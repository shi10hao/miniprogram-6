// 云函数 addAdminSubMsgCount：管理端点一次订阅，按模板逐条记一条下发额度
//
// 额度记在独立集合 admin_sub_msg，不写 users：
// users 集合配了数据模板，模板里没声明的字段会被拒或被裁掉，
// 之前写 users.subMsgAdmin 就是「订阅成功但可收 0 条」的根因。
// 文档结构：_id = openid，{ apply: {count,lastSubTime,lastSendTime,lastErrCode}, abnormal: {...} }
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const COLL = 'admin_sub_msg'

// 必须和 miniprogram/pages/admin/adminSubMsgModel.js 的 SUBSCRIBE_TMPL_ALIAS 一致
const TMPL_ALIAS = {
  '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg': 'apply',
  rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY: 'abnormal'
}

// 一次 accept 只换来一条额度，次数固定 +1，不接受客户端传 count
const INC_COUNT = 1

function normalizeCount(value) {
  const num = Math.floor(Number(value) || 0)
  return num > 0 ? num : 0
}

/** 新建一个空槽位（刚记上一条） */
function buildSlot(now) {
  return { count: INC_COUNT, lastSubTime: now, lastSendTime: 0, lastErrCode: 0 }
}

/** 集合还没建时云开发的错误码/文案都要认 */
function isMissingCollection(err) {
  if (!err) return false
  if (err.errCode === -502005) return true
  const msg = String(err.errMsg || err.message || '')
  return /collection.*not\s*exist/i.test(msg)
}

/**
 * 读某个 openid 的额度文档
 * @param {string} openid 用户 openid
 * @returns {Promise<Object|null>} 文档（已去掉 _id），没有则 null
 */
async function readQuota(openid) {
  const res = await db.collection(COLL).where({ _id: openid }).limit(1).get()
  const list = res.data || []
  if (!list.length) return null
  const doc = Object.assign({}, list[0])
  delete doc._id
  return doc
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
 * 给一个槽位 +1
 *
 * 槽位已存在时用点路径 + _.inc 原子自增，不会覆盖发送端刚做的扣减；
 * 槽位不存在时整文档 set（先读出另一格再合并），不依赖「点路径能否建出父字段」。
 * @param {string} openid 用户 openid
 * @param {string} alias apply / abnormal
 * @param {Object|null} current 当前文档
 * @returns {Promise<Object>} 写入后的文档
 */
async function addOne(openid, alias, current) {
  const now = Date.now()
  const slot = current && typeof current[alias] === 'object' ? current[alias] : null

  if (slot) {
    const data = {}
    data[`${alias}.count`] = _.inc(INC_COUNT)
    data[`${alias}.lastSubTime`] = now
    await db.collection(COLL).doc(openid).update({ data })
    return Object.assign({}, current, {
      [alias]: Object.assign({}, slot, {
        count: normalizeCount(slot.count) + INC_COUNT,
        lastSubTime: now
      })
    })
  }

  // 初次记账：整文档写，另一格原样带过去
  const merged = Object.assign({}, current || {})
  merged[alias] = buildSlot(now)
  await db.collection(COLL).doc(openid).set({ data: merged })
  return merged
}

/**
 * 把本次 accept 的模板逐个记账
 * @param {string} openid 用户 openid
 * @param {Array<string>} aliases apply / abnormal
 * @returns {Promise<{apply:number,abnormal:number}>}
 */
async function recordAll(openid, aliases) {
  let current = await readQuota(openid)
  for (let i = 0; i < aliases.length; i++) {
    current = await addOne(openid, aliases[i], current)
  }
  // 回读最新值：前端拿到的就是真实剩余条数，不用自己再猜
  const latest = await readQuota(openid)
  return readCounts(latest)
}

/**
 * 记一次订阅
 * @param {Object} event { tmplIds: Array<string> } 本次 accept 的模板 id
 * @returns {Promise<{code:number,msg:string,data?:{apply:number,abnormal:number}}>}
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const { tmplIds } = event

  if (!OPENID) {
    return { code: -2, msg: '未登录' }
  }

  const ids = Array.isArray(tmplIds) ? tmplIds : []
  // 白名单过滤 + 去重：只认管理端两个模板，别的 id 一律丢掉，
  // 免得把学生公告模板的 accept 记到管理端账上
  const aliases = []
  ids.forEach((id) => {
    const alias = TMPL_ALIAS[id]
    if (alias && aliases.indexOf(alias) === -1) aliases.push(alias)
  })
  if (!aliases.length) {
    return { code: -1, msg: '没有可记账的模板' }
  }

  try {
    const counts = await recordAll(OPENID, aliases)
    return { code: 0, msg: 'ok', data: counts }
  } catch (err) {
    // 集合还没建：这里自动建一次再重试，省得让管理员去控制台手点
    if (!isMissingCollection(err)) {
      console.error('[addAdminSubMsgCount] 更新失败', err)
      return { code: -99, msg: '服务器异常' }
    }
    console.warn('[addAdminSubMsgCount] admin_sub_msg 集合不存在，尝试自动创建')
    try {
      await db.createCollection(COLL)
    } catch (createErr) {
      // 已存在等情况都会报错，忽略，交给下面的重试判断
      console.warn('[addAdminSubMsgCount] 建集合返回', createErr && createErr.errCode)
    }
    try {
      const counts = await recordAll(OPENID, aliases)
      return { code: 0, msg: 'ok', data: counts }
    } catch (retryErr) {
      console.error('[addAdminSubMsgCount] 建集合后仍然写不进去', retryErr)
      return { code: -3, msg: '云开发里还没有 admin_sub_msg 集合' }
    }
  }
}
