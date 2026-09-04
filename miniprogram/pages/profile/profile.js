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
    isAuthenticated: false
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
      } else {
        this.setData({
          isAuthenticated: false,
          adminContacts: []
        })
      }
    } catch (err) {
      // console.error('读取用户信息失败:', err)
    }
  },

  goToLogin() {
    wx.redirectTo({
      url: '/pages/auth/auth'
    })
  },

  loadAdminContacts(userGroupName) {
    const db = wx.cloud.database()
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

  navigateToFeedback() {
    if (!this.data.isAuthenticated) { this.showAuthPrompt(); return }
    wx.navigateTo({ url: '/pages/feedback/feedback' })
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