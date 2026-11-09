// 首页「常用仪器」纯逻辑的回归测试
// 跑法：cd miniprogram && node tests/commonDeviceModel.test.js
// 重点守住：权重排序、预约状态过滤、同型号合并、补位去重、时间文案
const assert = require('assert')
const model = require('../pages/index/commonDeviceModel.js')

// 2024-05-06 12:00 本地时间，所有「今天/昨天」都相对它算
const NOW = new Date(2024, 4, 6, 12, 0, 0).getTime()

/** 本地时间 → ISO 串（和 device_usage.start_time 的写法一致） */
function iso(year, month, day, hour) {
  return new Date(year, month - 1, day, hour || 0, 0, 0).toISOString()
}

function testNormalizeLimit() {
  assert.strictEqual(model.normalizeLimit(undefined), 3)
  assert.strictEqual(model.normalizeLimit(0), 3)
  assert.strictEqual(model.normalizeLimit(-2), 3)
  assert.strictEqual(model.normalizeLimit('abc'), 3)
  assert.strictEqual(model.normalizeLimit('2'), 2)
  assert.strictEqual(model.normalizeLimit('2.7'), 2)
  assert.strictEqual(model.normalizeLimit(20), 10)
}

function testGroupKey() {
  assert.strictEqual(
    model.buildGroupKey({ device_name: '离心机', specifications: { 型号: 'H1850' } }),
    '离心机::H1850'
  )
  assert.strictEqual(
    model.buildGroupKey({ device_name: '离心机', specifications: { model: ' H1850 ' } }),
    '离心机::H1850'
  )
  assert.strictEqual(
    model.buildGroupKey({ device_name: '电泳仪', specifications: null }),
    '电泳仪::'
  )
  assert.strictEqual(model.buildGroupKey(null), '::')
}

function testBuildStats() {
  const usage = [
    { device_id: 'A', device_name: '离心机', start_time: iso(2024, 5, 6, 9) },
    { device_id: 'A', device_name: '离心机', start_time: iso(2024, 5, 1, 9) },
    { device_id: 'A', device_name: '离心机', start_time: iso(2024, 4, 20, 9) },
    { device_id: 'B', device_name: '电泳仪', start_time: iso(2024, 5, 4, 9) },
    // 脏数据：没有 device_id 的记录必须忽略
    { device_id: '', device_name: '脏数据', start_time: iso(2024, 5, 4, 9) }
  ]
  const reserves = [
    { device_id: 'B', device_name: '电泳仪', status: 'approved', start_time: '2024-05-05 09:00' },
    { device_id: 'B', device_name: '电泳仪', status: 'completed', start_time: '2024-05-05 10:00' },
    { device_id: 'C', device_name: '振荡器', status: 'approved', start_time: '2024-05-02 09:00' },
    // 取消的预约不算「常用」
    { device_id: 'D', device_name: '紫外分光', status: 'cancelled', start_time: '2024-05-02 09:00' }
  ]

  const stats = model.buildStats(usage, reserves)
  assert.strictEqual(stats.size, 3)

  const a = stats.get('A')
  assert.strictEqual(a.usage_count, 3)
  assert.strictEqual(a.reserve_count, 0)
  assert.strictEqual(a.last_raw, iso(2024, 5, 6, 9))
  assert.strictEqual(a.last_ts, new Date(2024, 4, 6, 9, 0, 0).getTime())

  const b = stats.get('B')
  assert.strictEqual(b.usage_count, 1)
  assert.strictEqual(b.reserve_count, 2)
  assert.strictEqual(b.last_raw, '2024-05-05 10:00')

  assert.strictEqual(stats.has('D'), false)

  // 权重：A = 3*3 = 9，B = 3 + 2 = 5，C = 1
  assert.deepStrictEqual(
    model.rankStats(stats).map(item => item.device_id),
    ['A', 'B', 'C']
  )
  assert.strictEqual(model.scoreOf(stats.get('B')), 5)
  assert.deepStrictEqual(model.collectDeviceIds(stats, 2), ['A', 'B'])
}

function testBuildListMergesGroups() {
  const entries = [
    // 同一台离心机的两个编号：展示时要合并成一张卡，次数相加，取更近的那个 device_id
    {
      device_id: 'A2',
      device_name: '离心机',
      specifications: { 型号: 'H1850' },
      usage_count: 1,
      reserve_count: 0,
      last_raw: iso(2024, 5, 5, 9)
    },
    {
      device_id: 'A1',
      device_name: '离心机',
      specifications: { 型号: 'H1850' },
      usage_count: 2,
      reserve_count: 0,
      last_raw: iso(2024, 5, 6, 9)
    },
    {
      device_id: 'B1',
      device_name: '电泳仪',
      specifications: { 型号: 'DYY-6C' },
      usage_count: 1,
      reserve_count: 0,
      last_raw: iso(2024, 5, 4, 9)
    },
    // 补位仪器：同名不同型号也只能出现一次（按名称去重）
    { device_id: 'R1', device_name: '振荡器', specifications: { 型号: 'X1' } },
    { device_id: 'R2', device_name: '振荡器', specifications: { 型号: 'X2' } }
  ]

  const list = model.buildListFromEntries(entries, 4)
  assert.strictEqual(list.length, 3)
  assert.strictEqual(list[0].device_name, '离心机')
  assert.strictEqual(list[0].device_id, 'A1')
  assert.strictEqual(list[0].usage_count, 3)
  assert.strictEqual(list[0].source, 'usage')
  assert.strictEqual(list[1].device_name, '电泳仪')
  assert.strictEqual(list[2].device_name, '振荡器')
  assert.strictEqual(list[2].device_id, 'R1')
  assert.strictEqual(list[2].source, 'recommend')

  // 一台记录都没有时只剩补位，limit 仍然生效
  const onlyRecommend = model.buildListFromEntries(entries.slice(3), 1)
  assert.strictEqual(onlyRecommend.length, 1)
  assert.strictEqual(onlyRecommend[0].source, 'recommend')
}

