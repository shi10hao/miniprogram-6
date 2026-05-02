// cloudfunctions/getDevices/index.js
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { groupName } = event

  // 可见性条件
  let visibilityCondition
  if (groupName) {
    visibilityCondition = _.or([
      { lab_type: 'public' },
      { lab_name: groupName }
    ])
  } else {
    visibilityCondition = { lab_type: 'public' }
  }

  const condition = _.and([
    { status: 'available' },
    visibilityCondition
  ])

  // 分页拉取
  const MAX_LIMIT = 100
  const countRes = await db.collection('devices').where(condition).count()
  const total = countRes.total
  const batchTimes = Math.ceil(total / MAX_LIMIT)

  const tasks = []
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(
      db.collection('devices')
        .where(condition)
        .orderBy('device_id', 'asc')
        .skip(i * MAX_LIMIT)
        .limit(MAX_LIMIT)
        .get()
    )
  }

  const results = await Promise.all(tasks)

  // 扁平化
  return results.reduce((acc, cur) => acc.concat(cur.data), [])
}