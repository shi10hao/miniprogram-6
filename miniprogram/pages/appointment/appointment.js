const db = wx.cloud.database()

Page({
  data: {
    activeTab: 'reservation',
    reservationHistory: [],
    usageHistory: [],
    isLoading: true,
    currentStudentId: ''
  },

  onLoad() {
    this.getCurrentStudentId()
    this.getOperationHistory()
  },

  onShow() {
    this.getOperationHistory()
  },

  getCurrentStudentId() {
    try {
      const userInfo = wx.getStorageSync('userInfo')
      if (userInfo && userInfo.userId) {
        this.setData({ currentStudentId: userInfo.userId })
      }
    } catch (err) {
      console.error('读取用户信息失败:', err)
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
  },

  getOperationHistory() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    const currentUserId = this.data.currentStudentId || userInfo.userId || ''

    if (!currentUserId) {
      this.setData({ isLoading: false })
      return Promise.resolve()
    }

    if (currentUserId !== this.data.currentStudentId) {
      this.setData({ currentStudentId: currentUserId })
    }

    this.setData({ isLoading: true })

    const reservationPromise = db.collection('reserves')
      .where({
        user_id: currentUserId
      })
      .orderBy('create_time', 'desc')
      .get()

    const usagePromise = db.collection('device_usage')
      .where({
        user_id: currentUserId,
        status: 'completed'
      })
      .orderBy('create_time', 'desc')
      .get()

    return Promise.all([reservationPromise, usagePromise])
      .then(([reservationRes, usageRes]) => {
        // 处理数据，添加格式化后的时间字段
        const processedReservations = (reservationRes.data || []).map(item => {
          return {
            ...item,
            // 添加格式化后的时间显示
            formatted_create_time: this.formatTime(item.create_time),
            // 提取开始时间和结束时间的时间部分
            start_time_display: this.getTimeFromDateTime(item.start_time),
            end_time_display: this.getTimeFromDateTime(item.end_time),
            // 状态显示逻辑：按 usage_status 区分是否生效
            status_display: this.getStatusDisplay(item),
            status_class: this.getStatusClass(item)
          }
        })
        
        const processedUsages = (usageRes.data || []).map(item => {
          const usageDate = this.getDateFromDateTime(item.start_time)
          const usagePeriod = `${this.getTimeFromDateTime(item.start_time)} - ${this.getTimeFromDateTime(item.end_time)}`
          return {
            ...item,
            // 添加格式化后的时间显示
            formatted_start_time: this.formatTime(item.start_time),
            formatted_end_time: this.formatTime(item.end_time),
            formatted_create_time: this.formatTime(item.create_time),
            usage_date_display: usageDate,
            usage_period_display: usagePeriod
          }
        })
        
        this.setData({
          reservationHistory: processedReservations,
          usageHistory: processedUsages,
          isLoading: false
        })
      })
      .catch(err => {
        console.error('获取操作历史失败:', err)
        this.setData({ isLoading: false })
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        })
        return Promise.reject(err)
      })
  },

  viewReservationDetail(e) {
    const index = e.currentTarget.dataset.index
    const r = this.data.reservationHistory[index]

    const lines = [
      '仪器：' + r.device_name,
      '仪器编号：' + r.device_id,
      '日期：' + r.reserve_date,
      '时间：' + r.start_time_display + ' - ' + r.end_time_display,
      '学号：' + r.user_id,
      '姓名：' + (r.student_name || ''),
      '课题组：' + (r.research_group || ''),
      '电话：' + (r.phone || ''),
      '提交时间：' + this.formatTime(r.create_time),
      '状态：' + r.status_display
    ]

    wx.showModal({
      title: '预约详情',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '确定'
    })
  },

  viewUsageDetail(e) {
    const index = e.currentTarget.dataset.index
    const u = this.data.usageHistory[index]

    const lines = [
      '仪器：' + u.device_name,
      '仪器编号：' + (u.device_id || ''),
      '使用日期：' + (u.usage_date_display || ''),
      '使用时段：' + (u.usage_period_display || ''),
      '开始时间：' + this.formatTime(u.start_time),
      '结束时间：' + this.formatTime(u.end_time),
      '状态：已完成',
      '记录时间：' + this.formatTime(u.create_time)
    ]

    if (u.usage_images && u.usage_images.length > 0) {
      lines.push('上传照片：' + u.usage_images.length + '张')
    }

    wx.showModal({
      title: '使用详情',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '确定'
    })
  },

  // 修改状态显示方法
  getStatusDisplay(item) {
    if (!item) return ''

    if (item.status === 'approved') {
      if (item.usage_status === 'active' || item.usage_status === 'completed') {
        return '已生效'
      }
      return '未生效'
    }

    const statusMap = {
      'pending': '待审核',
      'rejected': '已拒绝',
      'completed': '已完成',
      'cancelled': '已取消'
    }
    return statusMap[item.status] || item.status
  },

  getStatusClass(item) {
    if (!item) return ''

    if (item.status === 'approved') {
      if (item.usage_status === 'active' || item.usage_status === 'completed') {
        return 'effective'
      }
      return 'inactive'
    }

    return item.status || ''
  },

  // 从日期时间字符串中提取时间部分
  getTimeFromDateTime(dateTimeStr) {
    if (!dateTimeStr) return '--:--'
    
    // 如果是标准的日期时间格式，如 "2023-12-01 08:00"
    if (dateTimeStr.includes(' ')) {
      return dateTimeStr.split(' ')[1] // 取时间部分
    }
    
    // 如果是 ISO 格式，如 "2023-12-01T08:00:00.000Z"
    if (dateTimeStr.includes('T')) {
      const timePart = dateTimeStr.split('T')[1]
      if (timePart) {
        return timePart.substring(0, 5) // 取 HH:mm
      }
    }
    
    // 如果已经是时间格式，直接返回
    if (dateTimeStr.includes(':')) {
      return dateTimeStr
    }
    
    // 尝试解析为日期对象
    try {
      const date = new Date(dateTimeStr)
      if (!isNaN(date.getTime())) {
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        return `${hours}:${minutes}`
      }
    } catch (err) {
      console.error('解析时间失败:', err)
    }
    
    return '--:--'
  },

  getDateFromDateTime(dateTimeStr) {
    if (!dateTimeStr) return '--'

    if (dateTimeStr.includes(' ')) {
      return dateTimeStr.split(' ')[0]
    }

    if (dateTimeStr.includes('T')) {
      return dateTimeStr.split('T')[0]
    }

    try {
      const date = new Date(dateTimeStr)
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }
    } catch (err) {
      console.error('解析日期失败:', err)
    }

    return '--'
  },

  // 时间格式化函数
  formatTime(time) {
    if (!time) return '未记录'
    
    try {
      let date = new Date(time)
      
      if (isNaN(date.getTime())) {
        // 如果不是标准日期格式，直接返回原始值
        return time
      }
      
      // 格式化为本地时间：YYYY-MM-DD HH:mm:ss
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
      
    } catch (err) {
      return '无效时间'
    }
  },

  onPullDownRefresh() {
    this.getOperationHistory()
      .finally(() => {
        wx.stopPullDownRefresh()
      })
  }
})
