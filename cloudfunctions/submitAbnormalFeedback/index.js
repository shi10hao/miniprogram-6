const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()


exports.main = async (event, context) => {
  const reserveId = event && event.reserveId ? String(event.reserveId).trim() : ''
  const feedbackTitle = event && event.feedbackTitle ? String(event.feedbackTitle).trim() : ''
  const feedbackContent = event && event.feedbackContent ? String(event.feedbackContent).trim() : ''
  const userInfo = event && event.userInfo ? event.userInfo : {}
  const userId = String(userInfo.userId || '').trim()
  const feedbackScene = event && event.feedbackScene ? String(event.feedbackScene).trim() : 'start'
  const feedbackPhotos = event && event.feedbackPhotos ? event.feedbackPhotos : []
  // 参数校验
  if (!reserveId || !feedbackContent || !userId) {
    return buildErrorResult('INVALID_PARAMS', '参数不完整')
  }
  const transaction = await db.startTransaction()

  console.log(reserveId, feedbackTitle, feedbackContent, userInfo, userId, feedbackScene)

  try {

    // 1. 查询预约信息并校验
    const reserveRes = await transaction.collection('reserves').doc(reserveId).get()
    const reserve = reserveRes.data

    console.log("reserve:", reserve)

    if (!reserve) {
      throw createBusinessError('RESERVE_NOT_FOUND', '预约不存在')
    }
    if (String(reserve.user_id || '').trim() !== userId) {
      throw createBusinessError('FORBIDDEN', '无权操作该预约')
    }
    if (reserve.status !== 'approved') {
      throw createBusinessError('INVALID_RESERVE_STATUS', '当前预约不可提交反馈')
    }
    // 防止重复提交
    const allowedStatuses = ['not_started', 'active']
    if (reserve.usage_status && !allowedStatuses.includes(reserve.usage_status)) {
      throw createBusinessError('ALREADY_PROCESSED', '该预约已处理，请勿重复提交')
    }

    const now = new Date()
    const nowText = now.toISOString()
    let addRes = null
    const endUsage = event.endUsage !== false // 默认true，兼容旧调用
    if (feedbackScene === 'using') {
      const linkedUsageId = reserve.linked_usage_id
      if (!linkedUsageId) {
        throw createBusinessError('LINKED_USAGE_NOT_FOUND', '未找到关联的使用记录')
      }

      await transaction.collection('device_usage')
        .doc(linkedUsageId)
        .update({
          data: {
            'feedback.title': feedbackTitle,
            'feedback.content': feedbackContent,
            'feedback.submit_time': nowText,
            'feedback.photos': feedbackPhotos || []
          }
        })

      // 只有勾选结束时，才修改状态为异常
      if (endUsage) {
        await transaction.collection('device_usage')
          .doc(linkedUsageId)
          .update({
            data: {
              status: 'abnormal',
              end_time: nowText,
              abnormal_time: nowText
            }
          })
        await transaction.collection('reserves')
          .doc(reserveId)
          .update({
            data: {
              usage_status: 'abnormal'
            }
          })
      }
    } else {
      // 2. 插入异常使用记录
      const usageRecord = {
        reserve_id: reserveId,
        device_id: reserve.device_id,
        device_name: reserve.device_name,
        user_id: reserve.user_id,
        student_name: reserve.student_name || userInfo.name || '',
        group_name: reserve.research_group || userInfo.groupName || '',
        phone: reserve.phone || userInfo.phone || '',
        reserve_date: reserve.reserve_date || '',
        reserve_start_time: reserve.start_time || '',
        reserve_end_time: reserve.end_time || '',
        reserve_start_ts: resolveReservationTimestamp(reserve, 'start'),
        reserve_end_ts: resolveReservationTimestamp(reserve, 'end'),
        start_time: nowText, // 反馈提交时间 = 异常发生时间
        status: 'abnormal', // 核心：异常状态标识，管理端通过此字段筛选
        feedback: { // 反馈详情，管理端可直接读取
          title: feedbackTitle,
          content: feedbackContent,
          submit_time: nowText
        },
        usage_images: [],
        create_time: nowText,
        _openid: reserve._openid || userInfo.openid || ''
      }
      console.log("usageRecord:", usageRecord)
      addRes = await transaction.collection('device_usage').add({
        data: usageRecord
      })
      console.log("addRes:", addRes)
      // 3. 更新预约状态，避免重复出现在待使用列表
      await transaction.collection('reserves')
        .doc(reserveId)
        .update({
          data: {
            usage_status: 'abnormal',
            linked_usage_id: addRes._id
          }
        })
    }
    console.log("1")
    // 4. 提交事务
    await transaction.commit()
    console.log("2")
    // 根据不同场景返回不同的 usageId
    if (feedbackScene === 'using') {
      console.log("using")
      return {
        success: true,
        usageId: reserve.linked_usage_id // using场景返回已有的 usageId
      }
    } else {
      console.log("start")
      return {
        success: true,
        usageId: addRes._id // start场景返回新建的 usageId
      }
    }

  } catch (err) {
    await safeRollback(transaction)
    if (err && err.code) {
      return buildErrorResult(err.code, err.message)
    }
    console.error('submitAbnormalFeedback 执行失败:', err)
    return buildErrorResult('SUBMIT_FAILED', '提交失败，请重试')
  }

}
// ========== 工具函数（与startUsage云函数保持一致，保证时间解析统一）==========
function parseReservationTime(value) {
  if (!value) return null
  const text = String(value)
    .trim()
    .replace(/\//g, '-')
    .replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}(?::\d{2})?)$/, '$1 $2')
  const beijingMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T-](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (beijingMatch) {
    const year = Number(beijingMatch[1])
    const month = Number(beijingMatch[2])
    const day = Number(beijingMatch[3])
    const hour = Number(beijingMatch[4] || 0)
    const minute = Number(beijingMatch[5] || 0)
    const second = Number(beijingMatch[6] || 0)
    const beijingDate = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, 0))
    return Number.isNaN(beijingDate.getTime()) ? null : beijingDate
  }
  const date = new Date(text.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function resolveReservationTimestamp(reserve, field) {
  const tsKey = `${field}_ts`
  const timeKey = `${field}_time`
  const timestamp = Number(reserve && reserve[tsKey])
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp
  const date = parseReservationTime(reserve && reserve[timeKey])
  return date ? date.getTime() : 0
}

function createBusinessError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function buildErrorResult(code, error) {
  return {
    success: false,
    code,
    error
  }
}

async function safeRollback(transaction) {
  try {
    await transaction.rollback()
  } catch (rollbackErr) {
    console.error('反馈提交回滚失败:', rollbackErr)
  }
}