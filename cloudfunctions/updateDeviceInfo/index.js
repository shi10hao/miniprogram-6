const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { deviceIds, updateData } = event
  
  if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
    return { code: 1, message: '缺少 deviceIds' }
  }
  if (!updateData || Object.keys(updateData).length === 0) {
    return { code: 2, message: '缺少更新数据' }
  }

  try {
    // 逐条更新
    for (const id of deviceIds) {
      await db.collection('devices').doc(id).update({ data: updateData })
    }
    return { code: 0, message: '更新成功' }
  } catch (err) {
    console.error('更新失败', err)
    return { code: 3, message: err.message }
  }
}