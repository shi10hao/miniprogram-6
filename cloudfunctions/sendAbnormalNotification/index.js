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

  // 服务端拿到的真实 openid，绝不能信任前端传的身份
  const { OPENID } = cloud.getWXContext()

  if (!reserveId) {
    return { success: false, error: '缺少预约ID' }
  }

  // ===== 安全修复 1：服务端取预约信息，校验调用者确实是该预约的主人 =====
  let reserve
  try {
    const reserveRes = await db.collection('reserves').doc(String(reserveId)).get()
    reserve = reserveRes.data
  } catch (err) {
    console.error('查询预约失败:', err)
    return { success: false, error: '预约不存在' }
  }
  if (!reserve) {
    return { success: false, error: '预约不存在' }
  }

  // 预约上有 _openid 时必须匹配当前调用者；老数据没有 _openid 才降级放行（记录日志）
  if (reserve._openid && reserve._openid !== OPENID) {
    console.warn(`非法调用 sendAbnormalNotification：预约 ${reserveId} 的 owner 与调用者不符`, {
      reserveOwner: reserve._openid,
      caller: OPENID
    })
    return { success: false, error: '无权发送该预约的异常通知' }
  }
  if (!reserve._openid) {
    console.warn(`预约 ${reserveId} 缺少 _openid，无法严格校验调用者，已降级放行`)
  }

  // ===== 安全修复 2：一律以服务端预约数据为准，不信任前端传的仪器名/编号/姓名 =====
  const finalDeviceName = reserve.device_name || paramDeviceName || ''
  const finalDeviceId = reserve.device_id || paramDeviceId || ''
  const finalUserName = reserve.student_name || reserve.user_id || userName || '未知用户'

  // ===== 只通知真正的管理员 =====
  const adminUsers = await db.collection('users')
    .where({ role: _.in(['teacher', 'admin']) })
    .field({ user_id: true, wx_openid: true, role: true })
    .get()
  const admins = (adminUsers.data || []).filter(a => a.user_id)

  if (admins.length === 0) {
    return { success: false, error: '没有找到管理员' }
  }

  let sentCount = 0
  const now = new Date()
  const nowISO = now.toISOString()

  for (const admin of admins) {
    try {
      // 站内消息：只写给管理员本人
      const messageId = `abnormal_alert_${reserveId}_${admin.user_id}`
      await db.collection('messages').doc(messageId).set({
        data: {
          user_id: admin.user_id,
          title: '仪器使用异常提醒',
          content: `用户 ${finalUserName} 在使用 ${finalDeviceName}(${finalDeviceId}) 时报告了异常：${feedbackTitle || '无标题'} - ${feedbackContent || '无详情'}`,
          type: 'admin_notice',
          related_id: String(reserveId),
          message_key: `abnormal:${reserveId}`,
          is_read: false,
          create_time: nowISO
        }
      })

      // 微信订阅消息（管理员没授权时静默失败，不影响站内消息）
      if (admin.wx_openid) {
        try {
          await cloud.openapi.subscribeMessage.send({
            touser: admin.wx_openid,
            template_id: 'rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY',
            page: 'pages/admin/reserve-list/adminreservelist',
            data: {
              thing1: { value: (finalDeviceName || '未知仪器').slice(0, 20) },
              thing2: { value: `${(feedbackTitle || '异常反馈').slice(0, 20)}${feedbackContent ? '...' : ''}` },
              date4: { value: formatTime(now) },
              character_string25: { value: (finalDeviceId || '').slice(0, 32) }
            }
          })
        } catch (msgErr) {
          console.warn(`发送订阅消息给 ${admin.user_id} 失败（可能未授权）:`, msgErr)
        }
      }

      sentCount++
    } catch (err) {
      console.error(`处理管理员 ${admin.user_id} 失败:`, err)
    }
  }

  return { success: true, sentCount }
}

function formatTime(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
