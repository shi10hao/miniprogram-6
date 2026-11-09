// 云函数 getAdminSubMsgCount：读管理员自己的订阅额度
//
// 额度在独立集合 admin_sub_msg（_id = openid），不读 users —— users 有数据模板，
// 写不进去（详见 addAdminSubMsgCount 的说明）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLL = 'admin_sub_msg'

function normalizeCount(value) {
  const num = Math.floor(Number(value) || 0)
  return num > 0 ? num : 0
}

/** 集合还没建时当成「没有记录」处理，页面照常显示未订阅，不当成错误 */
function isMissingCollection(err) {
  if (!err) return false
  if (err.errCode === -502005) return true
  const msg = String(err.errMsg || err.message || '')
  return /collection.*not\s*exist/i.test(msg)
}

/**
 * 额度文档 → { apply, abnormal }
 * @param {Object} quota 文档
 * @returns {{ apply: number, abnormal: number }}
 */
function readCounts(quota) {
  const src = quota && typeof quota === 'object' ? quota : {}
  return {
    apply: src.apply && typeof src.apply === 'object' ? normalizeCount(src.apply.count) : 0,
    abnormal: src.abnormal && typeof src.abnormal === 'object' ? normalizeCount(src.abnormal.count) : 0
  }
}

/**
 * 读当前用户的额度
 * @returns {Promise<{code:number,msg:string,data:{apply:number,abnormal:number}}>}
 */
exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return { code: -2, msg: '未登录', data: { apply: 0, abnormal: 0 } }
  }

  try {
    const res = await db.collection(COLL).where({ _id: OPENID }).limit(1).get()
    const list = res.data || []
    return { code: 0, msg: 'ok', data: readCounts(list[0]) }
  } catch (err) {
    if (isMissingCollection(err)) {
      // 集合还没建：没有任何记录，等价于还没订阅过
      return { code: 0, msg: 'ok', data: { apply: 0, abnormal: 0 } }
    }
    console.error('[getAdminSubMsgCount] 查询失败', err)
    return { code: -99, msg: '服务器异常', data: { apply: 0, abnormal: 0 } }
  }
}
