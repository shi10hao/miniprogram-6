const assert = require('assert')

/**
 * 管理端订阅逻辑校验（pages/admin/adminSubMsgModel.js）。
 *
 * 重点回归项：
 *   1. requestSubscribeMessage 的 errMsg 恒为 ok，只有 res[tmplId] === 'accept' 才算拿到额度；
 *   2. 两个模板独立授权，只允许其中一个时只能记一条；
 *   3. 没有额度记录时按「额度未知」放行，不能当成 0 直接停发；
 *   4. 并发扣减压成负数、脏值，展示层一律按 0；
 *   5. 云端返回新旧两种结构都要能读，云函数没重新上传时页面不能白屏；
 *   6. 缺 admin_sub_msg 集合（code -3）要能给出「去建集合」的提示，而不是「稍后同步」。
 */

const {
  SUBSCRIBE_TMPL_IDS,
  ALIAS_LIST,
  SUBSCRIBE_STATUS,
  SUBSCRIBE_HINT,
  getAliasByTmplId,
  readSubscribeStatus,
  readAcceptedTmplIds,
  readAllStatuses,
  buildSubscribeFailText,
  readSlotCount,
  readCounts,
  hasQuotaRecord,
  shouldSendQuota,
  readAdminSubMsgResult,
  totalCount,
  buildSubMsgText,
  buildSyncFailText
} = require('../pages/admin/adminSubMsgModel')

const APPLY = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'
const ABNORMAL = 'rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY'

function testTmplMapping() {
  assert.strictEqual(SUBSCRIBE_TMPL_IDS.length, 2, '管理端只订阅两个模板')
  assert.deepStrictEqual(ALIAS_LIST, ['apply', 'abnormal'])
  assert.strictEqual(getAliasByTmplId(APPLY), 'apply')
  assert.strictEqual(getAliasByTmplId(ABNORMAL), 'abnormal')
  assert.strictEqual(getAliasByTmplId('other'), '', '不认识的模板不记账')
  assert.strictEqual(getAliasByTmplId(''), '')
}

function testAccepted() {
  const both = { errMsg: 'requestSubscribeMessage:ok', [APPLY]: 'accept', [ABNORMAL]: 'accept' }
  assert.deepStrictEqual(readAcceptedTmplIds(both), [APPLY, ABNORMAL])

  // 只允许申请提醒：不能顺手把异常告警也记一条
  const one = { [APPLY]: 'accept', [ABNORMAL]: 'reject' }
  assert.deepStrictEqual(readAcceptedTmplIds(one), [APPLY])

  // 关键回归：errMsg 是 ok 但两个都拒绝，一次都不能记
  const rejected = { errMsg: 'requestSubscribeMessage:ok', [APPLY]: 'reject', [ABNORMAL]: 'reject' }
  assert.deepStrictEqual(readAcceptedTmplIds(rejected), [])

  assert.deepStrictEqual(readAcceptedTmplIds(null), [])
  assert.deepStrictEqual(readAcceptedTmplIds({}), [])

  // 状态里杂夹着微信自己的 errMsg 字段，不能当成模板结果
  assert.strictEqual(readSubscribeStatus({ errMsg: 'requestSubscribeMessage:ok' }, 'errMsg'), 'requestSubscribeMessage:ok')
  assert.deepStrictEqual(readAllStatuses({ errMsg: 'ok', [APPLY]: 'ban' }), ['ban'])
}

function testFailText() {
  assert.strictEqual(buildSubscribeFailText(SUBSCRIBE_STATUS.BAN), '通知已在设置里关闭，请到设置中重新开启')
  assert.strictEqual(buildSubscribeFailText(SUBSCRIBE_STATUS.FILTER), '通知被系统过滤，请联系管理员')
  assert.strictEqual(buildSubscribeFailText(SUBSCRIBE_STATUS.REJECT), '已取消订阅')
  assert.strictEqual(buildSubscribeFailText(''), '未授权订阅')
  assert.strictEqual(buildSubscribeFailText(undefined), '未授权订阅')
}

function testQuota() {
  // 没记录（没订阅过 / 集合还没建）→ 额度未知 → 照发
  assert.strictEqual(hasQuotaRecord(undefined, 'apply'), false)
  assert.strictEqual(shouldSendQuota(undefined, 'apply'), true, '没有记录不能当成 0 停发')
  assert.strictEqual(shouldSendQuota({}, 'apply'), true)
  assert.strictEqual(shouldSendQuota({ apply: null }, 'apply'), true)

  // 记过账：正数才发
  assert.strictEqual(shouldSendQuota({ apply: { count: 1 } }, 'apply'), true)
  assert.strictEqual(shouldSendQuota({ apply: { count: 0 } }, 'apply'), false)
  assert.strictEqual(shouldSendQuota({ apply: { count: -3 } }, 'apply'), false, '负数按用尽处理')
  assert.strictEqual(shouldSendQuota({ apply: { count: '2' } }, 'apply'), true, '字符串数字也要认')

  // 两个槽位互不影响：异常告警为 0 不影响申请提醒
  const mixed = { apply: { count: 2 }, abnormal: { count: 0 } }
  assert.strictEqual(shouldSendQuota(mixed, 'apply'), true)
  assert.strictEqual(shouldSendQuota(mixed, 'abnormal'), false)
}

