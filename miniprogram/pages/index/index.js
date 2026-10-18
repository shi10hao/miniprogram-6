const db = wx.cloud.database()
const cloudFile = require('../../utils/cloudFile.js')

const PHOTO_REMINDER_TYPES = ['usage_photo_remind', 'usage_end_remind']
const BANNER_REMINDER_TYPES = ['reservation_remind', 'usage_photo_remind', 'usage_end_remind']
const NOTICE_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'

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
    quickEntries: QUICK_ENTRIES
  },

  onLoad() {
    this._authPromptShown = false
    // 首次 checkAuthStatus 已经会拉取数据，onShow 紧接着触发时不要再拉一遍
    this._subMsgCountLoadedAt = 0
    this.checkAuthStatus(true)
  },

  onShow() {
    // 从其他页面返回：只有登录态/课题组真的变了才重新拉数据
    this.checkAuthStatus()
    getApp().refreshMessageBadge()
    this.loadSubMsgCount()
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
      this.loadUnreadReminder()
    ]).then(() => {
      wx.stopPullDownRefresh()
    }).catch(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 加载用户剩余订阅消息次数
  async loadSubMsgCount() {
    if (!this.data.isAuthenticated) {
      if (this.data.subMsgCount !== 0) {
        this.setData({
          subMsgCount: 0
        })
      }
      this._subMsgCountLoadedAt = 0
      return
    }

    // 60 秒内不重复请求（onLoad 与首次 onShow 会连续触发）
    const now = Date.now()
    if (this._subMsgCountLoadedAt && (now - this._subMsgCountLoadedAt) < 60000) {
      return
    }
    this._subMsgCountLoadedAt = now

    try {
      const res = await wx.cloud.callFunction({
        name: 'getSubMsgCount'
      })

      if (res.result && res.result.success) {
        this.setData({
          subMsgCount: res.result.count || 0
        })
      }
    } catch (err) {
      console.error('加载订阅消息次数失败', err)
    }
  },

  // 点击订阅按钮
  onSubscribeTap() {
    if (!this.data.isAuthenticated) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }

    wx.requestSubscribeMessage({
      tmplIds: [NOTICE_TMPL_ID],
      success: (res) => {
        console.log('requestSubscribeMessage res', res)

        // 用户允许了这个模板才加计数
        if (res[NOTICE_TMPL_ID] === 'accept' || res.errMsg === 'requestSubscribeMessage:ok') {
          wx.cloud.callFunction({
            name: 'addSubMsgCount',
            data: {
              tmplId: NOTICE_TMPL_ID,
              count: 1
            },
            success: (r) => {
              if (r.result && r.result.success) {
                // 订阅成功后刷新缓存时间戳，避免紧接着重新拉取
                this._subMsgCountLoadedAt = Date.now()
                this.setData({
                  subMsgCount: r.result.count || 0
                })
                wx.showToast({
                  title: `订阅成功，剩余${r.result.count || 0}次`,
                  icon: 'success',
                  duration: 2000
                })
              } else {
                wx.showToast({
                  title: '订阅记录失败',
                  icon: 'none'
                })
              }
            },
            fail: (err) => {
              console.error('addSubMsgCount 失败', err)
              wx.showToast({
                title: '订阅失败',
                icon: 'none'
              })
            }
          })
        } else {
          wx.showToast({
            title: '未授权订阅',
            icon: 'none'
          })
        }
      },
      fail: (err) => {
        console.error('requestSubscribeMessage 失败', err)
        wx.showToast({
          title: '订阅调用失败',
          icon: 'none'
        })
      }
    })
  },
  //
  getCommonDevices() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    const groupName = String(userInfo.groupName || '').trim()
    const _ = db.command
    const visibilityCondition = groupName
      ? _.or([{
          lab_type: 'public'
        }, {
          lab_name: groupName
        }])
      : {
          lab_type: 'public'
        }

    return db.collection('devices')
      .where(_.and([{
        status: 'available'
      }, visibilityCondition]))
      .field({
        device_id: true,
        device_name: true,
        picture: true,
        lab_name: true,
        device_room: true,
        specifications: true
      })
      .orderBy('device_id', 'asc')
      .get()
      .then((res) => {
        const groupedDevices = {};
        (res.data || []).forEach((device) => {
          const specs = device.specifications || {}
          const model = specs && typeof specs === 'object'
            ? (specs['型号'] || specs.model || '')
            : ''
          const key = `${device.device_name || ''}::${String(model || '').trim()}`
          if (!groupedDevices[key]) {
            groupedDevices[key] = {
              device_id: device.device_id,
              device_name: device.device_name,
              picture: device.picture,
              lab_name: device.lab_name,
              device_room: device.device_room
            }
          }
        })

        const topDevices = Object.values(groupedDevices).slice(0, 3)

        this.setData({
          commonDevices: topDevices,
          isLoading: false,
          currentGroupName: groupName
        })

        // 图片是 cloud:// fileID，必须换成临时链接再交给 <image>，
        // 否则渲染层会报 Failed to load local image resource ... 500
        return cloudFile.resolveListField(topDevices, 'picture')
          .then((resolved) => {
            if (resolved !== topDevices) {
              this.setData({ commonDevices: resolved })
            }
          })
          .catch((err) => {
            // 图片解析失败不影响列表本身
            console.error('解析常用仪器图片失败:', err)
          })
      })
      .catch((err) => {
        // console.error('获取常用仪器失败:', err)
        this.setData({
          isLoading: false,
          commonDevices: [],
          currentGroupName: groupName
        })
      })
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
