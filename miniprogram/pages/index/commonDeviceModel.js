/**
 * 首页「常用仪器」的纯逻辑
 *
 * 输入是数据库原始记录（device_usage / reserves / devices），输出是三宫格卡片要的字段。
 * 这里不碰 wx.*，所以能被 `node tests/commonDeviceModel.test.js` 直接调用。
 *
 * 几个容易踩的点：
 *  - 使用记录的 start_time 是 toISOString()（UTC 串），预约的 start_time 是
 *    「YYYY-MM-DD HH:mm」本地串，两者统一走 utils/datetime.js 解析；
 *  - 同一台仪器按型号可能有多条 devices 记录（device_name 相同、device_id 不同），
 *    展示时必须按「名称 + 型号」合并，否则三张卡可能全是同一台仪器的不同编号；
 *  - 使用比预约更能说明「常用」，所以使用权重 3、预约权重 1；
 *  - 记录不够 3 台时用可预约仪器补位，补位卡片的 source 是 recommend。
 */

const datetime = require('../../utils/datetime.js')

const DEFAULT_LIMIT = 3
const MAX_LIMIT = 10
// 小程序端单次 get 上限 20 条，本地兜底统计只看最近这些记录
const RECENT_SCAN = 20
// 只有这两种预约状态代表「真的约上了」，cancelled / rejected 不算常用
const USABLE_RESERVE_STATUS = ['approved', 'completed']

const USAGE_WEIGHT = 3
const RESERVE_WEIGHT = 1

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 把 3 / '3' / 0 / -1 / 'abc' 都收成 1~MAX_LIMIT 之间的整数 */
function normalizeLimit(limit) {
  const num = Number(limit)
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(num), MAX_LIMIT)
}

/** 型号：specifications 里优先取「型号」，其次取 model */
function pickModel(device) {
  const specs = device && device.specifications
  if (!specs || typeof specs !== 'object') return ''
  return String(specs['型号'] || specs.model || '').trim()
}

/** 同一台仪器的合并键：名称 + 型号 */
function buildGroupKey(device) {
  const name = String((device && device.device_name) || '').trim()
  return `${name}::${pickModel(device)}`
}

/** 时间统一转毫秒，解析不了当 0（排到最后） */
function toTimestamp(value) {
  const date = datetime.parseDateTime(value)
  return date ? date.getTime() : 0
}

function scoreOf(item) {
  return (item.usage_count || 0) * USAGE_WEIGHT + (item.reserve_count || 0) * RESERVE_WEIGHT
}

function compareRank(left, right) {
  const diff = scoreOf(right) - scoreOf(left)
  if (diff !== 0) return diff
  const leftTs = left.last_ts || toTimestamp(left.last_raw)
  const rightTs = right.last_ts || toTimestamp(right.last_raw)
  if (rightTs !== leftTs) return rightTs - leftTs
  const leftId = String(left.device_id || left.key || '')
  const rightId = String(right.device_id || right.key || '')
  if (leftId === rightId) return 0
  return leftId < rightId ? -1 : 1
}

/** 按 device_id 汇总使用/预约次数与最近一次时间 */
function buildStats(usageRecords, reserveRecords) {
  const map = new Map()

  function ensureStat(deviceId, deviceName) {
    let item = map.get(deviceId)
    if (!item) {
      item = {
        device_id: deviceId,
        device_name: String(deviceName || '').trim(),
        usage_count: 0,
        reserve_count: 0,
        last_ts: 0,
        last_raw: ''
      }
      map.set(deviceId, item)
    }
    return item
  }

  function touch(item, rawTime) {
    const ts = toTimestamp(rawTime)
    if (ts && ts >= item.last_ts) {
      item.last_ts = ts
      item.last_raw = rawTime
    }
  }

  const usageList = usageRecords || []
  usageList.forEach((record) => {
    const deviceId = String((record && record.device_id) || '').trim()
    if (!deviceId) return
    const item = ensureStat(deviceId, record.device_name)
    item.usage_count += 1
    touch(item, record.start_time)
  })

  const reserveList = reserveRecords || []
  reserveList.forEach((record) => {
    const deviceId = String((record && record.device_id) || '').trim()
    if (!deviceId) return
    if (USABLE_RESERVE_STATUS.indexOf(record.status) === -1) return
    const item = ensureStat(deviceId, record.device_name)
    item.reserve_count += 1
    touch(item, record.start_time)
  })

  return map
}

/** Map / 数组都能排：权重 → 最近时间 → device_id */
function rankStats(stats) {
  const list = stats instanceof Map ? Array.from(stats.values()) : (stats || [])
  return list.slice().sort(compareRank)
}

/** 按排名取出要回表查设备的 device_id（最多 max 个） */
function collectDeviceIds(stats, max) {
  const limit = max && max > 0 ? max : RECENT_SCAN
  const ids = []
  rankStats(stats).forEach((stat) => {
    if (ids.length >= limit) return
    ids.push(stat.device_id)
  })
  return ids
}

/** [{ device_id, ... }] → { [device_id]: device } */
function buildDeviceMap(devices) {
  const map = {}
  ;(devices || []).forEach((device) => {
    const deviceId = String((device && device.device_id) || '').trim()
    if (deviceId) map[deviceId] = device
  })
  return map
}

