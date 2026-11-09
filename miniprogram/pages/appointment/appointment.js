// pages/appointment/appointment.js
const datetime = require('../../utils/datetime.js')
const reserveFilter = require('../../utils/reserveFilter.js')

const db = wx.cloud.database()
const PAGE_SIZE = 20

// 预约的状态筛选：待开始 / 已过期 都只包含「尚未开始使用」的预约
const RESERVATION_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'upcoming', label: '待开始' },
  { key: 'expired', label: '已过期' },
  { key: 'effective', label: '已生效' },
  { key: 'cancelled', label: '已取消' }
]

const USAGE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'completed', label: '已完成' },
  { key: 'abnormal', label: '异常' }
]

const RESERVATION_EMPTY_TEXT = {
  all: '暂无预约记录',
  upcoming: '暂无待开始的预约',
  expired: '暂无已过期的预约',
  effective: '暂无已生效的预约',
  cancelled: '暂无已取消的预约'
}

const USAGE_EMPTY_TEXT = {
  all: '暂无使用记录',
  completed: '暂无已完成记录',
  abnormal: '暂无异常使用记录'
}

const RESERVATION_STATUS_TEXT = {
  pending: '待审核',
  rejected: '已拒绝',
  cancelled: '已取消',
  completed: '已完成'
}

const USAGE_STATUS_TEXT = {
  abnormal: '异常',
  completed: '已完成',
  using: '使用中'
}

