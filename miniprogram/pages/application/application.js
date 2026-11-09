const reserveFilter = require('../../utils/reserveFilter.js')

const db = wx.cloud.database()

Page({
  data: {
    isAuthenticated: false,
    // 使用概览的实时数字
    overview: {
      pending: 0,
      using: 0,
      history: 0
    },
    userName: ''
  },

  onLoad() {
    this.loadUserState()
  },

  onShow() {
    getApp().refreshMessageBadge()
    this.loadUserState()
    this.loadOverview()
  },

  // 下拉刷新：重读登录态 + 概览数字
  onPullDownRefresh() {
    this.loadUserState()
    this.loadOverview().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 读取登录态（不再重复请求用户资料，资料只在"我的"里展示）
  loadUserState() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    const isAuth = !!(userInfo && userInfo.userId)
    this.setData({
      isAuthenticated: isAuth,
      userName: userInfo.name || ''
    })
  },

  /**
   * 三个概览数字：待开始预约 / 使用中 / 历史记录
   * 用 count() 而不是把记录全拉回来，只为了显示数字。
   */
  loadOverview() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      this.setData({
        overview: { pending: 0, using: 0, history: 0 }
      })
      return Promise.resolve()
    }

    const reserves = db.collection('reserves')
    const usages = db.collection('device_usage')
    // 「待开始」的条件与「我的预约」页、「我的」页同源，见 utils/reserveFilter.js
    const pendingWhere = reserveFilter.buildReservationWhere(db.command, {
      userId: userInfo.userId,
      filter: 'upcoming'
    })

    return Promise.all([
      reserves.where(pendingWhere).count(),
      usages.where({ user_id: userInfo.userId, status: 'using' }).count(),
      usages.where({ user_id: userInfo.userId, status: 'completed' }).count()
    ]).then((results) => {
      this.setData({
        overview: {
          pending: (results[0] && results[0].total) || 0,
          using: (results[1] && results[1].total) || 0,
          history: (results[2] && results[2].total) || 0
        }
      })
    }).catch((err) => {
      console.error('[application] 加载使用概览失败', err)
    })
  },

  // 跳转到功能页面（需要登录的入口统一拦截）
  navigateToFunction(e) {
    const url = e.currentTarget.dataset.url
    const needAuth = e.currentTarget.dataset.needauth === true || e.currentTarget.dataset.needauth === 'true'
    if (!url) return

    if (needAuth && !this.data.isAuthenticated) {
      this.showAuthPrompt()
      return
    }

    wx.navigateTo({
      url: url,
      fail() {}
    })
  },

  showAuthPrompt() {
    wx.showModal({
      title: '提示',
      content: '该功能需要登录后使用',
      confirmText: '去登录',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/auth/auth' })
        }
      }
    })
  }
})
