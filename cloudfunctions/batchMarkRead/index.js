const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { userId } = event
  if (!userId) return { success: false, error: 'missing userId' }

  let totalUpdated = 0

  while (true) {
    const res = await db.collection('messages')
      .where({
        user_id: userId,
        is_read: _.neq(true)
      })
      .limit(100)  // 云函数内 limit 可以到 100
      .get()

    const records = res.data || []
    if (records.length === 0) break
    console.log("records:",records)
    const ids = records.map(item => item._id)
    
    await db.collection('messages')
      .where({
        _id: _.in(ids)
      })
      .update({
        data: {
          is_read: true,
          read_time: new Date().toISOString()
        }
      })

    totalUpdated += ids.length
  }

  return { success: true, updated: totalUpdated }
}