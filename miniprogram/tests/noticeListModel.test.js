const assert = require('assert')

/**
 * 公告列表页纯逻辑校验（pages/notice/list/noticeListModel.js）。
 *
 * 重点回归项：
 *   1. "2024-05-06 07:08" 这种老格式在 iOS 上 new Date 会 Invalid Date，
 *      必须规范化后才能得到时间标签，否则整列显示"时间未知"
 *   2. 日期块显示的是手机本地日期，直接截 ISO 字符串会差一天
 *   3. 详情页要用 notice_id，缺了才退 _id；wx:key 反而必须用 _id
 *   4. 翻页期间新发公告会让 skip 偏移，重复项必须在 appendNoticeList 里丢掉
 */

const {
  PAGE_SIZE,
  buildPreview,
  formatTimeLabel,
  parseTimeValue,
  buildNoticeItem,
  appendNoticeList,
  hasMoreAfter,
  getListSummary
} = require('../pages/notice/list/noticeListModel')

// 固定参照时间，避免测试跑在不同时刻结果不同（2024-05-06 12:00 本地时间）
const NOW = new Date(2024, 4, 6, 12, 0, 0).getTime()

function testParseTimeValue() {
  assert.strictEqual(parseTimeValue(''), 0)
  assert.strictEqual(parseTimeValue(null), 0)
  assert.strictEqual(parseTimeValue('not-a-date'), 0)

  // 空格分隔与横线分隔都要认，且按本地时区解析
  const spaced = parseTimeValue('2024-05-06 07:08')
  assert.strictEqual(spaced, new Date(2024, 4, 6, 7, 8, 0).getTime())
  assert.strictEqual(parseTimeValue('2024-05-06-07:08'), spaced, '旧数据里的横线分隔也要兼容')
  assert.strictEqual(parseTimeValue('2024-05-06 07:08:30'), new Date(2024, 4, 6, 7, 8, 30).getTime())
  assert.ok(parseTimeValue('2024-05-06T07:08:00.000Z') > 0)
}

function testFormatTimeLabel() {
  assert.strictEqual(formatTimeLabel(0, NOW), '时间未知')
  assert.strictEqual(formatTimeLabel(NOW - 30 * 1000, NOW), '刚刚')
  assert.strictEqual(formatTimeLabel(NOW - 5 * 60 * 1000, NOW), '5 分钟前')
  assert.strictEqual(formatTimeLabel(NOW - 3 * 60 * 60 * 1000, NOW), '3 小时前')
  assert.strictEqual(formatTimeLabel(new Date(2024, 4, 6, 9, 5).getTime(), NOW), '2 小时前')
  assert.strictEqual(formatTimeLabel(new Date(2024, 4, 6, 5, 5).getTime(), NOW), '今天 05:05', '超过 6 小时才换成钟点')
  assert.strictEqual(formatTimeLabel(new Date(2024, 4, 5, 21, 30).getTime(), NOW), '昨天 21:30')
  assert.strictEqual(formatTimeLabel(new Date(2024, 2, 8, 8, 0).getTime(), NOW), '03-08 08:00')
  assert.strictEqual(formatTimeLabel(new Date(2023, 11, 31, 18, 0).getTime(), NOW), '2023-12-31')
}

function testBuildPreview() {
  assert.strictEqual(buildPreview(''), '')
  assert.strictEqual(buildPreview(null), '')
  assert.strictEqual(buildPreview('<p>本周五  设备检修</p>'), '本周五 设备检修', '富文本要摘标签并合并空白')
  assert.strictEqual(buildPreview('A&amp;B'), 'A&B')

  const long = buildPreview('字'.repeat(100))
  assert.strictEqual(long.length, 61, '超出长度要截断并补省略号')
  assert.ok(long.endsWith('…'))

  // 表情是双代理项，按 UTF-16 截断会劈出半个字符，渲染成方块
  const emoji = buildPreview('😀'.repeat(80))
  assert.strictEqual(Array.from(emoji).length, 61, '按码点截断：60 个表情 + 省略号')
  assert.ok(emoji.indexOf('\uFFFD') === -1 && !/[\uD800-\uDBFF]$/.test(emoji), '不能留下半个代理项')
}

function testBuildNoticeItem() {
  const item = buildNoticeItem({
    _id: 'db-1',
    notice_id: 'ADMIN_1700000000000',
    title: '  实验室开放安排  ',
    content: '五一假期实验室开放时间调整，详见协作文档。',
    publish_date: '2024-05-06 09:05',
    doc_url: 'https://docs.qq.com/doc/DU0Z123456'
  }, NOW)

  assert.strictEqual(item.key, 'db-1', 'wx:key 用数据库主键')
  assert.strictEqual(item.id, 'ADMIN_1700000000000', '详情页优先用 notice_id')
  assert.strictEqual(item.title, '实验室开放安排')
  assert.strictEqual(item.hasDoc, true)
  assert.strictEqual(item.dayLabel, '06')
  assert.strictEqual(item.monthLabel, '5月')
  assert.strictEqual(item.timeLabel, '2 小时前')
  assert.strictEqual(item.isNew, true)
  assert.ok(item.preview.startsWith('五一假期'))
}

