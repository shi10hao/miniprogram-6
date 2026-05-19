const db = wx.cloud.database()
const _ = db.command

const ALLOWED_ROLES = ['teacher', 'admin']
const PAGE_SIZE = 100
const DEVICE_ID_CHUNK_SIZE = 50

Page({
  data: {
    activeTab: 0,
    filters: {
      labType: 'all', // all | public | group
      deviceType: 'all', // all | large | small
      searchKeyword: ''
    },
    deviceGroups: [],
    isLoadingDevices: true,
    msgTitle: '',
    msgContent: '',
    isSending: false,
    sentMessages: [],
    isLoadingMessages: false,
    adminName: '',
    showExitConfirm: false,
    recentReserves: [],
    reserveStats: {
      upcoming: 0,
      using: 0,
      completed: 0,
      total: 0
    },
    isLoadingReserves: false
  },

  onLoad() {
    wx.enableAlertBeforeUnload({
      message: '确定要退出管理端吗？'
    })
    this.bootstrapPage()
  },

  onUnload() {
    wx.disableAlertBeforeUnload()
  },

  onPullDownRefresh() {
    if (this.data.activeTab === 0) {
      this.loadDeviceStatus()
    } else if (this.data.activeTab === 1) {
      this.loadReserveSummary()
    } else if (this.data.activeTab === 2) {
      this.loadSentMessages()
    }
    wx.stopPullDownRefresh()
  },

  onShow() {
    if (this._ready) {
      if (this.data.activeTab === 0) {
        if (!this.data.deviceGroups || this.data.deviceGroups.length === 0) {
          this.loadDeviceStatus()
        }
      } else if (this.data.activeTab === 1) {
        this.loadReserveSummary()
      }
    }
  },

  onHide() {
    this.setData({
      showExitConfirm: false
    })
  },

  onLabTypeChange(e) {
    const type = e.currentTarget.dataset.type
    this.setData({
      'filters.labType': type
    }, () => {
      this.loadDeviceStatus()
    })
  },


  onDeviceTypeChange(e) {
    const type = e.currentTarget.dataset.type
    this.setData({
      'filters.deviceType': type
    }, () => {
      this.loadDeviceStatus()
    })
  },
  onSearchInput(e) {
    const keyword = e.detail.value.trim()

    this.setData({
      'filters.searchKeyword': keyword
    }, () => {
      this.loadDeviceStatus()
    })
  },
  clearSearch() {
    this.setData({
      'filters.searchKeyword': ''
    }, () => {
      this.loadDeviceStatus()
    })
  },

  confirmLogout() {
    this.setData({
      showExitConfirm: true
    })
  },

  cancelExit() {
    this.setData({
      showExitConfirm: false
    })
  },

  onBeforeLeaveExit() {
    this.setData({
      showExitConfirm: false
    })
  },

  doLogout() {
    this.setData({
      showExitConfirm: false
    })
    wx.removeStorageSync('adminInfo')
    wx.reLaunch({
      url: '/pages/admin/login/adminlogin'
    })
  },

  async bootstrapPage() {
    const session = await this.validateAdminSession()
    if (!session) return

    this.currentSession = session
    this._ready = true
    this.setData({
      adminName: session.name || '管理员'
    })
    this.loadDeviceStatus()
  },

  redirectToLogin(message) {
    wx.removeStorageSync('adminInfo')
    if (message) {
      wx.showToast({
        title: message,
        icon: 'none'
      })
    }
    setTimeout(() => {
      wx.reLaunch({
        url: '/pages/admin/login/adminlogin'
      })
    }, 400)
  },

  async validateAdminSession() {
    const localSession = wx.getStorageSync('adminInfo') || {}
    const userId = String(localSession.userId || '').trim()
    if (!userId) {
      this.redirectToLogin('请先登录')
      return null
    }

    try {
      const res = await db.collection('users')
        .where({
          user_id: userId,
          role: _.in(ALLOWED_ROLES)
        })
        .limit(1)
        .get()

      const user = (res.data || [])[0]
      if (!user || ALLOWED_ROLES.indexOf(user.role) === -1) {
        this.redirectToLogin('账号权限已失效，请重新登录')
        return null
      }

      const normalized = {
        userId: user.user_id,
        name: user.name || localSession.name || '管理员',
        role: user.role,
        groupName: user.group_name || '',
        loginTime: localSession.loginTime || new Date().toISOString()
      }

      wx.setStorageSync('adminInfo', normalized)
      return normalized
    } catch (err) {
      console.error('校验管理端会话失败:', err)
      this.redirectToLogin('登录状态校验失败，请重试')
      return null
    }
  },

  buildVisibleDeviceCondition(session) {
    if (!session) {
      return {
        deny: true
      }
    }

    const filters = this.data.filters
    const result = {
      labCondition: null,
      deviceType: null
    }

    if (session.role === 'admin') {
      result.labCondition = null
    } else if (session.role === 'teacher') {
      const groupName = String(session.groupName || '').trim()

      if (!groupName) {
        result.labCondition = {
          lab_type: 'public'
        }
      } else {
        if (filters.labType === 'all') {
          result.labCondition = _.or([{
              lab_type: 'public'
            },
            {
              lab_name: groupName
            }
          ])
        } else if (filters.labType === 'public') {
          result.labCondition = {
            lab_type: 'public'
          }
        } else if (filters.labType === 'group') {
          result.labCondition = {
            lab_name: groupName
          }
        }
      }
    } else {
      return {
        deny: true
      }
    }

    if (filters.deviceType === 'large') {
      result.deviceType = 'large'
    } else if (filters.deviceType === 'small') {
      result.deviceType = 'small'
    }

    return result
  },

  chunkArray(list, size) {
    const chunks = []
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size))
    }
    return chunks
  },

  // 替代原来的 fetchAllByWhere
  async fetchAllByCloud(
    collectionName,
    whereCondition = {},
    pageSize = 100
  ) {
    wx.showLoading({
      title: '加载中...'
    })

    // console.log('collectionName:', collectionName)
    // console.log('whereCondition:', whereCondition)

    try {
      const res = await wx.cloud.callFunction({
        name: 'getCollectionData',
        data: {
          collectionName,
          whereCondition,
          pageSize
        }
      })

      wx.hideLoading()

      if (res.result.code !== 0) {
        throw new Error(res.result.message)
      }

      return res.result.data
    } catch (err) {
      wx.hideLoading()
      console.error('云函数查询失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
      return []
    }
  },
  async fetchAllByCloud2(
    collectionName,
    whereCondition = {},
    pageSize = 100
  ) {
    wx.showLoading({
      title: '加载中...'
    })

    // console.log('collectionName:', collectionName)
    console.log('whereCondition:', whereCondition)

    try {
      const res = await wx.cloud.callFunction({
        name: 'getCollectionData2',
        data: {
          collectionName,
          whereCondition,
          pageSize
        }
      })

      wx.hideLoading()

      if (res.result.code !== 0) {
        throw new Error(res.result.message)
      }

      return res.result.data
    } catch (err) {
      wx.hideLoading()
      console.error('云函数查询失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
      return []
    }
  },
  async fetchUsingRecordsByDeviceIds(deviceIds) {
    if (!deviceIds.length) return []

    const chunks = this.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      const rows = await this.fetchAllByCloud('device_usage', {
        status: 'using',
        device_id: _.in(chunk)
      })
      all.push(...rows)
    }
    return all
  },

  getDeviceModel(device) {
    const specs = (device && device.specifications) || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs.model || device.model || '').trim()
    }
    return String((device && device.model) || '').trim()
  },

  buildGroupKey(device) {
    return [
      String(device.device_name || ''),
      String(device.lab_name || ''),
      String(device.device_type || ''),
      this.getDeviceModel(device)
    ].join('||')
  },

  compareGroups(a, b) {
    return [
      String(a.device_name || '').localeCompare(String(b.device_name || '')),
      String(a.lab_name || '').localeCompare(String(b.lab_name || '')),
      String(a.device_type || '').localeCompare(String(b.device_type || '')),
      String(a.model || '').localeCompare(String(b.model || ''))
    ].find(v => v !== 0) || 0
  },

  async loadDeviceStatus() {
    if (!this.currentSession) {
      const session = await this.validateAdminSession()
      if (!session) return
      this.currentSession = session
    }

    this.setData({
      isLoadingDevices: true
    })

    try {
      const devicesCondition =
        this.buildVisibleDeviceCondition(this.currentSession)

      console.log('【devices】condition:', devicesCondition)

      // ✅ 2️⃣ 只查 devices（只调用一次云函数）
      let allDevices = await this.fetchAllByCloud2(
        'devices',
        devicesCondition
      )
      const keyword = this.data.filters.searchKeyword?.toLowerCase().trim()

      if (keyword) {
        allDevices = allDevices.filter(device => {
          const deviceName = (device.device_name || '').toLowerCase()
          const model = (this.getDeviceModel(device) || '').toLowerCase()
          const labName = (device.lab_name || '').toLowerCase()
          const room = (device.device_room || '').toLowerCase()
          const description = (device.description || '').toLowerCase()

          return (
            deviceName.includes(keyword) ||
            model.includes(keyword) ||
            labName.includes(keyword) ||
            room.includes(keyword) ||
            description.includes(keyword)
          )
        })
      }
      const visibleDeviceIds = Array.from(
        new Set((allDevices || []).map(item => item.device_id).filter(Boolean))
      )
      const activeUsages = await this.fetchUsingRecordsByDeviceIds(visibleDeviceIds)
      const usingDeviceSet = new Set((activeUsages || []).map(item => item.device_id).filter(Boolean))

      const groupMap = {}
      allDevices.forEach(device => {
        const groupKey = this.buildGroupKey(device)
        if (!groupMap[groupKey]) {
          groupMap[groupKey] = {
            group_key: groupKey,
            device_name: device.device_name,
            device_type: device.device_type,
            lab_name: device.lab_name,
            model: this.getDeviceModel(device),
            picture: device.picture,
            available: 0,
            using: 0,
            maintenance: 0,
            total: 0
          }
        }

        const group = groupMap[groupKey]
        group.total += 1

        if (usingDeviceSet.has(device.device_id)) {
          group.using += 1
        } else if (device.status === 'maintenance') {
          group.maintenance += 1
        } else {
          group.available += 1
        }

        if (!group.picture && device.picture) {
          group.picture = device.picture
        }
      })

      const deviceGroups = Object.values(groupMap).sort((a, b) => this.compareGroups(a, b))
      this.setData({
        deviceGroups,
        isLoadingDevices: false
      })
      console.log('原始设备数:', allDevices.length)
      console.log('分组后数量:', Object.keys(groupMap).length)
    } catch (err) {
      console.error('加载仪器状态失败:', err)
      this.setData({
        isLoadingDevices: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  switchTab(e) {
    const tab = Number(e.currentTarget.dataset.tab)
    this.setData({
      activeTab: tab
    })
    if (tab === 0) this.loadDeviceStatus()
    if (tab === 1) this.loadReserveSummary()
    if (tab === 2) this.loadSentMessages()
  },

  goToReserveList() {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist'
    })
  },

  goTo3DBoard: function () {
    var role = this.currentSession ? this.currentSession.role : 'admin'
    wx.navigateTo({
      url: '/pages/webview/3dscene/scene3d?role=' + encodeURIComponent(role)
    })
  },

  goToDeviceDetail(e) {
    const deviceName = String(e.currentTarget.dataset.deviceName || '')
    const labName = String(e.currentTarget.dataset.labName || '')
    const deviceType = String(e.currentTarget.dataset.deviceType || '')
    const model = String(e.currentTarget.dataset.model || '')
    const groupKey = String(e.currentTarget.dataset.groupKey || '')

    const url = `/pages/admin/device-detail/admindevicedetail?deviceName=${encodeURIComponent(deviceName)}&labName=${encodeURIComponent(labName)}&deviceType=${encodeURIComponent(deviceType)}&model=${encodeURIComponent(model)}&groupKey=${encodeURIComponent(groupKey)}`
    wx.navigateTo({
      url
    })
  },

  onTitleInput(e) {
    this.setData({
      msgTitle: e.detail.value
    })
  },

  onContentInput(e) {
    this.setData({
      msgContent: e.detail.value
    })
  },

  sendMessage() {
    const {
      msgTitle,
      msgContent,
      adminName
    } = this.data
    const title = String(msgTitle || '').trim()
    const content = String(msgContent || '').trim()

    if (!title) {
      wx.showToast({
        title: '请填写标题',
        icon: 'none'
      })
      return
    }
    if (!content) {
      wx.showToast({
        title: '请填写内容',
        icon: 'none'
      })
      return
    }

    this.setData({
      isSending: true
    })
    const now = new Date()

    db.collection('notice')
      .add({
        data: {
          title,
          content,
          publish_date: now.toISOString(),
          notice_id: `ADMIN_${now.getTime()}`,
          type: 'admin',
          created_by: adminName || '管理员'
        }
      })
      .then(() => {
        this.setData({
          isSending: false,
          msgTitle: '',
          msgContent: ''
        })
        wx.showToast({
          title: '发布成功',
          icon: 'success'
        })
        this.loadSentMessages()
      })
      .catch(err => {
        this.setData({
          isSending: false
        })
        console.error('发布失败:', err)
        wx.showToast({
          title: '发布失败，请重试',
          icon: 'none'
        })
      })
  },

  loadSentMessages() {
    this.setData({
      isLoadingMessages: true
    })

    db.collection('notice')
      .where({
        type: 'admin'
      })
      .orderBy('publish_date', 'desc')
      .limit(20)
      .get()
      .then(res => {
        const sentMessages = (res.data || []).map(item => ({
          ...item,
          dateDisplay: this.formatTime(item.publish_date)
        }))
        this.setData({
          sentMessages,
          isLoadingMessages: false
        })
      })
      .catch(err => {
        console.error('加载通知历史失败:', err)
        this.setData({
          isLoadingMessages: false
        })
      })
  },

  formatTime(isoStr) {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (Number.isNaN(d.getTime())) return String(isoStr)

    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  async loadReserveSummary() {
    if (!this.currentSession) return

    this.setData({
      isLoadingReserves: true
    })

    try {
      const visibleCondition = this.buildVisibleDeviceCondition(this.currentSession)

      let visibleDeviceIds = null
      if (visibleCondition) {
        const devices = await this.fetchAllByCloud('devices', visibleCondition)
        visibleDeviceIds = Array.from(new Set(
          (devices || []).map(d => d.device_id).filter(Boolean)
        ))
        if (visibleDeviceIds.length === 0) {
          this.setData({
            recentReserves: [],
            reserveStats: {
              upcoming: 0,
              using: 0,
              completed: 0,
              total: 0
            },
            isLoadingReserves: false
          })
          return
        }
      }

      var reserveCondition = {
        status: 'approved'
      }
      if (visibleDeviceIds) {
        reserveCondition.device_id = _.in(visibleDeviceIds)
      }

      var allReserves = await this.fetchAllByCloud('reserves', reserveCondition)

      var activeUsages = await this.fetchAllByCloud('device_usage', {
        status: 'using'
      })
      var usingReserveIdMap = {};
      (activeUsages || []).forEach(function (u) {
        if (u.reserve_id) usingReserveIdMap[u.reserve_id] = true
      })

      var now = new Date()
      var stats = {
        upcoming: 0,
        using: 0,
        completed: 0,
        total: allReserves.length
      }

      var processed = (allReserves || []).map(item => {
        var statusInfo = this.getReserveDisplayStatus(item, usingReserveIdMap, now)
        var displayStatus = statusInfo.displayStatus
        var displayStatusText = statusInfo.displayStatusText

        if (displayStatus === 'using') {
          stats.using++
        } else if (displayStatus === 'completed') {
          stats.completed++
        } else if (displayStatus === 'upcoming') {
          stats.upcoming++
        }

        return {
          ...item,
          displayStatus,
          displayStatusText,
          start_time_display: this.getTimePart(item.start_time),
          end_time_display: this.getTimePart(item.end_time)
        }
      })

      processed.sort((a, b) => this.getDateTimeValue(b.start_time) - this.getDateTimeValue(a.start_time))

      this.setData({
        recentReserves: processed.slice(0, 10),
        reserveStats: stats,
        isLoadingReserves: false
      })
    } catch (err) {
      console.error('加载预约概览失败:', err)
      this.setData({
        isLoadingReserves: false
      })
    }
  },

  parseDateTime(dtStr) {
    if (!dtStr) return null
    if (dtStr instanceof Date) return isNaN(dtStr.getTime()) ? null : dtStr
    if (typeof dtStr === 'number') {
      var numericDate = new Date(dtStr)
      return isNaN(numericDate.getTime()) ? null : numericDate
    }

    var text = String(dtStr).trim().replace(/\//g, '-')
    var match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T-](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
    if (match) {
      var year = Number(match[1])
      var month = Number(match[2])
      var day = Number(match[3])
      var hour = Number(match[4] || 0)
      var minute = Number(match[5] || 0)
      var second = Number(match[6] || 0)
      var beijingDate = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, 0))
      return isNaN(beijingDate.getTime()) ? null : beijingDate
    }

    var d = new Date(text.replace(' ', 'T'))
    return isNaN(d.getTime()) ? null : d
  },

  resolveReserveTimestamp(reserve, field) {
    var tsKey = field + '_ts'
    var timeKey = field + '_time'
    var timestamp = Number(reserve && reserve[tsKey])
    if (isFinite(timestamp) && timestamp > 0) {
      return timestamp
    }

    var d = this.parseDateTime(reserve && reserve[timeKey])
    return d ? d.getTime() : 0
  },

  getReserveDisplayStatus(item, usingReserveIdMap, now) {
    if (!item) {
      return {
        displayStatus: 'past',
        displayStatusText: '已过期'
      }
    }

    if (item.usage_status === 'completed') {
      return {
        displayStatus: 'completed',
        displayStatusText: '已完成'
      }
    }

    if ((usingReserveIdMap && usingReserveIdMap[item._id]) || item.usage_status === 'active') {
      return {
        displayStatus: 'using',
        displayStatusText: '使用中'
      }
    }

    var startTs = this.resolveReserveTimestamp(item, 'start')
    var endTs = this.resolveReserveTimestamp(item, 'end')
    var nowTs = (now || new Date()).getTime()
    if (!startTs || !endTs) {
      return {
        displayStatus: 'past',
        displayStatusText: '已过期'
      }
    }

    if (nowTs < startTs) {
      return {
        displayStatus: 'upcoming',
        displayStatusText: '即将使用'
      }
    }

    if (nowTs >= startTs && nowTs < endTs) {
      return {
        displayStatus: 'upcoming',
        displayStatusText: '可开始使用'
      }
    }

    return {
      displayStatus: 'past',
      displayStatusText: '已过期'
    }
  },

  getTimePart(dtStr) {
    if (!dtStr) return '--:--'
    if (dtStr.indexOf(' ') !== -1) return dtStr.split(' ')[1]
    if (dtStr.indexOf('T') !== -1) {
      var timePart = dtStr.split('T')[1]
      if (timePart) return timePart.substring(0, 5)
    }
    return dtStr
  },

  getDateTimeValue(dtStr) {
    if (!dtStr) return 0
    var d = this.parseDateTime(dtStr)
    return d ? d.getTime() : 0
  }
})