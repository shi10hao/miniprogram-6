// cloudfunctions/getAvailableDevices/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { filters, userInfo } = event
  const userGroup = userInfo.researchGroup

  let condition = _.and([
    { status: 'available' },
    _.or([
      { lab_type: 'public' },
      { lab_name: userGroup }
    ])
  ])

  if (filters.labType !== 'all') {
    condition = _.and([
      condition,
      { lab_type: filters.labType }
    ])
  }

  if (filters.deviceType !== 'all') {
    condition = _.and([
      condition,
      { device_type: filters.deviceType }
    ])
  }

  const MAX_LIMIT = 100
  const countRes = await db.collection('devices').where(condition).count()
  const total = countRes.total
  const batchTimes = Math.ceil(total / MAX_LIMIT)

  const tasks = []
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(
      db.collection('devices')
        .where(condition)
        .skip(i * MAX_LIMIT)
        .limit(MAX_LIMIT)
        .get()
    )
  }

  const results = await Promise.all(tasks)
  console.log(results)
  return results.reduce((acc, cur) => acc.concat(cur.data), [])
}