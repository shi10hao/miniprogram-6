// 仪器使用页纯逻辑的回归测试
// 跑法：cd miniprogram && node tests/usageModel.test.js
// 重点守住：时长文案、预约状态判定、过期预约过滤、结束表单校验顺序
const assert = require('assert')
const usageModel = require('../pages/usage/usageModel.js')

// 2024-05-06 12:00 本地时间，所有用例都相对它算
const NOW = new Date(2024, 4, 6, 12, 0, 0).getTime()
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

function testFormatDuration() {
  assert.strictEqual(usageModel.formatDuration(0), '不足 1 分钟')
  assert.strictEqual(usageModel.formatDuration(30 * 1000), '不足 1 分钟')
  assert.strictEqual(usageModel.formatDuration(25 * MINUTE), '25 分钟')
  assert.strictEqual(usageModel.formatDuration(80 * MINUTE), '1 小时 20 分钟')
  assert.strictEqual(usageModel.formatDuration(2 * HOUR), '2 小时')
  assert.strictEqual(usageModel.formatDuration(30 * HOUR), '1 天 6 小时')
  assert.strictEqual(usageModel.formatDuration(48 * HOUR), '2 天')
  assert.strictEqual(usageModel.formatDuration(-1000), '不足 1 分钟')
  assert.strictEqual(usageModel.formatDuration('abc'), '不足 1 分钟')
}

function testUsagePeriodText() {
  // 用本地时间构造再转 ISO：这样断言不依赖跑测试的机器时区
  const sameDayStart = new Date(2024, 4, 6, 11, 52).toISOString()
  const sameDayEnd = new Date(2024, 4, 6, 11, 53).toISOString()
  assert.strictEqual(
    usageModel.buildUsagePeriodText(sameDayStart, sameDayEnd),
    '2024-05-06 11:52 - 11:53'
  )

  const crossStart = new Date(2024, 4, 6, 23, 0).toISOString()
  const crossEnd = new Date(2024, 4, 7, 10, 0).toISOString()
  assert.strictEqual(
    usageModel.buildUsagePeriodText(crossStart, crossEnd),
    '05-06 23:00 - 05-07 10:00'
  )

  assert.strictEqual(usageModel.buildUsagePeriodText('', ''), '')
}

function testReservePeriodText() {
  assert.strictEqual(
    usageModel.buildReservePeriodText('2024-05-06 15:00', '2024-05-06 16:30'),
    '15:00 - 16:30'
  )
  assert.strictEqual(
    usageModel.buildReservePeriodText('2024-05-06 22:00', '2024-05-07 02:00'),
    '05-06 22:00 - 05-07 02:00'
  )
}

function testElapsedText() {
  assert.strictEqual(usageModel.formatElapsedText('2024-05-06 11:00', NOW), '已使用 1 小时')
  assert.strictEqual(usageModel.formatElapsedText('2024-05-06 11:59:40', NOW), '刚刚开始')
  assert.strictEqual(usageModel.formatElapsedText('2024-05-06 12:20', NOW), '刚刚开始')
  assert.strictEqual(usageModel.formatElapsedText('', NOW), '')
}

function testBuildReserveView() {
  const ready = usageModel.buildReserveView(
    { _id: 'r1', device_name: '液相色谱', device_id: 'S2205619', start_time: '2024-05-06 11:00', end_time: '2024-05-06 13:00' },
    NOW
  )
  assert.strictEqual(ready.state, 'ready')
  assert.strictEqual(ready.state_text, '可开始')
  assert.strictEqual(ready.tag_class, 'ds-tag-success')
  assert.strictEqual(ready.can_start, true)
  assert.strictEqual(ready.time_text, '剩余 1 小时')

  const pending = usageModel.buildReserveView(
    { _id: 'r2', start_time: '2024-05-06 14:00', end_time: '2024-05-06 15:00' },
    NOW
  )
  assert.strictEqual(pending.state, 'pending')
  assert.strictEqual(pending.time_text, '距开始 2 小时')
  assert.strictEqual(pending.sort_weight, 1)

  const expired = usageModel.buildReserveView(
    { _id: 'r3', start_time: '2024-05-06 09:00', end_time: '2024-05-06 10:00' },
    NOW
  )
  assert.strictEqual(expired.state, 'expired')
  assert.strictEqual(expired.can_start, false)
  assert.strictEqual(expired.time_text, '已超过预约时段')

  // 数字时间戳优先于字符串
  const withTs = usageModel.buildReserveView(
    { _id: 'r4', start_ts: NOW - MINUTE, end_ts: NOW + HOUR, start_time: '2020-01-01 00:00' },
    NOW
  )
  assert.strictEqual(withTs.state, 'ready')
}

