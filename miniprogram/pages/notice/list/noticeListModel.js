// 公告列表页的纯数据处理逻辑，不依赖 wx.*，可直接用 node 跑
// （见 tests/noticeListModel.test.js）。
//
// 这一层集中解决四件事：
// 1. publish_date 在库里有两种写法：ISO（2024-05-06T07:08:00.000Z）和老数据的
//    "2024-05-06 07:08"。iOS 上 new Date('2024-05-06 07:08') 直接 Invalid Date，
//    所以先规范化成 T 分隔再解析。
// 2. 列表要展示"几分钟前 / 今天 09:30"这类相对时间，时区按手机本地算，
//    不能直接截 ISO 字符串（UTC 截出来会比本地日期早一天）。
// 3. 详情页按 notice_id 查，缺 notice_id 的历史数据才用 _id 兜底，
//    wx:key 又必须稳定唯一，所以 key 单独用 _id。
// 4. 翻页期间管理员新发公告会让 skip 偏移整体后移，同一页会重复出现，
//    所以要用 appendNoticeList 按 key 去重。

// 云开发小程序端单次 get 最多 20 条，超过的部分必须靠 skip 分页拿
const PAGE_SIZE = 20

// 摘要截断长度：两行文案够用，再长也会被 clamp 掉
const PREVIEW_LENGTH = 60

// 三天内的公告标 NEW，超过就不打扰视觉了
const NEW_HOURS = 72

const DEFAULT_TITLE = '管理员公告'

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * 把库里各种写法的时间转成毫秒时间戳，解析不了返回 0
 * @param {string|number|Date} value
 * @returns {number}
 */
function parseTimeValue(value) {
  if (!value) return 0
  // 云开发里 date 类型字段取回来是 Date 对象，测试里也可能直接传时间戳
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? 0 : time
  }
  if (typeof value === 'number') {
    return value > 0 ? value : 0
  }

  const text = String(value).trim()
  if (!text) return 0

  // "2024-05-06 07:08"、"2024-05-06-07:08" 都改成 "2024-05-06T07:08"，
  // 这样才走本地时区解析，且 iOS 也认
  const normalized = text.replace(/^(\d{4}-\d{2}-\d{2})[- ](\d{2}:\d{2})/, '$1T$2')
  const time = new Date(normalized).getTime()
  return Number.isNaN(time) ? 0 : time
}

// 公告正文可能是纯文本，也可能粘了富文本，摘掉标签再当摘要用
function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

// 按码点截断：'😀'.slice() 会把表情劈成两个半代理项，渲染出来是个方块
function truncateByCodePoint(text, limit) {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  return `${chars.slice(0, limit).join('')}…`
}

/**
 * 生成列表摘要
 * @param {string} content 公告正文
 * @returns {string}
 */
