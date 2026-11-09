/**
 * 设备实例详情
 *
 * 从仪器列表（管理端）点某个实例进来，看这台实例的身份信息、今日占用情况和近期使用/预约。
 * 数据整理全部交给 lib/instanceDetailModel.js，本文件只负责取数、状态切换和 setData。
 */

const model = require('./lib/instanceDetailModel')

const db = wx.cloud.database()
/** 使用记录 / 预约都只取最近若干条，够看，也不会一次拉太多 */
const USAGE_LIMIT = 20
const RESERVE_LIMIT = 20
const RECENT_USAGE_LIMIT = 6
const UPCOMING_RESERVE_LIMIT = 5

Page({
  // 2. data
  data: {
    deviceId: '',
    isLoading: true,
    loadError: false,
    notFound: false,
    partialError: false,
    deviceView: null,
    timeline: null,
    recentUsages: [],
    upcomingReserves: [],
    sectionCollapsed: {
      timeline: false,
      usage: false,
      reserve: false
    }
  },

  // 3. 生命周期
  onLoad(options) {
    const deviceId = this.decodeDeviceId(options)
    if (!deviceId) {
      this.setData({ isLoading: false, notFound: true })
      return
    }
    this.setData({ deviceId })
    this.loadData()
  },

  onPullDownRefresh() {
    if (!this.data.deviceId) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadData()
  },

  // ==================== 数据加载 ====================
  /** 入口用 encodeURIComponent 拼参数，这里要还原 */
  decodeDeviceId(options) {
    const raw = options && options.deviceId ? String(options.deviceId) : ''
    if (!raw) return ''
    try {
      return decodeURIComponent(raw)
    } catch (err) {
      console.error('[设备实例详情] deviceId 解码失败，按原值使用', err)
      return raw
    }
  },

  async loadData() {
    const deviceId = this.data.deviceId
    if (!deviceId) return
    // 下拉刷新和重试可能并发，用序号丢弃过期结果
    const token = (this.loadToken || 0) + 1
    this.loadToken = token
    // 只有首次进入才铺骨架；已经有内容时刷新保持原样，别闪一下白屏
    if (!this.data.deviceView) {
      this.setData({ isLoading: true, loadError: false })
    }

    try {
      const results = await Promise.all([
        this.fetchDevice(deviceId),
        this.fetchUsages(deviceId),
        this.fetchReserves(deviceId)
      ])
      if (token !== this.loadToken) return
      this.render(results[0], results[1], results[2])
    } catch (err) {
      if (token !== this.loadToken) return
      console.error('[设备实例详情] 加载失败', err)
      // 已有内容时只提示，不把整页换成错误页
      if (this.data.deviceView) {
        wx.showToast({ title: '刷新失败，稍后再试', icon: 'none' })
      } else {
        this.setData({ isLoading: false, loadError: true })
      }
    } finally {
      if (token === this.loadToken) wx.stopPullDownRefresh()
    }
  },

  async fetchDevice(deviceId) {
    const res = await db.collection('devices').where({ device_id: deviceId }).limit(1).get()
    return (res.data && res.data[0]) || null
  },

  /** 使用记录取不到时只降级这一块，不整页报错 */
  async fetchUsages(deviceId) {
    try {
      const res = await db.collection('device_usage')
        .where({ device_id: deviceId })
        .orderBy('start_time', 'desc')
        .limit(USAGE_LIMIT)
        .get()
      return { list: res.data || [], failed: false }
    } catch (err) {
      console.error('[设备实例详情] 使用记录查询失败', err)
      return { list: [], failed: true }
    }
  },

  /**
   * 预约按开始时间倒序取：未来的时间点最大，能被限量的 20 条覆盖到；
   * 若用正序，历史预约会先占满名额，后续预约反而是空的。
   */
  async fetchReserves(deviceId) {
    try {
      const res = await db.collection('reserves')
        .where({ device_id: deviceId, status: 'approved' })
        .orderBy('start_time', 'desc')
        .limit(RESERVE_LIMIT)
        .get()
      return { list: res.data || [], failed: false }
    } catch (err) {
      console.error('[设备实例详情] 预约记录查询失败', err)
      return { list: [], failed: true }
    }
  },

  // ==================== 渲染 ====================
  render(device, usageResult, reserveResult) {
    if (!device) {
      this.setData({
        isLoading: false,
        loadError: false,
        notFound: true,
        partialError: false,
        deviceView: null,
        timeline: null,
        recentUsages: [],
        upcomingReserves: []
      })
      return
    }

    const nowTs = Date.now()
    const usages = usageResult.list || []
    const reserves = reserveResult.list || []
    const partialError = !!(usageResult.failed || reserveResult.failed)
    const deviceView = model.buildDeviceView(device, model.findActiveUsage(usages, nowTs), nowTs)

    this.setData({
      isLoading: false,
      loadError: false,
      notFound: false,
      partialError,
      deviceView,
      timeline: model.buildTodayTimeline({ usages, reserves, nowTs }),
      recentUsages: model.buildRecentUsageViews(usages, nowTs, RECENT_USAGE_LIMIT),
      upcomingReserves: model.buildUpcomingReserveViews(reserves, usages, nowTs, UPCOMING_RESERVE_LIMIT)
    })

    if (deviceView.deviceName) {
      wx.setNavigationBarTitle({ title: deviceView.deviceName })
    }
    if (partialError) {
      wx.showToast({ title: '部分记录加载失败', icon: 'none' })
    }
  },

  // ==================== 交互 ====================
  retryLoad() {
    if (!this.data.deviceId) return
    this.loadData()
  },

  toggleSection(event) {
    const key = event && event.currentTarget ? event.currentTarget.dataset.key : ''
    if (!key) return
    const collapsed = this.data.sectionCollapsed
    if (!(key in collapsed)) return
    this.setData({ [`sectionCollapsed.${key}`]: !collapsed[key] })
  }
})
