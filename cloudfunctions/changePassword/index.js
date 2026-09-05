const cloud = require('wx-server-sdk')
const bcrypt = require('bcryptjs')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { userId, oldPwd, newPwd } = event
  try{
    const userRes = await db.collection('users')
      .where({user_id: userId})
      .get()
    if(userRes.data.length === 0){
      return {code:-1,msg:"用户不存在"}
    }
    const user = userRes.data[0]
    //校验旧密码
    const oldOk = await bcrypt.compare(oldPwd, user.password)
    if(!oldOk){
      return {code:-2,msg:"旧密码错误"}
    }
    //加密新密码
    const newHash = await bcrypt.hash(newPwd,10)
    await db.collection('users').doc(user._id).update({
      data:{
        password: newHash,
        pwd_modified: true
      }
    })
    return {code:0,msg:"密码修改成功"}
  }catch(err){
    console.error("changePassword err",err)
    return {code:-99,msg:"服务器异常"}
  }
}