function testBuildPendingReserveList() {
  const records = [
    { _id: 'a', start_time: '2024-05-06 14:00', end_time: '2024-05-06 15:00' },
    { _id: 'b', start_time: '2024-05-06 11:00', end_time: '2024-05-06 13:00' },
    { _id: 'c', start_time: '2024-05-05 11:00', end_time: '2024-05-05 13:00' }, // 昨天结束，丢掉
    { _id: 'd', start_time: '2024-05-06 15:00', end_time: '2024-05-06 16:00', usage_status: 'active' }, // 已在用，丢掉
    { _id: 'e', start_time: '2024-05-06 18:00', end_time: '2024-05-06 19:00', usage_status: 'not_started' },
    { _id: 'a', start_time: '2024-05-06 14:00', end_time: '2024-05-06 15:00' } // 重复 _id
  ]

  const list = usageModel.buildPendingReserveList(records, NOW)
  assert.deepStrictEqual(list.map((item) => item._id), ['b', 'a', 'e'])
  assert.strictEqual(list[0].state, 'ready')
  assert.strictEqual(list[1].state, 'pending')

  assert.deepStrictEqual(usageModel.buildPendingReserveList(null, NOW), [])
}

function testGetEndFormError() {
  const valid = {
    instrumentOff: true,
    computerOff: true,
    nextUser: '',
    moreSample: false,
    sampleCount: '6',
    moreSampleCount: '',
    totalPage: 'cloud://total.jpg',
    devicePage: 'cloud://device.jpg',
    roomPage: 'cloud://room.jpg',
    needSupplement: false,
    supplementPage: ''
  }

  assert.strictEqual(usageModel.getEndFormError(valid), '')
  assert.strictEqual(usageModel.getEndFormError(null), '请选择仪器是否关闭')
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { instrumentOff: null })),
    '请选择仪器是否关闭'
  )
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { computerOff: false })),
    '请填写下一个使用者姓名'
  )
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { computerOff: false, nextUser: '张三' })),
    ''
  )
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { sampleCount: '0' })),
    '运行样品总数需为正整数'
  )
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { moreSample: true, moreSampleCount: '8' })),
    '剩余样品数量不能大于运行样品总数'
  )
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { moreSample: true, moreSampleCount: '2' })),
    ''
  )
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { roomPage: '' })),
    '请上传实验室关门照片'
  )
  assert.strictEqual(
    usageModel.getEndFormError(Object.assign({}, valid, { needSupplement: true })),
    '请上传补充预约单'
  )
}

function testBuildEndChecklist() {
  const checklist = usageModel.buildEndChecklist(
    {
      instrumentOff: true,
      computerOff: false,
      nextUser: '  张三  ',
      moreSample: true,
      sampleCount: '6',
      moreSampleCount: '2',
      needSupplement: false,
      supplementPage: 'cloud://x.jpg'
    },
    { totalPage: 'cloud://total.jpg', devicePage: 'cloud://device.jpg', roomPage: 'cloud://room.jpg' }
  )

  assert.strictEqual(checklist.instrument_off, true)
  assert.strictEqual(checklist.computer_off, false)
  assert.strictEqual(checklist.next_user, '张三')
  assert.strictEqual(checklist.sample_count, 6)
  assert.strictEqual(checklist.more_sample, true)
  assert.strictEqual(checklist.more_sample_count, 2)
  assert.strictEqual(checklist.need_supplement, false)
  // 没勾补充预约时不能残留旧 fileID
  assert.strictEqual(checklist.supplement_page, '')
}

function testReminder() {
  assert.strictEqual(
    usageModel.getReminderSummary({ type: 'usage_end_remind' }),
    '点「正常结束使用」提交预约单与两张关闭照片，即可结束本次使用。'
  )
  assert.strictEqual(
    usageModel.getReminderSummary({ type: 'usage_photo_remind' }),
    '请在「上传照片板块」补充使用过程照片。'
  )
  assert.strictEqual(usageModel.truncateText('一二三四五六', 4), '一二三…')
  assert.strictEqual(usageModel.truncateText('短句', 4), '短句')

  const view = usageModel.buildReminderView({
    _id: 'm1',
    type: 'usage_photo_remind',
    title: '请上传照片',
    create_time: new Date(2024, 4, 6, 9, 30).toISOString()
  })
  assert.strictEqual(view.is_photo, true)
  assert.strictEqual(view.title, '请上传照片')
  assert.ok(view.time_text.length > 0)
}

function testIsPositiveInt() {
  assert.strictEqual(usageModel.isPositiveInt('6'), true)
  assert.strictEqual(usageModel.isPositiveInt(6), true)
  assert.strictEqual(usageModel.isPositiveInt('0'), false)
  assert.strictEqual(usageModel.isPositiveInt(''), false)
  assert.strictEqual(usageModel.isPositiveInt('1.5'), false)
  assert.strictEqual(usageModel.isPositiveInt(null), false)
}

function testEmptyEndForm() {
  const form = usageModel.createEmptyEndForm()
  assert.strictEqual(form.instrumentOff, null)
  assert.strictEqual(form.moreSample, null)
  assert.strictEqual(form.needSupplement, null)
  assert.strictEqual(form.sampleCount, '')
}

testFormatDuration()
testUsagePeriodText()
testReservePeriodText()
testElapsedText()
testBuildReserveView()
testBuildPendingReserveList()
testGetEndFormError()
testBuildEndChecklist()
testReminder()
testIsPositiveInt()
testEmptyEndForm()

console.log('usageModel tests passed')
