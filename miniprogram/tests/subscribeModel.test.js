const assert = require('assert')

/**
 * 首页订阅逻辑校验（pages/index/subscribeModel.js）。
 *
 * 重点回归项：
 *   1. requestSubscribeMessage 的 errMsg 恒为 ok，用户点「拒绝」也是 ok，
 *      旧代码把 errMsg 当授权成功判断，导致拒绝也被记成一次订阅
 *   2. 未授权有 reject / ban / filter 三种，提示文案不能一律「未授权订阅」
 *   3. 云端返回新旧两种结构都要能读，云函数没重新上传时首页不能白屏
 *   4. 扣减并发把 count 压成负数时，展示层按 0 处理
 */

const {
  SUBSCRIBE_STATUS,
  readSubscribeStatus,
  isSubscribed,
  buildSubscribeFailText,
  readSubMsgResult
} = require('../pages/index/subscribeModel')

const TMPL = 'tmpl-notice'

function testReadStatus() {
  assert.strictEqual(readSubscribeStatus({ [TMPL]: 'accept' }, TMPL), 'accept')
  assert.strictEqual(readSubscribeStatus({ [TMPL]: 'reject' }, TMPL), 'reject')
  assert.strictEqual(readSubscribeStatus({}, TMPL), '', '没有该模板时返回空串')
  assert.strictEqual(readSubscribeStatus(null, TMPL), '')
  assert.strictEqual(readSubscribeStatus({ [TMPL]: 'accept' }, ''), '')
}

function testIsSubscribed() {
  // 关键回归：errMsg 是 ok 但模板结果是 reject，不能算订阅成功
  const rejected = {
    errMsg: 'requestSubscribeMessage:ok',
    [TMPL]: 'reject'
  }
  assert.strictEqual(isSubscribed(rejected, TMPL), false, 'errMsg=ok 不代表用户点了允许')
  assert.strictEqual(isSubscribed({ errMsg: 'requestSubscribeMessage:ok', [TMPL]: 'accept' }, TMPL), true)
  assert.strictEqual(isSubscribed({ [TMPL]: 'ban' }, TMPL), false)
  assert.strictEqual(isSubscribed({}, TMPL), false)
}

function testFailText() {
  assert.strictEqual(
    buildSubscribeFailText(SUBSCRIBE_STATUS.BAN),
    '该通知已在设置里关闭，请到小程序设置中重新开启'
  )
  assert.strictEqual(buildSubscribeFailText(SUBSCRIBE_STATUS.FILTER), '该通知被系统过滤，请联系管理员')
  assert.strictEqual(buildSubscribeFailText(SUBSCRIBE_STATUS.REJECT), '已取消订阅')
  assert.strictEqual(buildSubscribeFailText(''), '未授权订阅')
  assert.strictEqual(buildSubscribeFailText(undefined), '未授权订阅')
}

function testReadResult() {
  // 新规范 { code, msg, data }
  assert.deepStrictEqual(readSubMsgResult({ code: 0, msg: 'ok', data: { count: 3 } }), { ok: true, count: 3 })
  assert.deepStrictEqual(
    readSubMsgResult({ code: -99, msg: '服务器异常' }),
    { ok: false, count: 0 },
    '失败时不能把 count 当有效值'
  )

  // 旧版 { success, count }，云函数还没重新上传时要能继续读
  assert.deepStrictEqual(readSubMsgResult({ success: true, count: 2 }), { ok: true, count: 2 })
  assert.deepStrictEqual(readSubMsgResult({ success: false }), { ok: false, count: 0 })

  // 负数 / 脏值一律按 0
  assert.deepStrictEqual(readSubMsgResult({ code: 0, data: { count: -1 } }), { ok: true, count: 0 })
  assert.deepStrictEqual(readSubMsgResult({ code: 0, data: { count: 'abc' } }), { ok: true, count: 0 })
  assert.deepStrictEqual(readSubMsgResult(undefined), { ok: false, count: 0 }, '无返回不报错')
}

testReadStatus()
testIsSubscribed()
testFailText()
testReadResult()
console.log('subscribeModel tests passed')
