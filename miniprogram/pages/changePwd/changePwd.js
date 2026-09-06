Page({
  data: {
    newPwd: '',
    confirmPwd: '',
    errMsg: '',
    loading: false
  },

  onNewPwdInput(e) {
    this.setData({ newPwd: e.detail.value, errMsg: '' })
  },

  onConfirmPwdInput(e) {
    this.setData({ confirmPwd: e.detail.value, errMsg: '' })
  },

  async doChange() {
    const { newPwd, confirmPwd } = this.data
    if (newPwd.length < 6) {
      this.setData({ errMsg: '新密码至少6位' })
      return
    }
    if (newPwd !== confirmPwd) {
      this.setData({ errMsg: '两次密码输入不一致' })
      return
    }

    this.setData({ loading: true })
    try {
      const userInfo = wx.getStorageSync('userInfo')
      if (!userInfo || !userInfo.userId) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      const res = await wx.cloud.callFunction({
        name: 'changePassword',
        data: {
          userId: userInfo.userId,
          newPassword: newPwd
        }
      })

      if (res.result.code !== 0) {
        this.setData({ errMsg: res.result.msg })
        return
      }

      // 更新本地缓存，标记已改密
      const updated = { ...userInfo, pwd_modified: true }
      wx.setStorageSync('userInfo', updated)

      wx.showToast({
        title: '密码修改成功',
        icon: 'success',
        duration: 1500
      })

      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 1500)
    } catch (err) {
      console.error('改密失败', err)
      this.setData({ errMsg: '网络异常，请稍后重试' })
    } finally {
      this.setData({ loading: false })
    }
  }
})