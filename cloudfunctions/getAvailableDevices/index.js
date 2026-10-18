// cloudfunctions/getAvailableDevices/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { filters, userInfo, reserveDate, startTime, endTime } = event
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

  // 只取前端分组/展示真正用得到的字段，显著减小返回体积
  const FIELD = {
    device_id: true,
    device_name: true,
    lab_type: true,
    device_type: true,
    lab_name: true,
    device_room: true,
    picture: true,
    description: true,
    specifications: true
  }

  const tasks = []
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(
      db.collection('devices')
        .where(condition)
        .field(FIELD)
        .skip(i * MAX_LIMIT)
        .limit(MAX_LIMIT)
        .get()
    )
  }

  const results = await Promise.all(tasks)
  const list = results.reduce((acc, cur) => acc.concat(cur.data), [])
  console.log('设备条数:', list.length)

  // 把冲突查询与「使用中」查询一起并入本函数：
  // 前端原本要串行 3 次云函数/数据库往返，现在合并为 1 次。
  const deviceIds = list.map(d => d.device_id).filter(Boolean)

  const conflictMap = {}
  let reservedDevices = []
  let usingDeviceIds = []

  if (deviceIds.length > 0) {
    const [conflictRes, usingRes] = await Promise.all([
      db.collection('reserves').where(
        _.and([
          { device_id: _.in(deviceIds) },
          { reserve_date: reserveDate },
          _.or([
            _.and([{ start_time: _.lte(startTime) }, { end_time: _.gt(startTime) }]),
            _.and([{ start_time: _.lt(endTime) }, { end_time: _.gte(endTime) }]),
            _.and([{ start_time: _.gte(startTime) }, { end_time: _.lte(endTime) }])
          ])
        ])
      ).field({ device_id: true }).get(),
      db.collection('device_usage')
        .where({ device_id: _.in(deviceIds), status: 'using' })
        .field({ device_id: true })
        .get()
    ])

    const conflicts = conflictRes.data || []
    reservedDevices = conflicts.map(item => item.device_id)
    conflicts.forEach((r) => {
      conflictMap[r.device_id] = (conflictMap[r.device_id] || 0) + 1
    })
    usingDeviceIds = (usingRes.data || []).map(item => item.device_id).filter(Boolean)
  }

  // 返回对象结构；前端保留了数组兼容分支，两种结构都能处理
  return {
    list,
    conflictMap,
    reservedDevices,
    usingDeviceIds
  }
}
