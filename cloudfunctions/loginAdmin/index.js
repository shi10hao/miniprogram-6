const cloud = require('wx-server-sdk')
const bcrypt = require('bcryptjs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { user_id, password } = event

  if (!user_id || !password) {
    return { code: 400, msg: '参数缺失' }
  }

  try {
    // 只查教师 / 管理员
    const res = await db.collection('users')
      .where({
        user_id,
        role: db.command.in(['teacher', 'admin'])
      })
      .limit(1)
      .get()

    if (res.data.length === 0) {
      return { code: -1, msg: '账号不存在或无权限' }
    }

    const user = res.data[0]

    if (!user.password) {
      return { code: -2, msg: '账号未设置密码' }
    }

    const passOk = await bcrypt.compare(password, user.password)
    if (!passOk) {
      return { code: -3, msg: '密码错误' }
    }

    // 返回管理端需要的字段
    return {
      code: 0,
      msg: 'ok',
      data: {
        userId: user.user_id,
        name: user.name,
        role: user.role,
        group_name: user.group_name
      }
    }

  } catch (err) {
    console.error('loginAdmin err', err)
    return { code: -99, msg: '服务器异常' }
  }
}