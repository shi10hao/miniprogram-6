const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ROLE_ADMIN = 'admin'
const ROLE_TEACHER = 'teacher'
const MAX_PAGE_SIZE = 100
const BATCH_SIZE = 100
const MAX_SCAN = 3000

/**
 * 解析调用者身份
 * 优先用 OPENID 反查 users（可信）；查不到时退回前端传参（兼容旧版本客户端）
 */
async function resolveCaller(event = {}) {
  const passedRole = String(event.role || '').trim()
  const fallback = {
    role: passedRole === ROLE_ADMIN || passedRole === ROLE_TEACHER ? passedRole : 'guest',
    groupName: String(event.groupName || '').trim()
  }
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fallback
  try {
    const res = await db.collection('users').where({ wx_openid: OPENID }).limit(1).get()
    const user = (res.data || [])[0]
    if (!user) return fallback
    if (user.role !== ROLE_ADMIN && user.role !== ROLE_TEACHER) {
      return { role: 'guest', groupName: '' }
    }
    return { role: user.role, groupName: String(user.group_name || '').trim() }
  } catch (err) {
    console.error('[getAdminGroups] 反查调用者身份失败，改用前端传参', err)
    return fallback
  }
}

/**
 * 构建实验室可见范围条件
 * 返回 null 表示不限制（管理员看全部）；返回 { deny: true } 表示无权查看
 */
function buildLabCondition(role, groupName, labType) {
  if (role === ROLE_ADMIN) {
    if (labType === 'public' || labType === 'group') return { lab_type: labType }
    return null
  }
  if (role !== ROLE_TEACHER) return { deny: true }
  if (!groupName) return { lab_type: 'public' }
  if (labType === 'public') return { lab_type: 'public' }
  if (labType === 'group') return { lab_name: groupName }
  return _.or([{ lab_type: 'public' }, { lab_name: groupName }])
}

/** 关键词命中判断：名称、型号、实验室、房间、描述任一包含即可 */
function matchKeyword(device, kw) {
  const specs = device.specifications || {}
  const model = String(specs['型号'] || specs.model || device.model || '').toLowerCase()
  const name = String(device.device_name || '').toLowerCase()
  const lab = String(device.lab_name || '').toLowerCase()
  const room = String(device.device_room || '').toLowerCase()
  const desc = String(device.description || '').toLowerCase()
  return name.includes(kw) || model.includes(kw) || lab.includes(kw) || room.includes(kw) || desc.includes(kw)
}

exports.main = async (event = {}) => {
  const emptyResult = { code: 0, data: { groups: [], total: 0, hasMore: false } }

  const pageSize = Math.min(Math.max(Number(event.pageSize) || 15, 1), MAX_PAGE_SIZE)
  const pageNum = Math.max(Number(event.pageNum) || 1, 1)
  const keyword = String(event.keyword || '').trim().toLowerCase()
  const deviceType = event.deviceType === 'large' || event.deviceType === 'small' ? event.deviceType : ''

  // 1) 可见范围
  let labCondition = null
  if (event.labType) {
    const caller = await resolveCaller(event)
    labCondition = buildLabCondition(caller.role, caller.groupName, event.labType)
  } else {
    // 兼容旧调用：直接传 where 条件片段
    labCondition = event.labCondition || null
  }
  if (labCondition && labCondition.deny) return emptyResult

  // 2) 合并筛选条件
  const conditions = []
  if (labCondition) conditions.push(labCondition)
  if (deviceType) conditions.push({ device_type: deviceType })

  let finalCondition = null
  if (conditions.length === 1) finalCondition = conditions[0]
  else if (conditions.length > 1) finalCondition = _.and(conditions)

  const collection = finalCondition ? db.collection('devices').where(finalCondition) : db.collection('devices')

  // 3) 取全部匹配设备（分组需要完整数据）
  const allDevices = []
  let skip = 0
  while (skip < MAX_SCAN) {
    const res = await collection.skip(skip).limit(BATCH_SIZE).get()
    const rows = res.data || []
    allDevices.push(...rows)
    if (rows.length < BATCH_SIZE) break
    skip += BATCH_SIZE
  }
  if (allDevices.length >= MAX_SCAN) {
    console.warn('[getAdminGroups] 设备数量超过扫描上限 ' + MAX_SCAN + '，统计可能不完整')
  }

  // 4) 关键词过滤
  const matched = keyword ? allDevices.filter(d => matchKeyword(d, keyword)) : allDevices

  // 5) 查使用中的记录
  const deviceIds = [...new Set(matched.map(d => d.device_id).filter(Boolean))]
  const usingDeviceIdSet = new Set()
  for (let i = 0; i < deviceIds.length; i += 50) {
    const chunk = deviceIds.slice(i, i + 50)
    const usageRes = await db.collection('device_usage')
      .where({ status: 'using', device_id: _.in(chunk) })
      .get()
    ;(usageRes.data || []).forEach((u) => {
      if (u.device_id) usingDeviceIdSet.add(u.device_id)
    })
  }

  // 6) 分组：同一名称 + 实验室 + 房间 + 类型 + 型号视为一组仪器
  const groupMap = {}
  matched.forEach((d) => {
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
        available: 0,
        using: 0,
        maintenance: 0,
        total: 0
      }
    }

    const group = groupMap[key]
    group.total += 1
    if (usingDeviceIdSet.has(d.device_id)) group.using += 1
    else if (d.status === 'maintenance') group.maintenance += 1
    else group.available += 1
    if (!group.picture && d.picture) group.picture = d.picture
  })

  // 7) 排序
  const groups = Object.values(groupMap)
  groups.sort((a, b) => {
    return String(a.device_name || '').localeCompare(String(b.device_name || ''))
      || String(a.lab_name || '').localeCompare(String(b.lab_name || ''))
      || String(a.device_room || '').localeCompare(String(b.device_room || ''))
      || String(a.device_type || '').localeCompare(String(b.device_type || ''))
      || String(a.model || '').localeCompare(String(b.model || ''))
  })

  // 8) 分页
  const total = groups.length
  const start = (pageNum - 1) * pageSize

  return {
    code: 0,
    data: {
      groups: groups.slice(start, start + pageSize),
      total,
      hasMore: start + pageSize < total
    }
  }
}
