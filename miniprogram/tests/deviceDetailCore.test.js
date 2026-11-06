const assert = require('assert')

/**
 * 仪器详情页纯逻辑（pages/device/detail/lib/detailCore.js）的回归断言。
 * 这些函数决定了「同款仪器怎么分组」「顶部徽标说什么」「编号怎么排」「规程怎么跳」，
 * 曾经出过的事故都在下面的用例里留了痕：
 *   - 状态只有两态，全维修中也显示「可用」
 *   - 同名不同型号被算成同款
 *   - 编号按字符串排，1001 排在 999 前面
 *   - 非 sections 对象走 structured 导致子页面白屏
 * 运行：cd miniprogram && node tests/deviceDetailCore.test.js
 */

const detailCore = require('../pages/device/detail/lib/detailCore.js')

function testParseDeviceId() {
  assert.strictEqual(detailCore.parseDeviceId({ deviceId: 'A100' }), 'A100', '普通编号原样返回')
  assert.strictEqual(detailCore.parseDeviceId({ deviceId: 'A%20100' }), 'A 100', '被 encode 过的编号要 decode')
  assert.strictEqual(detailCore.parseDeviceId({ deviceId: '  A100  ' }), 'A100', '去掉首尾空格')
  assert.strictEqual(detailCore.parseDeviceId({}), '', '没有参数时返回空串')
  assert.strictEqual(detailCore.parseDeviceId(null), '', 'options 为 null 也不能抛')
  // 孤立的 % 会让 decodeURIComponent 抛错，必须退回原文而不是崩掉
  assert.strictEqual(detailCore.parseDeviceId({ deviceId: 'A%ZZ' }), 'A%ZZ', '非法转义退回原文')
}

function testGetDeviceModelPriority() {
  assert.strictEqual(detailCore.getDeviceModel({ specifications: { 型号: 'BX53' }, model: 'X' }), 'BX53', '优先取 specifications.型号')
  assert.strictEqual(detailCore.getDeviceModel({ specifications: { model: 'BX53' } }), 'BX53', '其次取 specifications.model')
  assert.strictEqual(detailCore.getDeviceModel({ model: 'BX53' }), 'BX53', '最后取顶层 model')
  assert.strictEqual(detailCore.getDeviceModel({ specifications: { 型号: '   ' }, model: 'BX53' }), 'BX53', '空型号不足以覆盖下一级')
  assert.strictEqual(detailCore.getDeviceModel({}), '', '什么都没有时返回空串')
  assert.strictEqual(detailCore.getDeviceModel(null), '', 'device 为 null 也不能抛')
}

function testCompareCode() {
  const codes = ['DEV-1001', 'DEV-999', 'DEV-2'].sort(detailCore.compareCode)
  assert.deepStrictEqual(codes, ['DEV-2', 'DEV-999', 'DEV-1001'], '按数字尾号排序而不是按字符串')
  assert.deepStrictEqual(['未编号', 'DEV-5'].sort(detailCore.compareCode), ['未编号', 'DEV-5'], '没有数字的编号排最前且不抛错')
}

function testBuildStatusGroups() {
  const devices = [
    { device_id: 'DEV-2', status: 'available' },
    { device_id: 'DEV-10', status: 'available' },
    { device_id: 'DEV-3', status: 'available' },
    { device_id: 'DEV-7', status: 'maintenance' },
    { device_id: 'DEV-5', status: 'available' }
  ]
  const groups = detailCore.buildStatusGroups(devices, ['DEV-5', 'DEV-3'])
  const byKey = {}
  groups.forEach((group) => {
    byKey[group.key] = group
  })

  assert.deepStrictEqual(byKey.available.codes, ['DEV-2', 'DEV-10'], '在用设备不能留在可用里，编号按尾号排')
  assert.deepStrictEqual(byKey.using.codes, ['DEV-3', 'DEV-5'], 'usage 里的设备归到使用中')
  assert.deepStrictEqual(byKey.maintenance.codes, ['DEV-7'], 'maintenance 归到维修中')
  assert.strictEqual(groups.length, 3, '永远是三组，顺序即可用/使用中/维修中')
  assert.deepStrictEqual(groups.map(group => group.key), ['available', 'using', 'maintenance'], '组顺序固定')
}

