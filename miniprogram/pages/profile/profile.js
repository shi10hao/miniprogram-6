const reserveFilter = require('../../utils/reserveFilter.js')

const db = wx.cloud.database()

Page({
  data: {
    userInfo: {
      name: '未认证',
      userId: '未认证',
      major: '未认证',
      groupName: '未设置'
    },
    adminContacts: [],
    avatarText: '👤',
    isAuthenticated: false,
    // 数据概览：与工作台同源，让"我的"页不只是一堆入口
    overview: {
      pending: 0,
      using: 0,
      history: 0
    }
  },

  onLoad() {
    this._authPromptShown = false
    this.loadUserInfo()
  },

  onShow() {
    this.loadUserInfo()
    getApp().refreshMessageBadge()
  },

  // 下拉刷新：重读登录态与概览数字。消息红点自带 60 秒节流，这里不强制
  async onPullDownRefresh() {
    try {
      await this.loadUserInfo()
      getApp().refreshMessageBadge()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  /**
   * 读取本地登录态并触发概览加载
   * @returns {Promise<void>} 概览加载完成后 resolve，供下拉刷新收尾
   */
  loadUserInfo() {
    try {
      const userInfo = wx.getStorageSync('userInfo')
      const isAuth = !!(userInfo && userInfo.userId)

      if (isAuth) {
        const avatarText = userInfo.name ? userInfo.name.charAt(0) : '👤'
        this.setData({
          userInfo: {
            name: userInfo.name || '未设置',
            userId: userInfo.userId || '未设置',
            major: userInfo.major || '未设置',
            groupName: userInfo.groupName || '未设置'
          },
          avatarText: avatarText,
          isAuthenticated: true
        })
        this.loadAdminContacts(userInfo.groupName)
        return this.loadOverview(userInfo.userId)
      }

      this.setData({
        isAuthenticated: false,
        adminContacts: [],
        overview: { pending: 0, using: 0, history: 0 }
      })
    } catch (err) {
      // 本地缓存读不到时保持默认值即可，不阻塞页面渲染
      console.error('[profile] 读取用户信息失败', err)
    }

    return Promise.resolve()
  },

  /**
   * 三个概览数字：待开始预约 / 使用中 / 历史记录
   * 只取 count，不把记录全拉回来。
   * 「待开始」的条件必须和「我的预约」页的「待开始」筛选同源（utils/reserveFilter.js）：
   * 只按 status === 'approved' 数，会把已经用完的、时段早就过去的旧预约一起算进来，
   * 于是出现「只剩 1 个待开始，这里显示 69」。
   */
  loadOverview(userId) {
    if (!userId) return Promise.resolve()

    const nowText = reserveFilter.formatNowText()
    const pendingWhere = reserveFilter.buildReservationWhere(db.command, {
      userId: userId,
      filter: 'upcoming',
      nowText: nowText
    })

    return Promise.all([
      db.collection('reserves').where(pendingWhere).count(),
      db.collection('device_usage').where({ user_id: userId, status: 'using' }).count(),
      db.collection('device_usage').where({ user_id: userId, status: 'completed' }).count()
    ]).then((results) => {
      this.setData({
        overview: {
          pending: (results[0] && results[0].total) || 0,
          using: (results[1] && results[1].total) || 0,
          history: (results[2] && results[2].total) || 0
        }
      })
    }).catch((err) => {
      console.error('[profile] 加载使用概览失败', err)
    })
  },

  // 概览数字点击：待开始 → 预约记录的「待开始」；使用中 → 仪器使用页；历史 → 「已完成」
  goOverview(e) {
    const key = e.currentTarget.dataset.key
    const urlMap = {
      using: '/pages/usage/usage',
      pending: '/pages/appointment/appointment?view=upcoming',
      history: '/pages/appointment/appointment?view=history'
    }
    if (!urlMap[key]) return
    wx.navigateTo({
      url: urlMap[key],
      fail() {}
    })
  },

  goToLogin() {
    wx.redirectTo({
      url: '/pages/auth/auth'
    })
  },

  loadAdminContacts(userGroupName) {
    // db 已在文件顶部声明，这里不再重复获取，避免遮蔽外层变量
    const _ = db.command

    let whereCondition
    if (userGroupName && userGroupName !== '未设置') {
      whereCondition = _.or([
        { role: 'admin' },
        { role: 'teacher', group_name: userGroupName }
      ])
    } else {
      whereCondition = { role: 'admin' }
    }

    db.collection('users')
      .where(whereCondition)
      .limit(10)
      .get()
      .then((res) => {
        const contacts = (res.data || []).map(item => ({
          _id: item._id,
          name: item.name || '管理员',
          role: item.role || '',
          phone: item.phone || ''
        }))
        this.setData({ adminContacts: contacts })
      })
      .catch((err) => {
        // console.error('获取管理员信息失败:', err)
      })
  },

  showAuthPrompt() {
    wx.showModal({
      title: '未登录',
      content: '请先完成登录认证',
      showCancel: false,
      success: (res) => {
        if (res.confirm) {
          wx.redirectTo({
            url: '/pages/auth/auth'
          })
        }
      }
    })
  },

  // callAdmin(e) {
  //   const phone = e.currentTarget.dataset.phone
  //   if (!phone) return
  //   wx.makePhoneCall({
  //     phoneNumber: phone,
  //     fail: () => {}
  //   })
  // },

  navigateToDutyUpload() {
    if (!this.data.isAuthenticated) { this.showAuthPrompt(); return }
    wx.navigateTo({ url: '/pages/duty-upload/duty-upload' })
  },

  navigateToAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },

  navigateToAppointment() {
    if (!this.data.isAuthenticated) { this.showAuthPrompt(); return }
    wx.navigateTo({ url: '/pages/appointment/appointment' })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('userInfo')
          wx.reLaunch({ url: '/pages/index/index' })
        }
      }
    })
  },

  navigateToCommunication() {
    wx.navigateTo({
      url: '/pages/communication/communication'
    })
  }
})