function buildPreview(content) {
  const text = stripHtml(content)
  if (!text) return ''
  return truncateByCodePoint(text, PREVIEW_LENGTH)
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

/**
 * 时间标签：一小时内说"几分钟前"，当天说"今天 09:30"，跨年才补年份
 * @param {number} timeValue 目标时间的毫秒时间戳
 * @param {number} nowValue 参照时间（测试里传固定值，避免时间漂移）
 * @returns {string}
 */
function formatTimeLabel(timeValue, nowValue) {
  if (!timeValue) return '时间未知'

  const date = new Date(timeValue)
  const now = new Date(nowValue || Date.now())
  const diff = now.getTime() - timeValue

  // 用绝对值兜住手机时钟比服务器快几十秒的情况
  if (Math.abs(diff) < MINUTE_MS) return '刚刚'
  if (diff >= 0 && diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分钟前`
  if (diff >= 0 && diff < 6 * HOUR_MS) return `${Math.floor(diff / HOUR_MS)} 小时前`

  // 超过 6 小时就交给"今天 / 昨天 / 月日"这套日期文案
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (isSameDay(date, now)) return `今天 ${clock}`

  const yesterday = new Date(now.getTime() - 24 * HOUR_MS)
  if (isSameDay(date, yesterday)) return `昨天 ${clock}`

  if (date.getFullYear() === now.getFullYear()) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * notice 集合的一条记录 → 列表现成的渲染结构
 * @param {Object} item
 * @param {number} [nowValue] 参照时间，默认当前时间
 * @returns {Object}
 */
function buildNoticeItem(item, nowValue) {
  const row = item || {}
  const now = nowValue || Date.now()
  const timeValue = parseTimeValue(row.publish_date || row.create_time)
  const date = timeValue ? new Date(timeValue) : null
  const age = timeValue ? now - timeValue : 0

  return {
    // wx:key 必须稳定唯一，_id 才是数据库主键；notice_id 可能重复或缺失
    key: row._id || row.notice_id || `${timeValue}-${row.title || ''}`,
    // 详情页按 notice_id 查，查不到才用 _id 兜底
    id: row.notice_id || row._id || '',
    title: String(row.title || '').trim() || DEFAULT_TITLE,
    preview: buildPreview(row.content),
    hasDoc: !!row.doc_url,
    monthLabel: date ? `${date.getMonth() + 1}月` : '--',
    dayLabel: date ? pad(date.getDate()) : '--',
    timeLabel: formatTimeLabel(timeValue, now),
    // 未来时间（管理员误填 / 时钟误差）不标 NEW，避免角标一直挂着
    isNew: !!timeValue && age >= 0 && age < NEW_HOURS * HOUR_MS
  }
}

/**
 * 把一页原始数据转成渲染结构并追加到已有列表后面，按 key 去重。
 * 翻页期间有人新发公告时，上一页末尾会整体后移一位，重复项在这里被丢掉，
 * 否则 wx:key 重复会让列表渲染错位。
 * @param {Array<Object>} existing 已渲染的列表（可传空数组）
 * @param {Array<Object>} rows 本次拉到的原始数据
 * @param {number} [nowValue] 参照时间
 * @returns {Array<Object>} 只包含新增项
 */
function appendNoticeList(existing, rows, nowValue) {
  const loadedKeys = new Set((existing || []).map(item => item.key))
  const appended = []
  const sourceRows = rows || []

  sourceRows.forEach((row) => {
    const item = buildNoticeItem(row, nowValue)
    if (loadedKeys.has(item.key)) return
    loadedKeys.add(item.key)
    appended.push(item)
  })

  return appended
}

/**
 * 是否还有下一页
 * @param {number} loadedCount 本地已有条数
 * @param {number} pageRows 本次拉到的原始条数（去重前）
 * @param {number} totalCount 集合总数，查不到传 0
 * @returns {boolean}
 */
function hasMoreAfter(loadedCount, pageRows, totalCount) {
  if (totalCount > 0) return loadedCount < totalCount
  // 总数拿不到时退回"整页判断"：拉满一整页就认为后面还有
  return pageRows >= PAGE_SIZE
}

/**
 * 页面副标题：状态不同文案不同，避免"加载中"和"暂无公告"互相打架
 * @param {Object} options { total, count, isLoading, hasError }
 * @returns {string}
 */
function getListSummary(options) {
  const {
    total = 0,
    count = 0,
    isLoading = false,
    hasError = false
  } = options || {}

  if (isLoading) return '正在加载公告…'
  if (hasError) return '公告加载失败'
  if (total > 0) return `共 ${total} 条公告 · 管理员发布`
  // 总数查询失败但列表有内容：至少让用户知道加载了几条
  if (count > 0) return `已加载 ${count} 条公告`
  return '暂无公告'
}

module.exports = {
  PAGE_SIZE,
  PREVIEW_LENGTH,
  DEFAULT_TITLE,
  parseTimeValue,
  stripHtml,
  buildPreview,
  formatTimeLabel,
  buildNoticeItem,
  appendNoticeList,
  hasMoreAfter,
  getListSummary
}