function testBuildNoticeItemFallbacks() {
  const bare = buildNoticeItem({ _id: 'db-2' }, NOW)
  assert.strictEqual(bare.key, 'db-2')
  assert.strictEqual(bare.id, 'db-2', '没有 notice_id 时退到 _id，否则点不进详情')
  assert.strictEqual(bare.title, '管理员公告', '无标题时给默认标题，不能渲染成空卡片')
  assert.strictEqual(bare.preview, '')
  assert.strictEqual(bare.hasDoc, false)
  assert.strictEqual(bare.monthLabel, '--')
  assert.strictEqual(bare.dayLabel, '--')
  assert.strictEqual(bare.timeLabel, '时间未知')
  assert.strictEqual(bare.isNew, false, '没有时间就不能标 NEW')

  // 三天以上不标 NEW，未来时间也不标（防止误发公告一直挂着角标）
  const old = buildNoticeItem({ _id: 'db-3', publish_date: new Date(2024, 3, 1).getTime() }, NOW)
  assert.strictEqual(old.isNew, false)
  const edge = buildNoticeItem({ _id: 'db-3b', publish_date: NOW - 72 * 60 * 60 * 1000 }, NOW)
  assert.strictEqual(edge.isNew, false, '正好 72 小时不算新')
  const nearEdge = buildNoticeItem({ _id: 'db-3c', publish_date: NOW - 71 * 60 * 60 * 1000 }, NOW)
  assert.strictEqual(nearEdge.isNew, true)

  const future = buildNoticeItem({ _id: 'db-4', publish_date: NOW + 10 * 60 * 1000 }, NOW)
  assert.strictEqual(future.isNew, false)
  assert.strictEqual(future.timeLabel, '今天 12:10', '未来时间照实显示，不能当成刚刚')
  const skew = buildNoticeItem({ _id: 'db-5', publish_date: NOW + 20 * 1000 }, NOW)
  assert.strictEqual(skew.timeLabel, '刚刚', '几十秒的时钟误差按刚刚处理')
}

function testAppendNoticeList() {
  const loaded = [buildNoticeItem({ _id: 'a', publish_date: NOW - 1000 }, NOW)]
  const rows = [
    { _id: 'a', publish_date: NOW - 1000 },
    { _id: 'b', publish_date: NOW - 2000 },
    { _id: 'b', publish_date: NOW - 2000 }
  ]

  const fresh = appendNoticeList(loaded, rows, NOW)
  assert.strictEqual(fresh.length, 1, '已在列表里的、同页内重复的都要丢掉')
  assert.strictEqual(fresh[0].key, 'b')

  const all = appendNoticeList([], rows, NOW)
  assert.strictEqual(all.length, 2, '同一次返回里的重复 key 只保留一条')
  assert.deepStrictEqual(appendNoticeList([], [], NOW), [], '空页不报错')
  assert.deepStrictEqual(appendNoticeList(null, null, NOW), [], '脏参数不报错')
}

function testHasMoreAfter() {
  assert.strictEqual(hasMoreAfter(20, 20, 0), true, '总数未知时拉满整页就认为还有')
  assert.strictEqual(hasMoreAfter(5, 5, 0), false, '没拉满整页就是到底')
  assert.strictEqual(hasMoreAfter(20, 20, 25), true)
  assert.strictEqual(hasMoreAfter(25, 5, 25), false, '本地条数追上总数就到底')
}

function testGetListSummary() {
  assert.strictEqual(getListSummary({ isLoading: true, total: 5 }), '正在加载公告…', '加载中优先于总数')
  assert.strictEqual(getListSummary({ hasError: true }), '公告加载失败')
  assert.strictEqual(getListSummary({ total: 0 }), '暂无公告')
  assert.strictEqual(getListSummary({ total: 3 }), '共 3 条公告 · 管理员发布')
  assert.strictEqual(getListSummary({ count: 12 }), '已加载 12 条公告', '总数查不到时退回已加载条数')
  assert.strictEqual(getListSummary(), '暂无公告', '无参不报错')
}

function testPageSizeWithinClientLimit() {
  // 云开发小程序端单次 get 上限 20 条，超过会被静默截断
  assert.ok(PAGE_SIZE > 0 && PAGE_SIZE <= 20, 'PAGE_SIZE 不能超过 20')
}

testParseTimeValue()
testFormatTimeLabel()
testBuildPreview()
testBuildNoticeItem()
testBuildNoticeItemFallbacks()
testAppendNoticeList()
testHasMoreAfter()
testGetListSummary()
testPageSizeWithinClientLimit()
console.log('noticeListModel tests passed')
