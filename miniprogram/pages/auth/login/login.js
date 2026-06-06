Page({
  onLoad() {
    this.updateCanNavigateBack()
  },

  onShow() {
    this.updateCanNavigateBack()
  },
  //
  updateCanNavigateBack() {
    this.canNavigateBack = getCurrentPages().length > 1
  },
  //
  stopPropagation() {
    // 阻止点击弹窗内容时触发遮罩层关闭。
  },
  //
  async fetchOpenId() {
    const res = await wx.cloud.callFunction({
      name: 'getOpenId'
    })
    const openid = res && res.result && res.result.openid
    if (!openid) {
      throw new Error('未获取到 openid')
    }
    return openid
  },
  //
  getLoginErrorMessage(error) {
    const errorText = String(
      (error && (error.errMsg || error.message)) || error || ''
    )

    if (errorText.indexOf('Env Not Exists') !== -1 || errorText.indexOf('INVALID_ENV') !== -1) {
      return '当前云环境未绑定，请先在开发者工具切换正确云环境'
    }
    if (errorText.indexOf('FunctionName') !== -1 || errorText.indexOf('getOpenId') !== -1) {
      return '缺少 getOpenId 云函数，请先上传并部署'
    }

    return '获取账号标识失败，请稍后重试'
  },
  //
  onWechatLogin() {
    wx.showLoading({ title: '正在登录' })
    wx.login({
      success: async () => {
        try {
          const openid = await this.fetchOpenId()
          wx.setStorageSync('wechatUserInfo', {
            openid,
            wechatLoginTime: new Date().toISOString()
          })
          wx.hideLoading()
          wx.showToast({
            title: '微信登录成功',
            icon: 'success',
            duration: 1500
          })
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/auth/auth' })
          }, 1500)
        } catch (error) {
          console.error('微信登录后获取 openid 失败:', error)
          wx.hideLoading()
          wx.showToast({
            title: this.getLoginErrorMessage(error),
            icon: 'none'
          })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({
          title: '登录失败，请稍后重试',
          icon: 'none'
        })
      }
    })
  },
  //
  handleBack() {
    if (this.canNavigateBack) {
      wx.navigateBack()
      return
    }

    wx.showToast({
      title: '请先完成微信登录',
      icon: 'none'
    })
  }
})
