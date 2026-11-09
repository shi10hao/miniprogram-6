const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()
const _ = db.command
// 订阅额度单独一集合（_id = openid）。users 有数据模板，写不进未声明的字段
const QUOTA_COLL = 'admin_sub_msg'

// 故障告警模板，必须和 miniprogram/pages/admin/adminSubMsgModel.js
// 的 SUBSCRIBE_TMPL_ALIAS.abnormal 一致
const ABNORMAL_TMPL_ID = 'rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY'
// 本函数只消耗 abnormal 这一个槽位
const QUOTA_SLOT = 'abnormal'
// 用户拒绝接收 / 该模板额度已耗尽
const ERR_NO_QUOTA = 43101

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
 * 这次还要不要发：没有记账记录时按「额度未知」放行，靠 43101 纠偏
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
    console.warn('[sendAbnormalNotification] 读取额度失败，按未知额度处理', err && err.errCode)
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
      console.warn('[sendAbnormalNotification] 扣减失败，改整文档写', openid, err && err.errCode)
    }
  }
  try {
    await db.collection(QUOTA_COLL).doc(openid).set({
      data: buildQuotaDoc(quota, { count: 0, lastSendTime: now })
    })
  } catch (err) {
    console.error('[sendAbnormalNotification] 扣减订阅次数失败', openid, err)
  }
}

/**
 * 额度失效：归零并留下错误码
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
    console.error('[sendAbnormalNotification] 清零订阅次数失败', openid, err)
  }
}

exports.main = async (event) => {
  const {
    reserveId,
    deviceName: paramDeviceName,
    deviceId: paramDeviceId,
    userName,
    feedbackTitle,
    feedbackContent
  } = event

  // 服务端拿到的真实 openid，绝不能信任前端传的身份
  const { OPENID } = cloud.getWXContext()

  if (!reserveId) {
    return { success: false, error: '缺少预约ID' }
  }

  // ===== 安全修复 1：服务端取预约信息，校验调用者确实是该预约的主人 =====
  let reserve
  try {
    const reserveRes = await db.collection('reserves').doc(String(reserveId)).get()
    reserve = reserveRes.data
  } catch (err) {
    console.error('查询预约失败:', err)
    return { success: false, error: '预约不存在' }
  }
  if (!reserve) {
    return { success: false, error: '预约不存在' }
  }

  // 预约上有 _openid 时必须匹配当前调用者；老数据没有 _openid 才降级放行（记录日志）
  if (reserve._openid && reserve._openid !== OPENID) {
    console.warn(`非法调用 sendAbnormalNotification：预约 ${reserveId} 的 owner 与调用者不符`, {
      reserveOwner: reserve._openid,
      caller: OPENID
    })
    return { success: false, error: '无权发送该预约的异常通知' }
  }
  if (!reserve._openid) {
    console.warn(`预约 ${reserveId} 缺少 _openid，无法严格校验调用者，已降级放行`)
  }

  // ===== 安全修复 2：一律以服务端预约数据为准，不信任前端传的仪器名/编号/姓名 =====
  const finalDeviceName = reserve.device_name || paramDeviceName || ''
  const finalDeviceId = reserve.device_id || paramDeviceId || ''
  const finalUserName = reserve.student_name || reserve.user_id || userName || '未知用户'

  // ===== 只通知真正的管理员 =====
  const adminUsers = await db.collection('users')
    .where({ role: _.in(['teacher', 'admin']) })
    .field({ user_id: true, wx_openid: true, role: true })
    .get()
  const admins = (adminUsers.data || []).filter(a => a.user_id)

  if (admins.length === 0) {
    return { success: false, error: '没有找到管理员' }
  }

  // 额度在独立集合里，按 openid 一次取回
  const quotaMap = await loadQuotaMap(admins.map(a => a.wx_openid).filter(Boolean))

  let sentCount = 0
  let msgSent = 0
  let msgSkipped = 0
  const now = new Date()
  const nowISO = now.toISOString()

  for (const admin of admins) {
    try {
      // 站内消息：只写给管理员本人
      const messageId = `abnormal_alert_${reserveId}_${admin.user_id}`
      await db.collection('messages').doc(messageId).set({
        data: {
          user_id: admin.user_id,
          title: '仪器使用异常提醒',
          content: `用户 ${finalUserName} 在使用 ${finalDeviceName}(${finalDeviceId}) 时报告了异常：${feedbackTitle || '无标题'} - ${feedbackContent || '无详情'}`,
          type: 'admin_notice',
          related_id: String(reserveId),
          message_key: `abnormal:${reserveId}`,
          is_read: false,
          create_time: nowISO
        }
      })

      // 微信订阅消息（管理员没授权时静默失败，不影响站内消息）
      if (admin.wx_openid) {
        if (!shouldTrySend(quotaMap[admin.wx_openid])) {
          // 额度明确为 0，跳过这一个人，站内消息已经写好了
          msgSkipped++
          console.log('[sendAbnormalNotification] 无订阅额度，跳过', admin.user_id)
        } else {
          try {
            await cloud.openapi.subscribeMessage.send({
              touser: admin.wx_openid,
              templateId: ABNORMAL_TMPL_ID,
              page: 'pages/admin/reserve-list/adminreservelist',
              data: {
                thing1: { value: (finalDeviceName || '未知仪器').slice(0, 20) },
                thing2: { value: `${(feedbackTitle || '异常反馈').slice(0, 20)}${feedbackContent ? '...' : ''}` },
                date4: { value: formatTime(now) },
                character_string25: { value: (finalDeviceId || '').slice(0, 32) }
              }
            })
            await consumeQuota(admin.wx_openid, quotaMap[admin.wx_openid])
            msgSent++
          } catch (msgErr) {
            const errCode = msgErr && msgErr.errCode
            if (errCode === ERR_NO_QUOTA) {
              await clearQuota(admin.wx_openid, quotaMap[admin.wx_openid], errCode)
            }
            console.warn(`发送订阅消息给 ${admin.user_id} 失败（可能未授权）:`, errCode, msgErr && msgErr.errMsg)
          }
        }
      }

      sentCount++
    } catch (err) {
      console.error(`处理管理员 ${admin.user_id} 失败:`, err)
    }
  }

  return { success: true, sentCount, msgSent, msgSkipped }
}

function formatTime(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
