const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const {
    reserveId,
    deviceName: paramDeviceName,
    deviceId: paramDeviceId,
    userName,
    feedbackTitle,
    feedbackContent
  } = event
  console.log('收到请求参数:', {
    reserveId,
    deviceName: paramDeviceName,  // ✅ 使用原始参数
    deviceId: paramDeviceId,      // ✅ 使用原始参数
    userName,
    feedbackTitle,
    feedbackContent
  })
  let finalDeviceName = paramDeviceName || ''
  let finalDeviceId = paramDeviceId || ''

  if (!finalDeviceName || !finalDeviceId) {
    try {
      const reserveRes = await db.collection('reserves').doc(reserveId).get()
      const reserve = reserveRes.data
      if (reserve) {
        finalDeviceName = reserve.device_name || finalDeviceName
        finalDeviceId = reserve.device_id || finalDeviceId
      }
    } catch (err) {
      console.error('查询预约信息失败:', err)
    }
  }
  // 1. 查找所有管理员（teacher 和 admin 角色）
  const adminUsers = await db.collection('users')
    .where({
      role: _.in(['teacher', 'admin'])
    })
    .get()
  console.log('找到的管理员数量:', adminUsers.data.length)
  console.log('管理员列表:', adminUsers.data.map(a => ({
    user_id: a.user_id,
    wx_openid: a.wx_openid,
    role: a.role
  })))
  const admins = adminUsers.data || []
  if (admins.length === 0) {
    return {
      success: false,
      error: '没有找到管理员'
    }
  }

  let sentCount = 0
  console.log('所有管理员的 user_id:', admins.map(a => a.user_id))
  // 在查找管理员后添加
  console.log('管理员完整信息:', JSON.stringify(adminUsers.data.map(a => ({
    user_id: a.user_id,
    wx_openid: a.wx_openid,
    role: a.role
  }))))
  const testAdmins = admins.filter(a => a.user_id === 'X42214039')
  console.log('筛选后的测试管理员数量:', testAdmins.length)
  // 2. 给每个管理员发送消息提醒
  for (const admin of testAdmins) {
    if (!admin.wx_openid) continue

    try {
      // --- 保留原有的数据库消息记录 ---
      const messageId = `abnormal_alert_${reserveId}_${admin.user_id}`
      await db.collection('messages').doc(messageId).set({
        data: {
          user_id: admin.user_id,
          title: '仪器使用异常提醒',
          content: `用户 ${userName} 在使用 ${finalDeviceName}(${finalDeviceId}) 时报告了异常：${feedbackTitle || '无标题'} - ${feedbackContent || '无详情'}`,
          type: 'admin_notice',
          related_id: reserveId,
          message_key: `abnormal:${reserveId}`,
          is_read: false,
          create_time: new Date().toISOString()
        }
      })

      // --- 新增：发送微信订阅消息（适配你的模板） ---
      const PAGE_URL = 'pages/admin/reserve-list/adminreservelist' // TODO: 替换为你后台查看消息的页面路径
      const now = new Date()
      const formatTime = (d) => {
        const pad = n => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      }

      try {
        await cloud.openapi.subscribeMessage.send({
          touser: admin.wx_openid,
          template_id: 'rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY', // 你的模板ID
          page: PAGE_URL,
          data: {
            // 严格对应模板中的字段
            thing1: {
              value: finalDeviceName  || '未知仪器' // 机器名称
            },
            thing2: {
              value: `${(feedbackTitle || '异常反馈').substring(0, 20)}${feedbackContent ? '...' : ''}` // 故障描述（截断防超长）
            },
            date4: {
              value: formatTime(now) // 故障时间
            },
            character_string25: {
              value: finalDeviceId  || '' // 设备编号
            }
            // 场景说明不需要传，在模板配置里写死即可
          }
        })
      } catch (msgErr) {
        // 注意：如果用户没点过订阅按钮，这里会报错，但不影响数据库消息的写入
        console.warn(`发送订阅消息给 ${admin.user_id} 失败（可能用户未授权）:`, msgErr)
      }

      sentCount++
    } catch (err) {
      console.error(`处理管理员 ${admin.user_id} 失败:`, err)
    }
  }

  return {
    success: true,
    sentCount
  }
}