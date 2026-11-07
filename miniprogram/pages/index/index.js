const db = wx.cloud.database()
const commonDeviceService = require('./commonDeviceService.js')
const {
  readSubscribeStatus,
  isSubscribed,
  buildSubscribeFailText,
  readSubMsgResult
} = require('./subscribeModel.js')

// 首页常用仪器的数量：三宫格，多一台就会换行
const COMMON_DEVICE_LIMIT = 3
// 常用仪器随使用记录变化，从别的页面返回时最多每 60 秒重算一次，避免每次切页都打云函数
const COMMON_DEVICE_REFRESH_INTERVAL = 60 * 1000

const PHOTO_REMINDER_TYPES = ['usage_photo_remind', 'usage_end_remind']
const BANNER_REMINDER_TYPES = ['reservation_remind', 'usage_photo_remind', 'usage_end_remind']
// 公告推送用的一次性订阅模板，必须和 cloudfunctions/sendNoticeSubMsg 里的常量一致
const NOTICE_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'
// 订阅次数的展示节流：切页返回时不必每次都打云函数
const SUB_MSG_REFRESH_INTERVAL = 60 * 1000

// 首页快捷入口：把原先散落在首页/应用页的重复入口收敛到一处
const QUICK_ENTRIES = [
  { key: 'device', icon: '🔬', label: '仪器设备', url: '/pages/device/list/devicelist' },
  { key: 'notice', icon: '📢', label: '公告通知', url: '/pages/notice/list/noticelist' },
  { key: 'reserve', icon: '📅', label: '我的预约', url: '/pages/appointment/appointment', needAuth: true },
  { key: 'usage', icon: '🧪', label: '仪器使用', url: '/pages/usage/usage', needAuth: true }
]

