// 消息/公告详情页的纯数据处理逻辑。
// 不依赖 wx.*，可直接用 node 跑（见 tests/messageDetail.test.js）。
//
// 背景：消息详情与公告详情原本是两个页面，字段和渲染几乎一样，
// 只是公告多一个腾讯文档链接。合并后统一用这里的 normalize* 输出同一种结构，
// 页面只负责渲染，不再各写一套格式化逻辑。

// messages 表里的消息类型（admin_notice 是「只给管理员的内部提醒」，
// 和 notice 表里全员广播的公告不是一回事，别混用标签）
const TYPE_LABELS = {
  reservation_success: '预约成功',
  reservation_remind: '预约提醒',
  usage_photo_remind: '照片提醒',
  usage_end_remind: '结束提醒',
  admin_notice: '系统通知'
}

// notice 表是全员广播，标签固定
const NOTICE_TYPE_LABEL = '管理员公告'

// 标签配色直接对应 app.wxss 里的 ds-tag-<modifier>
const STYLE_PRIMARY = 'primary'
const STYLE_WARNING = 'warning'
const STYLE_MUTED = 'muted'

function getTypeLabel(type) {
  return TYPE_LABELS[type] || '系统消息'
}

function getStyleType(type) {
  if (type === 'reservation_success' || type === 'reservation_remind') return STYLE_PRIMARY
  if (type === 'usage_photo_remind' || type === 'usage_end_remind') return STYLE_WARNING
  return STYLE_MUTED
}

// 兼容 "2024-05-06 07:08"、"2024-05-06T07:08:00.000Z"、时间戳字符串等写法；
// 解析不了就原样展示，避免出现 Invalid Date
function formatTime(value) {
  if (!value) return '未知时间'
  const text = String(value)
  const normalized = text.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/, '$1 $2').replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    return text
  }

  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// messages 表的一条记录 → 详情页统一结构
function normalizeMessage(item) {
  const row = item || {}
  return {
    id: row._id,
    source: 'message',
    title: row.title || getTypeLabel(row.type),
    content: row.content || '',
    type: row.type || '',
    typeLabel: getTypeLabel(row.type),
    styleType: getStyleType(row.type),
    create_time: formatTime(row.create_time),
    doc_url: row.doc_url || '',
    is_read: !!row.is_read
  }
}

// notice 表的一条记录 → 详情页统一结构
// doc_url 是腾讯文档链接，合并后必须继续透传，否则公告里的协作文档入口会丢
function normalizeNotice(item) {
  const row = item || {}
  return {
    id: row.notice_id || row._id,
    source: 'notice',
    title: row.title || NOTICE_TYPE_LABEL,
    content: row.content || '',
    type: 'admin_notice',
    typeLabel: NOTICE_TYPE_LABEL,
    styleType: STYLE_MUTED,
    create_time: formatTime(row.publish_date || row.create_time),
    doc_url: row.doc_url || '',
    is_read: true
  }
}

// 空状态文案跟着来源走，公告/消息不要互相串
function getEmptyState(source) {
  if (source === 'notice') {
    return {
      title: '公告不存在',
      desc: '该公告可能已被删除或无法访问'
    }
  }
  return {
    title: '消息不存在',
    desc: '该消息可能已被删除或无法访问'
  }
}

module.exports = {
  TYPE_LABELS,
  NOTICE_TYPE_LABEL,
  getTypeLabel,
  getStyleType,
  formatTime,
  normalizeMessage,
  normalizeNotice,
  getEmptyState
}
