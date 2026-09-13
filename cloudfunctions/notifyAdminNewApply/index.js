const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 通用模板 ID（与 sendNoticeSubMsg 用的一致）
const NOTICE_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'

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

  // 3. 查询所有管理员
  let admins = []
  try {
    const adminRes = await db.collection('users')
      .where({ role: 'admin' })
      .field({ _openid: true, _id: true })
      .limit(1000)
      .get()
    admins = adminRes.data || []
  } catch (err) {
    console.error('查询管理员失败', err)
    return { code: 500, msg: '查询管理员失败' }
  }

  if (admins.length === 0) {
    return { code: 0, msg: '无管理员可通知', total: 0, sent: 0 }
  }

  // 4. 逐个发送（单发失败不中断）
  const results = await Promise.all(admins.map(async (u) => {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: u._openid,
        templateId: NOTICE_TMPL_ID,
        page: 'pages/admin/login/adminlogin',
        data,
        miniprogramState: 'developer', // 上线正式版请改 'formal'
        lang: 'zh_CN'
      })
      return { openid: u._openid, ok: true }
    } catch (err) {
      console.error('发送失败', u._openid, err)
      return { openid: u._openid, ok: false, errCode: err && err.errCode }
    }
  }))

  const sent = results.filter(r => r.ok).length
  return { code: 0, msg: 'ok', total: admins.length, sent }
}