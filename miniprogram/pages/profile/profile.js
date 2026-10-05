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
    latestFeedback: '',
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
        this.loadOverview(userInfo.userId)
      } else {
        this.setData({
          isAuthenticated: false,
          adminContacts: [],
          overview: { pending: 0, using: 0, history: 0 }
        })
      }
    } catch (err) {
      // console.error('读取用户信息失败:', err)
    }
  },

  /**
   * 三个概览数字：待开始预约 / 使用中 / 历史记录
   * 只取 count，不把记录全拉回来。字段名与工作台保持一致。
   */
  loadOverview(userId) {
    if (!userId) return Promise.resolve()

    return Promise.all([
      db.collection('reserves').where({ user_id: userId, status: 'approved' }).count(),
      db.collection('device_usage').where({ user_id: userId, status: 'using' }).count(),
      db.collection('device_usage').where({ user_id: userId, status: 'completed' }).count()
    ]).then(results => {
      this.setData({
        overview: {
          pending: (results[0] && results[0].total) || 0,
          using: (results[1] && results[1].total) || 0,
          history: (results[2] && results[2].total) || 0
        }
      })
    }).catch(err => {
      console.error('加载使用概览失败:', err)
    })
  },

  // 概览数字点击：使用中的记录跳仪器使用页，其余跳预约记录
  goOverview(e) {
    const key = e.currentTarget.dataset.key
    const url = key === 'using' ? '/pages/usage/usage' : '/pages/appointment/appointment'
    wx.navigateTo({
      url,
      fail: function() {}
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

    var whereCondition
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
      .then(res => {
        const contacts = (res.data || []).map(item => ({
          _id: item._id,
          name: item.name || '管理员',
          role: item.role || '',
          phone: item.phone || ''
        }))
        this.setData({ adminContacts: contacts })
      })
      .catch(err => {
        // console.error('获取管理员信息失败:', err)
      })
  },

  showAuthPrompt() {
    wx.showModal({
      title: '未登录',
      content: '请先完成登录认证',
      showCancel: false,
      success: res => {
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

  reAuth() {
    wx.showModal({
      title: '重新认证',
      content: '是否需要重新进行身份认证？',
      success: (res) => {
        if (res.confirm) {
          wx.redirectTo({
            url: '/pages/auth/auth'
          })
        }
      }
    })
  },

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