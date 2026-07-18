const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const SLOT_LOCK_COLLECTION = 'reservation_slot_locks'

exports.main = async event => {
  const rawReserveData = event && event.reserveData ? event.reserveData : null
  const reserveData = rawReserveData ? normalizeReserveData(rawReserveData) : null
  if (!reserveData) {
    return buildErrorResult('INVALID_PARAMS', '预约参数不完整')
  }

  const validationError = validateReserveData(reserveData)
  if (validationError) {
    return buildErrorResult(validationError.code, validationError.message)
  }

  const useSlotLocks = await isSlotLockCollectionAvailable()
  const transaction = await db.startTransaction()

  try {
    const slotLockIds = buildSlotLockIds(reserveData)
    const overlapRes = await transaction.collection('reserves')
      .where(buildOverlapCondition(reserveData))
      .limit(1)
      .get()

    if (overlapRes.data && overlapRes.data.length > 0) {
      throw createBusinessError('TIME_CONFLICT', '该时间段与其他人预约时间段重叠')
    }

    if (useSlotLocks && slotLockIds.length > 0) {
      const existingLocksRes = await transaction.collection(SLOT_LOCK_COLLECTION)
        .where({
          _id: _.in(slotLockIds)
        })
        .limit(slotLockIds.length || 1)
        .get()

      if (existingLocksRes.data && existingLocksRes.data.length > 0) {
        throw createBusinessError('TIME_CONFLICT', '该时间段与其他人预约时间段重叠')
      }
    }

    const now = new Date().toISOString()
    const wxContext = cloud.getWXContext ? cloud.getWXContext() : {}
    const reserveRecord = Object.assign({}, reserveData, {
      create_time: now,
      status: 'approved',
      usage_status: 'not_started',
      start_reminder_sent: false,
      start_reminder_sent_at: '',
      linked_usage_id: '',
      _openid: reserveData._openid || wxContext.OPENID || ''
    })

    const addRes = await transaction.collection('reserves').add({
      data: reserveRecord
    })

    if (useSlotLocks && slotLockIds.length > 0) {
      await Promise.all(slotLockIds.map(slotLockId => (
        transaction.collection(SLOT_LOCK_COLLECTION)
          .doc(slotLockId)
          .set({
            data: buildSlotLockRecord(slotLockId, reserveRecord, addRes._id, now)
          })
      )))
    }

    await transaction.collection('messages')
      .doc(`reservation_success_${addRes._id}`)
      .set({
        data: buildReservationSuccessMessage(addRes._id, reserveRecord, now)
      })

    await transaction.commit()

    return {
      success: true,
      reserveId: addRes._id
    }
  } catch (err) {
    await safeRollback(transaction)
    if (err && err.code) {
      return buildErrorResult(err.code, err.message)
    }

    if (await hasOverlapReservation(reserveData) || await hasSlotLocks(reserveData)) {
      return buildErrorResult('TIME_CONFLICT', '该时间段与其他人预约时间段重叠')
    }

    console.error('createReservation 执行失败:', err)
    return buildErrorResult('CREATE_RESERVATION_FAILED', '预约失败，请重试')
  }
}

function normalizeReserveData(reserveData) {
  const startDate = parseReservationTime(reserveData.start_time)
  const endDate = parseReservationTime(reserveData.end_time)

  return Object.assign({}, reserveData, {
    start_ts: normalizeTimestamp(reserveData.start_ts, startDate),
    end_ts: normalizeTimestamp(reserveData.end_ts, endDate)
  })
}

function normalizeTimestamp(value, fallbackDate) {
  const timestamp = Number(value)
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return timestamp
  }
  return fallbackDate ? fallbackDate.getTime() : 0
}

function validateReserveData(reserveData) {
  const requiredFields = [
    'device_id',
    'device_name',
    'reserve_date',
    'start_time',
    'end_time',
    'user_id',
    'student_name',
    'research_group',
    'phone'
  ]

  for (const field of requiredFields) {
    if (!String(reserveData[field] || '').trim()) {
      return createBusinessError('INVALID_PARAMS', '预约参数不完整')
    }
  }

  const startDate = new Date(Number(reserveData.start_ts))
  const endDate = new Date(Number(reserveData.end_ts))
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) {
    return createBusinessError('INVALID_TIME', '预约时间无效')
  }

  // 修改：检查是否跨越超过2天
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000
  if (endDate.getTime() - startDate.getTime() > twoDaysMs) {
    return createBusinessError('INVALID_TIME', '预约最多跨越2天')
  }

  // 保留：时间必须以30分钟为单位
  const startMinute = startDate.getMinutes()
  const endMinute = endDate.getMinutes()
  if (![0, 30].includes(startMinute) || ![0, 30].includes(endMinute)) {
    return createBusinessError('INVALID_TIME', '预约时间需按 30 分钟为单位选择')
  }

  // 保留：开始时间必须晚于当前时间
  if (startDate.getTime() <= Date.now()) {
    return createBusinessError('INVALID_TIME', '预约开始时间必须晚于当前时间')
  }

  return null
}