Page({
  data: {
    activeTab: 'reservation', // reservation | usage
    reservationFilter: 'all',
    usageFilter: 'all',
    reservationFilters: RESERVATION_FILTERS,
    usageFilters: USAGE_FILTERS,
    reservationHistory: [],
    usageHistory: [],
    isLoading: true,
    isLoadingMore: false,
    reservationHasMore: false,
    usageHasMore: false,
    reservationPage: 1,
    usagePage: 1,
    currentStudentId: '',
    needLogin: false,
    // 正在提交取消的预约 id，用来禁用按钮防止连点
    cancellingId: '',
    reservationEmptyText: RESERVATION_EMPTY_TEXT.all,
    usageEmptyText: USAGE_EMPTY_TEXT.all
  },

  // ============ 生命周期 ============
  onLoad(options) {
    // 首次进入，onShow 紧跟着触发时跳过重复加载
    this._firstShow = true
    // 请求序号：切换筛选/标签后，旧请求回来的结果直接丢弃
    this._reservationSeq = 0
    this._usageSeq = 0

    // 从「我的」页数据概览跳入时，带上目标视图
    const view = (options && options.view) || ''
    const patch = {}
    if (view === 'upcoming') {
      patch.activeTab = 'reservation'
      patch.reservationFilter = 'upcoming'
      patch.reservationEmptyText = RESERVATION_EMPTY_TEXT.upcoming
    } else if (view === 'history') {
      // 概览里的「历史记录」只统计已完成，进来也停在这个筛选上
      patch.activeTab = 'usage'
      patch.usageFilter = 'completed'
      patch.usageEmptyText = USAGE_EMPTY_TEXT.completed
    }
    if (Object.keys(patch).length) this.setData(patch)

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

  async onPullDownRefresh() {
    try {
      await this.loadActiveTab(true, true)
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // ============ 登录态 ============
  getCurrentStudentId() {
    let userId = ''
    try {
      const userInfo = wx.getStorageSync('userInfo') || {}
      userId = String(userInfo.userId || '').trim()
    } catch (err) {
      userId = ''
    }
    this.setData({ currentStudentId: userId, needLogin: !userId })
    return userId
  },

  resolveUserId() {
    if (this.data.currentStudentId) return this.data.currentStudentId
    return this.getCurrentStudentId()
  },

  // ============ 交互 ============
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.loadActiveTab(true)
  },

  switchReservationFilter(e) {
    const filter = e.currentTarget.dataset.filter
    if (!filter || filter === this.data.reservationFilter) return
    this.setData({
      reservationFilter: filter,
      reservationEmptyText: RESERVATION_EMPTY_TEXT[filter] || RESERVATION_EMPTY_TEXT.all,
      reservationHistory: [],
      reservationPage: 1
    })
    this.loadReservations(true)
  },

  switchUsageFilter(e) {
    const filter = e.currentTarget.dataset.filter
    if (!filter || filter === this.data.usageFilter) return
    this.setData({
      usageFilter: filter,
      usageEmptyText: USAGE_EMPTY_TEXT[filter] || USAGE_EMPTY_TEXT.all,
      usageHistory: [],
      usagePage: 1
    })
    this.loadUsages(true)
  },

  loadMore() {
    if (this.data.isLoading || this.data.isLoadingMore) return
    if (this.data.activeTab === 'usage') {
      if (!this.data.usageHasMore) return
      this.loadUsages(false)
      return
    }
    if (!this.data.reservationHasMore) return
    this.loadReservations(false)
  },

  loadActiveTab(isFirst, silent = false) {
    if (this.data.activeTab === 'usage') {
      return this.loadUsages(isFirst, silent)
    }
    return this.loadReservations(isFirst, silent)
  },

  // ============ 取消预约 ============
  onCancelReservation(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.cancellingId) return

    const item = (this.data.reservationHistory || []).find(row => row._id === id)
    // 列表数据可能是旧的，提交前再判一次能不能取消
    if (!item || !item.can_cancel) return

    wx.showModal({
      title: '取消预约',
      content: `确定取消「${item.device_name}」${item.reserve_date} ${item.start_time_display} - ${item.end_time_display} 的预约吗？取消后该时段会释放给其他同学。`,
      confirmText: '确认取消',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) this.cancelReservation(item)
      }
    })
  },

  async cancelReservation(item) {
    if (!item || !item._id || this.data.cancellingId) return
    this.setData({ cancellingId: item._id })

    try {
      // status 改成 cancelled 后，预约冲突校验（只查 approved）会自动释放该时段
      await db.collection('reserves').doc(item._id).update({
        data: {
          status: 'cancelled',
          cancel_time: db.serverDate()
        }
      })
      wx.showToast({ title: '已取消预约', icon: 'success' })
      // 静默重拉当前筛选：卡片在「待开始」里消失，在「已取消」里出现
      await this.loadReservations(true, true)
    } catch (err) {
      console.error('[appointment] 取消预约失败', err)
      wx.showToast({ title: '取消失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ cancellingId: '' })
    }
  },

  // ============ 加载预约记录 ============
  async loadReservations(isFirst, silent = false) {
    const userId = this.resolveUserId()
    if (!userId) {
      this.setData({
        isLoading: false,
        isLoadingMore: false,
        reservationHistory: [],
        reservationHasMore: false,
        needLogin: true
      })
      return
    }

    const seq = (this._reservationSeq || 0) + 1
    this._reservationSeq = seq
    const page = isFirst ? 1 : this.data.reservationPage
    const filter = this.data.reservationFilter

    if (isFirst) {
      if (!silent) this.setData({ isLoading: true })
    } else {
      this.setData({ isLoadingMore: true })
    }

    try {
      const res = await db.collection('reserves')
        .where(this.buildReservationWhere(userId, filter))
        .orderBy(this.getReservationSortField(filter), filter === 'upcoming' ? 'asc' : 'desc')
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .get()

      if (seq !== this._reservationSeq) return

      const rows = (res.data || []).map(item => this.processReservation(item))
      this.setData({
        reservationHistory: isFirst ? rows : this.data.reservationHistory.concat(rows),
        reservationPage: page + 1,
        reservationHasMore: (res.data || []).length === PAGE_SIZE,
        isLoading: false,
        isLoadingMore: false
      })
    } catch (err) {
      if (seq !== this._reservationSeq) return
      console.error('[appointment] 加载预约记录失败', err)
      if (!silent) wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
      this.setData({ isLoading: false, isLoadingMore: false })
    }
  },

  /** 待开始按开始时间正序（最近的一单在最前），其余按创建时间倒序 */
  getReservationSortField(filter) {
    return filter === 'upcoming' ? 'start_time' : 'create_time'
  },

  buildReservationWhere(userId, filter) {
    // 条件和「我的」页概览数字同源（utils/reserveFilter.js），否则又会对不上
    return reserveFilter.buildReservationWhere(db.command, { userId: userId, filter: filter })
  },

  processReservation(item) {
    const start = datetime.parseDateTime(item.start_time)
    const end = datetime.parseDateTime(item.end_time)
    const state = this.resolveReservationState(item, start, end)
    return Object.assign({}, item, {
      // 老数据可能没有 reserve_date，用开始时间兜底
      reserve_date: item.reserve_date || (start ? datetime.formatDateKey(start) : '--'),
      formatted_create_time: this.formatTime(item.create_time),
      start_time_display: this.formatClock(start),
      end_time_display: this.formatClock(end),
      status_display: state.label,
      status_class: state.className,
      time_hint: state.hint,
      can_cancel: state.canCancel
    })
  },

  /**
   * 预约状态：以「使用记录」为准，没有使用记录时再按预约时段判断。
   * 这样时段已过却从未开始使用的预约不会再一直显示「待开始」。
   * canCancel 只有「已通过、还没开始使用、时段还没结束」时为 true。
   */
  resolveReservationState(item, start, end) {
    if (!item) return { label: '', className: '', hint: '', canCancel: false }

    if (item.status !== 'approved') {
      return {
        label: RESERVATION_STATUS_TEXT[item.status] || item.status || '未知',
        className: item.status || '',
        hint: item.status === 'cancelled' ? '这次预约已取消，时段已释放' : '',
        canCancel: false
      }
    }

    const usageStatus = item.usage_status
    if (usageStatus === 'active') return { label: '使用中', className: 'using', hint: '', canCancel: false }
    if (usageStatus === 'completed') return { label: '已完成', className: 'completed', hint: '', canCancel: false }
    if (usageStatus === 'abnormal') return { label: '异常', className: 'abnormal', hint: '', canCancel: false }

    const now = Date.now()
    if (!start || now < start.getTime()) {
      return { label: '待开始', className: 'upcoming', hint: '', canCancel: true }
    }
    if (!end || now < end.getTime()) {
      return {
        label: '已到时段',
        className: 'ready',
        hint: '预约时段内，可去实验室开始使用',
        canCancel: true
      }
    }
    return {
      label: '已过期',
      className: 'expired',
      hint: '预约时段已过，且未开始使用',
      canCancel: false
    }
  },

  // ============ 加载使用记录 ============
  async loadUsages(isFirst, silent = false) {
    const userId = this.resolveUserId()
    if (!userId) {
      this.setData({
        isLoading: false,
        isLoadingMore: false,
        usageHistory: [],
        usageHasMore: false,
        needLogin: true
      })
      return
    }

    const seq = (this._usageSeq || 0) + 1
    this._usageSeq = seq
    const page = isFirst ? 1 : this.data.usagePage

    if (isFirst) {
      if (!silent) this.setData({ isLoading: true })
    } else {
      this.setData({ isLoadingMore: true })
    }

    try {
      const res = await db.collection('device_usage')
        .where(this.buildUsageWhere(userId, this.data.usageFilter))
        .orderBy('create_time', 'desc')
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .get()

      if (seq !== this._usageSeq) return

      const rows = (res.data || []).map(item => this.processUsage(item))
      this.setData({
        usageHistory: isFirst ? rows : this.data.usageHistory.concat(rows),
        usagePage: page + 1,
        usageHasMore: (res.data || []).length === PAGE_SIZE,
        isLoading: false,
        isLoadingMore: false
      })
    } catch (err) {
      if (seq !== this._usageSeq) return
      console.error('[appointment] 加载使用记录失败', err)
      if (!silent) wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
      this.setData({ isLoading: false, isLoadingMore: false })
    }
  },

  buildUsageWhere(userId, filter) {
    const _ = db.command
    const base = { user_id: userId }
    switch (filter) {
      case 'completed':
        return Object.assign({}, base, { status: 'completed' })
      case 'abnormal':
        return Object.assign({}, base, { status: 'abnormal' })
      default: // all：包含还在使用中的记录
        return Object.assign({}, base, { status: _.in(['completed', 'abnormal', 'using']) })
    }
  },

  processUsage(item) {
    const start = datetime.parseDateTime(item.start_time)
    const end = datetime.parseDateTime(item.end_time)
    return Object.assign({}, item, {
      formatted_start_time: this.formatTime(item.start_time),
      formatted_end_time: this.formatTime(item.end_time),
      formatted_create_time: this.formatTime(item.create_time),
      usage_date_display: start ? datetime.formatDateKey(start) : '--',
      usage_period_display: `${this.formatClock(start)} - ${this.formatClock(end)}`,
      image_count: (item.usage_images || []).length,
      status_display: USAGE_STATUS_TEXT[item.status] || '已完成',
      status_class: item.status || 'completed'
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
      '仪器：' + (u.device_name || '未知仪器'),
      '仪器编号：' + (u.device_id || '未记录'),
      '使用日期：' + (u.usage_date_display || '--'),
      '使用时段：' + (u.usage_period_display || '--'),
      '开始时间：' + u.formatted_start_time,
      '结束时间：' + u.formatted_end_time,
      '状态：' + u.status_display,
      '记录时间：' + u.formatted_create_time
    ]
    if (u.image_count > 0) {
      lines.push('上传照片：' + u.image_count + '张')
    }
    wx.showModal({
      title: '使用详情',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '确定'
    })
  },

  // ============ 时间工具 ============
  /** Date → 'HH:mm'，无效时间返回 '--:--' */
  formatClock(date) {
    if (!date) return '--:--'
    return `${datetime.pad2(date.getHours())}:${datetime.pad2(date.getMinutes())}`
  },

  /** 任意写法 → 'YYYY-MM-DD HH:mm:ss'（本地时区）。解析不出来时原样返回，避免显示成 Invalid Date */
  formatTime(value) {
    if (!value) return '未记录'
    const date = datetime.parseDateTime(value)
    if (!date) return String(value)
    return `${datetime.formatDateKey(date)} ${datetime.pad2(date.getHours())}:${datetime.pad2(date.getMinutes())}:${datetime.pad2(date.getSeconds())}`
  }
})
