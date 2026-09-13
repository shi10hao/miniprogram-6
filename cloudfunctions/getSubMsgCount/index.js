const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const USERS = 'users'

// 7天毫秒数，和微信一次性订阅授权展示/使用习惯对齐，可做清理判断
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) {
    return { success: false, error: 'no openid' }
  }

  let userRes
  try {
    userRes = await db.collection(USERS).where({ _openid: OPENID }).limit(1).get()
  } catch (err) {
    console.error('get user error', err)
    return { success: false, error: err }
  }

  if (!userRes.data.length) {
    return { success: true, count: 0 }
  }

  const user = userRes.data[0]
  const subMsg = user.subMsg || {}

  // 过期清零：lastSubTime 超过7天则视为过期
  if (subMsg.lastSubTime && Date.now() - subMsg.lastSubTime > SEVEN_DAYS) {
    await db.collection(USERS).doc(user._id).update({
      data: {
        subMsg: {
          count: 0,
          lastSubTime: _.remove(),
          tmplId: _.remove()
        }
      }
    })
    return { success: true, count: 0 }
  }

  return {
    success: true,
    count: subMsg.count || 0
  }
}