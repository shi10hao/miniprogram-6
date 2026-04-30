const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { docId, status, adminUserId } = event
  const validStatuses = ['available', 'maintenance']

  if (!docId) {
    return { success: false, error: '缺少设备ID' }
  }

  if (!status || validStatuses.indexOf(status) === -1) {
    return { success: false, error: '无效的状态值' }
  }

  try {
    var isAdmin = false

    if (adminUserId) {
      const userRes = await db.collection('users')
        .where({ user_id: adminUserId, role: _.in(['admin', 'teacher']) })
        .limit(1)
        .get()
      isAdmin = userRes.data && userRes.data.length > 0
    }

    if (!isAdmin) {
      const wxContext = cloud.getWXContext()
      const openid = wxContext.OPENID
      if (openid) {
        const userRes = await db.collection('users')
          .where({ _openid: openid, role: _.in(['admin', 'teacher']) })
          .limit(1)
          .get()
        isAdmin = userRes.data && userRes.data.length > 0
      }
    }

    if (!isAdmin) {
      return { success: false, error: '无操作权限' }
    }

    await db.collection('devices').doc(docId).update({
      data: { status: status }
    })

    return { success: true }
  } catch (err) {
    console.error('更新设备状态失败:', err)
    return { success: false, error: err.message || '更新失败' }
  }
}
