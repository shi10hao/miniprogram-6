const registerTempleID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'
Page({
  data: {
    // 登录表单
    studentId: '',
    password: '',

    // 登录状态
    isVerifying: false,
    canSubmit: false,
    loginErrMsg: '',

    // 隐私协议
    showPrivacyModal: false,
    privacyChecked: false,
    privacyAgreed: false,

    // 注册弹窗
    showRegisterModal: false,
    submitting: false,
    registerForm: {
      regStudentId: '',
      regName: '',
      regPhone: '',
      regMajor: '',
      regGroup: ''
    },

    // 初始密码提示
    showPwdTipModal: false,
    tempLoginInfo: null
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

  // ==================== 输入监听 ====================
  onStudentIdInput(e) {
    this.updateSubmitState(e.detail.value, this.data.password)
  },

  onPwdInput(e) {
    this.updateSubmitState(this.data.studentId, e.detail.value)
  },

  /** 统一更新提交按钮状态 */
  updateSubmitState(studentId, password) {
    this.setData({
      studentId: studentId,
      password: password,
      canSubmit: Boolean(studentId.trim() && password.trim()),
      loginErrMsg: ''
    })
  },

  // ==================== 隐私协议 ====================
  onCheckPrivacy(e) {
    this.setData({
      privacyChecked: e.detail.value.length > 0
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

  // ==================== 登录 ====================
  async doLogin() {
    if (!this.data.privacyChecked) {
      this.setData({
        showPrivacyModal: true
      })
      return
    }
    const {
      studentId,
      password
    } = this.data
    if (!studentId.trim() || !password.trim()) {
      return this.showError("请填写学号和密码")
    }
    this.setData({
      isVerifying: true,
      loginErrMsg: ""
    })
    try {
      const res = await wx.cloud.callFunction({
        name: "loginUser",
        data: {
          user_id: studentId.trim(),
          password: password.trim()
        }
      })
      const ret = res.result
      if (ret.code !== 0) {
        this.setData({
          loginErrMsg: ret.msg
        })
        return
      }
      //登录成功，存储本地userInfo，不再存phone
      const userPayload = ret.data
      wx.setStorageSync('userInfo', {
        userId: userPayload.userId,
        name: userPayload.name,
        groupName: userPayload.group_name,
        major: userPayload.major,
        role: userPayload.role
      })
      //检测是否初始未改密码，弹出提示
      if (userPayload.pwd_modified === false) {
        this.setData({
          tempLoginInfo: userPayload,
          showPwdTipModal: true
        })
      } else {
        wx.showToast({
          title: "登录成功",
          icon: "success"
        })
        this.loginSuccessNavigate()
      }
    } catch (err) {
      console.error("登录异常", err)
      this.setData({
        loginErrMsg: "登录失败，请稍后重试"
      })
    } finally {
      this.setData({
        isVerifying: false
      })
    }
  },

  /** 登录成功跳转 */
  loginSuccessNavigate() {
    wx.showToast({
      title: '登录成功',
      icon: 'success'
    })
    setTimeout(() => {
      wx.switchTab({
        url: '/pages/index/index'
      })
    }, 1200)
  },

  // ==================== 初始密码提示弹窗 ====================
  goChangePwd() {
    this.setData({
      showPwdTipModal: false
    })
    wx.navigateTo({
      url: '/pages/changePwd/changePwd'
    })
  },

  closePwdTip() {
    this.setData({
      showPwdTipModal: false
    })
    this.loginSuccessNavigate()
  },

  // ==================== 注册 ====================
  openRegisterModal() {
    this.setData({
      showRegisterModal: true
    })
  },

  onRegisterCancel() {
    this.setData({
      showRegisterModal: false
    })
  },

  onRegStudentIdInput(e) {
    this.setData({
      'registerForm.regStudentId': e.detail.value
    })
  },

  onRegNameInput(e) {
    this.setData({
      'registerForm.regName': e.detail.value
    })
  },

  onRegPhoneInput(e) {
    this.setData({
      'registerForm.regPhone': e.detail.value
    })
  },

  onRegMajorInput(e) {
    this.setData({
      'registerForm.regMajor': e.detail.value
    })
  },

  onRegGroupInput(e) {
    this.setData({
      'registerForm.regGroup': e.detail.value
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

  async onRegisterSubmit() {
    // 防重复点击
    if (this.data.submitting) return
    this.setData({
      submitting: true
    })

    const {
      regStudentId,
      regName,
      regPhone,
      regMajor
    } = this.data.registerForm

    // 前端校验
    if (!regStudentId.trim()) {
      this.setData({
        submitting: false
      })
      return this.showError('请填写学号')
    }
    if (!regName.trim()) {
      this.setData({
        submitting: false
      })
      return this.showError('请填写姓名')
    }
    if (!regPhone.trim()) {
      this.setData({
        submitting: false
      })
      return this.showError('请填写手机号')
    }
    const phoneReg = /^1[3-9]\d{9}$/
    if (!phoneReg.test(regPhone)) {
      this.setData({
        submitting: false
      })
      return this.showError('手机号格式错误')
    }
    if (!regMajor.trim()) {
      this.setData({
        submitting: false
      })
      return this.showError('请填写专业')
    }

    let subscribeStatus = 'reject' // 默认未授权
    try {
      const subRes = await wx.requestSubscribeMessage({
        tmplIds: [registerTempleID]
      })
      if (subRes[registerTempleID] === 'accept') {
        subscribeStatus = 'accept'
        console.log('用户已订阅审核通知')
      }
    } catch (err) {
      console.log('订阅消息弹窗结果', err)
    }
    // ========== 改动结束 ==========

    // 查重 + 提交
    try {
      const db = wx.cloud.database()
      const studentId = regStudentId.trim()

      const {
        total
      } = await db.collection('user_apply')
        .where({
          user_id: studentId,
          status: db.command.in(['pending', 'approved'])
        })
        .count()

      if (total > 0) {
        this.setData({
          submitting: false
        })
        return this.showError('该学号已提交过申请，请勿重复提交')
      }

      // 拿到新增记录的 _id
      const addRes = await db.collection('user_apply').add({
        data: {
          user_id: studentId,
          name: regName.trim(),
          phone: regPhone.trim(),
          major: regMajor.trim(),
          group_name: this.data.registerForm.regGroup.trim(),
          role: 'student',
          status: 'pending',
          subscribe_status: subscribeStatus,
          create_time: db.serverDate()
        }
      })

      // 通知管理员（异步，失败不影响用户端注册结果）
      if (addRes && addRes._id) {
        wx.cloud.callFunction({
          name: 'notifyAdminNewApply',
          data: {
            applyId: addRes._id
          }
        }).then(res => {
          console.log('通知管理员结果:', res.result)
        }).catch(err => {
          console.error('通知管理员失败:', err)
        })
      }

      wx.showToast({
        title: '提交成功，请等待管理员审核',
        icon: 'success',
        duration: 2000
      })
      this.setData({
        showRegisterModal: false,
        submitting: false,
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
      this.setData({
        submitting: false
      })
      this.showError('提交失败，请稍后重试')
    }
  },


  // ==================== 其他 ====================
  navigateToAdminLogin() {
    wx.navigateTo({
      url: '/pages/admin/login/adminlogin'
    })
  },

  showError(msg) {
    wx.showToast({
      title: msg,
      icon: 'none'
    })
  },
})