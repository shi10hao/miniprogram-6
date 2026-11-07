const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const {
    device_name = '',
    lab_name = '',
    device_room = '',
    device_type = '',
    model = '',
    force = false // 前端二次确认后传 true，才允许删除仍有未结束预约的组
  } = event

  try {
    // 基础参数校验
    if (!device_name || !lab_name || !device_room || !device_type) {
      return buildResult(1001, '缺少设备分组参数')
    }

    // 构造查询条件：名称 + 实验室 + 房间 + 类型，型号再加一层或条件
    // 注意不能写成 whereCondition._ = _.or(...)，'_' 会被当成真实字段名，一条都删不掉
    const baseCondition = {
      device_name,
      lab_name,
      device_room,
      device_type
    }
    const modelCondition = model && model.trim()
      ? _.or([{ model: model.trim() }, { 'specifications.型号': model.trim() }])
      : null
    const buildWhere = (extra) => {
      const list = [baseCondition]
      if (modelCondition) list.push(modelCondition)
      if (extra) list.push(extra)
      return list.length > 1 ? _.and(list) : baseCondition
    }
    const whereCondition = buildWhere(null)

    // 3. 安全校验：组内有正在使用的设备则禁止删除
    const usingCheck = await db.collection('devices')
      .where(buildWhere({ status: 'using' }))
      .count()
    if (usingCheck.total > 0) {
      return buildResult(1002, `该组有 ${usingCheck.total} 台设备正在使用中，无法删除`)
    }

    // 3.1 组内还有未结束的预约时，要求前端二次确认，避免留下孤儿预约
    if (!force) {
      const groupDeviceIds = await listGroupDeviceIds(whereCondition)
      const activeReserveCount = await countActiveReserves(groupDeviceIds)
      if (activeReserveCount > 0) {
        return buildResult(1004, `该组还有 ${activeReserveCount} 条未结束的预约，删除后这些预约将失去仪器信息`, {
          reserveCount: activeReserveCount
        })
      }
    }

    // 4. 执行批量删除
    const deleteRes = await db.collection('devices')
      .where(whereCondition)
      .remove()

    const deleteCount = deleteRes.stats.removed
    if (deleteCount === 0) {
      return buildResult(1003, '未找到匹配的设备，删除0条')
    }

    return buildResult(0, '删除成功', {
      deleteCount
    })
  } catch (err) {
    console.error('删除仪器组失败:', err)
    return buildResult(9999, '系统错误：' + err.message)
  }
}

/** 取出组内全部设备编号（最多 1000 条，足够覆盖单组规模） */
async function listGroupDeviceIds(whereCondition) {
  const ids = []
  const batch = 100
  for (let skip = 0; skip < 1000; skip += batch) {
    const res = await db.collection('devices')
      .where(whereCondition)
      .field({ device_id: true })
      .skip(skip)
      .limit(batch)
      .get()
    const rows = res.data || []
    rows.forEach((row) => {
      if (row.device_id) ids.push(row.device_id)
    })
    if (rows.length < batch) break
  }
  return ids
}

/** 统计这些设备上还没结束的已通过预约数量 */
async function countActiveReserves(deviceIds) {
  if (!deviceIds.length) return 0
  const now = Date.now()
  let total = 0
  for (let i = 0; i < deviceIds.length; i += 50) {
    const chunk = deviceIds.slice(i, i + 50)
    const res = await db.collection('reserves')
      .where(_.and([
        { device_id: _.in(chunk) },
        { status: 'approved' },
        { end_ts: _.gt(now) }
      ]))
      .count()
    total += res.total || 0
  }
  return total
}

// 统一返回格式
function buildResult(code, message, data = {}) {
  return {
    code,
    message,
    data
  }
}
