/**
 * 设备实例详情页的数据整理逻辑
 *
 * 全部是纯函数：不碰 wx.*，时间基准由调用方传入（nowTs），可以直接在 node 里断言。
 * 页面只负责取数与 setData，展示口径统一收在这里，避免 WXML 里堆三元表达式。
 */

const { pad2, parseDateTime, formatClock } = require('../../../utils/datetime')

/** 时间轴展示窗口：08:00 - 22:00 */
const DAY_START_HOUR = 8
const DAY_END_HOUR = 22
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_WINDOW_MS = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_MS
/** 小于 1 分钟的空档不单独成行，否则时间轴全是碎片 */
const MIN_GAP_MS = MINUTE_MS

const DEVICE_STATUS_META = {
  available: { text: '空闲可预约', chipClass: 'chip-available' },
  using: { text: '使用中', chipClass: 'chip-using' },
  maintenance: { text: '维护中', chipClass: 'chip-maintenance' }
}

const USAGE_STATUS_META = {
  using: { text: '使用中', tagClass: 'ds-tag-primary' },
  completed: { text: '已完成', tagClass: 'ds-tag-success' },
  abnormal: { text: '异常结束', tagClass: 'ds-tag-danger' }
}

/** 任意写法的时间 → 毫秒时间戳，解析不出来返回 null */
function toTimestamp(value) {
  const date = parseDateTime(value)
  return date ? date.getTime() : null
}

function pickTimestamp(values) {
  const list = Array.isArray(values) ? values : [values]
  for (let i = 0; i < list.length; i += 1) {
    const ts = toTimestamp(list[i])
    if (ts !== null) return ts
  }
  return null
}

/** 当天 08:00 的时间戳 */
function startOfWindow(nowTs) {
  const now = new Date(nowTs)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), DAY_START_HOUR, 0, 0).getTime()
}

function clockLabel(ts) {
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? '' : formatClock(date)
}

function dayKeyOf(ts) {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function shiftDayKey(ts, delta) {
  const date = new Date(ts)
  date.setDate(date.getDate() + delta)
  return dayKeyOf(date.getTime())
}

/** '今天' / '昨天' / '明天' / '6月3日' / '2025年12月19日' */
function formatDayLabel(ts, nowTs) {
  const key = dayKeyOf(ts)
  if (!key) return ''
  if (key === dayKeyOf(nowTs)) return '今天'
  if (key === shiftDayKey(nowTs, -1)) return '昨天'
  if (key === shiftDayKey(nowTs, 1)) return '明天'
  const date = new Date(ts)
  const now = new Date(nowTs)
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** 时长文案：'3 小时 20 分钟' / '45 分钟' / '0 分钟' */
function formatDuration(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '—'
  if (ms < MINUTE_MS) return ms <= 0 ? '0 分钟' : '不足 1 分钟'
  const totalMinutes = Math.floor(ms / MINUTE_MS)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours && minutes) return `${hours} 小时 ${minutes} 分钟`
  if (hours) return `${hours} 小时`
  return `${minutes} 分钟`
}

function getPersonName(source) {
  if (!source) return '未知用户'
  const name = source.student_name || source.user_name || source.research_group || source.user_id
  return name ? String(name).trim() : '未知用户'
}

function getFeedbackText(usage) {
  const feedback = usage && usage.feedback
  if (!feedback) return ''
  return String(feedback.content || feedback.title || '').trim()
}

/** 型号可能写在规格里，老数据还留着乱码键名 */
function getDeviceModel(device, specList) {
  const specs = device && device.specifications && typeof device.specifications === 'object'
    ? device.specifications
    : {}
  const fromSpecs = (specList || []).filter(item => item.key === '型号')[0]
  if (fromSpecs && fromSpecs.value) return fromSpecs.value
  return String(specs['型号'] || specs['鍨嬪彿'] || device.model || device.device_type || '').trim()
}

/** specifications 是自由对象，过滤空值、去掉和「型号」重复的乱码键 */
function normalizeSpecs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const hasProperModelKey = String(raw['型号'] || '').trim().length > 0
  return Object.keys(raw)
    .filter(key => key && !(hasProperModelKey && key === '鍨嬪彿'))
    .map(key => ({
      key,
      value: raw[key] === null || raw[key] === undefined ? '' : String(raw[key]).trim()
    }))
    .filter(item => item.value)
}

