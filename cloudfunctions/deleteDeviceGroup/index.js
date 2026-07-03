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
      model = ''
  } = event

  try {
    // 基础参数校验
    if (!device_name || !lab_name || !device_room || !device_type) {
      return buildResult(1001, '缺少设备分组参数')
    }

    // 构造查询条件
    const whereCondition = {
      device_name,
      lab_name,
      device_room,
      device_type
    }


    // 型号兼容：同时匹配 model 字段 和 specifications.型号
    if (model && model.trim()) {
      whereCondition._ = _.or([{
          model: model.trim()
        },
        {
          'specifications.型号': model.trim()
        }
      ])
    }

    // 3. 安全校验：组内有正在使用的设备则禁止删除
    const usingCheck = await db.collection('devices')
      .where(_.and([
        whereCondition,
        {
          status: 'using'
        }
      ]))
      .count()
    if (usingCheck.total > 0) {
      return buildResult(1002, `该组有 ${usingCheck.total} 台设备正在使用中，无法删除`)
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

// 统一返回格式
function buildResult(code, message, data = {}) {
  return {
    code,
    message,
    data
  }
}