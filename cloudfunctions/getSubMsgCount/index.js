// 云函数 getSubMsgCount：返回当前用户还能收到几条公告推送
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const USERS = 'users'

/**
 * 读取一次性订阅额度
 *
 * 额度只由 addSubMsgCount 增加、sendNoticeSubMsg 消耗，不按时间清零：
 * 微信的一次性订阅没有「7 天过期」这回事，按时间清零会让首页显示 0 条、
 * 而用户其实还有额度可收，管理员发公告时反而漏推。
 * 真的失效（用户关闭通知）会在发送时返回 43101，那时才把 count 归零。
 *
 * @param {Object} event 无参数
 * @returns {Promise<{code:number,msg:string,data?:{count:number}}>}
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) {
    return { code: -2, msg: '未登录' }
  }

  try {
    const userRes = await db.collection(USERS).where({ _openid: OPENID }).limit(1).get()
    if (!userRes.data.length) {
      return { code: 0, msg: 'ok', data: { count: 0 } }
    }

    const subMsg = userRes.data[0].subMsg || {}
    // 并发扣减可能把 count 压成负数，对外一律按 0 报
    const count = Math.floor(Number(subMsg.count) || 0)
    return { code: 0, msg: 'ok', data: { count: count > 0 ? count : 0 } }
  } catch (err) {
    console.error('[getSubMsgCount] 查询失败', err)
    return { code: -99, msg: '服务器异常' }
  }
}
