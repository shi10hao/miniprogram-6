Page({
  data: {
    keyword: "",
    recentList: [],
    searchList: []
  },

  onLoad() {
    this.loadRecentUsage()
  },

  /**
   * 加载本人最近使用仪器
   * 全部查询逻辑交给云函数，前端仅做交互与渲染
   */
  async loadRecentUsage() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) return

    wx.showLoading({ title: '加载中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: "getDeviceUsageList",
        data: {
          mode: "recent",
          userId: userInfo.userId
        }
      })
      this.setData({
        recentList: res.result.data
      })
    } catch (err) {
      console.error("加载最近仪器失败：", err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 输入框监听
  onInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  /**
   * 仪器名称搜索
   */
  async onSearch() {
    const kw = this.data.keyword.trim()
    if (!kw) {
      this.setData({ searchList: [] })
      return
    }
    wx.showLoading({ title: '搜索中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: "getDeviceUsageList",
        data: {
          mode: "search",
          keyword: kw
        }
      })
      console.log("getDeviceUsageLIst的res:",res)
      this.setData({
        searchList: res.result.data
      })
    } catch (err) {
      console.error("搜索仪器失败：", err)
      wx.showToast({ title: '搜索失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 点击仪器卡片，等待后续详情页开发，这里预留跳转点位
  onTapDevice(e) {
    const item = e.currentTarget.dataset.item
    console.log('点击仪器卡片：', item)
    wx.navigateTo({
      url: `/pages/communicationDetail/communicationDetail?deviceId=${item.deviceId}&deviceName=${encodeURIComponent(item.deviceName)}`
    })
  }
})