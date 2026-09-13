const cloud = require('wx-server-sdk')
const bcrypt = require('bcryptjs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 审核通知订阅消息模板 ID
const REGISTER_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'

// 格式化时间为 "YYYY年MM月DD日 HH:mm"
function formatTime(date) {
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 发送订阅消息
async function sendReviewMsg(openid, title, content) {
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: REGISTER_TMPL_ID,
      page: 'pages/auth/auth',
      data: {
        thing30: { value: title.slice(0, 20) },
        time3:   { value: formatTime(new Date()) },
        thing2:  { value: content.slice(0, 20) }
      }
    })
    return true
  } catch (err) {
    console.error('订阅消息发送失败', err)
    return false
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  // ========== 1. 管理员身份校验 ==========
  try {
    const adminRes = await db.collection('users')
      .where({ wx_openid: OPENID, role: 'admin' })
      .count()
    if (adminRes.total === 0) {
      return { code: 403, msg: '无权限操作' }
    }
  } catch (err) {
    console.error('管理员校验失败', err)
    return { code: 500, msg: '身份校验异常' }
  }

  // ========== 2. 参数校验 ==========
  const { applyId, action, rejectReason = '' } = event
  if (!applyId || !['approve', 'reject'].includes(action)) {
    return { code: 1, msg: '参数错误' }
  }
  if (action === 'reject' && rejectReason.trim().length > 20) {
    return { code: 1, msg: '拒绝理由不能超过20字' }
  }

  // ========== 3. 读取申请记录 ==========
  let apply
  try {
    const applyRes = await db.collection('user_apply').doc(applyId).get()
    apply = applyRes.data
  } catch (err) {
    console.error('读取申请记录失败', err)
    return { code: 1, msg: '申请记录不存在' }
  }

  if (apply.status !== 'pending') {
    return { code: 1, msg: '该申请已被处理，请勿重复操作' }
  }

  const now = db.serverDate()

  // ========== 4. 拒绝分支 ==========
  if (action === 'reject') {
    try {
      await db.collection('user_apply').doc(applyId).update({
        data: {
          status: 'rejected',
          reject_reason: rejectReason.trim(),
          review_time: now,
          review_by: OPENID
        }
      })
    } catch (err) {
      console.error('拒绝更新失败', err)
      return { code: 500, msg: '操作失败，请重试' }
    }

    if (apply.subscribe_status === 'accept') {
      const reason = rejectReason.trim()
      const content = reason ? `未通过：${reason}` : '审核未通过'
      await sendReviewMsg(apply._openid, '资环实仪注册未通过', content)
    }
    return { code: 0, msg: '已拒绝' }
  }

  // ========== 5. 同意分支 ==========
  // 5.1 检查 users 表是否已存在该 user_id
  try {
    const exist = await db.collection('users')
      .where({ user_id: apply.user_id })
      .count()
    if (exist.total > 0) {
      await db.collection('user_apply').doc(applyId).update({
        data: { status: 'approved', review_time: now, review_by: OPENID }
      })
      return { code: 0, msg: '该用户已存在，已标记为通过' }
    }
  } catch (err) {
    console.error('users 表查重失败', err)
    return { code: 500, msg: '操作失败，请重试' }
  }

  // 5.2 生成密码哈希（初始密码 = 手机号）
  let hashedPassword
  try {
    hashedPassword = await bcrypt.hash(apply.phone, 10)
  } catch (err) {
    console.error('密码哈希失败', err)
    return { code: 500, msg: '操作失败，请重试' }
  }

  // 5.3 写入 users 表
  try {
    await db.collection('users').add({
      data: {
        _openid: apply._openid,
        owner: apply._openid,
        wx_openid: apply._openid,
        user_id: apply.user_id,
        name: apply.name,
        phone: apply.phone,
        major: apply.major,
        group_name: apply.group_name || '',
        role: 'student',
        password: hashedPassword,
        pwd_modified: false,
        createBy: OPENID,
        updateBy: OPENID,
        createdAt: now,
        updatedAt: now
      }
    })
  } catch (err) {
    console.error('写入 users 表失败', err)
    return { code: 500, msg: '操作失败，请重试' }
  }

  // 5.4 更新 user_apply 状态
  try {
    await db.collection('user_apply').doc(applyId).update({
      data: {
        status: 'approved',
        review_time: now,
        review_by: OPENID
      }
    })
  } catch (err) {
    console.error('更新 user_apply 状态失败', err)
  }

  // 5.5 发送通过通知
  if (apply.subscribe_status === 'accept') {
    await sendReviewMsg(apply._openid, '资环实仪注册已通过', '审核通过，可登录使用')
  }

  return { code: 0, msg: '已通过' }
}