/**
 * 管理端「订阅提醒」的纯逻辑
 *
 * 抽成不依赖 wx.* 的模块，页面只负责调接口和 setData，判定规则能单独跑测试
 * （tests/adminSubMsgModel.test.js）。这里集中处理四个坑：
 * 1. requestSubscribeMessage 的 errMsg 恒为 ok，只有 res[tmplId] === 'accept' 才算拿到额度；
 * 2. 一次弹窗里两个模板是独立开关，用户可能只允许其中一条，所以记账要按目录逐条加；
 * 3. 一次性订阅的额度在微信侧是黑盒，本地 count 只是估算：字段不存在时视为「未知」，
 *    照发并靠 43101 纠偏，不能当成 0 直接停发；
 * 4. 云函数返回新旧两种结构（{ code, msg, data } / { success, count }）都要能读。
 *
 * 注意：模板 id 与别名的对应关系，云函数 addAdminSubMsgCount / notifyAdminNewApply /
 * sendAbnormalNotification 里各有一份，改动时必须同步。
 *
 * 额度存在独立集合 admin_sub_msg（_id = openid），不写 users：
 * users 集合配了数据模板，模板里没声明的字段写不进去，表现就是「订阅成功但可收 0 条」。
 */

// 管理端订阅的两个模板。别名是 admin_sub_msg 文档里的字段名：
// 模板 id 含 '-'，不适合直接拼进更新点路径，所以一律用别名。
const SUBSCRIBE_TMPL_ALIAS = {
  apply: '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg',
  abnormal: 'rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY'
}

const ALIAS_LIST = ['apply', 'abnormal']

// 订阅面板里用户看到的两条模板，对应哪些业务通知
const ALIAS_TITLE = {
  apply: '新注册申请提醒',
  abnormal: '仪器异常告警'
}

/**
 * 页面上的订阅说明
 *
 * 弹窗里那两行字是微信后台模板标题，改不了，也不该在页面上复述标题
 * （一旦后台标题和这里不一致，用户会以为说的是两回事）。
 * 所以只说「什么情况下会收到」，标题交给微信自己显示。
 */
const SUBSCRIBE_HINT = '点「订阅提醒」会请求两类通知：有人提交注册申请时、仪器使用报异常时。每允许一次可各收 1 条，可重复点击叠加。'

const SUBSCRIBE_TMPL_IDS = ALIAS_LIST.map(alias => SUBSCRIBE_TMPL_ALIAS[alias])

// 微信一次性订阅的四种返回状态，只有 accept 才真正换来一条下发额度
const SUBSCRIBE_STATUS = {
  ACCEPT: 'accept',
  REJECT: 'reject',
  BAN: 'ban',
  FILTER: 'filter'
}

/**
 * 模板 id → 槽位别名
 * @param {string} tmplId 模板 id
 * @returns {string} apply / abnormal，不认识的返回空串
 */
function getAliasByTmplId(tmplId) {
  if (!tmplId) return ''
  for (let i = 0; i < ALIAS_LIST.length; i++) {
    const alias = ALIAS_LIST[i]
    if (SUBSCRIBE_TMPL_ALIAS[alias] === tmplId) return alias
  }
  return ''
}

/**
 * 取某个模板的授权结果
 * @param {Object} res requestSubscribeMessage 的返回值
 * @param {string} tmplId 模板 id
 * @returns {string} accept / reject / ban / filter，取不到返回空串
 */
function readSubscribeStatus(res, tmplId) {
  if (!res || !tmplId) return ''
  const status = res[tmplId]
  return typeof status === 'string' ? status : ''
}

/**
 * 这一次真正拿到额度的模板 id 列表（已按白名单过滤）
 * 不要用 res.errMsg 判断：用户点「拒绝」时 errMsg 同样是 ok。
 * @param {Object} res requestSubscribeMessage 的返回值
 * @returns {Array<string>}
 */
function readAcceptedTmplIds(res) {
  return SUBSCRIBE_TMPL_IDS.filter(id => readSubscribeStatus(res, id) === SUBSCRIBE_STATUS.ACCEPT)
}

/**
 * 所有非空状态，用于区分「被关掉」和「只是拒绝」
 * @param {Object} res requestSubscribeMessage 的返回值
 * @returns {Array<string>}
 */
function readAllStatuses(res) {
  const statuses = []
  SUBSCRIBE_TMPL_IDS.forEach((id) => {
    const status = readSubscribeStatus(res, id)
    if (status) statuses.push(status)
  })
  return statuses
}

/**
 * 没拿到额度时的提示文案
 * @param {string} status readSubscribeStatus 的结果
 * @returns {string}
 */
