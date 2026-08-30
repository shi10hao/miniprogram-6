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
    canVerify: false,
    isStudentVerified: false,
    showPrivacyModal: false,
    privacyChecked: false,
    privacyAgreed: false,
    registerForm: {
      regStudentId: '',
      regName: '',
      regPhone: '',
      regMajor: '',
      regGroup: ''
    }
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo && userInfo.userId) {
      wx.showToast({
        title: '您已登录',
        icon: 'success'
      })
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/index/index'
        })
      }, 1500)
    }

    this.setData({
      privacyChecked: false,
      privacyAgreed: false
    })
  },

  onCheckPrivacy(e) {
    this.setData({
      privacyChecked: e.detail.value.length > 0
    })
  },

  confirmPrivacy() {
    this.setData({
      showPrivacyModal: false,
      privacyAgreed: true,
      privacyChecked: true
    })
  },

  skipPrivacy() {
    this.setData({
      showPrivacyModal: false,
      privacyChecked: false
    })
  },

  onStudentIdInput(e) {
    const studentId = e.detail.value
    this.setData({
      studentId,
      canVerify: Boolean(studentId.trim() && this.data.phone.trim()),
      studentInfo: null,
      isStudentVerified: false,
      verificationStatus: ''
    })
  },

  onPhoneInput(e) {
    const phone = e.detail.value
    this.setData({
      phone,
      canVerify: Boolean(this.data.studentId.trim() && phone.trim()),
      studentInfo: null,
      isStudentVerified: false,
      verificationStatus: ''
    })
  },

  async verifyStudent() {
    if (!this.data.privacyChecked) {
      this.setData({
        showPrivacyModal: true
      })
      return
    }

    const studentId = this.data.studentId.trim()
    const phone = this.data.phone.trim()

    if (!studentId || !phone) {
      this.showError('请输入学号和手机号')
      return
    }

    const phoneRegex = /^1[3-9]\d{9}$/
    if (!phoneRegex.test(phone)) {
      this.showError('请输入11位手机号')
      return
    }

    this.setData({
      isVerifying: true
    })

    try {
      const db = wx.cloud.database()
      const res = await db.collection('users')
        .where({
          user_id: studentId,
          phone,
          role: 'student'
        })
        .get()

      if (res.data.length) {
        const info = res.data[0]
        this.setData({
          studentInfo: info,
          name: info.name,
          major: info.major,
          groupName: info.group_name,
          verificationStatus: 'success',
          isStudentVerified: true
        })
      } else {
        this.setData({
          verificationStatus: 'error',
          isStudentVerified: false
        })
      }
    } finally {
      this.setData({
        isVerifying: false
      })
    }
  },

  async submitAuth() {
    const cachedUser = wx.getStorageSync('userInfo')
    if (cachedUser && cachedUser.userId) {
      wx.showToast({
        title: '您已登录',
        icon: 'none'
      })
      return
    }

    if (!this.validateForm()) return

    const {
      studentId,
      name,
      phone,
      major,
      groupName,
      studentInfo
    } = this.data

    const wechatUserInfo = wx.getStorageSync('wechatUserInfo') || {}

    const userInfoPayload = {
      userId: studentInfo?.user_id || studentId.trim(),
      name: name.trim(),
      phone: phone.trim(),
      major: major.trim(),
      groupName: groupName.trim(),
      role: 'student',
      openid: wechatUserInfo.openid || ''
    }

    wx.setStorageSync('userInfo', userInfoPayload)
    wx.showToast({
      title: '认证成功',
      icon: 'success'
    })

    setTimeout(() => {
      wx.switchTab({
        url: '/pages/index/index'
      })
    }, 1500)
  },

  validateForm() {
    const {
      studentId,
      phone,
      isStudentVerified
    } = this.data
    if (!studentId.trim()) return this.showError('请输入学号'), false
    if (!phone.trim()) return this.showError('请输入手机号'), false
    if (!isStudentVerified) return this.showError('请先完成验证'), false
    return true
  },

  showError(msg) {
    wx.showToast({
      title: msg,
      icon: 'none'
    })
  },

  navigateToAdminLogin() {
    wx.navigateTo({
      url: '/pages/admin/login/adminlogin'
    })
  },

  openPrivacyPage() {
    wx.navigateTo({
      url: '/pages/privacy/privacy'
    })
  },

  openAgreementPage() {
    wx.navigateTo({
      url: '/pages/agreement/agreement'
    })
  },

  async onRegisterSubmit() {
    const {
      registerForm
    } = this.data
    const {
      regStudentId,
      regName,
      regPhone,
      regMajor,
      regGroup
    } = registerForm
    if (!regStudentId.trim()) return this.showError('请填写学号')
    if (!regName.trim()) return this.showError('请填写姓名')
    if (!regPhone.trim()) return this.showError('请填写手机号')
    const phoneReg = /^1[3-9]\d{9}$/
    if (!phoneReg.test(regPhone)) return this.showError('手机号格式错误')
    if (!regMajor.trim()) return this.showError('请填写专业')
    const db = wx.cloud.database()
    // 订阅是否通过申请的通知
    let subscribeAccepted = false
    try {
      // 弹出订阅授权框
      const subRes = await wx.requestSubscribeMessage({
        tmplIds: ['你的审核通知模板ID']
      })
      // 判断该模板用户是否允许
      if (subRes['你的审核通知模板ID'] === 'accept') {
        subscribeAccepted = true
      }
    } catch (err) {
      console.log('订阅消息弹窗结果', err)
    }
    // 提交到待处理申请数据表中
    try {
      await db.collection('user_apply').add({
        data: {
          user_id: regStudentId.trim(),
          name: regName.trim(),
          phone: regPhone.trim(),
          major: regMajor.trim(),
          group_name: regGroup.trim(),
          role: 'student',
          status: 'pending',
          create_time: db.serverDate()
        }
      })
      wx.showToast({
        title: '提交成功，请等待管理员审核',
        icon: 'success',
        duration: 2000
      })
      this.setData({
        showRigisterModal: false,
        registerForm: {
          regStudentId: '',
          regName: '',
          regPhone: '',
          regMajor: '',
          regGroup: ''
        }
      })
    } catch (err) {
      console.error('注册申请失败', err)
      this.showError('提交失败，请稍后重试')
    }
  },

  openRegisterModal() {
    this.setData({
      showRigisterModal: true
    })
  },
  onRegisterCancel() {
    this.setData({
      showRigisterModal: false
    })
  },
  onRegStudentIdInput(e) {
    this.setData({
      "registerForm.regStudentId": e.detail.value
    })
  },
  onRegNameInput(e) {
    this.setData({
      "registerForm.regName": e.detail.value
    })
  },
  onRegPhoneInput(e) {
    this.setData({
      "registerForm.regPhone": e.detail.value
    })
  },
  onRegMajorInput(e) {
    this.setData({
      "registerForm.regMajor": e.detail.value
    })
  },
  onRegGroupInput(e) {
    this.setData({
      "registerForm.regGroup": e.detail.value
    })
  }
})