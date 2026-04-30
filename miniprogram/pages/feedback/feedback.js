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
    messageList: [],
    isLoading: true
  },

  onLoad() {
    this.loadMessages()
  },

  onShow() {
    this.loadMessages()
  },

  loadMessages() {
    this.setData({ isLoading: true })

    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      this.setData({ isLoading: false, messageList: [] })
      return
    }

    const _ = db.command
    Promise.all([
      db.collection('messages')
        .where({ user_id: userInfo.userId })
        .orderBy('create_time', 'desc')
        .limit(50)
        .get(),
      db.collection('notice')
        .where({ type: 'admin' })
        .orderBy('publish_date', 'desc')
        .limit(20)
        .get()
    ]).then(([msgRes, noticeRes]) => {
      const messages = (msgRes.data || []).map(item => ({
        _id: item._id,
        title: item.title || TYPE_LABELS[item.type] || '系统消息',
        content: item.content || '',
        create_time: this.formatTime(item.create_time),
        type: item.type || 'system',
        typeLabel: TYPE_LABELS[item.type] || '系统消息',
        source: 'message',
        is_read: !!item.is_read
      }))

      const notices = (noticeRes.data || []).map(item => ({
        _id: item._id,
        title: item.title || '管理员公告',
        content: item.content || '',
        create_time: this.formatTime(item.publish_date),
        type: 'admin_notice',
        typeLabel: '管理员公告',
        source: 'notice',
        is_read: true
      }))

      const all = [...messages, ...notices].sort((a, b) => {
        return b.create_time.localeCompare(a.create_time)
      })

      this.setData({ messageList: all, isLoading: false })
    }).catch(err => {
      console.error('加载消息失败:', err)
      this.setData({ isLoading: false, messageList: [] })
    })
  },

  formatTime(value) {
    if (!value) return ''
    const text = String(value).replace(' ', 'T')
    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return String(value)
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  viewDetail(e) {
    const messageId = e.currentTarget.dataset.messageid
    const source = e.currentTarget.dataset.source
    wx.navigateTo({
      url: `/pages/message/detail/messagedetail?messageId=${messageId}&source=${source}`
    })
  }
})
