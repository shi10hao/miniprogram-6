/**
 * 仪器使用页的纯逻辑
 *
 * 这里只做「原始记录 → 页面要展示的字段」的加工，不碰 wx.*，
 * 因此可以直接被 `node tests/usageModel.test.js` 调用（见 docs/code-style.md 第 4 节）。
 *
 * 几个容易踩的点：
 *  - 预约的 start_time / end_time 是「YYYY-MM-DD HH:mm」的北京时间字符串，
 *    使用记录的时间是 toISOString()，两者都必须走 utils/datetime.js 统一解析；
 *  - 云开发小程序端单次 get 上限 20 条，分页大小不能超过它；
 *  - 过期预约只保留「今天」的，更早的直接丢掉，避免列表被历史预约撑满。
 */

const datetime = require('../../utils/datetime.js')

const HISTORY_LIMIT = 10
const PENDING_LIMIT = 20
const PHOTO_LIMIT = 9

const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

const REMINDER_TYPES = ['reservation_remind', 'usage_photo_remind', 'usage_end_remind']
const PHOTO_REMINDER_TYPES = ['usage_photo_remind', 'usage_end_remind']

const RESERVE_NOT_STARTED = 'not_started'
const REMINDER_SUMMARY_MAX = 48

// 预约卡片三种状态：可开始 / 未到时间 / 已结束，权重决定排序（可开始的排最前）
const RESERVE_STATE_META = {
  ready: { text: '可开始', tagClass: 'ds-tag-success', weight: 0 },
  pending: { text: '未到时间', tagClass: 'ds-tag-warning', weight: 1 },
  expired: { text: '已结束', tagClass: 'ds-tag-muted', weight: 2 }
}

const USAGE_STATUS_META = {
  using: { text: '使用中', tagClass: 'ds-tag-warning' },
  completed: { text: '已完成', tagClass: 'ds-tag-success' },
  abnormal: { text: '异常结束', tagClass: 'ds-tag-danger' }
}

/**
 * 把毫秒差写成中文时长：不足 1 分钟 / 25 分钟 / 1 小时 20 分钟 / 2 天 3 小时
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const total = Number(ms)
  if (!Number.isFinite(total) || total <= 0) return '不足 1 分钟'

  const minutes = Math.floor(total / MS_PER_MINUTE)
  if (minutes < 1) return '不足 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) {
    return restMinutes ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`
  }

  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`
}

/** 'YYYY-MM-DD HH:mm'，解析不出来时原样返回，避免界面出现空白 */
function formatFullTime(value) {
  const date = datetime.parseDateTime(value)
  if (!date) return value ? String(value) : ''
  return `${datetime.formatDateKey(date)} ${datetime.formatClock(date)}`
}

/** 'YYYY-MM-DD' */
function formatDateOnly(value) {
  return datetime.formatDateKey(value)
}