/**
 * 顶部身份区
 * @param {object} device devices 集合里的文档
 * @param {object|null} activeUsage 正在进行的 usage
 * @param {number} nowTs
 */
function buildDeviceView(device, activeUsage, nowTs) {
  const source = device || {}
  const now = typeof nowTs === 'number' ? nowTs : Date.now()
  const specs = normalizeSpecs(source.specifications)
  const usage = activeUsage || null
  let statusKey = DEVICE_STATUS_META[source.status] ? source.status : 'unknown'
  // 有进行中的使用记录时，状态以使用记录为准（设备文档的 status 可能还没回写）
  if (usage) statusKey = 'using'
  const meta = DEVICE_STATUS_META[statusKey] || { text: '状态未知', chipClass: 'chip-none' }
  const startTs = usage ? toTimestamp(usage.start_time) : null
  const description = String(source.description || '').trim()
  const elapsedText = startTs === null ? '' : formatDuration(Math.max(now - startTs, 0))
  const startText = startTs === null ? '' : `${formatDayLabel(startTs, now)} ${clockLabel(startTs)}`

  return {
    deviceId: String(source.device_id || ''),
    deviceName: String(source.device_name || '未命名仪器'),
    labName: String(source.lab_name || ''),
    room: String(source.device_room || ''),
    labType: String(source.lab_type || ''),
    deviceType: String(source.device_type || ''),
    model: getDeviceModel(source, specs),
    statusKey,
    statusText: meta.text,
    chipClass: meta.chipClass,
    isUsing: statusKey === 'using',
    usingUser: usage ? getPersonName(usage) : '',
    usingDetail: usage && elapsedText ? `${startText} 开始 · 已用 ${elapsedText}` : '',
    description,
    hasDescription: description.length > 0,
    specs
  }
}

/** 找出进行中的使用记录：优先 status=using，其次「没有结束时间且已开始」的最新一条 */
function findActiveUsage(usages, nowTs) {
  if (!Array.isArray(usages) || !usages.length) return null
  const now = typeof nowTs === 'number' ? nowTs : Date.now()
  const running = usages.filter(item => item && item.status === 'using')[0]
  if (running) return running
  const openList = usages.filter((item) => {
    if (!item) return false
    const startTs = toTimestamp(item.start_time)
    return !item.end_time && item.status !== 'completed' && startTs !== null && startTs <= now
  })
  if (!openList.length) return null
  return openList.reduce((latest, item) => (
    toTimestamp(item.start_time) > toTimestamp(latest.start_time) ? item : latest
  ))
}

function buildUsageEvents(usages, nowTs) {
  if (!Array.isArray(usages)) return []
  const events = []
  usages.forEach((usage) => {
    if (!usage) return
    const startTs = toTimestamp(usage.start_time)
    if (startTs === null) return
    const endTs = toTimestamp(usage.end_time)
    const isOngoing = usage.status === 'using'
    const hasEnd = endTs !== null
    const meta = USAGE_STATUS_META[usage.status] || USAGE_STATUS_META.completed
    const subtitleParts = []
    if (isOngoing) {
      subtitleParts.push(`使用中 · 已用 ${formatDuration(Math.max(nowTs - startTs, 0))}`)
    } else if (!hasEnd) {
      // 老数据可能只有开始时间，不能当成「刚结束」，时长按未知处理
      subtitleParts.push('结束时间缺失，时长无法统计')
    } else {
      subtitleParts.push(meta.text + (usage.reserve_id ? ' · 由预约转入' : ''))
    }
    if (usage.status === 'abnormal' && usage.abnormal_reason) {
      subtitleParts.push(`异常原因：${String(usage.abnormal_reason).trim()}`)
    }
    events.push({
      key: `usage-${usage._id || startTs}`,
      type: 'usage',
      startTs,
      endTs: hasEnd ? endTs : (isOngoing ? nowTs : startTs),
      durationUnknown: !hasEnd && !isOngoing,
      title: getPersonName(usage),
      subtitle: subtitleParts.join('；'),
      tagText: isOngoing ? '进行中' : (usage.status === 'abnormal' ? '异常' : ''),
      tagClass: isOngoing ? 'ds-tag-primary' : 'ds-tag-danger',
      isOngoing,
      isAbnormal: usage.status === 'abnormal'
    })
  })
  return events
}

