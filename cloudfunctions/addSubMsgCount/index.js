const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const USERS = 'users'

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tmplId, count = 1 } = event

  if (!OPENID) {
    return { success: false, error: 'no openid' }
  }

  if (!tmplId) {
    return { success: false, error: 'no tmplId' }
  }

  const incCount = Math.max(1, Number(count) || 1)

  const userRes = await db.collection("users").where({ _openid: OPENID }).limit(1).get()
  console.log("userRes",userRes)
  if (!userRes.data.length) {
    return { success: false, error: 'user not found' }
  }

  const user = userRes.data[0]
  const subMsg = user.subMsg || {}

  let currentCount = subMsg.count || 0
  const expired = subMsg.lastSubTime && Date.now() - subMsg.lastSubTime > SEVEN_DAYS

  if (expired) {
    currentCount = 0
  }

  const newCount = currentCount + incCount

  await db.collection("users").doc(user._id).update({
    data: {
      subMsg: {
        count: newCount,
        lastSubTime: Date.now(),
        tmplId
      }
    }
  })

  return {
    success: true,
    count: newCount
  }
}