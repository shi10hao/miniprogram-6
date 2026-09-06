Page({
  data: {
    userId: '',
    userInfo: null,   // 查到的用户信息
    errMsg: '',
    querying: false,
    loading: false
  },

  onInput(e) {
    this.setData({ userId: e.detail.value, errMsg: '' })
    // 清空之前查询的结果
    if (this.data.userInfo) {
      this.setData({ userInfo: null })
    }
  },

  // 步骤1：查询用户
  async doQuery() {
    const userId = this.data.userId.trim()
    if (!userId) {
      this.setData({ errMsg: '请输入学号' })
      return
    }

    this.setData({ querying: true, errMsg: '' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'resetUserPassword',
        data: { action: 'query', userId }
      })

      if (res.result.code !== 0) {
        this.setData({ errMsg: res.result.msg, userInfo: null })
        return
      }

      this.setData({ userInfo: res.result.user })
    } catch (err) {
      console.error('查询失败', err)
      this.setData({ errMsg: '网络异常，请稍后重试' })
    } finally {
      this.setData({ querying: false })
    }
  },

  // 步骤2：重置密码（带二次确认）
  async doReset() {
    const { userInfo } = this.data

    const modal = await new Promise(resolve => {
      wx.showModal({
        title: '确认重置',
        content: `确定将 ${userInfo.name}（${userInfo.user_id}）的密码重置为手机号 ${userInfo.phone} 吗？`,
        success: resolve
      })
    })

    if (!modal.confirm) return

    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'resetUserPassword',
        data: { action: 'reset', userId: userInfo.user_id }
      })

      if (res.result.code !== 0) {
        this.setData({ errMsg: res.result.msg })
        return
      }

      wx.showToast({
        title: '重置成功',
        icon: 'success',
        duration: 1500
      })

      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    } catch (err) {
      console.error('重置失败', err)
      this.setData({ errMsg: '网络异常，请稍后重试' })
    } finally {
      this.setData({ loading: false })
    }
  }
})