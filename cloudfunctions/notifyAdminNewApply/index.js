const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
// 订阅额度单独一集合（_id = openid）。users 有数据模板，写不进未声明的字段
const QUOTA_COLL = 'admin_sub_msg'

// 通用模板 ID（新注册申请提醒），必须和 miniprogram/pages/admin/adminSubMsgModel.js
// 的 SUBSCRIBE_TMPL_ALIAS.apply 一致
const NOTICE_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'
// 本函数只消耗 apply 这一个槽位
const QUOTA_SLOT = 'apply'
// 用户拒绝接收 / 该模板额度已耗尽
const ERR_NO_QUOTA = 43101

// thing 类型微信限制 20 个字符
function cutStr(str, len = 20) {
  if (!str) return ''
  str = String(str).replace(/\s+/g, ' ').trim()
  if (str.length <= len) return str
  return str.slice(0, len - 1) + '…'
}

// time3 可读时间格式
function formatTime(input) {
  if (!input) return ''
  let d
  if (input instanceof Date) d = input
  else d = new Date(String(input).replace(/-/g, '/'))
  if (isNaN(d.getTime())) return String(input)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}年${m}月${day}日 ${h}:${min}`
}

function normalizeCount(value) {
  const num = Math.floor(Number(value) || 0)
  return num > 0 ? num : 0
}

/**
 * 取本函数负责的额度槽位
 * @param {Object} quota admin_sub_msg 文档
 * @returns {Object|null}
 */
function readSlot(quota) {
  if (!quota || typeof quota !== 'object') return null
  const slot = quota[QUOTA_SLOT]
  return slot && typeof slot === 'object' ? slot : null
}

/**
 * 这次还要不要发
 *
 * 没有额度记录（没订阅过 / 集合还没建）不能当成 0 —— 否则上线瞬间所有管理员就静默收不到新申请，
 * 所以要按「额度未知」放行，发完由微信返回 43101 再把额度归零。
 * @param {Object} quota admin_sub_msg 文档
 * @returns {boolean}
 */
function shouldTrySend(quota) {
  const slot = readSlot(quota)
  if (!slot) return true
  return normalizeCount(slot.count) > 0
}

/**
 * 批量取额度：openid → 文档
 * @param {Array<string>} openids 管理员 openid
 * @returns {Promise<Object>} openid → admin_sub_msg 文档
 */
async function loadQuotaMap(openids) {
  const map = {}
  if (!openids.length) return map
  try {
    // _id 采用 in 查询，管理员量级远小于 100
    const res = await db.collection(QUOTA_COLL)
      .where({ _id: _.in(openids.slice(0, 100)) })
      .limit(100)
      .get()
    const list = res.data || []
    list.forEach((doc) => {
      const copy = Object.assign({}, doc)
      const key = copy._id
      delete copy._id
      map[key] = copy
    })
  } catch (err) {
    // 集合还没建：当成全部「额度未知」，照发，不阻断通知
    console.warn('[notifyAdminNewApply] 读取额度失败，按未知额度处理', err && err.errCode)
  }
  return map
}

/** 槽位记录的统一形状 */
function buildSlotRecord(patch) {
  return Object.assign({ count: 0, lastSubTime: 0, lastSendTime: 0, lastErrCode: 0 }, patch)
}

/**
 * 合并出要整文档写回的额度（另一格原样保留）
 * @param {Object} quota 当前文档
 * @param {Object} patch 要合并进本槽位的字段
 * @returns {Object}
 */
function buildQuotaDoc(quota, patch) {
  const doc = {}
  if (quota && typeof quota === 'object') {
    Object.keys(quota).forEach((key) => {
      if (key !== '_id' && key !== '_openid') doc[key] = quota[key]
    })
  }
  const slot = doc[QUOTA_SLOT] && typeof doc[QUOTA_SLOT] === 'object' ? doc[QUOTA_SLOT] : {}
  doc[QUOTA_SLOT] = Object.assign(buildSlotRecord(), slot, patch)
  return doc
}

/**
 * 发送成功才扣一条
 * @param {string} openid 管理员 openid
 * @param {Object} quota 发送前读到的额度文档
 * @returns {Promise<void>}
 */
async function consumeQuota(openid, quota) {
  const now = Date.now()
  const slot = readSlot(quota)
  if (slot) {
    try {
      const data = {}
      data[`${QUOTA_SLOT}.count`] = _.inc(-1)
      data[`${QUOTA_SLOT}.lastSendTime`] = now
      await db.collection(QUOTA_COLL).doc(openid).update({ data })
      return
    } catch (err) {
      // 落到下面走整文档写，至少把 lastSendTime 记下来
      console.warn('[notifyAdminNewApply] 扣减失败，改整文档写', openid, err && err.errCode)
    }
  }
  try {
    // 没有记录：补一条已用尽的，下次就不会再盲发
    await db.collection(QUOTA_COLL).doc(openid).set({
      data: buildQuotaDoc(quota, { count: 0, lastSendTime: now })
    })
  } catch (err) {
    // 扣减失败不影响本次推送，下次发送会靠 43101 自愈
    console.error('[notifyAdminNewApply] 扣减订阅次数失败', openid, err)
  }
}

/**
 * 额度已失效，归零并留下错误码，方便查「为什么这个管理员收不到」
 * @param {string} openid 管理员 openid
 * @param {Object} quota 发送前读到的额度文档
 * @param {number} errCode 微信错误码
 * @returns {Promise<void>}
 */
async function clearQuota(openid, quota, errCode) {
  try {
    await db.collection(QUOTA_COLL).doc(openid).set({
      data: buildQuotaDoc(quota, { count: 0, lastErrCode: errCode })
    })
  } catch (err) {
    console.error('[notifyAdminNewApply] 清零订阅次数失败', openid, err)
  }
}

exports.main = async (event = {}) => {
  const { applyId } = event
  if (!applyId) {
    return { code: 1, msg: '参数缺失' }
  }

  // 1. 读取申请记录
  let apply
  try {
    const res = await db.collection('user_apply').doc(applyId).get()
    apply = res.data
  } catch (err) {
    console.error('读取申请记录失败', err)
    return { code: 1, msg: '申请记录不存在' }
  }

  // 2. 组装模板数据
  const data = {
    thing30: { value: '资环实仪新注册申请' },
    time3: { value: formatTime(apply.create_time || new Date()) },
    thing2: { value: cutStr(`${apply.name} ${apply.user_id}`, 20) }
  }

  // 3. 查询所有管理员（只取有真实 openid 的）
  let admins = []
  try {
    const adminRes = await db.collection('users')
      .where({ role: 'admin' })
      .field({ wx_openid: true, _id: true })
      .limit(1000)
      .get()
    admins = (adminRes.data || []).filter(u => u.wx_openid)
  } catch (err) {
    console.error('查询管理员失败', err)
    return { code: 500, msg: '查询管理员失败' }
  }

  if (admins.length === 0) {
    return { code: 0, msg: '无管理员可通知', total: 0, sent: 0, skipped: 0 }
  }

  // 4. 额度在独立集合里，按 openid 一次取回；额度明确为 0 的直接跳过
  const quotaMap = await loadQuotaMap(admins.map(u => u.wx_openid))
  const targets = admins.filter((u) => {
    if (shouldTrySend(quotaMap[u.wx_openid])) return true
    console.log('[notifyAdminNewApply] 无订阅额度，跳过', u._id)
    return false
  })
  const skipped = admins.length - targets.length

  if (targets.length === 0) {
    return { code: 0, msg: '管理员均无订阅额度', total: admins.length, sent: 0, skipped }
  }

  // 5. 逐个发送（单发失败不中断），成功后扣一条
  const results = await Promise.all(targets.map(async (u) => {
    const openid = u.wx_openid
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: NOTICE_TMPL_ID,
        page: 'pages/admin/apply-review/applyreview',
        data,
        miniprogramState: 'formal',
        lang: 'zh_CN'
      })
      await consumeQuota(openid, quotaMap[openid])
      return { openid, ok: true }
    } catch (err) {
      const errCode = err && err.errCode
      if (errCode === ERR_NO_QUOTA) {
        await clearQuota(openid, quotaMap[openid], errCode)
      }
      console.error('发送失败', openid, errCode, err && err.errMsg)
      return { openid, ok: false, errCode }
    }
  }))

  const sent = results.filter(r => r.ok).length
  return {
    code: 0,
    msg: 'ok',
    total: admins.length,
    sent,
    failed: results.length - sent,
    skipped
  }
}
