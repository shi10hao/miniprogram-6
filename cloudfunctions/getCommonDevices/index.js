// getCommonDevices：按「本人的使用记录 + 预约记录」算首页常看的仪器
// 排序权重：使用 3 分 / 预约 1 分，同分看最近一次时间；记录不足 limit 台时
// 用「可预约仪器」补位（source = recommend），保证首页三宫格不空。
// 入参：{ userInfo: { userId, groupName }, limit }
// 出参：{ code, msg, data: { list, hasHistory } }
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const $ = db.command.aggregate
const _ = db.command

const DEFAULT_LIMIT = 3
const MAX_LIMIT = 10
const MAX_KEYS = 30 // 参与排名的仪器上限，避免拉回整表
const MAX_RESERVE_ROWS = 60 // 预约分组行上限（先按次数粗筛，再按状态过滤）
const DEVICE_LIMIT = 100 // 云数据库单次 get 上限
const RECOMMEND_LIMIT = 20 // 补位候选数量

const USAGE_WEIGHT = 3
const RESERVE_WEIGHT = 1
const USABLE_RESERVE_STATUS = ['approved', 'completed']

const DEVICE_FIELD = {
  device_id: true,
  device_name: true,
  picture: true,
  lab_name: true,
  device_room: true,
  specifications: true
}

function normalizeLimit(limit) {
  const num = Number(limit)
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(num), MAX_LIMIT)
}