function testBuildStatusGroupsEdgeCases() {
  const empty = detailCore.buildStatusGroups([], [])
  assert.deepStrictEqual(empty.map(group => group.count), [0, 0, 0], '空列表三组计数为零')

  const noId = detailCore.buildStatusGroups([{ status: 'available' }], [])
  assert.deepStrictEqual(noId[0].codes, ['未编号'], '缺编号的设备用「未编号」占位')

  // 既在 usage 里又被标了 maintenance：按在用算，否则用户会看到「可预约」但约不上
  const conflict = detailCore.buildStatusGroups([{ device_id: 'DEV-1', status: 'maintenance' }], ['DEV-1'])
  assert.strictEqual(conflict[1].count, 1, '在用优先于维修中')
  assert.strictEqual(conflict[2].count, 0)

  // 同款超过 20 台（小程序单次 get 上限）时分组不能丢
  const many = []
  for (let i = 1; i <= 25; i += 1) {
    many.push({ device_id: 'DEV-' + i, status: 'available' })
  }
  const manyGroups = detailCore.buildStatusGroups(many, [])
  assert.strictEqual(manyGroups[0].count, 25, '25 台同款全都要出现在可用组')
}

function testBuildStatusSummary() {
  const build = (counts) => {
    return detailCore.buildStatusGroups(
      Object.keys(counts).reduce((acc, key) => {
        for (let i = 0; i < counts[key]; i += 1) {
          acc.push({ device_id: 'X-' + acc.length, status: key === 'maintenance' ? 'maintenance' : 'available' })
        }
        return acc
      }, []),
      []
    )
  }

  assert.deepStrictEqual(
    detailCore.buildStatusSummary(build({ available: 1, maintenance: 2 })),
    { statusKey: 'available', statusText: '有可用仪器' },
    '有可用就显示有可用'
  )
  // 原始 bug：只要有设备就报「可用」，全都维修中时会骗人
  assert.deepStrictEqual(
    detailCore.buildStatusSummary(build({ maintenance: 3 })),
    { statusKey: 'maintenance', statusText: '全部维修中' },
    '全部维修中不能再显示可用'
  )
  const allUsing = detailCore.buildStatusGroups(
    [{ device_id: 'A' }, { device_id: 'B' }],
    ['A', 'B']
  )
  assert.deepStrictEqual(
    detailCore.buildStatusSummary(allUsing),
    { statusKey: 'using', statusText: '全部使用中' },
    '全部在用显示全部使用中'
  )
  assert.deepStrictEqual(
    detailCore.buildStatusSummary([]),
    { statusKey: 'none', statusText: '暂无可用' },
    '空分组显示暂无可用'
  )
}

function testBuildBarState() {
  const availableState = detailCore.buildBarState(detailCore.buildStatusGroups(
    [{ device_id: 'A' }, { device_id: 'B' }, { device_id: 'C', status: 'maintenance' }],
    []
  ))
  assert.deepStrictEqual(availableState, { availableCount: 2, canReserve: true, barText: '2 台可用' }, '有可用就能预约并报台数')

  const noneState = detailCore.buildBarState(detailCore.buildStatusGroups(
    [{ device_id: 'A', status: 'maintenance' }],
    []
  ))
  assert.deepStrictEqual(noneState, { availableCount: 0, canReserve: false, barText: '暂无可预约' }, '没可用时按钮要拦住')
}

function testFormatGuide() {
  assert.deepStrictEqual(
    detailCore.formatGuide('先开机再预热'),
    { content: '先开机再预热', type: 'plain' },
    '纯文本走 plain'
  )

  const structured = { sections: [{ title: '开机', steps: ['插电', '按电源'] }] }
  const structuredResult = detailCore.formatGuide(structured)
  assert.strictEqual(structuredResult.type, 'structured', '带 sections 数组走 structured')
  assert.deepStrictEqual(JSON.parse(structuredResult.content), structured, 'content 必须是能 JSON.parse 回原对象的字符串')

  // 子页面只认 sections，其他对象结构走 structured 会白屏，只能退回纯文本
  assert.deepStrictEqual(
    detailCore.formatGuide({ text: '先开机再预热' }),
    { content: '先开机再预热', type: 'plain' },
    '普通对象取 text 走 plain'
  )
  assert.deepStrictEqual(
    detailCore.formatGuide({ content: '罐体' }),
    { content: '罐体', type: 'plain' },
    '普通对象取 content 走 plain'
  )
  assert.deepStrictEqual(
    detailCore.formatGuide(null),
    { content: '', type: 'plain' },
    'null 不能变成字符串 "undefined"'
  )
  assert.deepStrictEqual(
    detailCore.formatGuide({ sections: 'not-an-array' }).type,
    'plain',
    'sections 不是数组时不能当结构化'
  )
}

testParseDeviceId()
testGetDeviceModelPriority()
testCompareCode()
testBuildStatusGroups()
testBuildStatusGroupsEdgeCases()
testBuildStatusSummary()
testBuildBarState()
testFormatGuide()
console.log('deviceDetailCore tests passed')