/** 'YYYY-MM-DD' + 'HH:mm' 拼成可解析的时间串；start_time 已经是完整时间时直接用 */
function joinDateTime(dateValue, timeValue) {
  const timeText = timeValue === null || timeValue === undefined ? '' : String(timeValue).trim()
  if (!timeText) return ''
  if (timeText.indexOf('-') > 0 || timeText.indexOf('T') > 0) return timeText
  const dateText = dateValue === null || dateValue === undefined ? '' : String(dateValue).trim()
  return dateText ? `${dateText} ${timeText}` : ''
}

function buildReserveEvents(reserves, usages, nowTs) {
  if (!Array.isArray(reserves) || !reserves.length) return []
  const linkedReserveIds = {}
  const linkedUsageIds = {}
  const usageList = Array.isArray(usages) ? usages : []
  usageList.forEach((usage) => {
    if (!usage) return
    if (usage.reserve_id) linkedReserveIds[usage.reserve_id] = true
    if (usage._id) linkedUsageIds[usage._id] = true
  })

  const events = []
  reserves.forEach((reserve) => {
    if (!reserve) return
    if (reserve.status && reserve.status !== 'approved') return
    // 预约转成使用记录后不再重复占位；usage_status 只认 completed，active 可能还没生成记录
    if (reserve._id && linkedReserveIds[reserve._id]) return
    if (reserve.linked_usage_id && linkedUsageIds[reserve.linked_usage_id]) return
    if (reserve.usage_status === 'completed') return

    const startTs = pickTimestamp([
      reserve.start_ts,
      reserve.start_time,
      joinDateTime(reserve.reserve_date, reserve.start_time)
    ])
    if (startTs === null) return
    const endTs = pickTimestamp([
      reserve.end_ts,
      reserve.end_time,
      joinDateTime(reserve.reserve_date, reserve.end_time)
    ])
    const safeEnd = endTs !== null && endTs > startTs ? endTs : startTs + HOUR_MS
    const isOngoing = nowTs >= startTs && nowTs < safeEnd
    events.push({
      key: `reserve-${reserve._id || startTs}`,
      type: 'reserve',
      startTs,
      endTs: safeEnd,
      durationUnknown: false,
      title: getPersonName(reserve),
      subtitle: (isOngoing ? '预约时段进行中' : '已预约')
        + (reserve.research_group ? ` · ${String(reserve.research_group).trim()}` : ''),
      tagText: isOngoing ? '进行中' : '预约',
      tagClass: isOngoing ? 'ds-tag-success' : 'ds-tag-warning',
      isOngoing,
      isAbnormal: false
    })
  })
  return events
}

function toPercent(ts, dayStartTs) {
  const ratio = (ts - dayStartTs) / DAY_WINDOW_MS
  return Math.min(Math.max(Math.round(ratio * 1000) / 10, 0), 100)
}

function toWidthPercent(startTs, endTs) {
  const width = ((endTs - startTs) / DAY_WINDOW_MS) * 100
  return Math.min(Math.max(Math.round(width * 10) / 10, 0.6), 100)
}

function buildIdleItem(startTs, endTs, dayStartTs) {
  return {
    key: `idle-${startTs}`,
    type: 'idle',
    startClock: clockLabel(startTs),
    endClock: clockLabel(endTs),
    timeLabel: `${clockLabel(startTs)} – ${clockLabel(endTs)}`,
    durationText: formatDuration(endTs - startTs),
    title: '空闲',
    subtitle: '',
    tagText: '',
    tagClass: '',
    isIdle: true,
    isUsage: false,
    isReserve: false,
    isOngoing: false,
    isAbnormal: false,
    leftPercent: toPercent(startTs, dayStartTs),
    widthPercent: toWidthPercent(startTs, endTs)
  }
}

function buildEventItem(event, startTs, endTs, dayStartTs) {
  return {
    key: event.key,
    type: event.type,
    startClock: clockLabel(startTs),
    endClock: clockLabel(endTs),
    timeLabel: `${clockLabel(startTs)} – ${clockLabel(endTs)}`,
    durationText: event.durationUnknown ? '时长未知' : formatDuration(endTs - startTs),
    title: event.title,
    subtitle: event.subtitle,
    tagText: event.tagText,
    tagClass: event.tagClass,
    isIdle: false,
    isUsage: event.type === 'usage',
    isReserve: event.type === 'reserve',
    isOngoing: !!event.isOngoing,
    isAbnormal: !!event.isAbnormal,
    leftPercent: toPercent(startTs, dayStartTs),
    widthPercent: toWidthPercent(startTs, endTs)
  }
}