function buildSubscribeFailText(status) {
  if (status === SUBSCRIBE_STATUS.BAN) return '通知已在设置里关闭，请到设置中重新开启'
  if (status === SUBSCRIBE_STATUS.FILTER) return '通知被系统过滤，请联系管理员'
  if (status === SUBSCRIBE_STATUS.REJECT) return '已取消订阅'
  return '未授权订阅'
}

/**
 * 计数归一化：并发扣减可能压成负数，脏值一律按 0
 * @param {*} value 原始值
 * @returns {number}
 */
function normalizeCount(value) {
  const num = Math.floor(Number(value) || 0)
  return num > 0 ? num : 0
}

/**
 * 单个槽位取值
 *
 * 云端有两种形态：文档里的 { count: 3, ... } 和接口里的 3（扁平条数）。
 * 两种都要认，否则「数据库里有 3 条、页面显示 0 条」。
 * @param {*} value 槽位对象 / 直接的数字
 * @returns {number}
 */
function readSlotCount(value) {
  if (typeof value === 'number') return normalizeCount(value)
  if (value && typeof value === 'object') return normalizeCount(value.count)
  return 0
}

/**
 * 额度 → { apply, abnormal }
 * @param {Object} quota admin_sub_msg 文档，或云函数返回的扁平条数 { apply: 3, abnormal: 0 }
 * @returns {{ apply: number, abnormal: number }}
 */
function readCounts(quota) {
  const src = quota && typeof quota === 'object' ? quota : {}
  const counts = {}
  ALIAS_LIST.forEach((alias) => {
    counts[alias] = readSlotCount(src[alias])
  })
  return counts
}

/**
 * 该槽位有没有记账记录（老数据 / 没订阅过 → 没有记录）
 * @param {Object} quota admin_sub_msg 文档
 * @param {string} alias apply / abnormal
 * @returns {boolean}
 */
function hasQuotaRecord(quota, alias) {
  if (!quota || typeof quota !== 'object') return false
  const slot = quota[alias]
  if (typeof slot === 'number') return true
  return !!slot && typeof slot === 'object'
}

/**
 * 这次还要不要发：没有记录视为「未知额度」，照发；明确记过且为 0 才跳过
 * @param {Object} quota admin_sub_msg 文档
 * @param {string} alias apply / abnormal
 * @returns {boolean}
 */
function shouldSendQuota(quota, alias) {
  if (!hasQuotaRecord(quota, alias)) return true
  return readSlotCount(quota[alias]) > 0
}

/**
 * 归一化 addAdminSubMsgCount / getAdminSubMsgCount 的返回
 * @param {Object} result 云函数返回的 result
 * @returns {{ ok: boolean, code: number, counts: { apply: number, abnormal: number } }}
 */
function readAdminSubMsgResult(result) {
  const payload = result || {}
  const isNewShape = Object.prototype.hasOwnProperty.call(payload, 'code')
  const ok = isNewShape ? payload.code === 0 : payload.success === true
  let code = -1
  if (typeof payload.code === 'number') code = payload.code
  else if (payload.success === true) code = 0
  const source = payload.data && typeof payload.data === 'object' ? payload.data : payload
  return { ok, code, counts: readCounts(source) }
}

/**
 * 两个模板的额度合计
 * @param {Object} counts { apply, abnormal }
 * @returns {number}
 */
function totalCount(counts) {
  const src = counts || {}
  return readSlotCount(src.apply) + readSlotCount(src.abnormal)
}

/**
 * 顶部按钮上的小字
 * @param {Object} counts { apply, abnormal }
 * @returns {string}
 */
function buildSubMsgText(counts) {
  const total = totalCount(counts)
  return total > 0 ? '可收 ' + total + ' 条' : '未订阅'
}

/**
 * 云端记账失败的提示文案（toast 用，必须短）
 *
 * code -3 是「云开发里还没建 admin_sub_msg 集合」，这种情况页面会改用弹窗说明，
 * 这里只留一句兜底文案。
 * @param {Object} result readAdminSubMsgResult 的返回
 * @returns {string}
 */
function buildSyncFailText(result) {
  if (result && result.code === -3) return '订阅成功，次数没记上'
  return '订阅成功，次数稍后同步'
}

module.exports = {
  SUBSCRIBE_TMPL_ALIAS,
  SUBSCRIBE_TMPL_IDS,
  ALIAS_LIST,
  ALIAS_TITLE,
  SUBSCRIBE_STATUS,
  SUBSCRIBE_HINT,
  getAliasByTmplId,
  readSubscribeStatus,
  readAcceptedTmplIds,
  readAllStatuses,
  buildSubscribeFailText,
  normalizeCount,
  readSlotCount,
  readCounts,
  hasQuotaRecord,
  shouldSendQuota,
  readAdminSubMsgResult,
  totalCount,
  buildSubMsgText,
  buildSyncFailText
}
