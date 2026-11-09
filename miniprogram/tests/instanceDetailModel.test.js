const assert = require('assert')

/**
 * 设备实例详情页纯逻辑校验（pages/device-instance-detail/lib/instanceDetailModel.js）
 *
 * 重点回归原页面的几个坑：
 *   1. 时间轴没有事件时 hasActivity 必须为 false（界面走空态），不能把整段空闲当成记录；
 *   2. 08:00 - 22:00 之外的使用记录要被裁掉，不能算出负时长；
 *   3. 已完成但缺 end_time 的记录，时长按「未知」处理，不能当成「刚结束」；
 *   4. 预约转成使用记录后，同一时段不能既算预约又算使用；
 *   5. 占用率的分母固定是 14 小时窗口。
 *
 * 运行：cd miniprogram && node tests/instanceDetailModel.test.js
 */

const model = require('../pages/device-instance-detail/lib/instanceDetailModel')

const YEAR = 2026
const MONTH = 10 // 11 月
const DAY = 7

/** 当天某个时刻的时间戳 */
function at(hour, minute) {
  return new Date(YEAR, MONTH, DAY, hour, minute || 0, 0).getTime()
}

/** 云端写入的 ISO 字符串（本地时刻对应的真实瞬间） */
function iso(ts) {
  return new Date(ts).toISOString()
}

const NOW = at(15, 0)

function testFormatDuration() {
  assert.strictEqual(model.formatDuration(0), '0 分钟')
  assert.strictEqual(model.formatDuration(30 * 1000), '不足 1 分钟')
  assert.strictEqual(model.formatDuration(45 * 60 * 1000), '45 分钟')
  assert.strictEqual(model.formatDuration((3 * 60 + 20) * 60 * 1000), '3 小时 20 分钟')
  assert.strictEqual(model.formatDuration(3 * 60 * 60 * 1000), '3 小时')
  assert.strictEqual(model.formatDuration(-1), '—')
}

function testEmptyDayHasNoActivity() {
  const timeline = model.buildTodayTimeline({ usages: [], reserves: [], nowTs: NOW })
  assert.strictEqual(timeline.hasActivity, false, '没有记录时不该有使用块')
  assert.strictEqual(timeline.blocks.length, 0)
  assert.strictEqual(timeline.items.length, 1, '整段空闲只占一行')
  assert.strictEqual(timeline.items[0].isIdle, true)
  assert.strictEqual(timeline.items[0].durationText, '14 小时')
  assert.strictEqual(timeline.stats.usageText, '0 分钟')
  assert.strictEqual(timeline.stats.utilPercent, 0)
}

function testUsageClippedIntoWindow() {
  const usages = [{
    _id: 'u1',
    student_name: '张三',
    status: 'completed',
    start_time: iso(at(7, 0)),
    end_time: iso(at(9, 0))
  }]
  const timeline = model.buildTodayTimeline({ usages, nowTs: NOW })
  assert.strictEqual(timeline.hasActivity, true)
  assert.strictEqual(timeline.items[0].type, 'usage')
  assert.strictEqual(timeline.items[0].startClock, '08:00', '7 点开始的部分裁到 8 点')
  assert.strictEqual(timeline.items[0].endClock, '09:00')
  assert.strictEqual(timeline.items[0].durationText, '1 小时')
  assert.strictEqual(timeline.stats.usageText, '1 小时')
  assert.strictEqual(timeline.items[1].durationText, '13 小时', '09:00 之后到 22:00 都是空闲')
}

function testUsageOutsideWindowDropped() {
  const usages = [
    { _id: 'a', start_time: iso(at(6, 0)), end_time: iso(at(7, 0)), status: 'completed' },
    { _id: 'b', start_time: iso(at(22, 30)), end_time: iso(at(23, 0)), status: 'completed' }
  ]
  const timeline = model.buildTodayTimeline({ usages, nowTs: NOW })
  assert.strictEqual(timeline.hasActivity, false, '窗口外的记录不参与今日统计')
  assert.strictEqual(timeline.stats.usageCount, 0)

  const lateNight = model.buildTodayTimeline({ usages: [], nowTs: at(23, 0) })
  assert.strictEqual(lateNight.showNow, false, '22 点之后不再画「现在」刻度')
}

