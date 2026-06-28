const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { labCondition, deviceType, keyword, pageSize, pageNum } = event

  // 1) 构建查询条件
  let finalCondition = {}
  if (labCondition) {
    if (labCondition.deny) {
      return { code: 0, data: { groups: [], total: 0, hasMore: false } }
    }
    finalCondition = labCondition
  }
  if (deviceType) {
    finalCondition = _.and([finalCondition, { device_type: deviceType }])
  }

  // 2) 取全部匹配设备（分组需要完整数据）
  let allDevices = []
  let skip = 0
  const batchSize = 100
  while (true) {
    const res = await db.collection('devices').where(finalCondition).skip(skip).limit(batchSize).get()
    allDevices.push(...res.data)
    if (res.data.length < batchSize) break
    skip += batchSize
  }

  // 3) 关键词过滤
  if (keyword) {
    const kw = keyword.toLowerCase().trim()
    allDevices = allDevices.filter(d => {
      const specs = d.specifications || {}
      const model = String(specs['型号'] || specs.model || d.model || '').toLowerCase()
      const name = (d.device_name || '').toLowerCase()
      const lab = (d.lab_name || '').toLowerCase()
      const room = (d.device_room || '').toLowerCase()
      const desc = (d.description || '').toLowerCase()
      return name.includes(kw) || model.includes(kw) || lab.includes(kw) || room.includes(kw) || desc.includes(kw)
    })
  }

  // 4) 查使用中的记录
  const deviceIds = [...new Set(allDevices.map(d => d.device_id).filter(Boolean))]
  const usingDeviceIdSet = new Set()
  if (deviceIds.length > 0) {
    for (let i = 0; i < deviceIds.length; i += 50) {
      const chunk = deviceIds.slice(i, i + 50)
      const usageRes = await db.collection('device_usage')
        .where({ status: 'using', device_id: _.in(chunk) })
        .get()
      ;(usageRes.data || []).forEach(u => {
        if (u.device_id) usingDeviceIdSet.add(u.device_id)
      })
    }
  }

  // 5) 分组
  const groupMap = {}
  allDevices.forEach(d => {
    const specs = d.specifications || {}
    const model = String(specs['型号'] || specs.model || d.model || '').trim()
    const key = [d.device_name, d.lab_name, d.device_room, d.device_type, model].join('||')

    if (!groupMap[key]) {
      groupMap[key] = {
        group_key: key,
        device_name: d.device_name,
        device_type: d.device_type,
        lab_name: d.lab_name,
        device_room: d.device_room,
        model,
        picture: d.picture,
        available: 0, using: 0, maintenance: 0, total: 0
      }
    }

    const g = groupMap[key]
    g.total += 1
    if (usingDeviceIdSet.has(d.device_id)) {
      g.using += 1
    } else if (d.status === 'maintenance') {
      g.maintenance += 1
    } else {
      g.available += 1
    }
    if (!g.picture && d.picture) g.picture = d.picture
  })

  // 6) 排序
  let groups = Object.values(groupMap)
  groups.sort((a, b) => {
    return a.device_name?.localeCompare(b.device_name || '') ||
           a.lab_name?.localeCompare(b.lab_name || '') ||
           a.device_room?.localeCompare(b.device_room || '') ||
           a.device_type?.localeCompare(b.device_type || '') ||
           a.model?.localeCompare(b.model || '')
  })

  // 7) 分页
  const total = groups.length
  const start = (pageNum - 1) * pageSize
  const paged = groups.slice(start, start + pageSize)

  return {
    code: 0,
    data: { groups: paged, total, hasMore: start + pageSize < total }
  }
}