function testBuildLocalList() {
  const stats = model.buildStats(
    [{ device_id: 'A', device_name: '离心机', start_time: iso(2024, 5, 6, 9) }],
    [{ device_id: 'C', device_name: '振荡器', status: 'approved', start_time: '2024-05-02 09:00' }]
  )
  const deviceMap = model.buildDeviceMap([
    { device_id: 'A', device_name: '离心机', specifications: { 型号: 'H1850' }, picture: 'cloud://a' },
    { device_id: 'C', device_name: '振荡器', specifications: {} }
  ])
  const available = [
    { device_id: 'A', device_name: '离心机', specifications: { 型号: 'H1850' } },
    { device_id: 'C', device_name: '振荡器', specifications: {} },
    { device_id: 'E', device_name: '紫外分光', specifications: {} }
  ]

  const list = model.buildLocalList(stats, deviceMap, available, 3)
  assert.deepStrictEqual(
    list.map(item => item.device_id),
    ['A', 'C', 'E']
  )
  assert.strictEqual(list[0].source, 'usage')
  assert.strictEqual(list[1].source, 'reserve')
  assert.strictEqual(list[2].source, 'recommend')

  // 设备被删掉了（deviceMap 里没有）→ 跳过，不能让页面拿到空卡片
  const missing = model.buildLocalList(stats, {}, [], 3)
  assert.deepStrictEqual(missing, [])
}

function testRecentText() {
  assert.strictEqual(model.formatRecentText(iso(2024, 5, 6, 9), NOW), '今天')
  assert.strictEqual(model.formatRecentText(iso(2024, 5, 5, 20), NOW), '昨天')
  assert.strictEqual(model.formatRecentText(iso(2024, 3, 8, 10), NOW), '3月8日')
  assert.strictEqual(model.formatRecentText(iso(2023, 12, 19, 10), NOW), '2023年12月19日')
  assert.strictEqual(model.formatRecentText('', NOW), '')
  assert.strictEqual(model.formatRecentText('not-a-date', NOW), '')
}

function testMetaText() {
  assert.strictEqual(
    model.buildMetaText({ source: 'usage', usage_count: 3, last_raw: iso(2024, 5, 6, 9) }, NOW),
    '用过 3 次 · 今天'
  )
  assert.strictEqual(
    model.buildMetaText({ source: 'usage', usage_count: 1, last_raw: iso(2024, 5, 5, 9) }, NOW),
    '最近用过 · 昨天'
  )
  assert.strictEqual(
    model.buildMetaText({ source: 'usage', usage_count: 2, last_raw: '' }, NOW),
    '用过 2 次'
  )
  assert.strictEqual(
    model.buildMetaText({ source: 'reserve', reserve_count: 2, last_raw: iso(2024, 3, 8, 9) }, NOW),
    '预约 2 次 · 3月8日'
  )
  assert.strictEqual(
    model.buildMetaText({ source: 'reserve', reserve_count: 1, last_raw: '' }, NOW),
    '最近预约'
  )
  assert.strictEqual(model.buildMetaText({ source: 'recommend' }, NOW), '推荐')
  assert.strictEqual(model.buildMetaText(null, NOW), '')
}

function testBuildCards() {
  const cards = model.buildCards([
    {
      device_id: 'A',
      device_name: '离心机',
      picture: 'cloud://a',
      lab_name: '一号楼',
      device_room: '101',
      source: 'usage',
      usage_count: 4,
      reserve_count: 0,
      last_raw: iso(2024, 5, 6, 9)
    }
  ], NOW)

  assert.strictEqual(cards.length, 1)
  assert.strictEqual(cards[0].device_id, 'A')
  assert.strictEqual(cards[0].picture, 'cloud://a')
  assert.strictEqual(cards[0].meta_text, '用过 4 次 · 今天')
  assert.strictEqual(cards[0].imgFailed, false)
  assert.deepStrictEqual(model.buildCards([]), [])
}

testNormalizeLimit()
testGroupKey()
testBuildStats()
testBuildListMergesGroups()
testBuildLocalList()
testRecentText()
testMetaText()
testBuildCards()

console.log('commonDeviceModel tests passed')
