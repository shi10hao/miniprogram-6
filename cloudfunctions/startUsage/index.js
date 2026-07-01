const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async event => {
  const reserveId = event && event.reserveId ? String(event.reserveId).trim() : ''
  const startPhotoId = event && event.startPhotoId ? String(event.startPhotoId).trim() : ''
  const userInfo = event && event.userInfo ? event.userInfo : {}
  const userId = String(userInfo.userId || '').trim()

  if (!reserveId || !startPhotoId || !userId) {
    return buildErrorResult('INVALID_PARAMS', '开始使用参数不完整')
  }

  const transaction = await db.startTransaction()

  try {
    const reserveRes = await transaction.collection('reserves').doc(reserveId).get()
    const reserve = reserveRes.data

    if (!reserve) {
      throw createBusinessError('RESERVE_NOT_FOUND', '当前时间无可开始使用的预约')
    }

    if (String(reserve.user_id || '').trim() !== userId) {
      throw createBusinessError('FORBIDDEN', '无权开始该预约')
    }

    if (reserve.status !== 'approved') {
      throw createBusinessError('INVALID_RESERVE_STATUS', '当前预约不可开始使用')
    }

    if (reserve.usage_status && reserve.usage_status !== 'not_started') {
      throw createBusinessError('ALREADY_STARTED', '该预约已开始使用，请勿重复操作')
    }

    const now = new Date()
    // if (!isWithinReservationWindow(reserve, now)) {
    //   throw createBusinessError('INVALID_TIME_WINDOW', '当前时间无可开始使用的预约')
    // }

    const existingUsageRes = await transaction.collection('device_usage')
      .where({ reserve_id: reserveId })
      .limit(1)
      .get()

    if (existingUsageRes.data && existingUsageRes.data.length > 0) {
      throw createBusinessError('ALREADY_STARTED', '该预约已开始使用，请勿重复操作')
    }

    const nowText = now.toISOString()
    const usageRecord = {
      reserve_id: reserveId,
      device_id: reserve.device_id,
      device_name: reserve.device_name,
      user_id: reserve.user_id,
      student_name: reserve.student_name || userInfo.name || '',
      group_name: reserve.research_group || userInfo.groupName || '',
      phone: reserve.phone || userInfo.phone || '',
      reserve_date: reserve.reserve_date || '',
      reserve_start_time: reserve.start_time || '',
      reserve_end_time: reserve.end_time || '',
      reserve_start_ts: resolveReservationTimestamp(reserve, 'start'),
      reserve_end_ts: resolveReservationTimestamp(reserve, 'end'),
      start_time: nowText,
      start_photo: startPhotoId,
      status: 'using',
      usage_images: [],
      last_reminder_time: nowText,
      create_time: nowText,
      _openid: reserve._openid || userInfo.openid || ''
    }

    const addRes = await transaction.collection('device_usage').add({
      data: usageRecord
    })

    await transaction.collection('reserves')
      .doc(reserveId)
      .update({
        data: {
          usage_status: 'active',
          linked_usage_id: addRes._id
        }
      })

    await transaction.commit()

    return {
      success: true,
      usageId: addRes._id
    }
  } catch (err) {
    await safeRollback(transaction)
    if (err && err.code) {
      return buildErrorResult(err.code, err.message)
    }

    if (await hasExistingUsageForReserve(reserveId)) {
      return buildErrorResult('ALREADY_STARTED', '该预约已开始使用，请勿重复操作')
    }

    console.error('startUsage 执行失败:', err)
    return buildErrorResult('START_USAGE_FAILED', '开始使用失败，请重试')
  }
}

function parseReservationTime(value) {
  if (!value) {
    return null
  }

  const text = String(value)
    .trim()
    .replace(/\//g, '-')
    .replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}(?::\d{2})?)$/, '$1 $2')
  const beijingMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T-](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
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

  const date = new Date(text.replace(' ', 'T'))
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

function isWithinReservationWindow(reserve, now = new Date()) {
  const startTs = resolveReservationTimestamp(reserve, 'start')
  const endTs = resolveReservationTimestamp(reserve, 'end')
  const nowTs = now.getTime()
  return !!(startTs && endTs && nowTs >= startTs && nowTs < endTs)
}

function createBusinessError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function buildErrorResult(code, error) {
  return {
    success: false,
    code,
    error
  }
}

async function hasExistingUsageForReserve(reserveId) {
  const res = await db.collection('device_usage')
    .where({ reserve_id: reserveId })
    .limit(1)
    .get()

  return !!(res.data && res.data.length > 0)
}

async function safeRollback(transaction) {
  try {
    await transaction.rollback()
  } catch (rollbackErr) {
    console.error('startUsage 回滚失败:', rollbackErr)
  }
}

exports.__test = {
  parseReservationTime,
  isWithinReservationWindow,
  resolveReservationTimestamp
}
