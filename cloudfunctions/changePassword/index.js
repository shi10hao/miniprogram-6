const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const bcrypt = require('bcryptjs')

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // 从前端传 userId（你存 userInfo 里的），或者从 users 表用 openid 反查
  const { userId, newPassword } = event

  if (!userId || !newPassword) {
    return { code: 400, msg: '参数缺失' }
  }

  if (newPassword.length < 6) {
    return { code: 400, msg: '密码至少6位' }
  }

  // 查用户
  const res = await db.collection('users').where({ user_id: userId }).get()
  if (res.data.length === 0) {
    return { code: 404, msg: '用户不存在' }
  }

  const hash = bcrypt.hashSync(newPassword, 10)
  await db.collection('users').doc(res.data[0]._id).update({
    data: {
      password: hash,
      pwd_modified: true
    }
  })

  return { code: 0, msg: '密码修改成功' }
}