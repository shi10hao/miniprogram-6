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
    allGroupTotal: 0,
    pageSize: 15,
    currentPage: 1,
    displayedGroups: [],
    hasMore: false,
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
      abnormal: 0, // 新增
      total: 0
    },
    isLoadingReserves: false,
    // 新增仪器弹窗控制
    showDeviceForm: false,
    isSubmittingDevice: false,
    // 新增仪器表单数据
    deviceForm: {
      device_name: '',
      lab_name: '',
      device_room: '',
      device_type: 'large',
      lab_type: 'public',
      instances: [{
        device_id: ''
      }],
      picture: '',
      operation_procedure: '',
      precautions: '',
      specificationsText: ''
    },
    // 卫生记录
    dutyRecords: [],
    isLoadingDuty: false,
    dutyPage: 1,
    dutyPageSize: 20,
    hasMoreDuty: true
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
        if (!this.data.displayedGroups || this.data.displayedGroups.length === 0) {
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
  requestSubscribeMessage() {
    wx.requestSubscribeMessage({
      tmplIds: ['rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY'],
      success: (res) => {
        if (res['rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY'] === 'accept') {
          console.log('管理员已同意接收订阅消息')
        } else {
          console.log('管理员拒绝了订阅消息')
        }
      },
      fail: (err) => {
        console.error('订阅授权失败:', err)
      }
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

  // 加载更多仪器分组
  async loadMoreDevices() {
    const {
      currentPage,
      pageSize,
      filters
    } = this.data

    try {
      const devicesCondition = this.buildVisibleDeviceCondition(this.currentSession)
      const keyword = filters.searchKeyword?.toLowerCase().trim() || ''

      const res = await wx.cloud.callFunction({
        name: 'getAdminGroups',
        data: {
          labCondition: devicesCondition.labCondition || null,
          deviceType: devicesCondition.deviceType || null,
          keyword,
          pageSize,
          pageNum: currentPage + 1
        }
      })

      if (res.result.code !== 0) {
        throw new Error(res.result.message || '加载失败')
      }

      const {
        groups,
        hasMore
      } = res.result.data

      this.setData({
        displayedGroups: this.data.displayedGroups.concat(groups || []),
        currentPage: currentPage + 1,
        hasMore
      })
    } catch (err) {
      console.error('加载更多失败:', err)
      wx.showToast({
        title: '加载更多失败',
        icon: 'none'
      })
    }
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
      if (filters.labType === 'all') {
        result.labCondition = null
      } else if (filters.labType === 'public') {
        result.labCondition = {
          lab_type: 'public'
        }
      } else if (filters.labType === 'group') {
        result.labCondition = {
          lab_type: 'group'
        }
      }
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
    pageSize = 100,
    sortField = ''
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
          pageSize,
          sortField // 透传排序字段
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
    console.log("all:", all)
    return all
  },

  // getDeviceModel(device) {
  //   const specs = (device && device.specifications) || {}
  //   if (specs && typeof specs === 'object') {
  //     return String(specs['型号'] || specs.model || device.model || '').trim()
  //   }
  //   return String((device && device.model) || '').trim()
  // },

  // buildGroupKey(device) {
  //   return [
  //     String(device.device_name || ''),
  //     String(device.lab_name || ''),
  //     String(device.device_type || ''),
  //     this.getDeviceModel(device)
  //   ].join('||')
  // },

  // compareGroups(a, b) {
  //   return [
  //     String(a.device_name || '').localeCompare(String(b.device_name || '')),
  //     String(a.lab_name || '').localeCompare(String(b.lab_name || '')),
  //     String(a.device_type || '').localeCompare(String(b.device_type || '')),
  //     String(a.model || '').localeCompare(String(b.model || ''))
  //   ].find(v => v !== 0) || 0
  // },

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
      const devicesCondition = this.buildVisibleDeviceCondition(this.currentSession)
      const keyword = this.data.filters.searchKeyword?.toLowerCase().trim() || ''
      const pageSize = this.data.pageSize

      wx.showLoading({
        title: '加载中...'
      })
      const res = await wx.cloud.callFunction({
        name: 'getAdminGroups',
        data: {
          labCondition: devicesCondition.labCondition || null,
          deviceType: devicesCondition.deviceType || null,
          keyword,
          pageSize,
          pageNum: 1
        }
      })
      wx.hideLoading()

      if (res.result.code !== 0) {
        throw new Error(res.result.message || '加载失败')
      }

      const {
        groups,
        total,
        hasMore
      } = res.result.data

      this.setData({
        displayedGroups: groups || [],
        allGroupTotal: total,
        currentPage: 1,
        hasMore,
        isLoadingDevices: false
      })
      console.log("displayedGroups:", this.data.displayedGroups)
    } catch (err) {
      wx.hideLoading()
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
  async loadDutyRecords() {
    if (!this.currentSession) return

    this.setData({
      isLoadingDuty: true,
      dutyPage: 1
    })
    try {
      const records = await this.fetchAllByCloud('duty_records', {}, this.data.dutyPageSize, 'submit_time')
      const formatted = records.map(item => ({
        ...item,
        submit_time_display: this.formatTime(item.submit_time)
      }))
      this.setData({
        dutyRecords: formatted,
        hasMoreDuty: records.length === this.data.dutyPageSize,
        isLoadingDuty: false
      })
    } catch (err) {
      console.error('加载卫生记录失败', err)
      this.setData({
        isLoadingDuty: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },
  async loadMoreDuty() {
    if (this.data.isLoadingDuty || !this.data.hasMoreDuty) return
    this.setData({
      isLoadingDuty: true
    })
    const nextPage = this.data.dutyPage + 1
    try {
      const skip = (nextPage - 1) * this.data.dutyPageSize
      const res = await wx.cloud.callFunction({
        name: 'getCollectionData',
        data: {
          collectionName: 'duty_records',
          whereCondition: {},
          pageSize: this.data.dutyPageSize,
          startSkip: startSkip, // 改这里：skip → startSkip
          sortField: 'submit_time' // 补上排序，保证下一页顺序一致
        }
      })

      if (res.result.code !== 0) throw new Error(res.result.message)
      const newRecords = res.result.data.map(item => ({
        ...item,
        submit_time_display: this.formatTime(item.submit_time)
      }))
      this.setData({
        dutyRecords: this.data.dutyRecords.concat(newRecords),
        dutyPage: nextPage,
        hasMoreDuty: newRecords.length === this.data.dutyPageSize,
        isLoadingDuty: false
      })
    } catch (err) {
      console.error('加载更多失败:', err)
      this.setData({
        isLoadingDuty: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },
  // 预览卫生照片
  previewDutyImage(e) {
    const current = e.currentTarget.dataset.src
    const urls = e.currentTarget.dataset.list
    wx.previewImage({
      current,
      urls
    })
  },
  switchTab(e) {
    const tab = Number(e.currentTarget.dataset.tab)
    this.setData({
      activeTab: tab
    })
    if (tab === 0) this.loadDeviceStatus()
    if (tab === 1) this.loadReserveSummary()
    if (tab === 2) this.loadSentMessages()
    if (tab === 3) this.loadDutyRecords()
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
    const rawKeyword = String(this.data.filters.searchKeyword || '').trim()
    // 如果关键词是设备名的一部分 → 按名称搜到的 → 不传
    // 否则 → 按房间号/编号搜到的 → 传过去过滤
    const keyword = (rawKeyword && deviceName.toLowerCase().includes(rawKeyword.toLowerCase())) ? '' : rawKeyword

    const url = `/pages/admin/device-detail/admindevicedetail?deviceName=${encodeURIComponent(deviceName)}&labName=${encodeURIComponent(labName)}&deviceType=${encodeURIComponent(deviceType)}&model=${encodeURIComponent(model)}&groupKey=${encodeURIComponent(groupKey)}&keyword=${encodeURIComponent(keyword)}`
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
        abnormal: 0, // 新增
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
        } else if (displayStatus === 'abnormal') { // 新增
          stats.abnormal++
        }
        // 计算时间显示（支持跨天）
        var timeDisplay = ''
        if (item.start_time && item.end_time) {
          var startDateOnly = this.formatDateOnly(item.start_time)
          var endDateOnly = this.formatDateOnly(item.end_time)
          var isCrossDay = startDateOnly && endDateOnly && startDateOnly !== endDateOnly

          if (isCrossDay) {
            // 跨天：2026-07-10 19:00 - 07-18 19:30
            var pad = function (n) {
              return String(n).padStart(2, '0')
            }
            var startD = this.parseDateTime(item.start_time)
            var endD = this.parseDateTime(item.end_time)
            if (startD && endD) {
              var startTime = pad(startD.getHours()) + ':' + pad(startD.getMinutes())
              var endDisplay = pad(endD.getMonth() + 1) + '-' + pad(endD.getDate()) + ' ' + pad(endD.getHours()) + ':' + pad(endD.getMinutes())
              timeDisplay = item.reserve_date + ' ' + startTime + ' - ' + endDisplay
            } else {
              timeDisplay = item.reserve_date + ' ' + this.getTimePart(item.start_time) + '-' + this.getTimePart(item.end_time)
            }
          } else {
            // 同天：2026-07-10 19:00 - 19:30
            timeDisplay = item.reserve_date + ' ' + this.getTimePart(item.start_time) + '-' + this.getTimePart(item.end_time)
          }
        }

        return {
          ...item,
          displayStatus,
          displayStatusText,
          timeDisplay: timeDisplay
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
  formatDateOnly(isoStr) {
    if (!isoStr) return ''
    var d = this.parseDateTime(isoStr)
    if (!d) return ''
    var pad = function (n) {
      return String(n).padStart(2, '0')
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
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
    // 新增：优先判断异常状态
    if (item.usage_status === 'abnormal') {
      return {
        displayStatus: 'abnormal',
        displayStatusText: '异常'
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
  },

  gotoUpcoming() {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=upcoming'
    })
  },

  gotoUsing() {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=using'
    })
  },

  gotoCompleted() {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=completed'
    })
  },

  gotoAll() {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=all'
    })
  },

  gotoReserveDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/reserve-detail/reserve-detail?id=${id}`
    })
  },

  // 打开新增仪器弹窗
  openAddDeviceModal() {
    this.setData({
      showDeviceForm: true,
      isSubmittingDevice: false,
      deviceForm: {
        device_name: '',
        lab_name: '',
        device_room: '',
        device_type: 'large',
        lab_type: 'public',
        instances: [{
          device_id: ''
        }],
        picture: '',
        operation_procedure: '',
        precautions: '',
        specificationsText: ''
      }
    })
  },

  // 关闭新增仪器弹窗
  closeDeviceForm() {
    this.setData({
      showDeviceForm: false
    })
  },

  // 表单基础字段输入
  onDeviceFormInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({
      [`deviceForm.${field}`]: value
    })
  },

  selectDeviceType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({
      'deviceForm.device_type': type
    })
  },

  // 选择实验室类型
  selectLabType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({
      'deviceForm.lab_type': type
    })
  },

  // 添加一台仪器实例
  addInstance() {
    const instances = this.data.deviceForm.instances.slice()
    instances.push({
      device_id: ''
    })
    this.setData({
      'deviceForm.instances': instances
    })
  },

  // 删除一台仪器实例
  deleteInstance(e) {
    const index = e.currentTarget.dataset.index
    const instances = this.data.deviceForm.instances.slice()
    instances.splice(index, 1)
    this.setData({
      'deviceForm.instances': instances
    })
  },

  // 实例编号输入
  onInstanceInput(e) {
    const index = e.currentTarget.dataset.index
    const value = e.detail.value
    const instances = this.data.deviceForm.instances.slice()
    instances[index].device_id = value
    this.setData({
      'deviceForm.instances': instances
    })
  },

  // 选择并上传仪器图片
  chooseDevicePic() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempPath = res.tempFiles[0].tempFilePath
        wx.showLoading({
          title: '上传中...'
        })
        wx.cloud.uploadFile({
          cloudPath: `device_pics/${Date.now()}.jpg`,
          filePath: tempPath,
          success: uploadRes => {
            wx.hideLoading()
            this.setData({
              'deviceForm.picture': uploadRes.fileID
            })
          },
          fail: err => {
            wx.hideLoading()
            console.error('图片上传失败:', err)
            wx.showToast({
              title: '图片上传失败',
              icon: 'none'
            })
          }
        })
      }
    })
  },

  parseSpecs(text) {
    const specs = {}
    if (!text) return specs
    text.split('\n').forEach(line => {
      line = line.trim()
      if (!line) return
      const sepIndex = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':')
      if (sepIndex === -1) return
      const key = line.substring(0, sepIndex).trim()
      const val = line.substring(sepIndex + 1).trim()
      if (key) specs[key] = val
    })
    return specs
  },

  // 提交新增仪器组
  submitDeviceForm() {
    const form = this.data.deviceForm

    // 基础校验
    if (!form.device_name.trim()) {
      wx.showToast({
        title: '请输入仪器名称',
        icon: 'none'
      })
      return
    }
    if (!form.lab_name.trim()) {
      wx.showToast({
        title: '请输入所属实验室',
        icon: 'none'
      })
      return
    }
    if (!form.device_room.trim()) {
      wx.showToast({
        title: '请输入房间位置',
        icon: 'none'
      })
      return
    }

    // 校验设备编号
    const idList = form.instances.map(i => i.device_id.trim()).filter(Boolean)
    if (idList.length === 0) {
      wx.showToast({
        title: '请至少填写一台设备编号',
        icon: 'none'
      })
      return
    }
    if (new Set(idList).size !== idList.length) {
      wx.showToast({
        title: '设备编号不能重复',
        icon: 'none'
      })
      return
    }

    this.setData({
      isSubmittingDevice: true
    })

    // 组装提交数据------------------------------------------------重要，想要修改添加的东西，就从这里改
    const submitData = {
      device_name: form.device_name.trim(),
      lab_name: form.lab_name.trim(),
      device_room: form.device_room.trim(),
      device_type: form.device_type,
      lab_type: form.lab_type,
      device_ids: idList,
      picture: form.picture,
      operation_procedure: form.operation_procedure.trim(),
      precautions: form.precautions.trim(),
      specifications: this.parseSpecs(form.specificationsText)
    }

    // 调用云函数批量新增
    wx.cloud.callFunction({
      name: 'addDeviceGroup',
      data: submitData
    }).then(res => {
      this.setData({
        isSubmittingDevice: false
      })
      if (res.result.code === 0) {
        wx.showToast({
          title: '新增成功',
          icon: 'success'
        })
        // 延迟1.5秒再关闭弹窗+刷新，避免loading覆盖toast
        setTimeout(() => {
          this.closeDeviceForm()
          this.loadDeviceStatus()
        }, 1500)
      } else {
        wx.showToast({
          title: res.result.message || '新增失败',
          icon: 'none'
        })
        console.log("res.result.message:", res.result.message)
      }
    }).catch(err => {
      this.setData({
        isSubmittingDevice: false
      })
      console.error('新增仪器失败:', err)
      wx.showToast({
        title: '新增失败，请重试',
        icon: 'none'
      })
    })
  },

  // 删除仪器组
  deleteDeviceGroup(e) {
    const dataset = e.currentTarget.dataset
    console.log('删除按钮参数：', dataset)
    const deviceName = dataset.deviceName

    wx.showModal({
      title: '确认删除',
      content: `确定要删除「${deviceName}」该组所有仪器吗？删除后不可恢复。`,
      confirmColor: '#e74c3c',
      success: modal => {
        if (!modal.confirm) return

        wx.showLoading({
          title: '删除中...'
        })
        wx.cloud.callFunction({
          name: 'deleteDeviceGroup',
          data: {
            device_name: dataset.deviceName,
            lab_name: dataset.labName,
            device_room: dataset.deviceRoom,
            device_type: dataset.deviceType,
            model: dataset.model || ''
          }
        }).then(res => {
          wx.hideLoading()
          if (res.result.code === 0) {
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            })
            this.loadDeviceStatus() // 刷新列表
          } else {
            wx.showToast({
              title: res.result.message || '删除失败',
              icon: 'none'
            })
          }
        }).catch(err => {
          wx.hideLoading()
          console.error('删除仪器组失败:', err)
          wx.showToast({
            title: '删除失败，请重试',
            icon: 'none'
          })
        })
      }
    })
  },

  gotoAbnormal() {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=abnormal'
    })
  }
})