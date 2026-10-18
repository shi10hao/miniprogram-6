const assert = require('assert')

/**
 * 消息/公告详情页合并后的纯逻辑校验。
 *
 * 合并要点：两个页面原本各自格式化字段，合并后统一走 detailModel.js。
 * 最容易回归的两点：
 *   1. 公告的 doc_url（腾讯文档链接）必须原样透传，否则"打开协作文档"入口会消失
 *   2. notice 表的标签是「管理员公告」，不能复用 messages 表 admin_notice 的「系统通知」
 */

const {
  formatTime,
  normalizeMessage,
  normalizeNotice,
  getEmptyState
} = require('../pages/message/detail/detailModel')

function testNoticeKeepsDocUrl() {
  const detail = normalizeNotice({
    _id: 'db-1',
    notice_id: 'ADMIN_1700000000000',
    title: '实验室开放安排',
    content: '详见协作文档',
    publish_date: '2024-05-06 07:08',
    doc_url: 'https://docs.qq.com/doc/DU0Z123456',
    type: 'admin'
  })

  assert.strictEqual(detail.id, 'ADMIN_1700000000000', '优先用 notice_id 作为业务主键')
  assert.strictEqual(detail.source, 'notice')
  assert.strictEqual(detail.title, '实验室开放安排')
  assert.strictEqual(detail.doc_url, 'https://docs.qq.com/doc/DU0Z123456', '腾讯文档链接必须保留')
  assert.strictEqual(detail.typeLabel, '管理员公告')
  assert.strictEqual(detail.styleType, 'muted')
  assert.strictEqual(detail.create_time, '2024-05-06 07:08')
  assert.strictEqual(detail.is_read, true, '公告广播不需要标已读')
}

function testNoticeWithoutNoticeIdFallsBackToDocId() {
  const detail = normalizeNotice({ _id: 'db-2', title: '', content: '' })
  assert.strictEqual(detail.id, 'db-2')
  assert.strictEqual(detail.title, '管理员公告', '无标题时用公告默认标题')
  assert.strictEqual(detail.content, '')
  assert.strictEqual(detail.doc_url, '', '没有文档链接时给空串，wxml 才 wx:if 得掉')
  assert.strictEqual(detail.create_time, '未知时间')
}

function testNoticeIgnoresOtherCollectionLabels() {
  // 同一份数据在 messages 表里是「系统通知」，在 notice 表里必须是「管理员公告」
  const detail = normalizeNotice({ _id: 'x', notice_id: 'x', type: 'admin_notice' })
  assert.strictEqual(detail.typeLabel, '管理员公告')
}

function testMessageLabelsAndStyle() {
  const reservation = normalizeMessage({
    _id: 'm-1',
    type: 'reservation_remind',
    title: '',
    content: '明天 9:00 使用 HPLC',
    create_time: '2024-05-06T07:08:00.000Z',
    is_read: 0
  })

  assert.strictEqual(reservation.id, 'm-1')
  assert.strictEqual(reservation.source, 'message')
  assert.strictEqual(reservation.title, '预约提醒', '无标题时用类型名兜底')
  assert.strictEqual(reservation.typeLabel, '预约提醒')
  assert.strictEqual(reservation.styleType, 'primary')
  assert.strictEqual(reservation.doc_url, '')
  assert.strictEqual(reservation.is_read, false)

  const usage = normalizeMessage({ _id: 'm-2', type: 'usage_end_remind' })
  assert.strictEqual(usage.typeLabel, '结束提醒')
  assert.strictEqual(usage.styleType, 'warning')

  const system = normalizeMessage({ _id: 'm-3', type: 'admin_notice' })
  assert.strictEqual(system.typeLabel, '系统通知')
  assert.strictEqual(system.styleType, 'muted')

  const unknown = normalizeMessage({ _id: 'm-4', type: 'something_new' })
  assert.strictEqual(unknown.typeLabel, '系统消息', '未知类型不能渲染成 undefined')
}

function testMessageKeepsDocUrlIfPresent() {
  // 目前消息没有文档字段，但模型层保留透传，后续消息带文档时不用再改页面
  const detail = normalizeMessage({ _id: 'm-5', type: 'admin_notice', doc_url: 'https://docs.qq.com/doc/x' })
  assert.strictEqual(detail.doc_url, 'https://docs.qq.com/doc/x')
}

function testFormatTime() {
  assert.strictEqual(formatTime(''), '未知时间')
  assert.strictEqual(formatTime(null), '未知时间')
  // 数据库里常见的 "YYYY-MM-DD HH:mm" 要能被 iOS/Android 都解析
  assert.strictEqual(formatTime('2024-05-06 07:08'), '2024-05-06 07:08')
  assert.strictEqual(formatTime('2024-05-06-07:08'), '2024-05-06 07:08', '旧数据里的横线分隔也要兼容')
  assert.strictEqual(formatTime('not-a-date'), 'not-a-date', '解析失败原样展示，不能显示 Invalid Date')
}

function testEmptyState() {
  assert.deepStrictEqual(getEmptyState('notice'), {
    title: '公告不存在',
    desc: '该公告可能已被删除或无法访问'
  })
  assert.deepStrictEqual(getEmptyState('message'), {
    title: '消息不存在',
    desc: '该消息可能已被删除或无法访问'
  })
  assert.strictEqual(getEmptyState().title, '消息不存在', '默认按消息处理')
}

testNoticeKeepsDocUrl()
testNoticeWithoutNoticeIdFallsBackToDocId()
testNoticeIgnoresOtherCollectionLabels()
testMessageLabelsAndStyle()
testMessageKeepsDocUrlIfPresent()
testFormatTime()
testEmptyState()
console.log('messageDetail tests passed')
