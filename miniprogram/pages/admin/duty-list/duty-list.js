// pages/admin/duty-list/duty-list.js
const cloudFile = require('../../../utils/cloudFile.js')
const datetime = require('../../../utils/datetime.js')

// 与管理端一致：教师和管理员才能看这份记录（里面有全站同学的姓名和手机号）
const ALLOWED_ROLES = ['teacher', 'admin']
const PAGE_SIZE = 10
const MAX_RECORDS = 1000
const FETCH_PAGE_SIZE = 200
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const SEARCH_DELAY = 180

const DATE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '近 7 天' }
]

Page({
  data: {
    isChecking: true,
    forbidden: false,
    isLoading: false,
    hasError: false,
    keyword: '',
    dateFilter: 'all',
    dateFilters: DATE_FILTERS,
    totalCount: 0,
    matchedCount: 0,
    visibleRecords: [],
    hasMore: false,
    isFetchingMore: false,
    skeletonRows: [0, 1, 2]
  },

  // ==================== 生命周期 ====================

  onLoad() {
    // 原始记录、过滤结果、已渲染条数都放实例上，避免整表进 setData
    this.records = []
    this.filtered = []
    this.renderedCount = 0
    this.isRendering = false
    this.searchTimer = null
    this.bootstrap()
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
  },

  async onPullDownRefresh() {
    try {
      await this.bootstrap()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onReachBottom() {
    this.loadMore()
  },

  // ==================== 身份校验 ====================

  async bootstrap() {
    this.setData({
      isChecking: true,
      forbidden: false,
      hasError: false
    })

    const gate = await this.checkAdmin()
    if (gate === 'forbidden') {
      this.setData({ isChecking: false, forbidden: true })
      return
    }
    if (gate === 'error') {
      this.setData({ isChecking: false, hasError: true })
      return
    }

    this.setData({ isChecking: false })
    await this.loadRecords()
  },

  /** 返回 'ok' | 'forbidden' | 'error' */
  async checkAdmin() {
    const adminInfo = wx.getStorageSync('adminInfo') || {}
    const userId = String(adminInfo.userId || '').trim()
    if (!userId) return 'forbidden'

    try {
      const db = wx.cloud.database()
      const res = await db.collection('users')
        .where({ user_id: userId, role: db.command.in(ALLOWED_ROLES) })
        .limit(1)
        .get()
      return (res.data || []).length ? 'ok' : 'forbidden'
    } catch (err) {
      console.error('[duty-list] 校验管理员身份失败', err)
      return 'error'
    }
  },

  // ==================== 数据加载 ====================

  async loadRecords() {
    this.setData({ isLoading: true, hasError: false })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getCollectionData',
        data: {
          collectionName: 'duty_records',
          whereCondition: {},
          pageSize: FETCH_PAGE_SIZE,
          startSkip: 0,
          sortField: 'submit_time'
        }
      })

      const result = (res && res.result) || {}
      if (result.code !== 0) {
        throw new Error(result.message || result.msg || '加载失败')
      }

      this.records = (result.data || [])
        .slice(0, MAX_RECORDS)
        .map(item => this.normalizeRecord(item))
      this.setData({ isLoading: false })
      await this.refreshFilter()
    } catch (err) {
      console.error('[duty-list] 加载卫生打卡记录失败', err)
      this.setData({ isLoading: false, hasError: true })
    }
  },

  normalizeRecord(item) {
    const images = Array.isArray(item.images) ? item.images : []
    const name = item.name || '未知用户'
    return {
      id: item._id || '',
      name,
      avatarText: name.slice(0, 1),
      phone: item.phone || '',
      labName: item.lab_name || item.device_room || '未填写实验室',
      room: item.lab_name && item.device_room ? item.device_room : '',
      remark: item.remark || '',
      images,
      imageUrls: [],
      timeText: datetime.formatMoment(item.submit_time),
      dateKey: datetime.formatDateKey(item.submit_time),
      submitTime: item.submit_time || ''
    }
  },

  // ==================== 筛选与分页 ====================

  async refreshFilter() {
    this.applyFilter()
    this.setData({ visibleRecords: [] })
    this.renderedCount = 0
    await this.renderNextPage()
  },

  applyFilter() {
    const keyword = this.data.keyword.trim().toLowerCase()
    const dateFilter = this.data.dateFilter
    const todayKey = datetime.formatDateKey(new Date())

    this.filtered = this.records.filter((item) => {
      if (dateFilter === 'today' && item.dateKey !== todayKey) return false
      if (dateFilter === 'week' && !datetime.isWithinDays(item.submitTime, 7)) return false
      if (!keyword) return true
      return [item.name, item.labName, item.phone, item.remark]
        .some(text => String(text || '').toLowerCase().indexOf(keyword) !== -1)
    })

    this.setData({
      totalCount: this.records.length,
      matchedCount: this.filtered.length
    })
  },

  /** 只渲染下一页：只为这一页的照片换临时链接，记录多了也不会卡 */
  async renderNextPage() {
    if (this.isRendering) return
    this.isRendering = true
    try {
      const start = this.renderedCount
      const nextCount = Math.min(start + PAGE_SIZE, this.filtered.length)

      if (nextCount <= start) {
        this.setData({ hasMore: false })
        return
      }

      const page = await this.resolveImages(this.filtered.slice(start, nextCount))
      this.renderedCount = nextCount
      this.setData({
        visibleRecords: this.data.visibleRecords.concat(page),
        hasMore: nextCount < this.filtered.length
      })
    } catch (err) {
      console.error('[duty-list] 渲染记录失败', err)
    } finally {
      this.isRendering = false
    }
  },

  async loadMore() {
    if (this.data.isLoading || this.data.isChecking || this.data.isFetchingMore) return
    if (!this.data.hasMore) return
    this.setData({ isFetchingMore: true })
    try {
      await this.renderNextPage()
    } finally {
      this.setData({ isFetchingMore: false })
    }
  },

  async resolveImages(items) {
    const fileIds = []
    items.forEach(item => fileIds.push(...item.images))

    let urlMap = {}
    try {
      urlMap = await cloudFile.resolveTempUrls(fileIds)
    } catch (err) {
      // 换链接失败不阻塞记录展示，照片留空
      console.error('[duty-list] 换取图片临时链接失败', err)
    }

    return items.map((item) => {
      const imageUrls = item.images
        .map(id => cloudFile.resolveSingle(id, urlMap))
        .filter(Boolean)
      return { ...item, imageUrls }
    })
  },

  // ==================== 交互 ====================

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => {
      this.refreshFilter()
    }, SEARCH_DELAY)
  },

  onClearKeyword() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    if (!this.data.keyword) return
    this.setData({ keyword: '' })
    this.refreshFilter()
  },

  onDateFilter(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.dateFilter) return
    this.setData({ dateFilter: key })
    this.refreshFilter()
  },

  onRetry() {
    this.bootstrap()
  },

  onRefresh() {
    this.bootstrap()
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/index/index' })
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.url
    const urls = e.currentTarget.dataset.urls || []
    if (!current || !urls.length) return
    wx.previewImage({ current, urls })
  },

  onCall(e) {
    const phone = e.currentTarget.dataset.phone
    if (!PHONE_PATTERN.test(String(phone || ''))) {
      wx.showToast({ title: '号码格式有误', icon: 'none' })
      return
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail() {}
    })
  }
})
