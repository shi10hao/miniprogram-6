// 经验交流：按仪器找「用过它的同学」
const AUTH_PAGE = '/pages/auth/auth'
const DETAIL_PAGE = '/pages/communicationDetail/communicationDetail'
const MAX_KEYWORD_LENGTH = 30

Page({
  data: {
    keyword: '',
    searchedKeyword: '',
    recentList: [],
    searchList: [],
    isLoggedIn: false,
    isLoadingRecent: false,
    isSearching: false,
    isSearchMode: false,
    hasRecentError: false,
    hasSearchError: false,
    skeletonRows: [0, 1, 2]
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    const isLoggedIn = Boolean(userInfo.userId)

    this.setData({ isLoggedIn })
    if (isLoggedIn) this.loadRecentUsage()
  },

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId || this.data.isLoggedIn) return

    // 从登录页返回：补一次登录态和最近仪器
    this.setData({ isLoggedIn: true })
    this.loadRecentUsage()
  },

  async onPullDownRefresh() {
    try {
      if (this.data.isLoggedIn) await this.loadRecentUsage()
      if (this.data.isSearchMode) await this.search(this.data.searchedKeyword)
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // ==================== 输入监听 ====================
  onInput(e) {
    const value = e.detail.value
    this.setData({ keyword: value })

    if (!this.data.isSearchMode || value.trim() === this.data.searchedKeyword) return

    // 关键词改了，旧结果不再对应当前输入，先收起
    this.setData({ isSearchMode: false, searchList: [], hasSearchError: false })
  },

  onClearKeyword() {
    this.setData({
      keyword: '',
      searchedKeyword: '',
      searchList: [],
      isSearchMode: false,
      hasSearchError: false
    })
  },

  // ==================== 业务动作 ====================
  /**
   * 加载本人最近用过的仪器
   */
  async loadRecentUsage() {
    if (this.data.isLoadingRecent) return

    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      this.setData({ isLoggedIn: false, recentList: [] })
      return
    }

    this.setData({ isLoadingRecent: true, hasRecentError: false })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getDeviceUsageList',
        data: { mode: 'recent', userId: userInfo.userId }
      })
      const result = (res && res.result) || {}
      if (result.code !== 0) throw new Error(result.msg || '加载失败')

      this.setData({ recentList: result.data || [] })
    } catch (err) {
      console.error('[communication] 加载最近仪器失败', err)
      this.setData({ recentList: [], hasRecentError: true })
    } finally {
      this.setData({ isLoadingRecent: false })
    }
  },

  /**
   * 点搜索按钮 / 键盘回车
   */
  async onSearch() {
    const keyword = this.data.keyword.trim().slice(0, MAX_KEYWORD_LENGTH)
    if (!keyword) {
      this.setData({ isSearchMode: false, searchList: [], hasSearchError: false })
      wx.showToast({ title: '请输入仪器名称', icon: 'none' })
      return
    }
    if (this.data.isSearching) return

    await this.search(keyword)
  },

  /**
   * 按名称搜索仪器（下拉刷新也复用这里，不弹提示）
   */
  async search(keyword) {
    const value = String(keyword || '').trim()
    if (!value) return

    this.setData({
      isSearching: true,
      isSearchMode: true,
      searchedKeyword: value,
      hasSearchError: false
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getDeviceUsageList',
        data: { mode: 'search', keyword: value }
      })
      const result = (res && res.result) || {}
      if (result.code !== 0) throw new Error(result.msg || '搜索失败')

      this.setData({ searchList: result.data || [] })
    } catch (err) {
      console.error('[communication] 搜索仪器失败', err)
      this.setData({ searchList: [], hasSearchError: true })
    } finally {
      this.setData({ isSearching: false })
    }
  },

  /**
   * 进入仪器详情，查看用过它的同学
   */
  onTapDevice(e) {
    const deviceName = String(e.currentTarget.dataset.deviceName || '').trim()
    if (!deviceName) return

    wx.navigateTo({
      url: `${DETAIL_PAGE}?deviceName=${encodeURIComponent(deviceName)}`
    })
  },

  openLogin() {
    wx.navigateTo({ url: AUTH_PAGE })
  }
})
