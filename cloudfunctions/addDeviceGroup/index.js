const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()
const _ = db.command


// 云函数入口函数
exports.main = async (event, context) => {

  // 1. 接收参数
  const {
    device_name = '',
      lab_name = '',
      device_room = '',
      device_type = 'large',
      lab_type = 'public',
      device_ids = [],
      picture = '',
      operation_procedure = '',
      precautions = '',
      specifications = {}
  } = event

  try {
    // 2. 基础参数校验
    if (!device_name.trim()) {
      return buildResult(1001, '仪器名称不能为空')
    }
    if (!lab_name.trim()) {
      return buildResult(1002, '所属实验室不能为空')
    }
    if (!device_room.trim()) {
      return buildResult(1003, '房间位置不能为空')
    }
    if (!Array.isArray(device_ids) || device_ids.length === 0) {
      return buildResult(1004, '请至少填写一台设备编号')
    }

    // 3. 设备编号去重校验（数据库已存在的不能重复添加）
    const cleanIds = [...new Set(device_ids.map(id => String(id).trim()))].filter(Boolean)
    if (cleanIds.length !== device_ids.length) {
      return buildResult(1005, '提交的设备编号存在重复')
    }

    const existRes = await db.collection('devices')
      .where({
        device_id: _.in(cleanIds)
      })
      .count()
    if (existRes.total > 0) {
      return buildResult(1006, `有 ${existRes.total} 个设备编号已存在，请更换编号`)
    }

    // 4. 组装每条设备记录（同组共享字段完全一致）
    const now = new Date().toISOString()
    const deviceRecords = cleanIds.map(deviceId => ({
      device_id: deviceId,
      device_name: device_name.trim(),
      lab_name: lab_name.trim(),
      lab_type: lab_type,
      device_room: device_room.trim(),
      device_type: device_type,
      status: 'available', // 默认可用状态
      picture: picture,
      operation_procedure: operation_procedure.trim(),
      precautions: precautions.trim(),
      specifications: specifications,
      create_time: now,
      update_time: now
    }))

    // 5. 批量插入数据库
    const addRes = await db.collection('devices').add({
      data: deviceRecords
    })
    console.log("deviceRecords:", deviceRecords)
    console.log("addRes:", addRes)

    // 兼容返回值：新版SDK批量返回ids，旧版单条返回_id
    const addCount = addRes.ids ? addRes.ids.length : (addRes._id ? 1 : 0)

    return buildResult(0, '新增成功', {
      addCount
    })



  } catch (err) {
    console.error('新增仪器组失败:', err)
    return buildResult(9999, '系统错误：' + err.message)
  }
}
// 统一返回格式
function buildResult(code, message, data = {}) {
  return {
    code,
    message,
    data
  }
}