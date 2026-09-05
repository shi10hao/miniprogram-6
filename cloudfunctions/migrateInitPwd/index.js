const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const bcrypt = require('bcryptjs')

exports.main = async () => {
  // 先查所有，看看到底有什么
  const all = await db.collection('users').limit(10).get()
  
  return {
    total_fetched: all.data.length,
    sample: all.data.length > 0 ? {
      _id: all.data[0]._id,
      user_id: all.data[0].user_id,
      phone: all.data[0].phone,
      has_password: all.data[0].password !== undefined
    } : null
  }
}