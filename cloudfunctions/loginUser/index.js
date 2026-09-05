const cloud = require('wx-server-sdk')
const bcrypt = require('bcryptjs')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { user_id, password } = event
  try {
    const userRes = await db.collection('users')
      .where({ user_id, role: 'student' })
      .get()
    if(userRes.data.length === 0){
      return {code:-1,msg:"学号不存在"}
    }
    const user = userRes.data[0]
    //密码哈希比对
    const passOk = await bcrypt.compare(password, user.password)
    if(!passOk){
      return {code:-2,msg:"密码错误"}
    }
    //返回业务需要字段，不要返回password、phone
    return {
      code:0,
      msg:"ok",
      data:{
        userId: user.user_id,
        name: user.name,
        major: user.major,
        group_name: user.group_name,
        role: user.role,
        pwd_modified: user.pwd_modified
      }
    }
  }catch(err){
    console.error("loginUser err",err)
    return {code:-99,msg:"服务器异常"}
  }
}