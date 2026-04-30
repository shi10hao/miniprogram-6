const db = wx.cloud.database()

const TYPE_LABELS = {
  reservation_success: '预约成功',
  reservation_remind: '预约提醒',
  usage_photo_remind: '照片提醒',
  usage_end_remind: '结束提醒',
  admin_notice: '管理员公告'
}

Page({
  data: {
    message: null,
    isLoading: true
  },

  onLoad(options) {
    const messageId = options.messageId
    const source = options.source || 'message'

    if (!messageId) {
      this.setData({ isLoading: false })
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      return
    }

    this.getMessageDetail(messageId, source)
  },

  getMessageDetail(messageId, source) {
    this.setData({ isLoading: true })

    const request = source === 'notice'
      ? this.getNoticeDetail(messageId)
      : this.getUserMessageDetail(messageId)

    request
      .then(message => {
        this.setData({
          message,
          isLoading: false
        })
      })
      .catch(err => {
        console.error('获取消息详情失败:', err)
        this.setData({
          message: null,
          isLoading: false
        })
        wx.showToast({
          title: '消息不存在',
          icon: 'none'
        })
      })
  },

  getUserMessageDetail(messageId) {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      return Promise.reject(new Error('missing_user'))
    }

    return db.collection('messages')
      .where({
        _id: messageId,
        user_id: userInfo.userId
      })
      .limit(1)
      .get()
      .then(res => {
        const item = res.data && res.data.length > 0 ? res.data[0] : null
        if (!item) {
          throw new Error('message_not_found')
        }

        const message = this.normalizeMessage(item)
        return this.markMessageAsRead(messageId, userInfo.userId).then(marked => {
          if (marked) {
            message.is_read = true
          }
          return message
        })
      })
  },

  getNoticeDetail(messageId) {
    return db.collection('notice')
      .where({
        notice_id: messageId,
        type: 'admin'
      })
      .limit(1)
      .get()
      .then(res => {
        if (res.data && res.data.length > 0) {
          return this.normalizeNotice(res.data[0])
        }
        return db.collection('notice')
          .where({
            _id: messageId,
            type: 'admin'
          })
          .limit(1)
          .get()
          .then(docRes => {
            const item = docRes.data && docRes.data.length > 0 ? docRes.data[0] : null
            if (!item) {
              throw new Error('notice_not_found')
            }
            return this.normalizeNotice(item)
          })
      })
  },

  normalizeMessage(item) {
    return {
      _id: item._id,
      source: 'message',
      title: item.title || this.getTypeLabel(item.type),
      content: item.content || '',
      type: item.type,
      typeLabel: this.getTypeLabel(item.type),
      create_time: this.formatTime(item.create_time),
      is_read: !!item.is_read
    }
  },

  normalizeNotice(item) {
    return {
      _id: item.notice_id || item._id,
      source: 'notice',
      title: item.title || '管理员公告',
      content: item.content || '',
      type: 'admin_notice',
      typeLabel: this.getTypeLabel('admin_notice'),
      create_time: this.formatTime(item.publish_date || item.create_time),
      is_read: true
    }
  },

  getTypeLabel(type) {
    return TYPE_LABELS[type] || '系统消息'
  },

  markMessageAsRead(messageId, userId) {
    const _ = db.command
    return db.collection('messages')
      .where({
        _id: messageId,
        user_id: userId,
        is_read: _.neq(true)
      })
      .update({
        data: {
          is_read: true,
          read_time: new Date().toISOString()
        }
      })
      .then(updateRes => !!(updateRes.stats && updateRes.stats.updated > 0))
      .catch(err => {
        console.error('详情页标记已读失败:', err)
        return false
      })
  },

  formatTime(value) {
    if (!value) return '未知时间'
    const text = String(value)
    const normalized = text.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/, '$1 $2').replace(' ', 'T')
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) {
      return text
    }

    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
})
