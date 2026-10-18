/**
 * 时间解析与展示的公共工具
 *
 * 这套逻辑原来散落在 reserve-detail / duty-list 里，各自实现一遍、各自有坑：
 * - 'YYYY-MM-DD HH:mm' 在部分小程序的 JS 核心里解析不出结果，必须先拆成数字再构造；
 * - 云端写入的是 toISOString()（带 Z 的 UTC），直接本地格式化即可，不需要手工加 8 小时。
 * 这里统一收口，页面只负责取字段。
 */

function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * 把任意时间写法解析成 Date，解析不出来返回 null（绝不返回 Invalid Date）
 * 支持：Date / 时间戳 / 'YYYY-MM-DD HH:mm[:ss]'（含 / 分隔）/ 带时区的 ISO 字符串
 */
function parseDateTime(rawValue) {
  if (!rawValue) return null
  if (rawValue instanceof Date) {
    return Number.isNaN(rawValue.getTime()) ? null : rawValue
  }
  if (typeof rawValue === 'number') {
    const fromTs = new Date(rawValue)
    return Number.isNaN(fromTs.getTime()) ? null : fromTs
  }

  const text = String(rawValue).trim()
  if (!text) return null

  // 本地时间写法：拆成数字按本地时区构造，避免 iOS 上 'YYYY-MM-DD HH:mm' 解析失败
  const local = text
    .replace(/\//g, '-')
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (local) {
    const date = new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4] || 0),
      Number(local[5] || 0),
      Number(local[6] || 0)
    )
    return Number.isNaN(date.getTime()) ? null : date
  }

  // 带时区的 ISO 字符串交给运行时
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isSameDay(left, right) {
  if (!left || !right) return false
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function formatClock(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 'YYYY-MM-DD'，用于分组或比较日期（无法解析时返回空串） */
function formatDateKey(rawValue) {
  const date = parseDateTime(rawValue)
  if (!date) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** '今天 14:20' / '昨天 09:05' / '3月8日 14:20' / '2025年12月19日 14:20' */
function formatMoment(rawValue) {
  const date = parseDateTime(rawValue)
  if (!date) return ''
  const clock = formatClock(date)
  const now = new Date()
  if (isSameDay(date, now)) return `今天 ${clock}`
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (isSameDay(date, yesterday)) return `昨天 ${clock}`
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
}

/** '2026-07-10' + '19:00 - 19:30'；跨天时结束时间带上日期 */
function formatTimeRange(startValue, endValue) {
  const start = parseDateTime(startValue)
  if (!start) return { dateDisplay: '', timeDisplay: '' }

  const dateDisplay = formatDateKey(start)
  const startClock = formatClock(start)
  const end = parseDateTime(endValue)
  if (!end) return { dateDisplay, timeDisplay: startClock }

  const endClock = formatClock(end)
  const timeDisplay = isSameDay(start, end)
    ? `${startClock} - ${endClock}`
    : `${startClock} - ${pad2(end.getMonth() + 1)}-${pad2(end.getDate())} ${endClock}`
  return { dateDisplay, timeDisplay }
}

/** 是否在最近 N 天内（含今天；未来时间不算） */
function isWithinDays(rawValue, days) {
  const date = parseDateTime(rawValue)
  if (!date) return false
  const diff = Date.now() - date.getTime()
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000
}

module.exports = {
  pad2,
  parseDateTime,
  isSameDay,
  formatDateKey,
  formatMoment,
  formatTimeRange,
  isWithinDays
}
