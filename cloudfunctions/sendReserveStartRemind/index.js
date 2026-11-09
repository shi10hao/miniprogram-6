const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 订阅消息模板ID
const RESERVE_REMIND_TPL_ID = 'rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk'

// 提醒窗口：从现在算起 35 分钟内要开始的预约
// 定时器每 5 分钟跑一次，所以一条 T 点开始的预约会在 (T-35min, T] 区间的第一个 tick 被提醒，
// 实际提前量落在 30~35 分钟，和「预约开始前 30 分钟提醒」的文案一致。
const REMIND_AHEAD_MS = 35 * 60 * 1000
// 下界留 5 分钟宽限：让「开始前 10 分钟内才创建 / 才被批准」的预约也能收到提醒。
// 原实现下界是 now+10min，这段是永久盲区 —— 临时约的场次一条提醒都收不到。
const REMIND_GRACE_MS = 5 * 60 * 1000

exports.main = async (event, context) => {
  const now = new Date()
  const nowTs = now.getTime()

  const startTsMin = nowTs - REMIND_GRACE_MS
  const startTsMax = nowTs + REMIND_AHEAD_MS

  // usage_status 表示预约有没有被使用过：not_started / '' / 字段缺失 三种都算「还没开始」。
  // 原来的 _.in([null, 'not_started']) 匹配不到「字段根本不存在」的老记录，会漏提醒。
  const notStartedCondition = _.or([
    { usage_status: 'not_started' },
    { usage_status: _.eq('') },
    { usage_status: null },
    { usage_status: _.exists(false) }
  ])

  try {
    let allReserves = []
    let lastId = null
    const pageSize = 100

    while (true) {
      const conditions = [
        {
          status: 'approved',
          start_ts: _.gte(startTsMin).and(_.lt(startTsMax)),
          start_reminder_sent: _.neq(true)
        },
        notStartedCondition
      ]
      // _id 游标分页：条件一起塞进 and，避免二次 where 的合并语义踩坑
      if (lastId) conditions.push({ _id: _.gt(lastId) })

      const res = await db.collection('reserves')
        .where(_.and(conditions))
        .limit(pageSize)
        .get()
      const records = res.data || []
      if (records.length === 0) break

      allReserves = allReserves.concat(records)
      if (records.length < pageSize) break

      lastId = records[records.length - 1]._id
    }
    let sentCount = 0
    for (const r of allReserves) {
      try {
        const openid = r._openid
        if (!openid) {
          console.warn('无openid，跳过')
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
        console.log('已发送提醒')
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