function testOverlapIsTrimmed() {
  const usages = [
    { _id: 'u1', start_time: iso(at(9, 0)), end_time: iso(at(11, 0)), status: 'completed' },
    { _id: 'u2', start_time: iso(at(10, 0)), end_time: iso(at(12, 0)), status: 'completed' }
  ]
  const timeline = model.buildTodayTimeline({ usages, nowTs: NOW })
  const usageItems = timeline.items.filter(item => item.isUsage)
  assert.strictEqual(usageItems.length, 2)
  assert.strictEqual(usageItems[1].startClock, '11:00', '重叠部分压到上一条结束之后')
  assert.strictEqual(usageItems[1].durationText, '1 小时')
  assert.strictEqual(timeline.stats.usageText, '3 小时', '重叠不能重复计时')
}

function testOngoingUsageEndsAtNow() {
  const usage = { _id: 'u3', student_name: '李四', status: 'using', start_time: iso(at(13, 0)) }
  const timeline = model.buildTodayTimeline({ usages: [usage], nowTs: NOW })
  const usageItem = timeline.items.filter(item => item.isUsage)[0]
  assert.strictEqual(usageItem.endClock, '15:00')
  assert.strictEqual(usageItem.durationText, '2 小时')
  assert.strictEqual(usageItem.isOngoing, true)
  assert.strictEqual(timeline.stats.usageText, '2 小时')
  assert.strictEqual(model.findActiveUsage([usage], NOW), usage)
}

function testCompletedWithoutEndTimeIsUnknown() {
  const usage = { _id: 'u4', student_name: '赵六', status: 'completed', start_time: iso(at(10, 0)) }
  const timeline = model.buildTodayTimeline({ usages: [usage], nowTs: NOW })
  const usageItem = timeline.items.filter(item => item.isUsage)[0]
  assert.strictEqual(usageItem.durationText, '时长未知')
  assert.strictEqual(timeline.stats.usageText, '0 分钟', '缺结束时间不能虚增时长')
  assert.strictEqual(timeline.items.length, 3, '08-10 空闲 + 该记录 + 10-22 空闲')
}

function testReserveDedupedByLinkedUsage() {
  const reserve = {
    _id: 'r1',
    status: 'approved',
    student_name: '王五',
    start_time: '2026-11-07 16:00',
    end_time: '2026-11-07 18:00'
  }
  const usage = {
    _id: 'u5',
    reserve_id: 'r1',
    status: 'completed',
    start_time: iso(at(16, 0)),
    end_time: iso(at(18, 0))
  }

  const withUsage = model.buildTodayTimeline({ usages: [usage], reserves: [reserve], nowTs: NOW })
  assert.strictEqual(withUsage.blocks.filter(item => item.type === 'reserve').length, 0, '转成使用后不再重复占位')
  assert.strictEqual(withUsage.stats.reserveText, '0 分钟')

  const withoutUsage = model.buildTodayTimeline({ usages: [], reserves: [reserve], nowTs: NOW })
  assert.strictEqual(withoutUsage.blocks.length, 1)
  assert.strictEqual(withoutUsage.blocks[0].type, 'reserve')
  assert.strictEqual(withoutUsage.stats.reserveText, '2 小时')
}

function testUnapprovedReserveSkipped() {
  const timeline = model.buildTodayTimeline({
    usages: [],
    reserves: [
      { _id: 'r2', status: 'cancelled', start_ts: at(16), end_ts: at(18) },
      { _id: 'r3', status: 'approved', usage_status: 'completed', start_ts: at(16), end_ts: at(18) }
    ],
    nowTs: NOW
  })
  assert.strictEqual(timeline.hasActivity, false)
}

function testUtilizationUsesWindowAsDenominator() {
  const usages = [{
    _id: 'u7',
    status: 'completed',
    start_time: iso(at(8, 0)),
    end_time: iso(at(15, 0))
  }]
  const timeline = model.buildTodayTimeline({ usages, nowTs: NOW })
  assert.strictEqual(timeline.stats.utilPercent, 50, '7 小时 / 14 小时')
  assert.strictEqual(timeline.stats.idleText, '7 小时')
  assert.strictEqual(timeline.showNow, true)
  assert.strictEqual(timeline.nowPercent, 50, '15:00 正好在 14 小时窗口的中点')
}