/** 按 cursor 裁剪重叠、补空档，产出可直接渲染的行 */
function layoutEvents(events, dayStartTs, dayEndTs) {
  const items = []
  const stats = { usageMs: 0, reserveMs: 0, usageCount: 0 }
  let cursor = dayStartTs

  events.forEach((event) => {
    const startTs = Math.max(event.startTs, cursor)
    const endTs = Math.min(event.endTs, dayEndTs)
    if (endTs < startTs) return
    if (startTs - cursor >= MIN_GAP_MS) {
      items.push(buildIdleItem(cursor, startTs, dayStartTs))
    }
    items.push(buildEventItem(event, startTs, endTs, dayStartTs))
    const durationMs = Math.max(endTs - startTs, 0)
    if (event.type === 'usage') {
      stats.usageMs += durationMs
      stats.usageCount += 1
    } else {
      stats.reserveMs += durationMs
    }
    cursor = Math.max(cursor, endTs)
  })

  if (dayEndTs - cursor >= MIN_GAP_MS) {
    items.push(buildIdleItem(cursor, dayEndTs, dayStartTs))
  }
  return { items, stats }
}

function buildStatsView(raw) {
  const busyMs = raw.usageMs + raw.reserveMs
  const idleMs = Math.max(DAY_WINDOW_MS - busyMs, 0)
  const ratio = DAY_WINDOW_MS > 0 ? Math.min(busyMs / DAY_WINDOW_MS, 1) : 0
  const percent = Math.round(ratio * 100)
  return {
    windowText: `${pad2(DAY_START_HOUR)}:00 – ${pad2(DAY_END_HOUR)}:00`,
    usageText: formatDuration(raw.usageMs),
    reserveText: formatDuration(raw.reserveMs),
    idleText: formatDuration(idleMs),
    utilPercent: percent,
    utilText: `${percent}%`,
    usageCount: raw.usageCount
  }
}

/**
 * 今日时间轴 + 概览
 * @param {{usages?: Array, reserves?: Array, nowTs?: number}} options
 */
function buildTodayTimeline(options) {
  const opts = options || {}
  const nowTs = typeof opts.nowTs === 'number' ? opts.nowTs : Date.now()
  const dayStartTs = startOfWindow(nowTs)
  const dayEndTs = dayStartTs + DAY_WINDOW_MS
  const events = buildUsageEvents(opts.usages, nowTs)
    .concat(buildReserveEvents(opts.reserves, opts.usages, nowTs))

  const inWindow = events.filter((event) => {
    const startTs = Math.max(event.startTs, dayStartTs)
    const endTs = Math.min(event.endTs, dayEndTs)
    return endTs >= dayStartTs && startTs < dayEndTs
  }).map(event => ({
    key: event.key,
    type: event.type,
    startTs: Math.max(event.startTs, dayStartTs),
    endTs: Math.min(event.endTs, dayEndTs),
    durationUnknown: event.durationUnknown,
    title: event.title,
    subtitle: event.subtitle,
    tagText: event.tagText,
    tagClass: event.tagClass,
    isOngoing: event.isOngoing,
    isAbnormal: event.isAbnormal
  }))

  inWindow.sort((left, right) => {
    if (left.startTs !== right.startTs) return left.startTs - right.startTs
    return right.endTs - left.endTs
  })

  const layout = layoutEvents(inWindow, dayStartTs, dayEndTs)
  const blocks = layout.items.filter(item => !item.isIdle).map(item => ({
    key: item.key,
    type: item.type,
    left: item.leftPercent,
    width: item.widthPercent
  }))

  return {
    items: layout.items,
    blocks,
    hasActivity: blocks.length > 0,
    // 时间条上标出「现在」的位置，超过 22:00 或不到 08:00 就不画
    showNow: nowTs >= dayStartTs && nowTs <= dayEndTs,
    nowPercent: toPercent(Math.min(Math.max(nowTs, dayStartTs), dayEndTs), dayStartTs),
    stats: buildStatsView(layout.stats)
  }
}