/** 当天 0 点的时间戳（本地时区），用于「只关心今天及以后的预约」 */
function getDayStartTs(now) {
  const base = Number(now) || Date.now()
  const date = new Date(base)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * 预约的起止时间戳：优先用创建预约时写入的数字时间戳，老数据退回解析字符串
 * @param {Object} reserve
 * @param {'start'|'end'} field
 * @returns {number} 毫秒时间戳，取不到时为 0
 */
function getReserveTimestamp(reserve, field) {
  const tsValue = Number(reserve && reserve[`${field}_ts`])
  if (Number.isFinite(tsValue) && tsValue > 0) return tsValue

  const date = datetime.parseDateTime(reserve && reserve[`${field}_time`])
  return date ? date.getTime() : 0
}

/**
 * 使用记录的一段区间文案
 * 同一天：2026-11-06 15:52 - 15:53
 * 跨天：07-17 18:00 - 07-18 10:00
 */
function buildUsagePeriodText(startValue, endValue) {
  const start = datetime.parseDateTime(startValue)
  if (!start) return ''

  const startClock = datetime.formatClock(start)
  const end = datetime.parseDateTime(endValue)
  if (!end) return `${datetime.formatDateKey(start)} ${startClock}`

  if (datetime.isSameDay(start, end)) {
    return `${datetime.formatDateKey(start)} ${startClock} - ${datetime.formatClock(end)}`
  }

  const pad = datetime.pad2
  const endText = `${pad(end.getMonth() + 1)}-${pad(end.getDate())} ${datetime.formatClock(end)}`
  return `${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${startClock} - ${endText}`
}

/**
 * 预约卡片的时段文案（日期在单独一行显示，这里只给时间）
 * 同一天：15:00 - 16:30；跨天带上月日
 */
function buildReservePeriodText(startValue, endValue) {
  const start = datetime.parseDateTime(startValue)
  if (!start) return ''

  const startClock = datetime.formatClock(start)
  const end = datetime.parseDateTime(endValue)
  if (!end) return startClock

  if (datetime.isSameDay(start, end)) {
    return `${startClock} - ${datetime.formatClock(end)}`
  }

  const pad = datetime.pad2
  return `${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${startClock} - ${pad(end.getMonth() + 1)}-${pad(end.getDate())} ${datetime.formatClock(end)}`
}

/** 使用中卡片顶部那句「已使用 1 小时 5 分钟」 */
function formatElapsedText(startValue, now) {
  const start = datetime.parseDateTime(startValue)
  if (!start) return ''

  const nowTs = Number(now) || Date.now()
  const diff = nowTs - start.getTime()
  // 刚开始那半分钟报时长没有意义，直接说「刚刚开始」
  if (diff < MS_PER_MINUTE) return '刚刚开始'
  return `已使用 ${formatDuration(diff)}`
}

/** 'YYYY-MM-DD HH:mm' + 时长 + 状态文案，页面直接用 */
function buildUsageView(usage) {
  const source = usage || {}
  const statusMeta = USAGE_STATUS_META[source.status] || { text: source.status || '未知', tagClass: 'ds-tag-muted' }

  const startTs = datetime.parseDateTime(source.start_time)
  const endTs = datetime.parseDateTime(source.end_time)
  const hasDuration = !!(startTs && endTs)
  const feedback = source.feedback || {}

  return {
    _id: source._id || '',
    device_id: source.device_id || '',
    device_name: source.device_name || '未知仪器',
    reserve_id: source.reserve_id || '',
    reserve_date: source.reserve_date || '',
    status: source.status || '',
    status_text: statusMeta.text,
    status_tag: statusMeta.tagClass,
    start_time: source.start_time || '',
    usage_images: Array.isArray(source.usage_images) ? source.usage_images : [],
    start_time_display: formatFullTime(source.start_time),
    usage_period_display: buildUsagePeriodText(source.start_time, source.end_time),
    duration_text: hasDuration ? formatDuration(endTs.getTime() - startTs.getTime()) : '',
    feedback_title: feedback.title || '',
    feedback_content: feedback.content || '',
    has_feedback: !!(feedback.title || feedback.content)
  }
}

/** 使用历史列表：状态/时长都算好，WXML 只负责摆位置 */
function buildHistoryList(records) {
  return (records || []).map(buildUsageView)
}

/**
 * 单条预约 → 卡片视图
 * @param {Object} reserve 数据库原始记录
 * @param {number} now 当前时间戳（测试里可固定）
 */
function buildReserveView(reserve, now) {
  const source = reserve || {}
  const nowTs = Number(now) || Date.now()
  const startTs = getReserveTimestamp(source, 'start')
  const endTs = getReserveTimestamp(source, 'end')

  let state = 'expired'
  if (startTs && endTs) {
    if (nowTs < startTs) state = 'pending'
    else if (nowTs < endTs) state = 'ready'
  }

  const meta = RESERVE_STATE_META[state]
  let timeText = '已超过预约时段'
  if (state === 'pending') {
    timeText = `距开始 ${formatDuration(startTs - nowTs)}`
  } else if (state === 'ready') {
    timeText = `剩余 ${formatDuration(endTs - nowTs)}`
  }

  return {
    _id: source._id || '',
    device_id: source.device_id || '',
    device_name: source.device_name || '未知仪器',
    reserve_date: source.reserve_date || formatDateOnly(source.start_time),
    start_ts: startTs,
    end_ts: endTs,
    period_text: buildReservePeriodText(source.start_time, source.end_time),
    state,
    state_text: meta.text,
    tag_class: meta.tagClass,
    sort_weight: meta.weight,
    time_text: timeText,
    // 时间窗校验目前在云函数里关掉了，未到时间也允许开始，所以只有已结束不可点
    can_start: state !== 'expired'
  }
}

/**
 * 待使用预约列表：过滤掉已开始/已作废/今天之前就结束的记录，再按「可开始 → 未到时间 → 已结束」排序
 * @param {Array<Object>} records
 * @param {number} now
 */
function buildPendingReserveList(records, now) {
  const nowTs = Number(now) || Date.now()
  const dayStartTs = getDayStartTs(nowTs)
  const seen = {}
  const list = []

  ;(records || []).forEach((item) => {
    if (!item || !item._id || seen[item._id]) return
    // usage_status 缺省视为未开始（早期数据没有这个字段）
    if (item.usage_status && item.usage_status !== RESERVE_NOT_STARTED) return

    const view = buildReserveView(item, nowTs)
    if (!view.end_ts || view.end_ts < dayStartTs) return

    seen[item._id] = true
    list.push(view)
  })

  list.sort((a, b) => {
    if (a.sort_weight !== b.sort_weight) return a.sort_weight - b.sort_weight
    return a.start_ts - b.start_ts
  })
  return list
}

/** 按码点截断，避免把表情劈成半个字符 */
function truncateText(text, maxLength) {
  const limit = Number(maxLength) > 0 ? Number(maxLength) : REMINDER_SUMMARY_MAX
  const chars = Array.from(String(text || ''))
  if (chars.length <= limit) return chars.join('')
  return `${chars.slice(0, limit - 1).join('')}…`
}

/** 横幅提醒的正文摘要：照片类提醒给出明确的去处，其它类型截断原内容 */
function getReminderSummary(item) {
  const source = item || {}
  if (source.type === 'usage_end_remind') {
    return '点「正常结束使用」提交预约单与两张关闭照片，即可结束本次使用。'
  }
  if (source.type === 'usage_photo_remind') {
    return '请在「上传照片板块」补充使用过程照片。'
  }
  return truncateText(source.content || '', REMINDER_SUMMARY_MAX)
}

function buildReminderView(item) {
  const source = item || {}
  return {
    _id: source._id || '',
    type: source.type || '',
    title: source.title || '未读提醒',
    content: getReminderSummary(source),
    related_id: source.related_id || '',
    time_text: datetime.formatMoment(source.create_time),
    is_photo: PHOTO_REMINDER_TYPES.indexOf(source.type) !== -1
  }
}

function isPositiveInt(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!/^\d+$/.test(text)) return false
  return Number(text) > 0
}

