const datetime = require('../../utils/datetime.js')

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
    isLoadingOverview: false,
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
        overview: { pending: 0, using: 0, history: 0 },
        isLoadingOverview: false
      })
      return Promise.resolve()
    }

    this.setData({ isLoadingOverview: true })

    const reserves = db.collection('reserves')
    const usages = db.collection('device_usage')
    // end_time 是 'YYYY-MM-DD HH:mm'，同格式字符串可直接比较先后
    const now = new Date()
    const nowText = `${datetime.formatDateKey(now)} ${datetime.pad2(now.getHours())}:${datetime.pad2(now.getMinutes())}`

    return Promise.all([
      // 待开始预约 = 已通过、尚未开始使用、且预约时段还没过去（时段已过的不再算待开始）
      reserves.where({
        user_id: userInfo.userId,
        status: 'approved',
        usage_status: db.command.in(['not_started', '']),
        end_time: db.command.gte(nowText)
      }).count(),
      usages.where({ user_id: userInfo.userId, status: 'using' }).count(),
      usages.where({ user_id: userInfo.userId, status: 'completed' }).count()
    ]).then((results) => {
      this.setData({
        overview: {
          pending: (results[0] && results[0].total) || 0,
          using: (results[1] && results[1].total) || 0,
          history: (results[2] && results[2].total) || 0
        },
        isLoadingOverview: false
      })
    }).catch((err) => {
      console.error('加载使用概览失败:', err)
      this.setData({ isLoadingOverview: false })
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
  },

  // 跳转到仪器列表（首页已有入口，这里保留给"使用提示"里的链接）
  navigateToDeviceList() {
    wx.navigateTo({
      url: '/pages/device/list/devicelist'
    })
  }
})
