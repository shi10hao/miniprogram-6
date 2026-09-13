const db = wx.cloud.database()

const PHOTO_REMINDER_TYPES = ['usage_photo_remind', 'usage_end_remind']
const BANNER_REMINDER_TYPES = ['reservation_remind', 'usage_photo_remind', 'usage_end_remind']
const NOTICE_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'
Page({
  data: {
    commonDevices: [],
    latestNotices: [],
    isLoading: true,
    isAuthenticated: false,
    currentGroupName: '',
    unreadReminder: null,
    subMsgCount: 0, // ← 新增这行
  },

  onLoad() {
    this._authPromptShown = false
    this.checkAuthStatus()
  },

  onShow() {
    this.checkAuthStatus()
    getApp().refreshMessageBadge()
    this.loadSubMsgCount() // ← 新增这行
  },

  //
  checkAuthStatus() {
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

      if (userInfo) {
        this.setData({
          isAuthenticated: true,
          currentGroupName: String(userInfo.groupName || '').trim()
        })
        this.getCommonDevices()
        this.getLatestNotices()
        this.loadUnreadReminder()
      } else {
        // 不跳登录！不跳登录！
        this.setData({
          isAuthenticated: false,
          unreadReminder: null
        })
        // 加载公开数据（仪器、公告）
        this.getCommonDevices()
        this.getLatestNotices()
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
    // 加载用户剩余订阅消息次数
    async loadSubMsgCount() {
      if (!this.data.isAuthenticated) {
        this.setData({
          subMsgCount: 0
        })
        return
      }
  
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
    const visibilityCondition = groupName ?
      _.or([{
        lab_type: 'public'
      }, {
        lab_name: groupName
      }]) : {
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
      .then(res => {
        const groupedDevices = {};
        (res.data || []).forEach(device => {
          const specs = device.specifications || {}
          const model = specs && typeof specs === 'object' ?
            (specs['型号'] || specs.model || '') :
            ''
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

        this.setData({
          commonDevices: Object.values(groupedDevices).slice(0, 3),
          isLoading: false,
          currentGroupName: groupName
        })
      })
      .catch(err => {
        // console.error('获取常用仪器失败:', err)
        this.setData({
          isLoading: false,
          commonDevices: [],
          currentGroupName: groupName
        })
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
      .then(res => {
        const formattedList = (res.data || []).map(item => ({
          ...item,
          publish_date: this.formatDate(item.publish_date)
        }))
        this.setData({
          latestNotices: formattedList
        })
      })
      .catch(err => {
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
      .then(res => {
        const item = res.data && res.data.length > 0 ? res.data[0] : null
        this.setData({
          unreadReminder: item ? this.normalizeReminder(item) : null
        })
        return item
      })
      .catch(err => {
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
    const deviceId = e && e.currentTarget && e.currentTarget.dataset ?
      e.currentTarget.dataset.deviceid :
      ''
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
        url: `/pages/notice/detail/noticedetail?noticeId=${noticeId}`,
        fail(err) {
          // console.error('跳转公告详情失败:', err)
        }
      })
    }
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
      success: res => {
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