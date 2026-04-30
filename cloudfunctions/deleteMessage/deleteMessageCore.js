function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeDocument(data) {
  if (Array.isArray(data)) {
    return data.length > 0 ? data[0] : null
  }
  return data || null
}

function getRemovedCount(result) {
  if (!result) return 0
  if (result.stats && typeof result.stats.removed === 'number') {
    return result.stats.removed
  }
  if (typeof result.removed === 'number') {
    return result.removed
  }
  if (typeof result.deleted === 'number') {
    return result.deleted
  }
  return 0
}

function canDeleteMessage(message, userId, openid) {
  if (!message) return false

  var messageOpenId = normalizeString(message._openid)
  var currentOpenId = normalizeString(openid)
  if (messageOpenId && currentOpenId && messageOpenId !== currentOpenId) {
    return false
  }

  return normalizeString(message.user_id) === normalizeString(userId)
}

function createDeleteMessageHandler(deps) {
  var db = deps && deps.db
  var getOpenId = deps && deps.getOpenId

  if (!db) {
    throw new Error('missing_db')
  }

  return async function deleteMessage(event) {
    var messageId = normalizeString(event && event.messageId)
    var userId = normalizeString(event && event.userId)

    if (!messageId || !userId) {
      return {
        success: false,
        code: 'INVALID_PARAMS',
        error: 'messageId and userId are required'
      }
    }

    try {
      var docRef = db.collection('messages').doc(messageId)
      var messageRes = await docRef.get()
      var message = normalizeDocument(messageRes && messageRes.data)
      if (!message) {
        return {
          success: false,
          code: 'MESSAGE_NOT_FOUND',
          error: 'message not found'
        }
      }

      var openid = typeof getOpenId === 'function' ? await getOpenId() : ''
      if (!canDeleteMessage(message, userId, openid)) {
        return {
          success: false,
          code: 'NO_PERMISSION',
          error: 'message does not belong to current user'
        }
      }

      var removeRes = await docRef.remove()
      var removed = getRemovedCount(removeRes)
      if (removed < 1) {
        return {
          success: false,
          code: 'DELETE_FAILED',
          error: 'message was not removed'
        }
      }

      return {
        success: true,
        removed: removed
      }
    } catch (err) {
      return {
        success: false,
        code: 'DELETE_FAILED',
        error: (err && (err.message || err.errMsg)) || 'delete failed'
      }
    }
  }
}

module.exports = {
  createDeleteMessageHandler,
  canDeleteMessage,
  getRemovedCount,
  normalizeDocument
}
