const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 订阅消息模板ID
const RESERVE_REMIND_TPL_ID = 'rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk'

exports.main = async (event, context) => {
  const now = new Date()
  const nowTs = now.getTime()

  const startTsMin = nowTs + 10 * 60 * 1000
  const startTsMax = nowTs + 35 * 60 * 1000

  try {
    let allReserves = []
    let lastId = null
    const pageSize = 100

    while(true) {
      let query = db.collection('reserves')
      .where({
        status: 'approved',
        usage_status: _.in([null, 'not_started']),
        start_ts: _.gte(startTsMin).and(_.lt(startTsMax)),
        start_reminder_sent: _.neq(true)
      }).limit(pageSize)

      if(lastId) {
        query = query.where({
          _id:db.command.gt(lastId)
        })
      }

      const res = await query.get()
      const records = res.data || []
      if(records.length === 0) break

      allReserves = allReserves.concat(records)
      if (records.length < pageSize) break

      lastId = records[records.length -1]._id
    }
    let sentCount = 0
    for (const r of allReserves) {
      try {
        const openid = r._openid
        if (!openid) {
          console.warn("无openid，跳过")
          continue
        }

        const startTime = (r.start_time || '').split(' ')[1] || r.start_time || ''
        await cloud.openapi.subscribeMessage.send({
          touser: openid,
          templateId: RESERVE_REMIND_TPL_ID,
          page: '/pages/usage/usage',
          data: {
            thing1: {
              value: (r.device_name || '仪器').slice(0, 20)
            },
            thing9: {
              value: '您的预约即将开始，请准时到场'
            },
            time4: {
              value: startTime.slice(0, 5)
            }
          }
        })

        await db.collection('reserves').doc(r._id).update({
          data: {
            start_reminder_sent: true
          }
        })

        sentCount++
        console.log("已发送提醒")
      } catch (e) {
        console.error(`发送预约开始提醒失败 reserveId=${r._id}`, e)
      }
    }

    return {
      ok: true,
      count: sentCount
    }
  } catch (err) {
    console.error('扫描预约失败:', err)
    return {
      ok: false,
      error: err.message
    }
  }
}