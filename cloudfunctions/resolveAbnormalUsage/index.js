// resolveAbnormalUsage：管理员把「异常」使用记录标记为已处理
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 与管理端一致：教师和管理员都可以处理
const ALLOWED_ROLES = ['teacher', 'admin']

exports.main = async (event) => {
  const reserveId = String((event && event.reserveId) || '').trim()
  if (!reserveId) return fail(-1, '缺少预约编号')

  const { OPENID } = cloud.getWXContext()

  try {
    const admin = await findAdmin(OPENID)
    if (!admin) {
      return fail(-403, '仅管理员可处理异常，请重新登录管理端后再试')
    }

    const usage = await findAbnormalUsage(reserveId)
    if (!usage) {
      return fail(-404, '没有待处理的异常记录')
    }

    const now = new Date().toISOString()
    const handledBy = {
      user_id: admin.user_id,
      name: admin.name || admin.user_id,
      role: admin.role
    }

    const transaction = await db.startTransaction()
    try {
      // 使用记录回归「已完成」，同时留下异常处理痕迹，便于事后追溯
      await transaction.collection('device_usage').doc(usage._id).update({
        data: {
          status: 'completed',
          end_time: usage.end_time || now,
          abnormal_resolved: true,
          abnormal_handled_by: handledBy,
          abnormal_handled_time: now,
          update_time: now
        }
      })
      await transaction.collection('reserves').doc(reserveId).update({
        data: {
          usage_status: 'completed',
          update_time: now
        }
      })
      await transaction.commit()
    } catch (err) {
      await safeRollback(transaction)
      throw err
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        usageId: usage._id,
        handledBy: handledBy.name,
        handledTime: now
      }
    }
  } catch (err) {
    console.error('[resolveAbnormalUsage] 处理失败', err)
    return fail(-99, '处理失败，请稍后重试')
  }
}

/**
 * 用调用者的真实 openid 反查管理员身份，不信任前端传来的任何身份字段。
 * loginAdmin 登录时会把 wx_openid 写进 users，所以正常走管理端的账号都能命中。
 */
async function findAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users')
    .where({
      wx_openid: openid,
      role: _.in(ALLOWED_ROLES)
    })
    .limit(1)
    .get()
  return (res.data || [])[0] || null
}

/** 取该预约下最新的一条异常使用记录（不用 orderBy：缺 create_time 的记录会被整条滤掉） */
async function findAbnormalUsage(reserveId) {
  const res = await db.collection('device_usage')
    .where({
      reserve_id: reserveId,
      status: 'abnormal'
    })
    .limit(20)
    .get()

  const list = (res.data || []).slice().sort((left, right) => {
    const leftTime = parseTime(left.create_time)
    const rightTime = parseTime(right.create_time)
    return rightTime - leftTime
  })
  return list[0] || null
}

function parseTime(value) {
  if (!value) return 0
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? 0 : time
}

function fail(code, msg) {
  return { code, msg, data: null }
}

async function safeRollback(transaction) {
  try {
    await transaction.rollback()
  } catch (err) {
    console.error('[resolveAbnormalUsage] 回滚失败', err)
  }
}
