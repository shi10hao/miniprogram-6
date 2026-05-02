Page({
  data: {
    studentId: '',
    name: '',
    phone: '',
    major: '',
    groupName: '',
    isVerifying: false,
    studentInfo: null,
    verificationStatus: '',
    showWechatModal: false,
    canVerify: false,
    isStudentVerified: false
  },

  onLoad() {
    this.checkWechatLogin()
  },

  checkWechatLogin() {
    const wechatUserInfo = wx.getStorageSync('wechatUserInfo')
    const userInfo = wx.getStorageSync('userInfo')
    const hasWechatLogin = Boolean(wechatUserInfo && wechatUserInfo.openid)

    if (userInfo && hasWechatLogin) {
      wx.switchTab({ url: '/pages/index/index' })
      return
    }

    if (!hasWechatLogin) {
      this.setData({ showWechatModal: true })
    }
  },

  stopPropagation() {
    // 阻止点击弹窗内容时触发遮罩层关闭。
  },

  closeModal() {
    // 身份认证前不允许手动关闭微信登录弹窗。
  },

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
          this.setData({ showWechatModal: false })
          wx.hideLoading()
          wx.showToast({
            title: '微信登录成功',
            icon: 'success'
          })
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

  onStudentIdInput(e) {
    const studentId = e.detail.value
    const canVerify = Boolean(studentId.trim() && this.data.phone.trim())
    this.setData({
      studentId,
      canVerify,
      studentInfo: null,
      name: '',
      major: '',
      groupName: '',
      verificationStatus: '',
      isStudentVerified: false
    })
  },

  onPhoneInput(e) {
    const phone = e.detail.value
    const canVerify = Boolean(this.data.studentId.trim() && phone.trim())
    this.setData({
      phone,
      canVerify,
      studentInfo: null,
      name: '',
      major: '',
      groupName: '',
      verificationStatus: '',
      isStudentVerified: false
    })
  },

  async verifyStudent() {
    const studentId = this.data.studentId.trim()
    const phone = this.data.phone.trim()

    if (!studentId || !phone) {
      this.showError('请先输入学号和手机号')
      return
    }

    const phoneRegex = /^1[3-9]\d{9}$/
    if (!phoneRegex.test(phone)) {
      this.showError('请输入11位手机号')
      return
    }

    this.setData({
      isVerifying: true,
      verificationStatus: ''
    })

    try {
      const db = wx.cloud.database()
      const result = await db.collection('users')
        .where({
          user_id:"X42214037" ,
          phone:"18134687512",
          role: "student"
        })
        .get()
        console.log(studentId,phone)
        console.log(result)
      if (result.data && result.data.length > 0) {
        const studentInfo = result.data[0]
        this.setData({
          studentInfo,
          name: studentInfo.name || '',
          major: studentInfo.major || '',
          groupName: studentInfo.group_name || '',
          verificationStatus: 'success',
          isStudentVerified: true
        })
        wx.showToast({
          title: '学号和手机号验证成功',
          icon: 'success'
        })
      } else {
        this.setData({
          studentInfo: null,
          name: '',
          major: '',
          groupName: '',
          verificationStatus: 'error',
          isStudentVerified: false
        })
        wx.showToast({
          title: '学号或手机号不匹配',
          icon: 'none'
        })
      }
    } catch (error) {
      console.error('验证失败:', error)
      this.setData({
        studentInfo: null,
        name: '',
        major: '',
        groupName: '',
        verificationStatus: 'error',
        isStudentVerified: false
      })
      wx.showToast({
        title: '验证失败，请稍后再试',
        icon: 'none'
      })
    } finally {
      this.setData({ isVerifying: false })
    }
  },

  async submitAuth() {
    const { studentId, name, phone, major, groupName, studentInfo } = this.data

    if (!this.validateForm()) {
      return
    }

    const wechatUserInfo = wx.getStorageSync('wechatUserInfo') || {}
    if (!wechatUserInfo.openid) {
      this.showError('请先完成微信登录')
      this.setData({ showWechatModal: true })
      return
    }

    const userInfo = {
      userId: (studentInfo && studentInfo.user_id) || studentId.trim(),
      name: name.trim(),
      phone: phone.trim(),
      major: major.trim(),
      groupName: groupName.trim(),
      role: 'student',
      openid: wechatUserInfo.openid
    }

    try {
      wx.setStorageSync('userInfo', userInfo)
      wx.showToast({
        title: '认证成功',
        icon: 'success',
        duration: 2000
      })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 2000)
    } catch (error) {
      console.error('保存用户信息失败:', error)
      wx.showToast({
        title: '认证失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  validateForm() {
    const { studentId, phone, studentInfo, isStudentVerified } = this.data

    if (!studentId.trim()) {
      this.showError('请输入学号')
      return false
    }

    if (!phone.trim()) {
      this.showError('请输入手机号')
      return false
    }

    const phoneRegex = /^1[3-9]\d{9}$/
    if (!phoneRegex.test(phone.trim())) {
      this.showError('请输入11位手机号')
      return false
    }

    if (!isStudentVerified || !studentInfo) {
      this.showError('请先完成学号和手机号验证')
      return false
    }

    return true
  },

  showError(message) {
    wx.showToast({
      title: message,
      icon: 'none',
      duration: 2000
    })
  },

  navigateToAdminLogin() {
    wx.navigateTo({ url: '/pages/admin/login/adminlogin' })
  }
})