Page({
  data: {
    commonDevices: [],
    latestNotices: [],
    isLoading: true,
    isAuthenticated: false,
    currentGroupName: '',
    unreadReminder: null,
    subMsgCount: 0,
    isSubscribing: false,
    quickEntries: QUICK_ENTRIES
  },

  onLoad() {
    this._authPromptShown = false
    // 首次 checkAuthStatus 已经会拉取数据，onShow 紧接着触发时不要再拉一遍
    this._subMsgCountLoadedAt = 0
    this._commonDeviceLoadedAt = 0
    this.checkAuthStatus(true)
  },

  onShow() {
    // 从其他页面返回：只有登录态/课题组真的变了才重新拉数据
    this.checkAuthStatus()
    // 刚用过/刚约过仪器，常用仪器顺序会变，节流重算一次
    this.refreshCommonDevicesIfStale()
    getApp().refreshMessageBadge()
    this.loadSubMsgCount()
  },

  // 常用仪器按最近使用时间排序，返回首页时按 60 秒节流刷新
  refreshCommonDevicesIfStale() {
    const loadedAt = this._commonDeviceLoadedAt || 0
    if (Date.now() - loadedAt < COMMON_DEVICE_REFRESH_INTERVAL) return
    this.getCommonDevices()
  },

  /**
   * 检查登录状态
   * @param {boolean} force 是否强制重新拉取仪器/公告数据
   */
  checkAuthStatus(force) {
    if (this._checkingAuth) return
    this._checkingAuth = true
    try {
      // 新增：先检查管理员登录状态
      const adminInfo = wx.getStorageSync('adminInfo')
      if (adminInfo && adminInfo.userId) {
        setTimeout(() => {
          wx.reLaunch({
            url: '/pages/admin/admin',
            complete: () => {
              this._checkingAuth = false
            }
          })
        }, 500)
        return
      }
      const userInfo = wx.getStorageSync('userInfo')
      const isAuthenticated = !!userInfo
      const groupName = String((userInfo && userInfo.groupName) || '').trim()

      // setData 只在值真的变了时才调用，避免无意义渲染
      if (this.data.isAuthenticated !== isAuthenticated) {
        this.setData({ isAuthenticated: isAuthenticated })
      }

      const fingerprint = isAuthenticated + '|' + groupName
      const stateChanged = this._authFingerprint !== fingerprint
      this._authFingerprint = fingerprint

      if (!force && !stateChanged) {
        // 登录态没变，无需重复请求仪器与公告
        return
      }

      this.setData({ currentGroupName: groupName })
      // 登录态变了，订阅次数跟着换人，必须绕过节流重新拉
      this._subMsgCountLoadedAt = 0

      // 加载公开数据（仪器、公告）
      this.getCommonDevices()
      this.getLatestNotices()

      if (isAuthenticated) {
        this.loadUnreadReminder()
      } else if (this.data.unreadReminder) {
        this.setData({ unreadReminder: null })
      }
    } catch (err) {
      // console.error('检查认证状态失败:', err)
      this.setData({
        isAuthenticated: false,
        unreadReminder: null
      })
      this.getCommonDevices()
      this.getLatestNotices()
    } finally {
      this._checkingAuth = false
    }
  },

  // 全局开启了 enablePullDownRefresh，这里必须实现，否则下拉后要等超时才收回
  onPullDownRefresh() {
    Promise.all([
      this.getCommonDevices(),
      this.getLatestNotices(),
      this.loadUnreadReminder(),
      // 手动下拉就是要最新值，绕开 60 秒节流
      this.loadSubMsgCount(true)
    ]).then(() => {
      wx.stopPullDownRefresh()
    }).catch(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 拉取「还能收到几条公告推送」
   * 次数由云端记账：用户每点一次订阅 +1，管理员每发一条公告 -1
   * @param {boolean} force 忽略节流强制刷新（下拉刷新用）
   */
  async loadSubMsgCount(force) {
    if (!this.data.isAuthenticated) {
      this._subMsgCountLoadedAt = 0
      if (this.data.subMsgCount !== 0) {
        this.setData({ subMsgCount: 0 })
      }
      return
    }

    // 60 秒内不重复请求（onLoad 与首次 onShow 会连续触发）；
    // 时间戳只在请求成功后才写，失败不能把重试窗口一起关掉
    const now = Date.now()
    const loadedAt = this._subMsgCountLoadedAt || 0
    if (!force && loadedAt && now - loadedAt < SUB_MSG_REFRESH_INTERVAL) return

    try {
      const res = await wx.cloud.callFunction({
        name: 'getSubMsgCount'
      })
      const result = readSubMsgResult(res && res.result)
      if (!result.ok) return
      this._subMsgCountLoadedAt = Date.now()
      if (this.data.subMsgCount !== result.count) {
        this.setData({ subMsgCount: result.count })
      }
    } catch (err) {
      console.error('[index] 加载订阅消息次数失败', err)
    }
  },

  /**
   * 点订阅条：先向微信要一次下发额度，再让云端记账
   * requestSubscribeMessage 必须由用户点击同步触发，所以拿到授权前不能 await 别的请求
   */
  async onSubscribeTap() {
    if (this.data.isSubscribing) return
    if (!this.data.isAuthenticated) {
      this.showAuthPrompt()
      return
    }

    this.setData({ isSubscribing: true })
    try {
      const res = await wx.requestSubscribeMessage({
        tmplIds: [NOTICE_TMPL_ID]
      })
      // 只有 accept 才算拿到额度，errMsg 恒为 ok，判断不了用户的选择
      if (!isSubscribed(res, NOTICE_TMPL_ID)) {
        wx.showToast({
          title: buildSubscribeFailText(readSubscribeStatus(res, NOTICE_TMPL_ID)),
          icon: 'none'
        })
        return
      }

      const added = await wx.cloud.callFunction({
        name: 'addSubMsgCount',
        // 次数固定由云端 +1，客户端只告诉它订的是哪个模板
        data: { tmplId: NOTICE_TMPL_ID }
      })
      const result = readSubMsgResult(added && added.result)
      if (!result.ok) {
        wx.showToast({
          title: '订阅成功，但次数同步失败',
          icon: 'none'
        })
        return
      }

      // 记账成功后刷新节流时间戳，避免紧接着重新拉一次
      this._subMsgCountLoadedAt = Date.now()
      this.setData({ subMsgCount: result.count })
      wx.showToast({
        title: `订阅成功，可收 ${result.count} 条`,
        icon: 'success',
        duration: 2000
      })
    } catch (err) {
      console.error('[index] 订阅消息失败', err)
      wx.showToast({
        title: '订阅调用失败，请稍后重试',
        icon: 'none'
      })
    } finally {
      this.setData({ isSubscribing: false })
    }
  },

  // 常用仪器：按「我的使用记录」算最近/最常用的三台，记录不够用可预约仪器补位
  async getCommonDevices() {
    // 并发/切页时用代次丢弃过期结果，避免旧响应覆盖新响应
    const seq = (this._commonDeviceSeq || 0) + 1
    this._commonDeviceSeq = seq
    // 记一次加载时间，配合 onShow 的 60 秒节流
    this._commonDeviceLoadedAt = Date.now()
    const userInfo = wx.getStorageSync('userInfo') || {}
    const groupName = String((userInfo && userInfo.groupName) || '').trim()

    try {
      const cards = await commonDeviceService.loadCommonDevices({
        userId: userInfo && userInfo.userId,
        groupName,
        limit: COMMON_DEVICE_LIMIT
      })
      if (this._commonDeviceSeq !== seq) return
      this.setData({
        commonDevices: cards,
        isLoading: false,
        currentGroupName: groupName
      })
    } catch (err) {
      console.error('[index] 加载常用仪器失败', err)
      if (this._commonDeviceSeq !== seq) return
      this.setData({
        commonDevices: [],
        isLoading: false,
        currentGroupName: groupName
      })
    }
  },

  // 首页仪器缩略图加载失败 → 显示占位，避免反复重试刷屏
  onCommonDeviceImageError(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    this.setData({
      [`commonDevices[${index}].imgFailed`]: true
    })
  },
  //
  getLatestNotices() {
    return db.collection('notice')
      .field({
        title: true,
        publish_date: true,
        notice_id: true,
        _id: true,
        doc_url: true
      })
      .orderBy('publish_date', 'desc')
      .limit(3)
      .get()
      .then((res) => {
        const formattedList = (res.data || []).map(item => ({
          ...item,
          publish_date: this.formatDate(item.publish_date)
        }))
        this.setData({
          latestNotices: formattedList
        })
      })
      .catch((err) => {
        // console.error('获取公告列表失败:', err)
        this.setData({
          latestNotices: []
        })
      })
  },
  //
  loadUnreadReminder() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      this.setData({
        unreadReminder: null
      })
      return Promise.resolve(null)
    }

    const _ = db.command
    return db.collection('messages')
      .where({
        user_id: userInfo.userId,
        is_read: _.neq(true),
        type: _.in(BANNER_REMINDER_TYPES)
      })
      .orderBy('create_time', 'desc')
      .limit(1)
      .get()
      .then((res) => {
        const item = res.data && res.data.length > 0 ? res.data[0] : null
        this.setData({
          unreadReminder: item ? this.normalizeReminder(item) : null
        })
        return item
      })
      .catch((err) => {
        // console.error('获取首页未读提醒失败:', err)
        this.setData({
          unreadReminder: null
        })
        return null
      })
  },
  //
  normalizeReminder(item) {
    return {
      _id: item._id,
      type: item.type,
      title: item.title || '未读提醒',
      content: this.getReminderSummary(item),
      create_time: this.formatDateTime(item.create_time)
    }
  },
  //
  getReminderSummary(item) {
    if (PHOTO_REMINDER_TYPES.indexOf(item.type) !== -1) {
      return '请前往“仪器使用”页的“上传照片板块”完成照片上传。'
    }
    return this.truncateText(item.content || '', 56)
  },

  goToUnreadReminder() {
    const reminder = this.data.unreadReminder
    if (!reminder) return

    if (PHOTO_REMINDER_TYPES.indexOf(reminder.type) !== -1) {
      wx.navigateTo({
        url: '/pages/usage/usage'
      })
      return
    }

    wx.navigateTo({
      url: `/pages/message/detail/messagedetail?messageId=${reminder._id}&source=message`
    })
  },
  //
  formatDate(dateStr) {
    const date = this.parseDateValue(dateStr)
    if (!date) return dateStr || '未知日期'
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  },
  //
  formatDateTime(value) {
    const date = this.parseDateValue(value)
    if (!date) return value || ''
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },
  //
  parseDateValue(value) {
    if (!value) return null
    const text = String(value)
    const normalized = text.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/, '$1 $2').replace(' ', 'T')
    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? null : date
  },

  gotoDeviceList(e) {
    const deviceId = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.deviceid
      : ''
    let url = '/pages/device/list/devicelist'
    if (deviceId) {
      url += `?deviceId=${encodeURIComponent(deviceId)}`
    }
    wx.navigateTo({
      url,
      fail(err) {
        // console.error('跳转仪器列表失败:', err)
      }
    })
  },

  gotoNoticeList() {
    wx.navigateTo({
      url: '/pages/notice/list/noticelist',
      fail(err) {
        // console.error('跳转公告列表失败:', err)
      }
    })
  },

  gotoDeviceDetail(e) {
    const deviceId = e.currentTarget.dataset.deviceid
    if (deviceId) {
      wx.navigateTo({
        url: `/pages/device/detail/devicedetail?deviceId=${deviceId}`,
        fail(err) {
          // console.error('跳转仪器详情失败:', err)
        }
      })
    }
  },

  gotoNoticeDetail(e) {
    const noticeId = e.currentTarget.dataset.noticeid
    if (noticeId) {
      wx.navigateTo({
        // 公告与消息共用 messagedetail，用 source=notice 区分
        url: `/pages/message/detail/messagedetail?messageId=${encodeURIComponent(noticeId)}&source=notice`,
        fail(err) {
          // console.error('跳转公告详情失败:', err)
        }
      })
    }
  },

  // 快捷入口统一走这里，需要登录的入口自动拦截
  gotoQuickEntry(e) {
    const url = e.currentTarget.dataset.url
    const needAuth = e.currentTarget.dataset.needauth === true || e.currentTarget.dataset.needauth === 'true'
    if (!url) return

    if (needAuth && !this.data.isAuthenticated) {
      this.showAuthPrompt()
      return
    }

    wx.navigateTo({
      url,
      fail() {
        // 忽略重复跳转等失败
      }
    })
  },

  gotoAuth() {
    wx.navigateTo({
      url: '/pages/auth/auth'
    })
  },

  showAuthPrompt() {
    wx.showModal({
      title: '提示',
      content: '该功能需要登录后使用',
      showCancel: true,
      confirmText: '去登录',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/auth/auth'
          })
        }
      }
    })
  },
  //
  truncateText(text, maxLength) {
    const value = String(text || '')
    if (value.length <= maxLength) {
      return value
    }
    return `${value.slice(0, maxLength - 1)}…`
  }
})
