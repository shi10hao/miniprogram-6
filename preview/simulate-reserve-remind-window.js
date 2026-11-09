/**
 * 预约前提醒「窗口」行为模拟（纯本地，不连云）
 *
 * 目的：证明改窗口前后「哪些预约收得到提醒」的差别 —— 原实现下界是 now+10min，
 * 于是「开始前 10 分钟内才创建 / 才批准」的预约永远落在窗口外（永久盲区）。
 *
 * 运行：node preview/simulate-reserve-remind-window.js
 */

const TICK_MS = 5 * 60 * 1000
// 改前：窗口 [now + 10min, now + 35min)
const OLD_MIN_OFFSET_MS = 10 * 60 * 1000
const OLD_AHEAD_MS = 35 * 60 * 1000
// 改后：窗口 [now - 5min, now + 35min)
const NEW_MIN_OFFSET_MS = -5 * 60 * 1000
const NEW_AHEAD_MS = 35 * 60 * 1000

const MIN = 60 * 1000
const HOUR = 60 * MIN

// 以 08:00 为零点做相对计时，避免时区干扰
function t(hours, minutes) {
  return hours * HOUR + minutes * MIN
}

const cases = [
  {
    name: '提前很久建的正常预约',
    startTs: t(10, 0),
    createdTs: t(7, 30),
    approvedTs: t(7, 31)
  },
  {
    name: '开始前 12 分钟才创建',
    startTs: t(10, 12),
    createdTs: t(10, 0),
    approvedTs: t(10, 0)
  },
  {
    name: '开始前 4 分钟才创建',
    startTs: t(10, 4),
    createdTs: t(10, 0),
    approvedTs: t(10, 0)
  },
  {
    name: '40 分钟前创建、22 分钟前才批准',
    startTs: t(11, 0),
    createdTs: t(10, 20),
    approvedTs: t(10, 38)
  }
]

// minOffsetMs：窗口下界相对「现在」的偏移
//   改前 = +10 分钟（now+10min 起），改后 = -5 分钟（留 5 分钟宽限）
// aheadMs：窗口上界 = now + aheadMs
function inWindow(nowTs, startTs, minOffsetMs, aheadMs) {
  return startTs >= nowTs + minOffsetMs && startTs < nowTs + aheadMs
}

// 一条预约在给定窗口下「第一次被提醒」的时刻
function firstRemind(c, minOffsetMs, aheadMs) {
  const tickStart = Math.ceil(Math.max(c.createdTs, c.approvedTs) / TICK_MS) * TICK_MS
  for (let nowTs = tickStart; nowTs < c.startTs + HOUR; nowTs += TICK_MS) {
    if (inWindow(nowTs, c.startTs, minOffsetMs, aheadMs)) return nowTs
  }
  return null
}

function clock(ts) {
  const base = t(8, 0)
  const diff = ts - base
  const h = 8 + Math.floor(diff / HOUR)
  const m = Math.round((diff % HOUR) / MIN)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function describe(label, c, ts) {
  if (ts === null) return `${label}：收不到提醒`
  const ahead = Math.round((c.startTs - ts) / MIN)
  return `${label}：${clock(ts)} 提醒（提前 ${ahead} 分钟）`
}

let changed = 0
console.log('预约开始时刻 / 创建时刻 -> 首次提醒时刻\n')
cases.forEach((c) => {
  const oldTs = firstRemind(c, OLD_MIN_OFFSET_MS, OLD_AHEAD_MS)
  const newTs = firstRemind(c, NEW_MIN_OFFSET_MS, NEW_AHEAD_MS)
  console.log(`${c.name}（${clock(c.startTs)} 开始）`)
  console.log('  ' + describe('改前', c, oldTs))
  console.log('  ' + describe('改后', c, newTs))
  if (oldTs !== newTs) changed += 1
  console.log('')
})

if (changed === 0) {
  console.error('窗口改动没有产生任何差异，检查常量是否真的改到了')
  process.exit(1)
}

// 改后必须满足的三条
const lateCase = cases[2]
if (firstRemind(lateCase, OLD_MIN_OFFSET_MS, OLD_AHEAD_MS) !== null) {
  console.error('「开始前 4 分钟才创建」在改前不该收到提醒，模拟条件写错了')
  process.exit(1)
}
if (firstRemind(lateCase, NEW_MIN_OFFSET_MS, NEW_AHEAD_MS) === null) {
  console.error('改后仍然收不到「开始前 4 分钟才创建」的提醒')
  process.exit(1)
}
const normal = cases[0]
const normalTs = firstRemind(normal, NEW_MIN_OFFSET_MS, NEW_AHEAD_MS)
const aheadMinutes = Math.round((normal.startTs - normalTs) / MIN)
if (aheadMinutes < 30 || aheadMinutes > 35) {
  console.error(`正常预约的提前量应在 30~35 分钟，实际 ${aheadMinutes} 分钟`)
  process.exit(1)
}

console.log(`行为差异符合预期：${changed} 条预约的提醒时刻发生变化`)
console.log('正常预约仍在开始前 30~35 分钟提醒，临时创建的预约不再漏提醒')