function testBuildDeviceView() {
  const device = {
    device_id: 'D001',
    device_name: '高效液相色谱仪',
    lab_name: '分析实验室',
    device_room: 'A302',
    status: 'maintenance',
    description: '  用于常规小分子分析  ',
    specifications: { 型号: 'LC-2030', 鍨嬪彿: 'LC-2030', 检测器: 'UV' }
  }

  const idleView = model.buildDeviceView(device, null, NOW)
  assert.strictEqual(idleView.statusKey, 'maintenance')
  assert.strictEqual(idleView.statusText, '维护中')
  assert.strictEqual(idleView.model, 'LC-2030')
  assert.deepStrictEqual(idleView.specs.map(item => item.key), ['型号', '检测器'], '乱码键名被过滤')
  assert.strictEqual(idleView.description, '用于常规小分子分析')
  assert.strictEqual(idleView.hasDescription, true)

  const usingView = model.buildDeviceView(device, { student_name: '张三', start_time: iso(at(13, 0)) }, NOW)
  assert.strictEqual(usingView.statusKey, 'using', '有进行中的记录时状态以记录为准')
  assert.strictEqual(usingView.isUsing, true)
  assert.strictEqual(usingView.usingUser, '张三')
  assert.strictEqual(usingView.usingDetail.indexOf('已用 2 小时') > 0, true)
}

function testFindActiveUsageFallback() {
  const openUsage = { _id: 'u6', start_time: iso(at(14, 0)) }
  assert.strictEqual(model.findActiveUsage([openUsage], NOW), openUsage, '没写 status 也能认出在用的记录')

  const finished = { _id: 'u8', status: 'completed', start_time: iso(at(9, 0)), end_time: iso(at(10, 0)) }
  assert.strictEqual(model.findActiveUsage([finished], NOW), null)
}

function testRecentUsageViews() {
  const usages = [
    { _id: 'a', student_name: '甲', status: 'completed', start_time: iso(at(9, 0)), end_time: iso(at(10, 30)) },
    { _id: 'b', student_name: '乙', status: 'using', start_time: iso(at(14, 0)) }
  ]
  const rows = model.buildRecentUsageViews(usages, NOW, 1)
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].title, '乙', '按开始时间倒序')
  assert.strictEqual(rows[0].dayText, '今天')
  assert.strictEqual(rows[0].durationText, '1 小时')
  assert.strictEqual(rows[0].statusText, '使用中')
}

function testUpcomingReserveViews() {
  const yesterday = at(10, 0) - 24 * 60 * 60 * 1000
  const tomorrow = at(10, 0) + 24 * 60 * 60 * 1000
  const reserves = [
    { _id: 'past', status: 'approved', start_ts: yesterday, end_ts: yesterday + 60 * 60 * 1000 },
    { _id: 'next', status: 'approved', student_name: '钱七', research_group: '课题组A', start_ts: tomorrow, end_ts: tomorrow + 2 * 60 * 60 * 1000 }
  ]
  const rows = model.buildUpcomingReserveViews(reserves, [], NOW, 5)
  assert.strictEqual(rows.length, 1, '已结束的预约不再列出')
  assert.strictEqual(rows[0].title, '钱七')
  assert.strictEqual(rows[0].dayText, '明天')
  assert.strictEqual(rows[0].timeText, '10:00 – 12:00')
  assert.strictEqual(rows[0].statusText, '已预约')

  const ongoing = [
    { _id: 'now', status: 'approved', student_name: '孙八', start_ts: NOW - 60 * 60 * 1000, end_ts: NOW + 60 * 60 * 1000 }
  ]
  const ongoingRows = model.buildUpcomingReserveViews(ongoing, [], NOW, 5)
  assert.strictEqual(ongoingRows[0].statusText, '进行中', '正在进行的预约要标进行中')
}

testFormatDuration()
testEmptyDayHasNoActivity()
testUsageClippedIntoWindow()
testUsageOutsideWindowDropped()
testOverlapIsTrimmed()
testOngoingUsageEndsAtNow()
testCompletedWithoutEndTimeIsUnknown()
testReserveDedupedByLinkedUsage()
testUnapprovedReserveSkipped()
testUtilizationUsesWindowAsDenominator()
testBuildDeviceView()
testFindActiveUsageFallback()
testRecentUsageViews()
testUpcomingReserveViews()
console.log('instanceDetailModel tests passed')