/** 近期使用记录：按开始时间倒序，进行中的排最前 */
function buildRecentUsageViews(usages, nowTs, limit) {
  if (!Array.isArray(usages) || !usages.length) return []
  const now = typeof nowTs === 'number' ? nowTs : Date.now()
  const max = typeof limit === 'number' ? limit : 6
  const rows = []
  usages.forEach((usage) => {
    if (!usage) return
    const startTs = toTimestamp(usage.start_time)
    if (startTs === null) return
    const endTs = toTimestamp(usage.end_time)
    const isOngoing = usage.status === 'using'
    const meta = USAGE_STATUS_META[usage.status] || USAGE_STATUS_META.completed
    let durationText = '时长未知'
    if (endTs !== null) durationText = formatDuration(Math.max(endTs - startTs, 0))
    else if (isOngoing) durationText = formatDuration(Math.max(now - startTs, 0))
    rows.push({
      startTs,
      view: {
        key: `recent-${usage._id || startTs}`,
        title: getPersonName(usage),
        dayText: formatDayLabel(startTs, now),
        timeText: endTs === null ? `${clockLabel(startTs)} 起` : `${clockLabel(startTs)} – ${clockLabel(endTs)}`,
        durationText,
        statusText: meta.text,
        tagClass: meta.tagClass,
        isOngoing,
        isAbnormal: usage.status === 'abnormal',
        feedbackText: getFeedbackText(usage)
      }
    })
  })
  rows.sort((left, right) => right.startTs - left.startTs)
  return rows.slice(0, max).map(row => row.view)
}

/** 后续预约：只留还没结束的 approved 预约，按开始时间升序 */
function buildUpcomingReserveViews(reserves, usages, nowTs, limit) {
  if (!Array.isArray(reserves) || !reserves.length) return []
  const now = typeof nowTs === 'number' ? nowTs : Date.now()
  const max = typeof limit === 'number' ? limit : 5
  const linkedReserveIds = {}
  const linkedUsageIds = {}
  const usageList = Array.isArray(usages) ? usages : []
  usageList.forEach((usage) => {
    if (!usage) return
    if (usage.reserve_id) linkedReserveIds[usage.reserve_id] = true
    if (usage._id) linkedUsageIds[usage._id] = true
  })

  const rows = []
  reserves.forEach((reserve) => {
    if (!reserve) return
    if (reserve.status && reserve.status !== 'approved') return
    if (reserve._id && linkedReserveIds[reserve._id]) return
    if (reserve.linked_usage_id && linkedUsageIds[reserve.linked_usage_id]) return
    if (reserve.usage_status === 'completed') return

    const startTs = pickTimestamp([
      reserve.start_ts,
      reserve.start_time,
      joinDateTime(reserve.reserve_date, reserve.start_time)
    ])
    if (startTs === null) return
    const endTs = pickTimestamp([
      reserve.end_ts,
      reserve.end_time,
      joinDateTime(reserve.reserve_date, reserve.end_time)
    ])
    const safeEnd = endTs !== null && endTs > startTs ? endTs : startTs + HOUR_MS
    if (safeEnd < now) return
    const isOngoing = now >= startTs && now < safeEnd
    rows.push({
      startTs,
      view: {
        key: `upcoming-${reserve._id || startTs}`,
        title: getPersonName(reserve),
        dayText: formatDayLabel(startTs, now),
        timeText: `${clockLabel(startTs)} – ${clockLabel(safeEnd)}`,
        groupText: String(reserve.research_group || '').trim(),
        statusText: isOngoing ? '进行中' : '已预约',
        tagClass: isOngoing ? 'ds-tag-success' : 'ds-tag-primary'
      }
    })
  })
  rows.sort((left, right) => left.startTs - right.startTs)
  return rows.slice(0, max).map(row => row.view)
}

module.exports = {
  DAY_START_HOUR,
  DAY_END_HOUR,
  DAY_WINDOW_MS,
  DEVICE_STATUS_META,
  USAGE_STATUS_META,
  toTimestamp,
  startOfWindow,
  formatDuration,
  formatDayLabel,
  getPersonName,
  normalizeSpecs,
  buildDeviceView,
  findActiveUsage,
  buildTodayTimeline,
  buildRecentUsageViews,
  buildUpcomingReserveViews
}
