// 复现「待开始预约显示 69，点进去只有 1 条」：用同一批假数据分别按旧条件、新条件数一遍
// 运行：node preview/simulate-pending-count.js（仓库根目录）
const reserveFilter = require('../miniprogram/utils/reserveFilter.js')

const command = {
  in: values => ({ $in: values }),
  gte: value => ({ $gte: value }),
  lt: value => ({ $lt: value })
}

// 极简 where 匹配器：只实现这里用到的 $in / $gte / $lt 与等值判断
function matches(doc, where) {
  return Object.keys(where).every((key) => {
    const cond = where[key]
    if (cond && typeof cond === 'object') {
      if ('$in' in cond) return cond.$in.indexOf(doc[key]) >= 0
      if ('$gte' in cond) return typeof doc[key] === 'string' && doc[key] >= cond.$gte
      if ('$lt' in cond) return typeof doc[key] === 'string' && doc[key] < cond.$lt
    }
    return doc[key] === cond
  })
}

const NOW_TEXT = '2026-05-06 10:00'

// 造 69 条 approved：60 条早就过期没去用、8 条已经用完、1 条真的还没开始
const docs = []
for (let i = 0; i < 60; i++) {
  const day = String((i % 28) + 1).padStart(2, '0')
  docs.push({
    user_id: 'student-1',
    status: 'approved',
    usage_status: i % 7 === 0 ? '' : 'not_started', // 混入空串，模拟老数据
    start_time: `2026-03-${day} 09:00`,
    end_time: `2026-03-${day} 10:00`
  })
}
for (let i = 0; i < 8; i++) {
  docs.push({
    user_id: 'student-1',
    status: 'approved',
    usage_status: 'completed',
    start_time: `2026-04-0${i + 1} 14:00`,
    end_time: `2026-05-2${i % 9} 16:00`
  })
}
docs.push({
  user_id: 'student-1',
  status: 'approved',
  usage_status: 'not_started',
  start_time: '2026-05-06 19:00',
  end_time: '2026-05-06 21:00'
})

const oldWhere = { user_id: 'student-1', status: 'approved' }
const newWhere = reserveFilter.buildReservationWhere(command, {
  userId: 'student-1',
  filter: 'upcoming',
  nowText: NOW_TEXT
})

const oldCount = docs.filter(doc => matches(doc, oldWhere)).length
const newCount = docs.filter(doc => matches(doc, newWhere)).length

console.log('库里 approved 预约：' + docs.length + ' 条（60 条已过期 + 8 条已用完 + 1 条真的待开始）')
console.log('旧条件 { user_id, status: "approved" } → 待开始 ' + oldCount + ' 条')
console.log('新条件 ' + JSON.stringify(newWhere) + ' → 待开始 ' + newCount + ' 条')
console.log(newCount === 1 && oldCount === 69 ? '复现与修复一致 ✅' : '数字对不上，检查条件 ❌')
