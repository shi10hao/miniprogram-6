// 云函数 addSubMsgCount：用户点一次订阅，云端记一条下发额度
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const USERS = 'users'

// 一次 requestSubscribeMessage 只换来一条额度，次数固定 +1。
// 不接受客户端传 count：否则任何人都能反复调用把次数刷到天上去。
const INC_COUNT = 1

/**
 * 记一次订阅
 * @param {Object} event { tmplId: string }
 * @returns {Promise<{code:number,msg:string,data?:{count:number}}>}
 */
exports.main = async (event = {}, context) => {
  const { OPENID } = cloud.getWXContext()
  const { tmplId } = event

  if (!OPENID) {
    return { code: -2, msg: '未登录' }
  }

  if (!tmplId) {
    return { code: -1, msg: '缺少模板 id' }
  }

  try {
    const userRes = await db.collection(USERS).where({ _openid: OPENID }).limit(1).get()
    if (!userRes.data.length) {
      return { code: -2, msg: '用户不存在' }
    }

    const user = userRes.data[0]
    const hasSubMsg = user.subMsg && typeof user.subMsg === 'object'

    if (hasSubMsg) {
      // 用点路径 + _.inc 原子自增：并发点两次不会丢计数，
      // 也不会整对象覆盖掉发送端刚做过的扣减
      await db.collection(USERS).doc(user._id).update({
        data: {
          'subMsg.count': _.inc(INC_COUNT),
          'subMsg.lastSubTime': Date.now(),
          'subMsg.tmplId': tmplId
        }
      })
    } else {
      await db.collection(USERS).doc(user._id).update({
        data: {
          subMsg: {
            count: INC_COUNT,
            lastSubTime: Date.now(),
            tmplId
          }
        }
      })
    }

    // 回读最新值：前端拿到的是真实剩余条数，不用自己再猜
    const latest = await db.collection(USERS).doc(user._id).field({ subMsg: true }).get()
    const subMsg = (latest.data && latest.data.subMsg) || {}
    const count = Math.floor(Number(subMsg.count) || 0)
    return { code: 0, msg: 'ok', data: { count: count > 0 ? count : 0 } }
  } catch (err) {
    console.error('[addSubMsgCount] 更新失败', err)
    return { code: -99, msg: '服务器异常' }
  }
}
