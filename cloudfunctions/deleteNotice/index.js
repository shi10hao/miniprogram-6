const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { noticeId } = event

  if (!noticeId) {
    return { code: -1, message: '缺少 noticeId' }
  }

  try {
    const db = cloud.database()
    const _ = db.command

    // 优先按 _id 删，其次按 notice_id 删（兼容两种情况）
    const res = await db.collection('notice')
      .where(_.or([
        { _id: noticeId },
        { notice_id: noticeId }
      ]))
      .remove()

    if (res.stats.removed === 0) {
      return { code: -1, message: '未找到该通知' }
    }

    return { code: 0, message: '删除成功' }
  } catch (err) {
    console.error('删除通知失败:', err)
    return { code: -1, message: '删除失败' }
  }
}