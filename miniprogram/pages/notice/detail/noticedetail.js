const db = wx.cloud.database()

Page({
  data: {
    notice: null,
    isLoading: true
  },

  onLoad(options) {
    const { noticeId } = options
    if (!noticeId) {
      wx.showToast({ title: '缺少公告ID', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }
    this.getNoticeDetail(noticeId)
  },

  // 获取公告详情
  getNoticeDetail(noticeId) {
    this.setData({ isLoading: true })
    
    db.collection('notice')
      .where({ notice_id: noticeId })
      .get()
      .then(res => {
        if (res.data.length === 0) return db.collection('notice').doc(noticeId).get()
        return res
      })
      .then(res => {
        let notice = null
        if (res.data && res.data.length > 0) {
          notice = res.data[0]
        } else if (res.data) {
          notice = res.data
        }

        if (notice) {
          notice.publish_date = this.formatDate(notice.publish_date)
          this.setData({ notice, isLoading: false })
        } else {
          this.setData({ isLoading: false })
          wx.showToast({ title: '未找到公告', icon: 'none' })
        }
      })
      .catch(err => {
        console.error('获取公告详情失败：', err)
        this.setData({ isLoading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      })
  },

  formatDate(dateStr) {
    if (!dateStr) return '未知日期'
    const text = String(dateStr).replace(' ', 'T')
    const date = new Date(text)
    if (isNaN(date.getTime())) return dateStr
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
})