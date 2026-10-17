const db = wx.cloud.database()
const PAGE_SIZE = 20

Page({
  data: {
    activeTab: 'reservation',      // reservation | usage
    reservationFilter: 'all',      // all | upcoming | effective | cancelled
    usageFilter: 'all',            // all | completed | abnormal
    reservationHistory: [],
    usageHistory: [],
    isLoading: true,
    isLoadingMore: false,
    reservationHasMore: false,
    usageHasMore: false,
    reservationPage: 1,
    usagePage: 1,
    currentStudentId: ''
  },

  onLoad(options) {
    // 首次进入，onShow 紧跟着触发时跳过重复加载
    this._firstShow = true

    // 从工作台"使用概览"跳入时，带上目标视图
    const view = options && options.view
    if (view === 'upcoming') {
      this.setData({ activeTab: 'reservation', reservationFilter: 'upcoming' })
    } else if (view === 'history') {
      this.setData({ activeTab: 'usage' })
    }

    this.getCurrentStudentId()
    this.loadActiveTab(true)
  },

  onShow() {
    if (this._firstShow) {
      this._firstShow = false
      return
    }
    // 从详情页等返回时静默刷新当前 tab
    this.loadActiveTab(true, true)
  },

  getCurrentStudentId() {
    try {
      const userInfo = wx.getStorageSync('userInfo')
      if (userInfo && userInfo.userId) {
        this.setData({ currentStudentId: userInfo.userId })
      }
    } catch (err) {
      // ignore
    }
  },

  // ============ 交互 ============
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.loadActiveTab(true)
  },

  switchReservationFilter(e) {
    const filter = e.currentTarget.dataset.filter
    if (filter === this.data.reservationFilter) return
    this.setData({ reservationFilter: filter })
    this.loadReservations(true)
  },

  switchUsageFilter(e) {
    const filter = e.currentTarget.dataset.filter
    if (filter === this.data.usageFilter) return
    this.setData({ usageFilter: filter })
    this.loadUsages(true)
  },

  loadMore() {
    if (this.data.isLoadingMore) return
    if (this.data.activeTab === 'usage') {
      if (!this.data.usageHasMore) return
      this.loadUsages(false)
    } else {
      if (!this.data.reservationHasMore) return
      this.loadReservations(false)
    }
  },

  loadActiveTab(isFirst, silent = false) {
    if (this.data.activeTab === 'usage') {
      return this.loadUsages(isFirst, silent)
    }
    return this.loadReservations(isFirst, silent)
  },

  // ============ 加载预约记录 ============
  loadReservations(isFirst, silent = false) {
    const userId = this.data.currentStudentId || (wx.getStorageSync('userInfo') || {}).userId || ''
    if (!userId) {
      this.setData({ isLoading: false, reservationHistory: [], reservationHasMore: false })
      return Promise.resolve()
    }

    const page = isFirst ? 1 : this.data.reservationPage
    if (isFirst) {
      if (!silent) this.setData({ isLoading: true })
      this.setData({ reservationPage: 1 })
    } else {
      this.setData({ isLoadingMore: true })
    }

    const where = this.buildReservationWhere(userId, this.data.reservationFilter)

    return db.collection('reserves')
      .where(where)
      .orderBy('create_time', 'desc')
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()
      .then(res => {
        const rows = (res.data || []).map(item => this.processReservation(item))
        const hasMore = (res.data || []).length === PAGE_SIZE
        this.setData({
          reservationHistory: isFirst ? rows : this.data.reservationHistory.concat(rows),
          reservationPage: page + 1,
          reservationHasMore: hasMore,
          isLoading: false,
          isLoadingMore: false
        })
      })
      .catch(err => {
        console.error('加载预约记录失败:', err)
        if (!silent) {
          wx.showToast({ title: '加载失败', icon: 'none' })
        }
        this.setData({ isLoading: false, isLoadingMore: false })
      })
  },

  buildReservationWhere(userId, filter) {
    const _ = db.command
    const base = { user_id: userId }
    switch (filter) {
      case 'upcoming':
        // 已通过 且 尚未开始使用（空串兼容老数据）
        return Object.assign({}, base, {
          status: 'approved',
          usage_status: _.in(['not_started', ''])
        })
      case 'effective':
        // 已通过 且 已进入使用/已完成/异常
        return Object.assign({}, base, {
          status: 'approved',
          usage_status: _.in(['active', 'completed', 'abnormal'])
        })
      case 'cancelled':
        // 未通过 / 已取消 / 待审核 等非通过状态
        return Object.assign({}, base, {
          status: _.in(['cancelled', 'rejected', 'pending'])
        })
      default:
        return base
    }
  },

  processReservation(item) {
    return Object.assign({}, item, {
      formatted_create_time: this.formatTime(item.create_time),
      start_time_display: this.getTimeFromDateTime(item.start_time),
      end_time_display: this.getTimeFromDateTime(item.end_time),
      status_display: this.getStatusDisplay(item),
      status_class: this.getStatusClass(item)
    })
  },

  // ============ 加载使用记录 ============
  loadUsages(isFirst, silent = false) {
    const userId = this.data.currentStudentId || (wx.getStorageSync('userInfo') || {}).userId || ''
    if (!userId) {
      this.setData({ isLoading: false, usageHistory: [], usageHasMore: false })
      return Promise.resolve()
    }

    const page = isFirst ? 1 : this.data.usagePage
    if (isFirst) {
      if (!silent) this.setData({ isLoading: true })
      this.setData({ usagePage: 1 })
    } else {
      this.setData({ isLoadingMore: true })
    }

    return db.collection('device_usage')
      .where(this.buildUsageWhere(userId, this.data.usageFilter))
      .orderBy('create_time', 'desc')
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()
      .then(res => {
        const rows = (res.data || []).map(item => this.processUsage(item))
        const hasMore = (res.data || []).length === PAGE_SIZE
        this.setData({
          usageHistory: isFirst ? rows : this.data.usageHistory.concat(rows),
          usagePage: page + 1,
          usageHasMore: hasMore,
          isLoading: false,
          isLoadingMore: false
        })
      })
      .catch(err => {
        console.error('加载使用记录失败:', err)
        if (!silent) {
          wx.showToast({ title: '加载失败', icon: 'none' })
        }
        this.setData({ isLoading: false, isLoadingMore: false })
      })
  },

  buildUsageWhere(userId, filter) {
    const _ = db.command
    const base = { user_id: userId }
    switch (filter) {
      case 'completed':
        return Object.assign({}, base, { status: 'completed' })
      case 'abnormal':
        return Object.assign({}, base, { status: 'abnormal' })
      default: // all
        return Object.assign({}, base, { status: _.in(['completed', 'abnormal']) })
    }
  },

  processUsage(item) {
    const usageDate = this.getDateFromDateTime(item.start_time)
    const usagePeriod = `${this.getTimeFromDateTime(item.start_time)} - ${this.getTimeFromDateTime(item.end_time)}`
    const isAbnormal = item.status === 'abnormal'
    return Object.assign({}, item, {
      formatted_start_time: this.formatTime(item.start_time),
      formatted_end_time: this.formatTime(item.end_time),
      formatted_create_time: this.formatTime(item.create_time),
      usage_date_display: usageDate,
      usage_period_display: usagePeriod,
      status_display: isAbnormal ? '异常' : '已完成',
      status_class: isAbnormal ? 'abnormal' : 'completed'
    })
  },

  // ============ 详情 ============
  // 预约记录 → 详情页（reserve-detail 内已做归属校验）
  viewReservationDetail(e) {
    const index = e.currentTarget.dataset.index
    const r = this.data.reservationHistory[index]
    if (!r || !r._id) return
    wx.navigateTo({
      url: `/pages/reserve-detail/reserve-detail?id=${r._id}`
    })
  },

  // 使用记录 → 详情页（有 reserve_id 时），无关联预约时降级为弹窗
  viewUsageDetail(e) {
    const index = e.currentTarget.dataset.index
    const u = this.data.usageHistory[index]
    if (!u) return
    if (u.reserve_id) {
      wx.navigateTo({
        url: `/pages/reserve-detail/reserve-detail?id=${u.reserve_id}`
      })
      return
    }
    this.showUsageModal(u)
  },

  showUsageModal(u) {
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

  // ============ 状态映射 ============
  getStatusDisplay(item) {
    if (!item) return ''
    if (item.status === 'approved') {
      const us = item.usage_status
      if (us === 'active' || us === 'completed' || us === 'abnormal') return '已生效'
      return '待开始'
    }
    const statusMap = {
      pending: '待审核',
      rejected: '已拒绝',
      completed: '已完成',
      cancelled: '已取消'
    }
    return statusMap[item.status] || item.status || '未知'
  },

  getStatusClass(item) {
    if (!item) return ''
    if (item.status === 'approved') {
      const us = item.usage_status
      if (us === 'active' || us === 'completed' || us === 'abnormal') return 'effective'
      return 'upcoming'
    }
    return item.status || ''
  },

  // ============ 时间工具 ============
  getTimeFromDateTime(dateTimeStr) {
    if (!dateTimeStr) return '--:--'
    if (dateTimeStr.includes(' ')) return dateTimeStr.split(' ')[1]
    if (dateTimeStr.includes('T')) {
      const timePart = dateTimeStr.split('T')[1]
      if (timePart) return timePart.substring(0, 5)
    }
    if (dateTimeStr.includes(':')) return dateTimeStr
    try {
      const date = new Date(dateTimeStr)
      if (!isNaN(date.getTime())) {
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        return `${hours}:${minutes}`
      }
    } catch (err) {
      // ignore
    }
    return '--:--'
  },

  getDateFromDateTime(dateTimeStr) {
    if (!dateTimeStr) return '--'
    if (dateTimeStr.includes(' ')) return dateTimeStr.split(' ')[0]
    if (dateTimeStr.includes('T')) return dateTimeStr.split('T')[0]
    try {
      const date = new Date(dateTimeStr)
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }
    } catch (err) {
      // ignore
    }
    return '--'
  },

  formatTime(time) {
    if (!time) return '未记录'
    try {
      const date = new Date(time)
      if (isNaN(date.getTime())) return time
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
    Promise.resolve(this.loadActiveTab(true)).finally(() => {
      wx.stopPullDownRefresh()
    })
  }
})
