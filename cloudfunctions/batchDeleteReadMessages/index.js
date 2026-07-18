const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { userId } = event
  if (!userId) return { success: false, error: 'missing userId' }

  let totalDeleted = 0

  while (true) {
    const res = await db.collection('messages')
      .where({
        user_id: userId,
        is_read: true
      })
      .limit(100)
      .get()

    const records = res.data || []
    if (records.length === 0) break

    const ids = records.map(item => item._id)
    
    await db.collection('messages')
      .where({
        _id: _.in(ids)
      })
      .remove()

    totalDeleted += ids.length
  }

  return { success: true, deleted: totalDeleted }
}