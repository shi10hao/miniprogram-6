// cloudfunctions/checkDeviceConflictsBatch/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { deviceIds, reserveDate, startTime, endTime } = event

  if (!deviceIds || deviceIds.length === 0) return {}

  const startDT = `${reserveDate} ${startTime}`
  const endDT = `${reserveDate} ${endTime}`

  const res = await db.collection('reserves').where(
    _.and([
      { device_id: _.in(deviceIds) },
      { reserve_date: reserveDate },
      { status: 'approved' },
      _.or([
        _.and([{ start_time: _.lte(startDT) }, { end_time: _.gt(startDT) }]),
        _.and([{ start_time: _.lt(endDT) }, { end_time: _.gte(endDT) }]),
        _.and([{ start_time: _.gte(startDT) }, { end_time: _.lte(endDT) }])
      ])
    ])
  ).get()

  // 按 device_id 统计冲突数
  const map = {}
  res.data.forEach(r => {
    map[r.device_id] = (map[r.device_id] || 0) + 1
  })

  return map
}