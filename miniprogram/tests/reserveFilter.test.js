/**
 * utils/reserveFilter.js 的纯逻辑断言（不依赖 wx.*，可直接 node 跑）
 * 运行：cd miniprogram && node tests/reserveFilter.test.js
 *
 * 重点盯的是「数字和列表对不上」那个 bug：待开始的条件一旦漏掉时间/使用状态，
 * 「我的」页就会把历史预约全算进去。
 */

const assert = require('assert')
const reserveFilter = require('../utils/reserveFilter.js')

// 假 command：只要形状对得上，断言就能看出条件拼错没有
const command = {
  in: values => ({ $in: values }),
  gte: value => ({ $gte: value }),
  lt: value => ({ $lt: value })
}

const nowText = '2026-05-06 10:00'

// ---- formatNowText：与 reserves.end_time 同格式，补零 ----
assert.strictEqual(
  reserveFilter.formatNowText(new Date(2026, 4, 6, 9, 5)),
  '2026-05-06 09:05',
  '应输出 YYYY-MM-DD HH:mm 且补零'
)
assert.strictEqual(
  reserveFilter.formatNowText(new Date(2026, 11, 31, 23, 59)),
  '2026-12-31 23:59'
)

// ---- upcoming：已通过 + 未开始使用 + 时段还没结束 ----
assert.deepStrictEqual(
  reserveFilter.buildReservationWhere(command, { userId: 'u1', filter: 'upcoming', nowText: nowText }),
  {
    user_id: 'u1',
    status: 'approved',
    usage_status: { $in: ['not_started', ''] },
    end_time: { $gte: nowText }
  },
  '待开始必须排除已用完的、已过期的，否则数字虚高'
)

// ---- expired：同样未开始使用，但时段已经过去 ----
assert.deepStrictEqual(
  reserveFilter.buildReservationWhere(command, { userId: 'u1', filter: 'expired', nowText: nowText }),
  {
    user_id: 'u1',
    status: 'approved',
    usage_status: { $in: ['not_started', ''] },
    end_time: { $lt: nowText }
  }
)

// ---- effective：已进入使用流程 ----
assert.deepStrictEqual(
  reserveFilter.buildReservationWhere(command, { userId: 'u1', filter: 'effective', nowText: nowText }),
  {
    user_id: 'u1',
    status: 'approved',
    usage_status: { $in: ['active', 'completed', 'abnormal'] }
  }
)

// ---- cancelled：待审核/已拒绝/已取消 ----
assert.deepStrictEqual(
  reserveFilter.buildReservationWhere(command, { userId: 'u1', filter: 'cancelled', nowText: nowText }),
  {
    user_id: 'u1',
    status: { $in: ['cancelled', 'rejected', 'pending'] }
  }
)

// ---- all / 未知 filter：只按人过滤，别把它筛成空列表 ----
assert.deepStrictEqual(
  reserveFilter.buildReservationWhere(command, { userId: 'u1', filter: 'all', nowText: nowText }),
  { user_id: 'u1' }
)
assert.deepStrictEqual(
  reserveFilter.buildReservationWhere(command, { userId: 'u1' }),
  { user_id: 'u1' },
  '不传 filter 时按全部处理'
)

// ---- 传进来的 nowText 必须原样用上（页面只取一次当前时间，数字和列表用同一刻） ----
assert.strictEqual(
  reserveFilter.buildReservationWhere(command, { userId: 'u1', filter: 'upcoming', nowText: '2030-01-01 08:00' })
    .end_time.$gte,
  '2030-01-01 08:00'
)

// ---- 状态覆盖：待开始 ∪ 已过期 ∪ 已生效 必须覆盖所有 usage_status 取值 ----
// 否则漏掉的状态既不算待开始也不算已生效，数字和列表永远差一截
const knownStates = ['not_started', '', 'active', 'completed', 'abnormal']
knownStates.forEach((state) => {
  const inNotStarted = reserveFilter.NOT_STARTED_STATES.indexOf(state) >= 0
  const inStarted = reserveFilter.STARTED_STATES.indexOf(state) >= 0
  assert.ok(inNotStarted || inStarted, `usage_status = "${state}" 没有落进任何筛选`)
  assert.ok(!(inNotStarted && inStarted), `usage_status = "${state}" 同时落进两个筛选`)
})

console.log('reserveFilter tests passed')
