const db = wx.cloud.database()

Page({
  data: {
    noticeList: [],
    isLoading: true
  },

  onLoad() {
    this.getNoticeList()
  },

  // 获取公告列表（包含日期字段）
  getNoticeList() {
    this.setData({ isLoading: true })
    
    db.collection('notice')
      .field({
        title: true,
        publish_date: true,
        notice_id: true, // 保留唯一标识
        _id: true // 数据库自带的唯一ID，备用
      })
      .orderBy('publish_date', 'desc') // 按日期倒序
      .get()
      .then(res => {
        // 格式化日期（将数据库日期转换为可读格式）
        const formattedList = res.data.map(item => ({
          ...item,
          // 假设数据库日期是ISO格式（如"2023-10-01T08:00:00.000Z"）
          publish_date: this.formatDate(item.publish_date)
        }))
        
        this.setData({
          noticeList: formattedList,
          isLoading: false
        })
      })
      .catch(err => {
        console.error('获取公告列表失败：', err)
        this.setData({ isLoading: false })
      })
  },

  // 日期格式化工具（关键：解决日期不显示问题）
  formatDate(dateStr) {
    if (!dateStr) return '未知日期'
    
    // 处理不同格式的日期（根据你的数据库实际格式调整）
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) {
      // 若日期格式无效，直接返回原始字符串
      return dateStr.split('T')[0] || dateStr
    }
    
    // 格式化为 "YYYY-MM-DD"
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
  },

  // 跳转到详情页（关键：正确传递参数）
  goToDetail(e) {
    const noticeId = e.currentTarget.dataset.noticeid
    if (!noticeId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      return
    }
    
    wx.navigateTo({
      url: `/pages/notice/detail/noticedetail?noticeId=${noticeId}`
    })
  }
})