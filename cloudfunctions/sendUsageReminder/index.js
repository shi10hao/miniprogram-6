const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const TEMPLATE_ID = 'rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk'
const REMINDER_INTERVAL_MS = 3 * 60 * 60 * 1000 // 3小时
const PAGE_SIZE = 100

exports.main = async () => {
  try {
    const now = new Date()
    const activeUsages = await fetchAllByWhere('device_usage', {
      status: 'using'
    })
    const results = []

    for (const usage of activeUsages) {
      // 2. 判断逻辑改为从开始时间算起
      const startTime = new Date(usage.start_time)
      if (Number.isNaN(startTime.getTime())) {
        results.push({
          id: usage._id,
          skipped: true,
          reason: 'invalid_start_time'
        })
        continue
      }

      const elapsed = now.getTime() - startTime.getTime()
      if (elapsed < REMINDER_INTERVAL_MS) {
        results.push({
          id: usage._id,
          skipped: true,
          reason: 'less_than_3h_from_start'
        })
        continue
      }

      // 计算已过去的完整3小时周期数
      const cyclesPassed = Math.floor(elapsed / REMINDER_INTERVAL_MS)

      // 计算已提醒的次数
      const remindedCycles = usage.last_reminder_time
        ? Math.floor((new Date(usage.last_reminder_time).getTime() - startTime.getTime()) / REMINDER_INTERVAL_MS)
        : 0

      if (cyclesPassed === remindedCycles) {
        results.push({
          id: usage._id,
          skipped: true,
          reason: 'already_reminded_for_current_cycle'
        })
        continue
      }

      if (!usage.user_id) {
        results.push({
          id: usage._id,
          skipped: true,
          reason: 'missing_user_id'
        })
        continue
      }

      const timeBucket = getReminderTimeBucket(now)
      const messageKey = `usage_photo_remind:${usage._id}:${timeBucket}`
      const messageDocId = buildUsageReminderDocId(usage._id, timeBucket)
      let messageCreated = false

      try {
        // 只创建、不覆盖：doc().set() 会把用户已经读过的那条消息重新写成未读，
        // 表现为「每次提醒后红点又回来了」。add 带自定义 _id 时重复插入会报错，正好当幂等判断。
        await db.collection('messages').add({
          data: Object.assign({ _id: messageDocId }, buildUsageReminderMessage(usage, now, messageKey))
        })
        messageCreated = true
      } catch (messageErr) {
        const errMsg = String((messageErr && (messageErr.errMsg || messageErr.message)) || '')
        const errCode = messageErr && messageErr.errCode
        const duplicated = errCode === -502001 || /duplicate|E11000|already exists|已存在/i.test(errMsg)
        if (duplicated) {
          // 本周期的站内消息之前就写过了，跳过写库、继续看订阅消息要不要补发
          console.log('本周期的提醒消息已存在，跳过写入:', messageDocId)
        } else {
          console.error('写入使用提醒消息失败:', usage._id, messageErr)
          results.push({
            id: usage._id,
            error: 'message_write_failed',
            detail: String(messageErr)
          })
          continue
        }
      }

      // 站内消息用固定 docId 写、天然幂等，只是「已经提醒过」的记账；
      // 订阅消息能不能发，由上面「周期判断 + last_reminder_time」决定：
      // 能走到这里就说明本周期的 last_reminder_time 还没被推进，该发就发。
      // （旧实现拿 messageCreated 当开关：第一次发送失败时 last_reminder_time 没推进、
      //   但消息文档已经建好，于是 messageCreated 恒为 false，永远不再重试。）
      let subscribeResult = 'skipped'
      try {
        const openId = await resolveUsageOpenId(usage)
        if (openId) {
          await cloud.openapi.subscribeMessage.send({
            touser: openId,
            templateId: TEMPLATE_ID,
            page: 'pages/usage/usage',
            data: {
              thing1: {
                value: clipText(usage.device_name || '仪器', 20)
              },
              thing9: {
                value: clipText('请到仪器使用页，上传“使用中照片”', 20)
              },
              time4: {
                value: formatTime(now)
              }
            }
          })
          subscribeResult = 'sent'
        } else {
          console.error('发送使用提醒订阅消息失败: 未找到 openid, usage._id:', usage._id)
          subscribeResult = 'failed'
        }
      } catch (sendErr) {
        subscribeResult = 'failed'
        console.error('发送使用提醒订阅消息失败:', usage._id, '错误详情:', JSON.stringify(sendErr))
      }

      if (subscribeResult === 'sent') {
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
      } else {
        // 订阅消息发送失败时，不更新 last_reminder_time，下次还会重试
        console.log('订阅消息未成功发送，跳过更新 last_reminder_time，下次将重试')
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
  const usageStart = formatUsageStart(usage.start_time)

  return {
    user_id: usage.user_id,
    title: '仪器使用拍照提醒',
    content: `您正在使用${usage.device_name || '仪器'}，已达到3小时提醒节点。请前往“仪器使用”页的“上传照片板块”上传照片，补齐使用过程记录。开始时间：${usageStart}。`,
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

/**
 * 站内消息里的「开始时间」：字符串原样透传
 *
 * device_usage.start_time 存的就是 'YYYY-MM-DD HH:mm'（用户在东八区面板里选的），
 * 先 new Date() 再格式化会被云函数运行时区二次偏移（运行时时区可能不是东八区，
 * '2026-11-09 09:00' 会被当成 UTC，最终显示成 17:00）。
 * @param {string|Date} value 开始时间
 * @returns {string}
 */
function formatUsageStart(value) {
  if (!value) return '当前使用时段'
  if (typeof value === 'string') return value
  return formatTime(value instanceof Date ? value : new Date(value))
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

// time4 用中文年月日时分：微信 time 类型支持 "2019年10月1日 15:01"，
// 而纯 "YYYY-MM-DD HH:mm" 属于「日期+时间」拼接，有被拒（47003）的风险。
// 时区固定按上海算（云函数运行时时区不保证是东八区）。
const CHINA_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ''
  }
  const parts = CHINA_TIME_FORMAT.formatToParts(date)
  const pick = (type) => {
    const hit = parts.find(item => item.type === type)
    return hit ? hit.value : ''
  }
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  const hour = pick('hour')
  const minute = pick('minute')
  if (!year || !month || !day) return ''
  return `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`
}