/**
 * 结束表单校验：返回第一条错误文案，全部通过返回空串
 * 顺序按界面从上往下，用户看到的第一个红字就是这里返回的那条
 * @param {Object} form
 * @returns {string}
 */
function getEndFormError(form) {
  const value = form || {}

  if (value.instrumentOff !== true && value.instrumentOff !== false) return '请选择仪器是否关闭'
  if (value.computerOff !== true && value.computerOff !== false) return '请选择电脑是否关闭'
  if (value.computerOff === false && !String(value.nextUser || '').trim()) return '请填写下一个使用者姓名'
  if (!isPositiveInt(value.sampleCount)) return '运行样品总数需为正整数'
  if (value.moreSample !== true && value.moreSample !== false) return '请选择是否还有未测试的样品'

  if (value.moreSample) {
    if (!isPositiveInt(value.moreSampleCount)) return '剩余样品数量需为正整数'
    if (Number(value.moreSampleCount) > Number(value.sampleCount)) return '剩余样品数量不能大于运行样品总数'
  }

  if (!value.totalPage) return '请上传总的预约单'
  if (!value.devicePage) return '请上传仪器关闭照片'
  if (!value.roomPage) return '请上传实验室关门照片'
  if (value.needSupplement !== true && value.needSupplement !== false) return '请选择是否需要补充预约'
  if (value.needSupplement && !value.supplementPage) return '请上传补充预约单'

  return ''
}

/** 结束表单提交给数据库的结构（字段名与云函数写入的 usageRecord 保持 snake_case） */
function buildEndChecklist(form, fileIds) {
  const value = form || {}
  const files = fileIds || {}
  return {
    instrument_off: value.instrumentOff === true,
    computer_off: value.computerOff === true,
    next_user: String(value.nextUser || '').trim(),
    sample_count: Number(value.sampleCount) || 0,
    more_sample: value.moreSample === true,
    more_sample_count: value.moreSample ? Number(value.moreSampleCount) || 0 : 0,
    total_page: files.totalPage || '',
    device_page: files.devicePage || '',
    room_page: files.roomPage || '',
    need_supplement: value.needSupplement === true,
    supplement_page: value.needSupplement ? files.supplementPage || '' : ''
  }
}

function createEmptyEndForm() {
  return {
    instrumentOff: null,
    computerOff: null,
    nextUser: '',
    moreSample: null,
    sampleCount: '',
    moreSampleCount: '',
    totalPage: '',
    devicePage: '',
    roomPage: '',
    needSupplement: null,
    supplementPage: ''
  }
}

module.exports = {
  HISTORY_LIMIT,
  PENDING_LIMIT,
  PHOTO_LIMIT,
  MS_PER_DAY,
  REMINDER_TYPES,
  PHOTO_REMINDER_TYPES,
  formatDuration,
  formatFullTime,
  formatDateOnly,
  formatElapsedText,
  getDayStartTs,
  getReserveTimestamp,
  buildUsagePeriodText,
  buildReservePeriodText,
  buildUsageView,
  buildHistoryList,
  buildReserveView,
  buildPendingReserveList,
  truncateText,
  getReminderSummary,
  buildReminderView,
  isPositiveInt,
  getEndFormError,
  buildEndChecklist,
  createEmptyEndForm
}
