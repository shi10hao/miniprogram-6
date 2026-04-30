const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const TEMPLATE_ID = 'FClBgpZO9KXJ79M0ZAqqrEDoqWlXWPmRz862s6zVP4M'
const REMINDER_INTERVAL_MS = 30 * 60 * 1000
const PAGE_SIZE = 100

exports.main = async () => {
  try {
    const now = new Date()
    const activeUsages = await fetchAllByWhere('device_usage', { status: 'using' })
    const results = []

    for (const usage of activeUsages) {
      const lastReminder = usage.last_reminder_time
        ? new Date(usage.last_reminder_time)
        : new Date(usage.start_time)

      if (Number.isNaN(lastReminder.getTime())) {
        results.push({ id: usage._id, skipped: true, reason: 'invalid_last_reminder_time' })
        continue
      }

      if (now.getTime() - lastReminder.getTime() < REMINDER_INTERVAL_MS) {
        results.push({ id: usage._id, skipped: true, reason: 'interval_not_reached' })
        continue
      }

      if (!usage.user_id) {
        results.push({ id: usage._id, skipped: true, reason: 'missing_user_id' })
        continue
      }

      const timeBucket = getReminderTimeBucket(now)
      const messageKey = `usage_photo_remind:${usage._id}:${timeBucket}`
      const messageDocId = buildUsageReminderDocId(usage._id, timeBucket)
      let messageCreated = false

      try {
        const writeRes = await db.collection('messages')
          .doc(messageDocId)
          .set({
            data: buildUsageReminderMessage(usage, now, messageKey)
          })
        messageCreated = !!(writeRes.stats && writeRes.stats.created > 0)
      } catch (messageErr) {
        console.error('写入使用提醒消息失败:', usage._id, messageErr)
        results.push({ id: usage._id, error: 'message_write_failed', detail: String(messageErr) })
        continue
      }

      let subscribeResult = messageCreated ? 'skipped' : 'skipped_existing_message'
      if (messageCreated) {
        try {
          const openId = await resolveUsageOpenId(usage)
          if (openId) {
            await cloud.openapi.subscribeMessage.send({
              touser: openId,
              templateId: TEMPLATE_ID,
              page: 'pages/usage/usage',
              data: {
                thing1: { value: clipText(usage.device_name || '仪器', 20) },
                time2: { value: formatTime(new Date(usage.start_time || now.toISOString())) },
                thing3: { value: clipText('请到仪器使用页上传照片板块补传照片', 20) }
              }
            })
            subscribeResult = 'sent'
          }
        } catch (sendErr) {
          subscribeResult = 'failed'
          console.error('发送使用提醒订阅消息失败:', usage._id, sendErr)
        }
      }

      try {
        await db.collection('device_usage')
          .doc(usage._id)
          .update({
            data: {
              last_reminder_time: now.toISOString()
            }
          })
      } catch (updateErr) {
        console.error('更新使用提醒时间失败:', usage._id, updateErr)
        results.push({
          id: usage._id,
          error: 'usage_update_failed',
          subscribe: subscribeResult,
          messageKey,
          messageCreated,
          detail: String(updateErr)
        })
        continue
      }

      results.push({
        id: usage._id,
        messageKey,
        messageWritten: messageCreated,
        messageCreated,
        subscribe: subscribeResult,
        updated: true
      })
    }

    return {
      success: true,
      processed: activeUsages.length,
      results
    }
  } catch (err) {
    console.error('sendUsageReminder 执行失败:', err)
    return {
      success: false,
      error: String(err)
    }
  }
}

async function fetchAllByWhere(collectionName, whereCondition) {
  let skip = 0
  const rows = []

  while (true) {
    const res = await db.collection(collectionName)
      .where(whereCondition)
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

function buildUsageReminderMessage(usage, now, messageKey) {
  const usageStart = usage.start_time
    ? formatTime(new Date(usage.start_time))
    : '当前使用时段'

  return {
    user_id: usage.user_id,
    title: '仪器使用拍照提醒',
    content: `您正在使用${usage.device_name || '仪器'}，已达到30分钟提醒节点。请前往“仪器使用”页的“上传照片板块”上传照片，补齐使用过程记录。开始时间：${usageStart}。`,
    type: 'usage_photo_remind',
    related_id: usage._id,
    message_key: messageKey,
    is_read: false,
    create_time: now.toISOString()
  }
}

function buildUsageReminderDocId(usageId, timeBucket) {
  return `usage_photo_remind_${usageId}_${timeBucket}`
}

async function resolveUsageOpenId(usage) {
  if (usage._openid) {
    return usage._openid
  }

  if (!usage.reserve_id) {
    return ''
  }

  try {
    const reserveRes = await db.collection('reserves').doc(usage.reserve_id).get()
    return reserveRes.data && reserveRes.data._openid
      ? reserveRes.data._openid
      : ''
  } catch (err) {
    if (err && err.errCode !== -1) {
      console.error('查询预约 openid 失败:', usage.reserve_id, err)
    }
    return ''
  }
}

function getReminderTimeBucket(now) {
  return Math.floor(now.getTime() / REMINDER_INTERVAL_MS)
}

function clipText(value, maxLength) {
  const text = String(value || '')
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}…`
}

function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ''
  }

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
