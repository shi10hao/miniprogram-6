const db = wx.cloud.database()

Page({
  data: {
    username: '',
    password: '',
    isLogging: false
  },
  //
  onUsernameInput(e) {
    this.setData({
      username: e.detail.value
    })
  },
  //
  onPasswordInput(e) {
    this.setData({
      password: e.detail.value
    })
  },
  //
  async adminLogin() {
    if (this.data.isLogging) return
  
    const username = this.data.username.trim()
    const password = this.data.password.trim()
  
    if (!username) {
      wx.showToast({ title: '请输入账号', icon: 'none' })
      return
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
  
    this.setData({ isLogging: true })
  
    try {
      const res = await wx.cloud.callFunction({
        name: 'loginAdmin',
        data: { user_id: username, password }
      })
  
      const { code, msg, data } = res.result
      console.log("res:",res)
      if (code !== 0) {
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
  
      // 获取 openid 并保存
      try {
        const openidRes = await wx.cloud.callFunction({ name: 'getOpenId' })
        const openid = openidRes.result.openid
        if (openid) {
          await db.collection('users').where({ user_id: data.userId }).update({
            data: { wx_openid: openid }
          })
        }
      } catch (err) {
        console.error('保存 openid 失败:', err)
      }
  
      // 存缓存
      wx.setStorageSync('adminInfo', {
        userId: data.userId,
        name: data.name || '管理员',
        role: data.role,
        groupName: data.group_name || '',
        loginTime: new Date().toISOString()
      })
  
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/admin/admin' })
      }, 600)
  
    } catch (err) {
      console.error('管理端登录失败:', err)
      wx.showToast({ title: '登录失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isLogging: false })
    }
  },
  //
  backToStudentAuth() {
    wx.reLaunch({
      url: '/pages/auth/auth'
    })
  }
})