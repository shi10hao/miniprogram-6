/**
 * 首页「订阅公告通知」的纯逻辑
 *
 * 抽成不依赖 wx.* 的模块，页面只管调接口和 setData，判读规则能单独跑测试
 * （tests/subscribeModel.test.js）。这里集中处理三个坑：
 * 1. requestSubscribeMessage 的 errMsg 恒为 ok，不能拿来判断用户是否点了允许；
 * 2. 未授权有 reject / ban / filter 三种，用户看到的提示应该不一样；
 * 3. 云端返回有新规范 { code, msg, data } 和旧版 { success, count } 两种写法。
 */

// 微信一次性订阅，只有 accept 才真正换来「一条下发额度」
const SUBSCRIBE_STATUS = {
  ACCEPT: 'accept',
  REJECT: 'reject',
  BAN: 'ban',
  FILTER: 'filter'
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
 * 用户这一次是否真的拿到了下发额度
 * 注意：不要用 res.errMsg === 'requestSubscribeMessage:ok' 判断，
 * 用户点「拒绝」时 errMsg 同样是 ok，那样会把拒绝也记成一次订阅。
 * @param {Object} res requestSubscribeMessage 的返回值
 * @param {string} tmplId 模板 id
 * @returns {boolean}
 */
function isSubscribed(res, tmplId) {
  return readSubscribeStatus(res, tmplId) === SUBSCRIBE_STATUS.ACCEPT
}

/**
 * 没拿到额度时的提示文案，按微信返回的状态区分
 * @param {string} status readSubscribeStatus 的结果
 * @returns {string}
 */
function buildSubscribeFailText(status) {
  if (status === SUBSCRIBE_STATUS.BAN) return '该通知已在设置里关闭，请到小程序设置中重新开启'
  if (status === SUBSCRIBE_STATUS.FILTER) return '该通知被系统过滤，请联系管理员'
  if (status === SUBSCRIBE_STATUS.REJECT) return '已取消订阅'
  return '未授权订阅'
}

/**
 * 归一化 getSubMsgCount / addSubMsgCount 的返回
 * @param {Object} result 云函数返回的 result
 * @returns {{ ok: boolean, count: number }}
 */
function readSubMsgResult(result) {
  const payload = result || {}
  const isNewShape = Object.prototype.hasOwnProperty.call(payload, 'code')
  const ok = isNewShape ? payload.code === 0 : payload.success === true
  const source = payload.data && typeof payload.data === 'object' ? payload.data : payload
  const count = Math.floor(Number(source.count) || 0)
  return {
    ok,
    // 扣减可能把 count 压到负数（并发发送），展示层一律按 0 处理
    count: count > 0 ? count : 0
  }
}

module.exports = {
  SUBSCRIBE_STATUS,
  readSubscribeStatus,
  isSubscribed,
  buildSubscribeFailText,
  readSubMsgResult
}
