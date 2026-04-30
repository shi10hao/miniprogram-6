const db = wx.cloud.database()

Page({
  data: {
    username: '',
    password: '',
    isLogging: false
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  adminLogin() {
    if (this.data.isLogging) return

    const username = String(this.data.username || '').trim()
    const password = String(this.data.password || '').trim()

    if (!username) {
      wx.showToast({ title: '请输入账号', icon: 'none' })
      return
    }

    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }

    this.setData({ isLogging: true })

    db.collection('users')
      .where({
        user_id: username,
        role: db.command.in(['teacher', 'admin'])
      })
      .limit(1)
      .get()
      .then(res => {
        const userInfo = (res.data || [])[0]
        if (!userInfo) {
          wx.showToast({ title: '账号不存在或无权限', icon: 'none' })
          return
        }

        const phone = String(userInfo.phone || '').trim()
        if (password !== phone) {
          wx.showToast({ title: '密码错误', icon: 'none' })
          return
        }

        wx.setStorageSync('adminInfo', {
          userId: userInfo.user_id,
          name: userInfo.name || '管理员',
          role: userInfo.role,
          groupName: userInfo.group_name || '',
          loginTime: new Date().toISOString()
        })

        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/admin/admin' })
        }, 600)
      })
      .catch(err => {
        console.error('管理端登录失败:', err)
        wx.showToast({ title: '登录失败，请重试', icon: 'none' })
      })
      .finally(() => {
        this.setData({ isLogging: false })
      })
  },

  backToStudentAuth() {
    wx.reLaunch({ url: '/pages/auth/auth' })
  }
})
