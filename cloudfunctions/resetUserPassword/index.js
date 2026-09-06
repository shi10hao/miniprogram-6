const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const bcrypt = require('bcryptjs')

exports.main = async (event, context) => {
  const { action, userId } = event

  // ① 查询用户信息
  if (action === 'query') {
    if (!userId) return { code: 400, msg: '请输入学号' }

    const res = await db.collection('users').where({ user_id: userId }).get()
    if (res.data.length === 0) {
      return { code: 404, msg: '该学号不存在' }
    }

    const u = res.data[0]
    return {
      code: 0,
      user: {
        user_id: u.user_id,
        name: u.name,
        phone: u.phone,
        major: u.major || '',
        group_name: u.group_name || '',
        role: u.role || '',
        pwd_modified: u.pwd_modified || false
      }
    }
  }

  // ② 重置密码
  if (action === 'reset') {
    if (!userId) return { code: 400, msg: '参数缺失' }

    const res = await db.collection('users').where({ user_id: userId }).get()
    if (res.data.length === 0) {
      return { code: 404, msg: '用户不存在' }
    }

    const user = res.data[0]
    if (!user.phone) {
      return { code: 400, msg: '该用户未绑定手机号，无法重置' }
    }

    const hash = bcrypt.hashSync(user.phone, 10)
    await db.collection('users').doc(user._id).update({
      data: {
        password: hash,
        pwd_modified: false
      }
    })

    return { code: 0, msg: '密码已重置为手机号' }
  }

  return { code: 400, msg: '未知操作' }
}