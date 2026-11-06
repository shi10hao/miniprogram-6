/**
 * lib/reserveFlow.js 的纯逻辑断言（不依赖 wx.*，可直接 node 跑）
 * 运行：cd miniprogram && node tests/reserveFlow.test.js
 */

const assert = require('assert')
const reserveFlow = require('../pages/device/detail/lib/reserveFlow.js')

// ---- getAvailableCodes：只取"可用"组，并剔除占位编号 ----
assert.deepStrictEqual(reserveFlow.getAvailableCodes(null), [], '空输入应返回空数组')
assert.deepStrictEqual(reserveFlow.getAvailableCodes([]), [], '空分组应返回空数组')

const groups = [
  {
    key: 'available',
    label: '可用',
    count: 3,
    codes: ['DEV-2', '未编号', '', 'DEV-1001']
  },
  { key: 'using', label: '使用中', count: 1, codes: ['DEV-9'] },
  { key: 'maintenance', label: '维修中', count: 0, codes: [] }
]
assert.deepStrictEqual(
  reserveFlow.getAvailableCodes(groups),
  ['DEV-2', 'DEV-1001'],
  '应剔除「未编号」和空字符串，且不混入使用中的编号'
)

// 全维修中时没有可预约编号，不能拿出「使用中」的编号糊弄
assert.deepStrictEqual(
  reserveFlow.getAvailableCodes([
    { key: 'available', codes: [] },
    { key: 'maintenance', codes: ['DEV-3'] }
  ]),
  []
)

// ---- buildSheetItems：最多 6 项，当前那台加后缀 ----
assert.deepStrictEqual(reserveFlow.buildSheetItems(null, 'DEV-1'), [], '空列表应返回空数组')
assert.deepStrictEqual(
  reserveFlow.buildSheetItems(['DEV-1', 'DEV-2'], 'DEV-1'),
  ['DEV-1 · 当前', 'DEV-2'],
  '当前编号应带「· 当前」后缀'
)
assert.deepStrictEqual(
  reserveFlow.buildSheetItems(['DEV-1', 'DEV-2'], ''),
  ['DEV-1', 'DEV-2'],
  '没有当前编号时不应加后缀'
)

const many = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']
const items = reserveFlow.buildSheetItems(many, 'D8')
assert.strictEqual(items.length, 6, 'showActionSheet 上限 6 项')
assert.deepStrictEqual(items, ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], '截断应保留前 6 项')

// ---- buildUrl：编码编号，空编号不带参数 ----
assert.strictEqual(
  reserveFlow.buildUrl('DEV 1/x'),
  '/pages/reservation/reservation?deviceId=DEV%201%2Fx',
  '编号里的空格与斜杠必须转义'
)
assert.strictEqual(
  reserveFlow.buildUrl(''),
  '/pages/reservation/reservation',
  '没有编号时不应留下空的 deviceId 参数'
)
assert.strictEqual(reserveFlow.buildUrl(null), '/pages/reservation/reservation')

console.log('reserveFlow tests passed')
