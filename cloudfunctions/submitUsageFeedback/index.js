const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async event => {
  const usageId = event.usageId || ''
  const feedbackType = event.feedbackType || 'other'
  const feedbackTitle = event.feedbackTitle || ''
  const feedbackContent = event.feedbackContent || ''
  const feedbackPhotos = event.feedbackPhotos || []
  const endUsage = !!event.endUsage
  const userInfo = event.userInfo || {}
  const userId = String(userInfo.userId || '').trim()

  if (!usageId || !feedbackContent || !userId) {
    return { success: false, code: 'INVALID_PARAMS', error: '参数不完整' }
  }

  const transaction = await db.startTransaction()

  try {
    // 1. 校验使用记录
    const usageRes = await transaction.collection('device_usage').doc(usageId).get()
    const usage = usageRes.data
    if (!usage) {
      throw createError('USAGE_NOT_FOUND', '使用记录不存在')
    }
    if (String(usage.user_id || '').trim() !== userId) {
      throw createError('FORBIDDEN', '无权操作该记录')
    }
    if (usage.status !== 'using') {
      throw createError('INVALID_STATUS', '该使用记录已结束，无法提交反馈')
    }

    const now = new Date()
    const nowText = now.toISOString()

    // 2. 插入反馈工单
    const feedbackRecord = {
      usage_id: usageId,
      reserve_id: usage.reserve_id || '',
      device_id: usage.device_id,
      device_name: usage.device_name,
      user_id: userId,
      student_name: usage.student_name || userInfo.name || '',
      group_name: usage.group_name || userInfo.groupName || '',
      phone: usage.phone || userInfo.phone || '',
      type: feedbackType,
      title: feedbackTitle,
      content: feedbackContent,
      photos: feedbackPhotos,
      status: 'pending', // pending待处理 processing处理中 completed已完成
      create_time: nowText,
      update_time: nowText,
      _openid: usage._openid || userInfo.openid || ''
    }

    const addRes = await transaction.collection('feedbacks').add({
      data: feedbackRecord
    })

    // 3. 若勾选同步结束使用，更新使用记录状态
    if (endUsage) {
      await transaction.collection('device_usage').doc(usageId).update({
        data: {
          status: 'abnormal',
          end_time: nowText,
          abnormal_reason: feedbackContent,
          feedback_id: addRes._id,
          update_time: nowText
        }
      })

      // 同步更新预约状态
      if (usage.reserve_id) {
        await transaction.collection('reserves').doc(usage.reserve_id).update({
          data: {
            usage_status: 'abnormal',
            update_time: nowText
          }
        })
      }
    }

    await transaction.commit()
    return { success: true, feedbackId: addRes._id }

  } catch (err) {
    try { await transaction.rollback() } catch(e) {}
    if (err && err.code) {
      return { success: false, code: err.code, error: err.message }
    }
    console.error('提交使用反馈失败:', err)
    return { success: false, code: 'SYSTEM_ERROR', error: '提交失败，请重试' }
  }
}

function createError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}