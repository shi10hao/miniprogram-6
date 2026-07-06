const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 你的一次性订阅消息模板ID，和前端保持一致
const TEMPLATE_ID = 'rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk'
// 提醒间隔：2小时（单位毫秒）
const REMIND_INTERVAL_MS = 2 * 60 * 60 * 1000
// const REMIND_INTERVAL_MS = 1 * 60 * 1000
//  ---------------------------------------   需要上传触发器!!!!!!    -----------------------------------------------
exports.main = async (event, context) => {
  try {
    const now = new Date()
    const nowTs = now.getTime()
    const nowISO = now.toISOString()
    console.log("OK")
    // 1. 查询所有正在使用中的仪器记录
    const usageRes = await db.collection('device_usage')
      .where({ status: 'using' })
      .get()
    const usingList = usageRes.data
    console.log("usingList:",usingList)
    for (const usage of usingList) {
      const userId = usage.user_id
      const usageId = usage._id
      const openId = usage._openid
      const deviceName = usage.device_name || '仪器'

      // 无openid无法推送订阅消息，跳过
      if (!openId) continue

      // 2. 查询最近一次提醒，判断是否满足2小时间隔
      const lastMsgRes = await db.collection('messages')
        .where({
          user_id: userId,
          type: 'usage_photo_remind',
          related_id: usageId
        })
        .orderBy('create_time', 'desc')
        .limit(1)
        .get()
      const lastMsg = lastMsgRes.data[0]
      let needSend = true

      if (lastMsg) {
        const lastCreateTs = new Date(lastMsg.create_time).getTime()
        if (nowTs - lastCreateTs < REMIND_INTERVAL_MS) {
          needSend = false
        }
      }
      console.log("needSend:",needSend)
      if (needSend) {
        // ① 必执行：写入站内消息（打开小程序顶部横幅可见，永久兜底）
        await db.collection('messages').add({
          data: {
            user_id: userId,
            title: '请上传仪器使用中照片',
            content: `您正在使用${deviceName}，每两小时需上传仪器运行状态照片，请前往上传照片板块提交。`,
            type: 'usage_photo_remind',
            related_id: usageId,
            message_key: `usage_photo_remind:${usageId}:${nowTs}`,
            is_read: false,
            create_time: nowISO
          }
        })

        // ② 尝试推送微信订阅消息（退出小程序也能收到服务通知）
        try {
          await cloud.openapi.subscribeMessage.send({
            touser: openId,
            templateId: TEMPLATE_ID,
            page: 'pages/usage/usage', // 点击通知跳转的页面路径，确认和你实际路径一致
            data: {
              // ⚠️ 字段名必须和你小程序后台申请的模板完全一致，示例仅供参考
              thing1: { value: deviceName },
              thing9: { value: '请及时上传仪器运行照片' },
              time4: { value: nowISO.replace('T', ' ').slice(0, 16) }
            }
          })
          console.log(`订阅消息推送成功 userId:${userId}`)
        } catch (pushErr) {
          // 错误码43101 = 用户拒绝授权/推送额度耗尽，自动降级为纯站内提醒
          const errCode = pushErr.errCode || pushErr.errorCode
          if (errCode === 43101) {
            console.log(`用户订阅额度耗尽 userId:${userId}，已降级为站内提醒`)
          } else {
            console.error(`订阅消息推送失败 userId:${userId}`, pushErr)
          }
        }
      }
    }

    return { success: true, totalUsing: usingList.length }
  } catch (err) {
    console.error('定时提醒任务执行失败', err)
    return { success: false, error: err.message }
  }
}