// 【关键修改】移除 reserve_date 限制
function buildOverlapCondition(reserveData) {
  return _.and([
    {
      device_id: reserveData.device_id,
      status: 'approved'
    },
    _.or([
      _.and([
        { start_time: _.lte(reserveData.start_time) },
        { end_time: _.gt(reserveData.start_time) }
      ]),
      _.and([
        { start_time: _.lt(reserveData.end_time) },
        { end_time: _.gte(reserveData.end_time) }
      ]),
      _.and([
        { start_time: _.gte(reserveData.start_time) },
        { end_time: _.lte(reserveData.end_time) }
      ])
    ])
  ])
}

function buildReservationSuccessMessage(reserveId, reserveData, now) {
  return {
    user_id: reserveData.user_id,
    title: '预约成功',
    content: `您已成功预约${reserveData.device_name}，预约时间为${reserveData.start_time} 至 ${reserveData.end_time}。如需补传照片，请在开始使用后前往"仪器使用"页的"上传照片板块"。`,
    type: 'reservation_success',
    related_id: reserveId,
    message_key: `reservation_success:${reserveId}`,
    is_read: false,
    create_time: now
  }
}

async function hasOverlapReservation(reserveData) {
  const res = await db.collection('reserves')
    .where(buildOverlapCondition(reserveData))
    .limit(1)
    .get()

  return !!(res.data && res.data.length > 0)
}

async function hasSlotLocks(reserveData) {
  const slotLockIds = buildSlotLockIds(reserveData)
  if (slotLockIds.length === 0) {
    return false
  }

  let res
  try {
    res = await db.collection(SLOT_LOCK_COLLECTION)
      .where({
        _id: _.in(slotLockIds)
      })
      .limit(slotLockIds.length || 1)
      .get()
  } catch (err) {
    if (isCollectionMissingError(err)) {
      return false
    }
    throw err
  }

  return !!(res.data && res.data.length > 0)
}

// 【关键修改】slotLockIds 使用日期作为前缀，避免跨天冲突
function buildSlotLockIds(reserveData) {
  const startDate = new Date(Number(reserveData.start_ts) || 0)
  const endDate = new Date(Number(reserveData.end_ts) || 0)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) {
    return []
  }

  const deviceId = sanitizeIdPart(reserveData.device_id)
  const slotIds = []
  let cursor = new Date(startDate.getTime())

  while (cursor.getTime() < endDate.getTime()) {
    // 使用完整的日期时间作为 slot ID，而不是 reserve_date
    const datePrefix = formatDateForSlot(cursor)
    slotIds.push(`${deviceId}_${datePrefix}_${formatSlot(cursor)}`)
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000)
  }

  return slotIds
}

// 新增：格式化日期用于 slot ID
function formatDateForSlot(date) {
  const pad = n => String(n).padStart(2, '0')
  const beijingDate = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${beijingDate.getUTCFullYear()}${pad(beijingDate.getUTCMonth() + 1)}${pad(beijingDate.getUTCDate())}`
}

function buildSlotLockRecord(slotLockId, reserveRecord, reserveId, now) {
  return {
    slot_id: slotLockId,
    reserve_id: reserveId,
    device_id: reserveRecord.device_id,
    reserve_date: reserveRecord.reserve_date,
    start_time: reserveRecord.start_time,
    end_time: reserveRecord.end_time,
    user_id: reserveRecord.user_id,
    create_time: now
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

async function isSlotLockCollectionAvailable() {
  try {
    await db.collection(SLOT_LOCK_COLLECTION).limit(1).get()
    return true
  } catch (err) {
    if (isCollectionMissingError(err)) {
      console.warn(`${SLOT_LOCK_COLLECTION} 集合不存在，预约将仅使用 reserves 冲突校验`)
      return false
    }
    throw err
  }
}

function isCollectionMissingError(err) {
  const message = `${err && err.message ? err.message : ''} ${err && err.errMsg ? err.errMsg : ''}`
  return message.indexOf('DATABASE_COLLECTION_NOT_EXIST') !== -1 ||
    message.indexOf('collection not exists') !== -1 ||
    message.indexOf('Db or Table not exist') !== -1
}

function formatSlot(date) {
  const pad = n => String(n).padStart(2, '0')
  const beijingDate = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${pad(beijingDate.getUTCHours())}${pad(beijingDate.getUTCMinutes())}`
}

function sanitizeIdPart(value) {
  return String(value || '').replace(/[^0-9A-Za-z_-]/g, '_')
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

async function safeRollback(transaction) {
  try {
    await transaction.rollback()
  } catch (rollbackErr) {
    console.error('createReservation 回滚失败:', rollbackErr)
  }
}

exports.__test = {
  parseReservationTime,
  isCollectionMissingError
}