/** 使用记录是 ISO 串，预约是「YYYY-MM-DD HH:mm」本地串，比较大小前统一成时间戳 */
function toTimestamp(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  let text = String(value).trim().replace(' ', 'T')
  // 预约写的是北京时间但不带时区，补 +08:00 才不会跟 UTC 的 ISO 串差 8 小时
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    text += '+08:00'
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function buildVisibility(groupName) {
  if (groupName) {
    return _.or([{ lab_type: 'public' }, { lab_name: groupName }])
  }
  return { lab_type: 'public' }
}

/** 使用流水按 device_id 聚合：次数 + 最近一次开始时间 */
async function aggregateUsage(userId) {
  const res = await db.collection('device_usage')
    .aggregate()
    .match({ user_id: userId })
    .group({
      _id: '$device_id',
      count: $.sum(1),
      last: $.max('$start_time')
    })
    .sort({ count: -1, last: -1 })
    .limit(MAX_KEYS)
    .end()
  return (res && res.list) || []
}

/**
 * 预约按 device_id + status 聚合。
 * 这里不把 _.in 塞进 match（不同基础库版本对聚合 match 里的查询操作符支持不一致），
 * 先在 JS 里按状态过滤，效果一样且不会踩版本坑。
 */
async function aggregateReserves(userId) {
  const res = await db.collection('reserves')
    .aggregate()
    .match({ user_id: userId })
    .group({
      _id: { device_id: '$device_id', status: '$status' },
      count: $.sum(1),
      last: $.max('$start_time')
    })
    .sort({ count: -1 })
    .limit(MAX_RESERVE_ROWS)
    .end()
  return (res && res.list) || []
}

/** 两个聚合结果 → { [device_id]: { usage_count, reserve_count, last_raw } } */
function mergeStats(usageRows, reserveRows) {
  const map = new Map()

  function ensure(deviceId) {
    let item = map.get(deviceId)
    if (!item) {
      item = { device_id: deviceId, usage_count: 0, reserve_count: 0, last_raw: '' }
      map.set(deviceId, item)
    }
    return item
  }

  function touch(item, last) {
    if (!last) return
    if (toTimestamp(last) >= toTimestamp(item.last_raw)) {
      item.last_raw = last
    }
  }

  ;(usageRows || []).forEach((row) => {
    const deviceId = String((row && row._id) || '').trim()
    if (!deviceId) return
    const item = ensure(deviceId)
    item.usage_count += row.count || 0
    touch(item, row.last)
  })

  ;(reserveRows || []).forEach((row) => {
    const id = row && row._id
    const deviceId = String((id && id.device_id) || '').trim()
    if (!deviceId) return
    if (USABLE_RESERVE_STATUS.indexOf(id.status) === -1) return
    const item = ensure(deviceId)
    item.reserve_count += row.count || 0
    touch(item, row.last)
  })

  return map
}

function scoreOf(item) {
  return item.usage_count * USAGE_WEIGHT + item.reserve_count * RESERVE_WEIGHT
}

function compareRank(left, right) {
  const diff = scoreOf(right) - scoreOf(left)
  if (diff !== 0) return diff
  const tsDiff = toTimestamp(right.last_raw) - toTimestamp(left.last_raw)
  if (tsDiff !== 0) return tsDiff
  const leftId = String(left.device_id || '')
  const rightId = String(right.device_id || '')
  if (leftId === rightId) return 0
  return leftId < rightId ? -1 : 1
}

function toEntry(device, usageCount, reserveCount, lastRaw) {
  let source = 'recommend'
  if (usageCount > 0) source = 'usage'
  else if (reserveCount > 0) source = 'reserve'

  return {
    device_id: String(device.device_id || ''),
    device_name: String(device.device_name || '').trim(),
    picture: device.picture || '',
    lab_name: device.lab_name || '',
    device_room: device.device_room || '',
    specifications: device.specifications || null,
    source,
    usage_count: usageCount,
    reserve_count: reserveCount,
    last_raw: lastRaw || ''
  }
}

async function loadDevicesByIds(ids, groupName) {
  if (!ids.length) return []
  const res = await db.collection('devices')
    .where(_.and([{ device_id: _.in(ids) }, buildVisibility(groupName)]))
    .field(DEVICE_FIELD)
    .limit(DEVICE_LIMIT)
    .get()
  return res.data || []
}

/** 补位：当前可预约、且不是已经用过的那几台 */
async function loadRecommends(groupName, usedIds, limit) {
  const conditions = [{ status: 'available' }, buildVisibility(groupName)]
  if (usedIds.length) conditions.push({ device_id: _.nin(usedIds) })

  const res = await db.collection('devices')
    .where(_.and(conditions))
    .field(DEVICE_FIELD)
    .orderBy('device_id', 'asc')
    .limit(Math.max(limit, RECOMMEND_LIMIT))
    .get()
  return res.data || []
}

exports.main = async (event, context) => {
  try {
    // 兼容两种入参写法：{ userInfo: { userId, groupName } } 或扁平的 { userId, groupName }
    const userInfo = (event && event.userInfo) || event || {}
    const userId = String(userInfo.userId || '').trim()
    const groupName = String(userInfo.groupName || '').trim()
    const limit = normalizeLimit(event && event.limit)

    let stats = new Map()
    if (userId) {
      const rows = await Promise.all([
        aggregateUsage(userId),
        aggregateReserves(userId)
      ])
      stats = mergeStats(rows[0], rows[1])
    }

    const statsList = Array.from(stats.values()).sort(compareRank)
    const usedIds = statsList
      .slice(0, MAX_KEYS)
      .map((item) => item.device_id)
      .filter(Boolean)
    const devices = await loadDevicesByIds(usedIds, groupName)
    const deviceMap = new Map()
    devices.forEach((device) => {
      deviceMap.set(String(device.device_id || ''), device)
    })

    const entries = []
    statsList.forEach((item) => {
      const device = deviceMap.get(item.device_id)
      if (!device) return
      entries.push(toEntry(device, item.usage_count, item.reserve_count, item.last_raw))
    })

    if (entries.length < limit) {
      const recommends = await loadRecommends(groupName, usedIds, limit)
      recommends.forEach((device) => {
        entries.push(toEntry(device, 0, 0, ''))
      })
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        list: entries,
        hasHistory: entries.some((item) => item.source !== 'recommend')
      }
    }
  } catch (err) {
    console.error('[getCommonDevices] 查询常用仪器失败', err)
    return { code: -99, msg: '服务器异常', data: { list: [], hasHistory: false } }
  }
}