function testCounts() {
  assert.deepStrictEqual(readCounts(undefined), { apply: 0, abnormal: 0 })
  assert.deepStrictEqual(readCounts({ apply: { count: 3 }, abnormal: { count: 1 } }), { apply: 3, abnormal: 1 })
  assert.deepStrictEqual(readCounts({ apply: { count: -2 } }), { apply: 0, abnormal: 0 }, '负数压 0')
  assert.deepStrictEqual(readCounts({ apply: { count: 'abc' } }), { apply: 0, abnormal: 0 })

  // 云端 readCounts 返回的是扁平条数，前端也必须认得（否则「库里有 3 条、页面显示 0 条」）
  assert.deepStrictEqual(readCounts({ apply: 3, abnormal: 0 }), { apply: 3, abnormal: 0 })
  assert.deepStrictEqual(readCounts({ apply: 0 }), { apply: 0, abnormal: 0 })
  assert.strictEqual(readSlotCount(1), 1)
  assert.strictEqual(readSlotCount({ count: 2 }), 2)
  assert.strictEqual(readSlotCount(undefined), 0)

  assert.strictEqual(totalCount({ apply: 2, abnormal: 1 }), 3)
  assert.strictEqual(totalCount({ apply: { count: 2 }, abnormal: { count: 1 } }), 3, '嵌套文档也要能合计')
  assert.strictEqual(totalCount(undefined), 0)
  assert.strictEqual(buildSubMsgText({ apply: 0, abnormal: 0 }), '未订阅')
  assert.strictEqual(buildSubMsgText({ apply: 1, abnormal: 2 }), '可收 3 条')
  assert.strictEqual(buildSubMsgText({ apply: { count: 1 }, abnormal: { count: 2 } }), '可收 3 条')

  // 说明文案不复述后台模板标题（标题改不了，写死会和弹窗对不上）
  assert.ok(SUBSCRIBE_HINT.indexOf('新注册申请提醒') === -1, '说明里不该出现后台模板标题')
  assert.ok(SUBSCRIBE_HINT.indexOf('注册申请') !== -1)
  assert.ok(SUBSCRIBE_HINT.indexOf('异常') !== -1)
}

function testSyncFailText() {
  assert.strictEqual(buildSyncFailText({ code: -3, ok: false }), '订阅成功，次数没记上')
  assert.strictEqual(buildSyncFailText({ code: -99, ok: false }), '订阅成功，次数稍后同步')
  assert.strictEqual(buildSyncFailText(null), '订阅成功，次数稍后同步')
}

function testReadResult() {
  // 新规范 { code, msg, data }
  assert.deepStrictEqual(
    readAdminSubMsgResult({ code: 0, msg: 'ok', data: { apply: 2, abnormal: 1 } }),
    { ok: true, code: 0, counts: { apply: 2, abnormal: 1 } }
  )
  // data 是文档原样（{ apply: { count } }）时也要读得出来
  assert.deepStrictEqual(
    readAdminSubMsgResult({ code: 0, msg: 'ok', data: { apply: { count: 3, lastSendTime: 0 } } }),
    { ok: true, code: 0, counts: { apply: 3, abnormal: 0 } }
  )
  assert.deepStrictEqual(
    readAdminSubMsgResult({ code: -99, msg: '服务器异常' }),
    { ok: false, code: -99, counts: { apply: 0, abnormal: 0 } },
    '失败时不能把 counts 当有效值'
  )
  assert.deepStrictEqual(
    readAdminSubMsgResult({ code: -3, msg: '云开发里还没有 admin_sub_msg 集合' }),
    { ok: false, code: -3, counts: { apply: 0, abnormal: 0 } },
    '缺集合要保留 code，前端据此提示'
  )

  // 旧版 { success, count }：云函数还没上传时页面也不能报错
  assert.deepStrictEqual(
    readAdminSubMsgResult({ success: true, count: 1 }),
    { ok: true, code: 0, counts: { apply: 0, abnormal: 0 } }
  )
  assert.deepStrictEqual(
    readAdminSubMsgResult({ success: false }),
    { ok: false, code: -1, counts: { apply: 0, abnormal: 0 } }
  )
  assert.deepStrictEqual(readAdminSubMsgResult(undefined), { ok: false, code: -1, counts: { apply: 0, abnormal: 0 } })
}

testTmplMapping()
testAccepted()
testFailText()
testQuota()
testCounts()
testSyncFailText()
testReadResult()
console.log('adminSubMsgModel tests passed')
