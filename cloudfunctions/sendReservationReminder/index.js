const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const TEMPLATE_ID = 'FClBgpZO9KXJ79M0ZAqqrEDoqWlXWPmRz862s6zVP4M'
const REMINDER_WINDOW_MS = 60 * 60 * 1000
const PAGE_SIZE = 100

exports.main = async () => {
  try {
    const now = new Date()
    const reservations = (await fetchAllReservationCandidates()).filter(item => {
      if (item.start_reminder_sent === true) {
        return false
      }

      const startTs = resolveReservationTimestamp(item, 'start')
      if (!startTs) {
        return false
      }

      const diff = startTs - now.getTime()
      return diff >= 0 && diff <= REMINDER_WINDOW_MS
    })

    const results = []

    for (const reserve of reservations) {
      if (!reserve.user_id) {
        results.push({ id: reserve._id, skipped: true, reason: 'missing_user_id' })
        continue
      }

      const messageKey = `reservation_remind:${reserve._id}`
      const messageDocId = buildReservationReminderDocId(reserve._id)
      let messageCreated = false

      try {
        const writeRes = await db.collection('messages')
          .doc(messageDocId)
          .set({
            data: buildReservationReminderMessage(reserve, now, messageKey)
          })
        messageCreated = !!(writeRes.stats && writeRes.stats.created > 0)
      } catch (messageErr) {
        console.error('写入预约开始提醒失败:', reserve._id, messageErr)
        results.push({ id: reserve._id, error: 'message_write_failed', detail: String(messageErr) })
        continue
      }

      let subscribeResult = messageCreated ? 'skipped' : 'skipped_existing_message'
      if (messageCreated) {
        try {
          if (reserve._openid) {
            await cloud.openapi.subscribeMessage.send({
              touser: reserve._openid,
              templateId: TEMPLATE_ID,
              page: 'pages/usage/usage',
              data: {
                thing1: { value: clipText(reserve.device_name || '仪器', 20) },
                time2: { value: clipText(reserve.start_time || formatDateTime(now), 20) },
                thing3: { value: clipText('您的预约将在1小时内开始，请按时使用', 20) }
              }
            })
            subscribeResult = 'sent'
          }
        } catch (sendErr) {
          subscribeResult = 'failed'
          console.error('发送预约开始订阅消息失败:', reserve._id, sendErr)
        }
      }

      try {
        await db.collection('reserves')
          .doc(reserve._id)
          .update({
            data: {
              start_reminder_sent: true,
              start_reminder_sent_at: now.toISOString()
            }
          })
      } catch (updateErr) {
        console.error('更新预约提醒状态失败:', reserve._id, updateErr)
        results.push({
          id: reserve._id,
          error: 'reserve_update_failed',
          subscribe: subscribeResult,
          messageKey,
          messageCreated,
          detail: String(updateErr)
        })
        continue
      }

      results.push({
        id: reserve._id,
        messageKey,
        messageWritten: messageCreated,
        messageCreated,
        subscribe: subscribeResult,
        updated: true
      })
    }

    return {
      success: true,
      processed: reservations.length,
      results
    }
  } catch (err) {
    console.error('sendReservationReminder 执行失败:', err)
    return {
      success: false,
      error: String(err)
    }
  }
}

async function fetchAllReservationCandidates() {
  let skip = 0
  const rows = []

  while (true) {
    const res = await db.collection('reserves')
      .where({
        status: 'approved',
        usage_status: 'not_started'
      })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()

    const pageRows = res.data || []
    rows.push(...pageRows)

    if (pageRows.length < PAGE_SIZE) {
      break
    }
    skip += PAGE_SIZE
  }

  return rows
}

function buildReservationReminderMessage(reserve, now, messageKey) {
  return {
    user_id: reserve.user_id,
    title: '预约开始提醒',
    content: `您预约的${reserve.device_name || '仪器'}将在1小时内开始使用。预约时间：${reserve.start_time || ''} 至 ${reserve.end_time || ''}，请按时到达实验室。`,
    type: 'reservation_remind',
    related_id: reserve._id,
    message_key: messageKey,
    is_read: false,
    create_time: now.toISOString()
  }
}

function buildReservationReminderDocId(reserveId) {
  return `reservation_remind_${reserveId}`
}

function parseReservationTime(value) {
  if (!value) {
    return null
  }

  const text = String(value).trim()
  if (!text) {
    return null
  }

  const normalized = text
    .replace(/\//g, '-')
    .replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}(?::\d{2})?)$/, '$1 $2')

  const beijingMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T-](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (beijingMatch) {
    const year = Number(beijingMatch[1])
    const month = Number(beijingMatch[2])
    const day = Number(beijingMatch[3])
    const hour = Number(beijingMatch[4] || 0)
    const minute = Number(beijingMatch[5] || 0)
    const second = Number(beijingMatch[6] || 0)
    const beijingDate = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, 0))
    return Number.isNaN(beijingDate.getTime()) ? null : beijingDate
  }

  const date = new Date(normalized.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function resolveReservationTimestamp(reserve, field) {
  const tsKey = `${field}_ts`
  const timeKey = `${field}_time`
  const timestamp = Number(reserve && reserve[tsKey])
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return timestamp
  }

  const date = parseReservationTime(reserve && reserve[timeKey])
  return date ? date.getTime() : 0
}

function formatDateTime(date) {
  const pad = n => String(n).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join(':')
}

function clipText(value, maxLength) {
  const text = String(value || '')
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}…`
}