/** 统一成页面要的中间结构（还没算 meta_text） */
function buildEntry(device, usageCount, reserveCount, lastRaw) {
  const usage = usageCount || 0
  const reserve = reserveCount || 0
  let source = 'recommend'
  if (usage > 0) source = 'usage'
  else if (reserve > 0) source = 'reserve'

  return {
    device_id: String(device.device_id || ''),
    device_name: String(device.device_name || '').trim(),
    picture: device.picture || '',
    lab_name: device.lab_name || '',
    device_room: device.device_room || '',
    specifications: device.specifications || null,
    source,
    usage_count: usage,
    reserve_count: reserve,
    last_ts: toTimestamp(lastRaw),
    last_raw: lastRaw || ''
  }
}

/** 统计结果 + 设备详情 → 每台一条 entry（同 device_id 一条） */
function buildEntries(stats, deviceMap) {
  const entries = []
  rankStats(stats).forEach((stat) => {
    const device = deviceMap && deviceMap[stat.device_id]
    if (!device) return
    entries.push(buildEntry(device, stat.usage_count, stat.reserve_count, stat.last_raw))
  })
  return entries
}

/** 可预约仪器 → 权重为 0 的补位 entry */
function buildRecommendEntries(devices) {
  const entries = []
  ;(devices || []).forEach((device) => {
    if (!device) return
    entries.push(buildEntry(device, 0, 0, ''))
  })
  return entries
}

function isRecommend(entry) {
  return !entry.usage_count && !entry.reserve_count
}

/**
 * 按「名称 + 型号」合并同名仪器，排序后取前 limit 台。
 * entries 里已带补位仪器时不要再外来补位。
 */
function mergeGroups(entries) {
  const groups = new Map()
  const names = new Set()

  ;(entries || []).forEach((entry) => {
    const key = buildGroupKey(entry)
    const exist = groups.get(key)
    if (exist) {
      exist.usage_count += entry.usage_count || 0
      exist.reserve_count += entry.reserve_count || 0
      // 云函数返回的 entry 只有 last_raw，不能拿 last_ts 比，统一按原始时间比
      if (toTimestamp(entry.last_raw) > toTimestamp(exist.last_raw)) {
        exist.last_raw = entry.last_raw || ''
        exist.device = entry
      }
      return
    }
    const name = String(entry.device_name || '').trim()
    // 补位仪器按名称去重，避免三张卡都是同一台仪器的不同编号
    if (isRecommend(entry) && names.has(name)) return
    names.add(name)
    groups.set(key, {
      key,
      device: entry,
      usage_count: entry.usage_count || 0,
      reserve_count: entry.reserve_count || 0,
      last_raw: entry.last_raw || ''
    })
  })

  return Array.from(groups.values()).sort(compareRank)
}

function groupToEntry(group) {
  return buildEntry(group.device, group.usage_count, group.reserve_count, group.last_raw)
}

/** entry 列表 → 最终的 top limit 台（每台一条 entry） */
function buildListFromEntries(entries, limit) {
  return mergeGroups(entries)
    .slice(0, normalizeLimit(limit))
    .map(groupToEntry)
}

/** 本地兜底：统计 + 设备 + 可预约仪器一把算完 */
function buildLocalList(stats, deviceMap, availableDevices, limit) {
  const entries = buildEntries(stats, deviceMap)
    .concat(buildRecommendEntries(availableDevices))
  return buildListFromEntries(entries, limit)
}

/** 最近时间是「今天 / 昨天 / 3月8日 / 2025年12月19日」 */
function formatRecentText(rawValue, now) {
  const date = datetime.parseDateTime(rawValue)
  if (!date) return ''
  const base = now ? new Date(now) : new Date()
  if (datetime.isSameDay(date, base)) return '今天'
  const yesterday = new Date(base.getTime() - MS_PER_DAY)
  if (datetime.isSameDay(date, yesterday)) return '昨天'
  if (date.getFullYear() === base.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** 卡片第二行文案：用过 5 次 · 今天 / 最近用过 · 昨天 / 预约 2 次 · 3月8日 / 推荐 */
function buildMetaText(entry, now) {
  if (!entry) return ''
  if (entry.source === 'usage') {
    const recent = formatRecentText(entry.last_raw, now)
    const head = entry.usage_count > 1 ? `用过 ${entry.usage_count} 次` : '最近用过'
    return recent ? `${head} · ${recent}` : head
  }
  if (entry.source === 'reserve') {
    const recent = formatRecentText(entry.last_raw, now)
    const head = entry.reserve_count > 1 ? `预约 ${entry.reserve_count} 次` : '最近预约'
    return recent ? `${head} · ${recent}` : head
  }
  if (entry.source === 'recommend') return '推荐'
  return ''
}

/** 一张卡片：图片先用 fileID，云函数/兜底都拿 fileID，再由页面换成临时链接 */
function buildCard(entry, now) {
  return {
    device_id: entry.device_id,
    device_name: entry.device_name,
    picture: entry.picture,
    lab_name: entry.lab_name,
    device_room: entry.device_room,
    source: entry.source,
    meta_text: buildMetaText(entry, now),
    imgFailed: false
  }
}

function buildCards(list, now) {
  return (list || []).map((entry) => buildCard(entry, now))
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  RECENT_SCAN,
  USABLE_RESERVE_STATUS,
  USAGE_WEIGHT,
  RESERVE_WEIGHT,
  normalizeLimit,
  pickModel,
  buildGroupKey,
  toTimestamp,
  scoreOf,
  buildStats,
  rankStats,
  collectDeviceIds,
  buildDeviceMap,
  buildEntry,
  buildEntries,
  buildRecommendEntries,
  mergeGroups,
  buildListFromEntries,
  buildLocalList,
  formatRecentText,
  buildMetaText,
  buildCard,
  buildCards
}
