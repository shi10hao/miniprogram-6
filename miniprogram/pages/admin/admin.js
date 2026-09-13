/**
 * 管理端首页 admin.js
 * 
 * 功能模块：
 * ├── 页面生命周期 & 会话校验
 * ├── 仪器状态管理（Tab 0）—— 按实验室/类型/关键词筛选，分页加载
 * ├── 预约概览（Tab 1）—— 统计各状态数量，展示最近预约
 * ├── 通知发布（Tab 2）—— 管理员发布公告
 * ├── 卫生打卡记录（Tab 3）—— 分页加载，临时链接解析
 * ├── 仪器新增/删除 —— 弹窗表单，调用云函数
 * └── 工具方法 —— 时间格式化、数组分块、条件构建等
 */

const db = wx.cloud.database()
const _ = db.command

// ========== 常量定义 ==========

const ALLOWED_ROLES = ['teacher', 'admin'] // 允许进入管理端的角色
const PAGE_SIZE = 100 // 云函数单次拉取上限
const DEVICE_ID_CHUNK_SIZE = 50 // device_id 查询分片大小（in 操作符限制）

// ========== 页面实例 ==========

Page({
  // ---------- 初始数据 ----------
  data: {
    activeTab: 0, // 当前激活的 Tab 页
    filters: { // 仪器筛选条件
      labType: 'all', // all | public | group
      deviceType: 'all', // all | large | small
      searchKeyword: '' // 搜索关键词
    },
    allGroupTotal: 0, // 仪器组总数
    pageSize: 15, // 前端分页大小
    currentPage: 1, // 当前页码
    displayedGroups: [], // 当前展示的仪器组列表
    hasMore: false, // 是否还有更多数据
    isLoadingDevices: true, // 仪器列表加载状态

    // 通知发布
    msgTitle: '',
    msgContent: '',
    isSending: false,
    sentMessages: [],
    isLoadingMessages: false,
    msgDocUrl: '', // ← 新增：腾讯文档链接（可选）

    // 管理员信息
    adminName: '',

    // 退出确认弹窗
    showExitConfirm: false,

    // 预约概览
    recentReserves: [],
    reserveStats: {
      upcoming: 0,
      using: 0,
      completed: 0,
      abnormal: 0,
      total: 0
    },
    isLoadingReserves: false,

    // 新增仪器弹窗
    showDeviceForm: false,
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
    },

    // 卫生打卡
    dutyRecords: [],
    isLoadingDuty: false,
    dutyPage: 1,
    dutyPageSize: 20,
    hasMoreDuty: true,

    // 注册审批
    pendingApplyCount: 0,
  },

  // ==================== 工具方法 ====================

  /** 补零，用于时间格式化 */
  pad: function (n) {
    return String(n).padStart(2, '0')
  },

  /** 将 ISO 字符串格式化为 "YYYY-MM-DD HH:mm" */
  formatTime: function (isoStr) {
    if (!isoStr) return ''
    var d = this.parseDateTime(isoStr)
    if (!d) return String(isoStr)
    return d.getFullYear() + '-' + this.pad(d.getMonth() + 1) + '-' + this.pad(d.getDate()) + ' ' + this.pad(d.getHours()) + ':' + this.pad(d.getMinutes())
  },

  /** 仅格式化日期部分 "YYYY-MM-DD" */
  formatDateOnly: function (isoStr) {
    if (!isoStr) return ''
    var d = this.parseDateTime(isoStr)
    if (!d) return ''
    return d.getFullYear() + '-' + this.pad(d.getMonth() + 1) + '-' + this.pad(d.getDate())
  },

  /**
   * 解析多种格式的日期时间字符串为 Date 对象
   * 支持：ISO 8601、YYYY-MM-DD HH:mm、时间戳
   * 注意：小程序端需手动处理时区偏移（-8h）
   */
  parseDateTime: function (dtStr) {
    if (!dtStr) return null
    if (dtStr instanceof Date) return isNaN(dtStr.getTime()) ? null : dtStr
    if (typeof dtStr === 'number') {
      var d = new Date(dtStr)
      return isNaN(d.getTime()) ? null : d
    }
    var text = String(dtStr).trim().replace(/\//g, '-')
    var match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T-](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
    if (match) {
      var year = Number(match[1]),
        month = Number(match[2]),
        day = Number(match[3])
      var hour = match[4] ? Number(match[4]) : 0,
        minute = match[5] ? Number(match[5]) : 0,
        second = match[6] ? Number(match[6]) : 0
      return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, 0))
    }
    var d2 = new Date(text.replace(' ', 'T'))
    return isNaN(d2.getTime()) ? null : d2
  },

  /** 从日期时间字符串中提取时间部分 "HH:mm" */
  getTimePart: function (dtStr) {
    if (!dtStr) return '--:--'
    if (dtStr.indexOf(' ') !== -1) return dtStr.split(' ')[1]
    if (dtStr.indexOf('T') !== -1) {
      var timePart = dtStr.split('T')[1]
      if (timePart) return timePart.substring(0, 5)
    }
    return dtStr
  },

  /** 将日期时间转为时间戳（毫秒），用于排序比较 */
  getDateTimeValue: function (dtStr) {
    if (!dtStr) return 0
    var d = this.parseDateTime(dtStr)
    return d ? d.getTime() : 0
  },

  /** 将数组按指定大小切分为二维数组（用于分批查询） */
  chunkArray: function (list, size) {
    var chunks = []
    var i
    for (i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size))
    }
    return chunks
  },

  // ==================== 生命周期 ====================

  /** 页面加载：启用退出确认，启动会话校验 */
  onLoad: function () {
    wx.enableAlertBeforeUnload({
      message: '确定要退出管理端吗？'
    })
    this.bootstrapPage()
  },

  /** 页面卸载：关闭退出确认 */
  onUnload: function () {
    wx.disableAlertBeforeUnload()
  },

  /** 下拉刷新：根据当前 Tab 重新加载数据 */
  onPullDownRefresh: function () {
    if (this._refreshing) return
    this._refreshing = true

    var tab = this.data.activeTab
    if (tab === 0) this.loadDeviceStatus()
    else if (tab === 1) this.loadReserveSummary()
    else if (tab === 2) this.loadSentMessages()

    // 各方法完成后重置（或者在 finally 里）
    var self = this
    setTimeout(function () {
      self._refreshing = false
    }, 2000)
    wx.stopPullDownRefresh()
  },

  /** 页面显示：按需刷新数据 */
  onShow: function () {
    if (!this._ready) return
    // 自动订阅：每天最多触发一次，避免频繁弹窗
    const today = new Date().toDateString()
    const lastAutoSub = wx.getStorageSync('lastAutoSubDate')
    if (lastAutoSub !== today) {
      this.requestSubscribeMessage()
      wx.setStorageSync('lastAutoSubDate', today)
    }
    var tab = this.data.activeTab
    if (tab === 0 && (!this.data.displayedGroups || this.data.displayedGroups.length === 0)) {
      this.loadDeviceStatus()
    } else if (tab === 1) {
      this.loadReserveSummary()
    } else if (tab === 2) {
      this.loadSentMessages()
    } else if (tab === 3) {
      // 从审批页返回时，刷新红点数量
      this.loadPendingApplyCount()
    }
  },

  /** 页面隐藏：关闭退出确认弹窗 */
  onHide: function () {
    this.setData({
      showExitConfirm: false
    })
  },

  // ==================== 会话管理 ====================

  /** 初始化页面：校验管理员会话 */
  bootstrapPage: function () {
    var self = this
    self.validateAdminSession().then(function (session) {
      if (!session) return
      self.currentSession = session
      self._ready = true
      self.setData({
        adminName: session.name || '管理员'
      })
      self.loadDeviceStatus()
    })
  },

  /** 清除登录态并跳转到登录页 */
  redirectToLogin: function (message) {
    wx.removeStorageSync('adminInfo')
    if (message) wx.showToast({
      title: message,
      icon: 'none'
    })
    var self = this
    setTimeout(function () {
      wx.reLaunch({
        url: '/pages/admin/login/adminlogin'
      })
    }, 400)
  },

  /**
   * 校验管理员会话有效性
   * 1. 从本地缓存读取 userId
   * 2. 查询 users 集合确认角色权限
   * 3. 更新缓存并返回标准化会话对象
   */
  validateAdminSession: function () {
    var self = this
    return new Promise(function (resolve) {
      var localSession = wx.getStorageSync('adminInfo') || {}
      var userId = String(localSession.userId || '').trim()
      if (!userId) {
        self.redirectToLogin('请先登录')
        resolve(null)
        return
      }
      db.collection('users')
        .where({
          user_id: userId,
          role: _.in(ALLOWED_ROLES)
        })
        .limit(1)
        .get()
        .then(function (res) {
          var user = (res.data || [])[0]
          if (!user || ALLOWED_ROLES.indexOf(user.role) === -1) {
            self.redirectToLogin('账号权限已失效，请重新登录')
            resolve(null)
            return
          }
          var normalized = {
            userId: user.user_id,
            name: user.name || localSession.name || '管理员',
            role: user.role,
            groupName: user.group_name || '',
            loginTime: localSession.loginTime || new Date().toISOString()
          }
          wx.setStorageSync('adminInfo', normalized)
          resolve(normalized)
        })
        .catch(function (err) {
          console.error('校验管理端会话失败:', err)
          self.redirectToLogin('登录状态校验失败，请重试')
          resolve(null)
        })
    })
  },

  // ==================== 云函数通用封装 ====================

  /**
   * 通过云函数 getCollectionData 拉取全量数据
   * 内部自动处理分页游标，适合数据量不大的集合
   */
  fetchAllByCloud: function (collectionName, whereCondition, pageSize, sortField, startSkip) {
    var self = this
    if (pageSize === undefined) pageSize = 100
    if (startSkip === undefined) startSkip = 0
    wx.showLoading({
      title: '加载中...'
    })
    return wx.cloud.callFunction({
      name: 'getCollectionData',
      data: {
        collectionName: collectionName,
        whereCondition: whereCondition || {},
        pageSize: pageSize,
        sortField: sortField || '',
        startSkip: startSkip
      }
    }).then(function (res) {
      wx.hideLoading()
      if (res.result.code !== 0) throw new Error(res.result.message)
      return res.result.data
    }).catch(function (err) {
      wx.hideLoading()
      console.error('云函数查询失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
      return []
    })
  },

  // ==================== Tab 切换 ====================

  /** 切换 Tab 页，按需加载对应数据 */
  switchTab: function (e) {
    var tab = Number(e.currentTarget.dataset.tab)
    this.setData({
      activeTab: tab
    })

    if (tab === 0) {
      if (!this.data.displayedGroups || this.data.displayedGroups.length === 0) {
        this.loadDeviceStatus()
      }
    } else if (tab === 1) {
      this.loadReserveSummary()
    } else if (tab === 2) {
      this.loadSentMessages()
    } else if (tab === 3) {
      this.loadPendingApplyCount()
    }

  },

  // ==================== 仪器状态管理（Tab 0） ====================

  /** 筛选条件变更回调 */
  onLabTypeChange: function (e) {
    var self = this
    this.setData({
      'filters.labType': e.currentTarget.dataset.type
    }, function () {
      self.loadDeviceStatus()
    })
  },

  onDeviceTypeChange: function (e) {
    var self = this
    this.setData({
      'filters.deviceType': e.currentTarget.dataset.type
    }, function () {
      self.loadDeviceStatus()
    })
  },

  onSearchInput: function (e) {
    var self = this
    clearTimeout(self._searchTimer)
    self._searchTimer = setTimeout(function () {
      self.setData({
        'filters.searchKeyword': e.detail.value.trim()
      }, function () {
        self.loadDeviceStatus()
      })
    }, 500) // 用户停止输入 500ms 后才查
  },

  clearSearch: function () {
    var self = this
    this.setData({
      'filters.searchKeyword': ''
    }, function () {
      self.loadDeviceStatus()
    })
  },

  /**
   * 根据管理员角色和筛选条件构建数据库查询条件
   * - admin：可看所有实验室
   * - teacher：只看公共实验室 + 自己课题组
   */
  buildVisibleDeviceCondition: function (session) {
    if (!session) return {
      deny: true
    }
    var filters = this.data.filters
    var result = {
      labCondition: null,
      deviceType: null
    }
    var role = session.role
    var groupName = String(session.groupName || '').trim()

    if (role === 'admin') {
      if (filters.labType === 'public') result.labCondition = {
        lab_type: 'public'
      }
      else if (filters.labType === 'group') result.labCondition = {
        lab_type: 'group'
      }
    } else if (role === 'teacher') {
      if (!groupName) {
        result.labCondition = {
          lab_type: 'public'
        }
      } else if (filters.labType === 'all') {
        result.labCondition = _.or([{
          lab_type: 'public'
        }, {
          lab_name: groupName
        }])
      } else if (filters.labType === 'public') {
        result.labCondition = {
          lab_type: 'public'
        }
      } else if (filters.labType === 'group') {
        result.labCondition = {
          lab_name: groupName
        }
      }
    } else {
      return {
        deny: true
      }
    }

    if (filters.deviceType === 'large') result.deviceType = 'large'
    else if (filters.deviceType === 'small') result.deviceType = 'small'

    return result
  },

  /** 加载仪器状态（入口） */
  loadDeviceStatus: function () {
    var self = this
    if (!self.currentSession) {
      self.validateAdminSession().then(function (session) {
        if (!session) return
        self.currentSession = session
        self._doLoadDeviceStatus()
      })
    } else {
      self._doLoadDeviceStatus()
    }
  },

  /** 实际执行加载仪器组（调用云函数 getAdminGroups） */
  _doLoadDeviceStatus: function () {
    var self = this
    self.setData({
      isLoadingDevices: true
    })
    wx.showLoading({
      title: '加载中...'
    })

    var devicesCondition = self.buildVisibleDeviceCondition(self.currentSession)
    var keyword = (self.data.filters.searchKeyword || '').toLowerCase().trim()

    wx.cloud.callFunction({
      name: 'getAdminGroups',
      data: {
        labCondition: devicesCondition.labCondition || null,
        deviceType: devicesCondition.deviceType || null,
        keyword: keyword,
        pageSize: self.data.pageSize,
        pageNum: 1
      }
    }).then(function (res) {
      wx.hideLoading()
      if (res.result.code !== 0) {
        throw new Error(res.result.message || '加载失败')
      }
      var groups = res.result.data.groups || []
      var total = res.result.data.total
      var hasMore = res.result.data.hasMore
      self.setData({
        displayedGroups: groups,
        allGroupTotal: total,
        currentPage: 1,
        hasMore: hasMore,
        isLoadingDevices: false
      })
    }).catch(function (err) {
      wx.hideLoading()
      console.error('加载仪器状态失败:', err)
      self.setData({
        isLoadingDevices: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    })
  },

  /** 加载更多仪器组（前端分页） */
  loadMoreDevices: function () {
    if (this._loadingMore) return
    this._loadingMore = true

    var self = this
    var currentPage = self.data.currentPage
    var pageSize = self.data.pageSize
    var filters = self.data.filters

    var devicesCondition = self.buildVisibleDeviceCondition(self.currentSession)
    var keyword = (filters.searchKeyword || '').toLowerCase().trim()

    wx.cloud.callFunction({
      name: 'getAdminGroups',
      data: {
        labCondition: devicesCondition.labCondition || null,
        deviceType: devicesCondition.deviceType || null,
        keyword: keyword,
        pageSize: pageSize,
        pageNum: currentPage + 1
      }
    }).then(function (res) {
      self._loadingMore = false
      if (res.result.code !== 0) throw new Error(res.result.message || '加载失败')
      var groups = res.result.data.groups || []
      var hasMore = res.result.data.hasMore
      self.setData({
        displayedGroups: self.data.displayedGroups.concat(groups),
        currentPage: currentPage + 1,
        hasMore: hasMore
      })
    }).catch(function (err) {
      self._loadingMore = false
      console.error('加载更多失败:', err)
      wx.showToast({
        title: '加载更多失败',
        icon: 'none'
      })
    })
  },

  // ==================== 预约概览（Tab 1） ====================

  /** 根据 device_id 列表分批查询正在使用的记录 */
  fetchUsingRecordsByDeviceIds: function (deviceIds) {
    var self = this
    if (!deviceIds || deviceIds.length === 0) return Promise.resolve([])
    var chunks = self.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    var all = []
    var promise = Promise.resolve()

    for (var i = 0; i < chunks.length; i++) {
      promise = promise.then(function (chunk) {
        return self.fetchAllByCloud('device_usage', {
          status: 'using',
          device_id: _.in(chunk)
        }).then(function (rows) {
          all = all.concat(rows)
        })
      }.bind(null, chunks[i]))
    }
    return promise.then(function () {
      return all
    })
  },

  /** 加载预约概览：统计各状态数量 + 最近预约列表 */
  loadReserveSummary: function () {
    var self = this
    if (!self.currentSession) return
    self.setData({
      isLoadingReserves: true
    })

    var visibleCondition = self.buildVisibleDeviceCondition(self.currentSession)
    var visibleDeviceIds = null

    var promise = Promise.resolve()
    if (visibleCondition) {
      promise = self.fetchAllByCloud('devices', visibleCondition).then(function (devices) {
        visibleDeviceIds = []
        for (var i = 0; i < devices.length; i++) {
          if (devices[i].device_id) visibleDeviceIds.push(devices[i].device_id)
        }
        // 手动去重
        var dedup = []
        for (var j = 0; j < visibleDeviceIds.length; j++) {
          if (dedup.indexOf(visibleDeviceIds[j]) === -1) dedup.push(visibleDeviceIds[j])
        }
        visibleDeviceIds = dedup
        if (visibleDeviceIds.length === 0) {
          self.setData({
            recentReserves: [],
            reserveStats: {
              upcoming: 0,
              using: 0,
              completed: 0,
              abnormal: 0,
              total: 0
            },
            isLoadingReserves: false
          })
          return 'skip'
        }
        return null
      })
    }

    promise = promise.then(function (skipFlag) {
      if (skipFlag === 'skip') return 'skip'

      var reserveCondition = {
        status: 'approved'
      }
      if (visibleDeviceIds) reserveCondition.device_id = _.in(visibleDeviceIds)

      return Promise.all([
        self.fetchAllByCloud('reserves', reserveCondition),
        self.fetchAllByCloud('device_usage', {
          status: 'using'
        })
      ]).then(function (results) {
        var allReserves = results[0]
        var activeUsages = results[1]

        // 构建正在使用的预约映射
        var usingReserveIdMap = {}
        for (var u = 0; u < activeUsages.length; u++) {
          if (activeUsages[u].reserve_id) usingReserveIdMap[activeUsages[u].reserve_id] = true
        }

        var now = new Date()
        var stats = {
          upcoming: 0,
          using: 0,
          completed: 0,
          abnormal: 0,
          total: allReserves.length
        }

        var processed = []
        for (var i = 0; i < allReserves.length; i++) {
          var item = allReserves[i]
          var statusInfo = self.getReserveDisplayStatus(item, usingReserveIdMap, now)
          var displayStatus = statusInfo.displayStatus
          var displayStatusText = statusInfo.displayStatusText

          // 统计各状态数量
          if (displayStatus === 'using') stats.using++
          else if (displayStatus === 'completed') stats.completed++
          else if (displayStatus === 'upcoming') stats.upcoming++
          else if (displayStatus === 'abnormal') stats.abnormal++

          var timeDisplay = self.buildTimeDisplay(item)

          processed.push({
            ...item,
            displayStatus: displayStatus,
            displayStatusText: displayStatusText,
            timeDisplay: timeDisplay
          })
        }

        // 按开始时间倒序排列
        processed.sort(function (a, b) {
          return self.getDateTimeValue(b.start_time) - self.getDateTimeValue(a.start_time)
        })

        self.setData({
          recentReserves: processed.slice(0, 10),
          reserveStats: stats,
          isLoadingReserves: false
        })
      })
    })

    promise.catch(function (err) {
      console.error('加载预约概览失败:', err)
      self.setData({
        isLoadingReserves: false
      })
    })
  },

  /** 构建预约时间显示文本（处理跨天情况） */
  buildTimeDisplay: function (item) {
    if (!item.start_time || !item.end_time) return ''
    var startDateOnly = this.formatDateOnly(item.start_time)
    var endDateOnly = this.formatDateOnly(item.end_time)
    var isCrossDay = startDateOnly && endDateOnly && startDateOnly !== endDateOnly

    if (isCrossDay) {
      var startD = this.parseDateTime(item.start_time)
      var endD = this.parseDateTime(item.end_time)
      if (startD && endD) {
        var startTime = this.pad(startD.getHours()) + ':' + this.pad(startD.getMinutes())
        var endDisplay = this.pad(endD.getMonth() + 1) + '-' + this.pad(endD.getDate()) + ' ' + this.pad(endD.getHours()) + ':' + this.pad(endD.getMinutes())
        return item.reserve_date + ' ' + startTime + ' - ' + endDisplay
      }
    }
    return item.reserve_date + ' ' + this.getTimePart(item.start_time) + '-' + this.getTimePart(item.end_time)
  },

  /** 计算预约的展示状态（即将使用/使用中/已完成/异常/已过期） */
  getReserveDisplayStatus: function (item, usingReserveIdMap, now) {
    if (!item) return {
      displayStatus: 'past',
      displayStatusText: '已过期'
    }
    if (item.usage_status === 'abnormal') return {
      displayStatus: 'abnormal',
      displayStatusText: '异常'
    }
    if (item.usage_status === 'completed') return {
      displayStatus: 'completed',
      displayStatusText: '已完成'
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
    if (!startTs || !endTs) return {
      displayStatus: 'past',
      displayStatusText: '已过期'
    }

    if (nowTs < startTs) return {
      displayStatus: 'upcoming',
      displayStatusText: '即将使用'
    }
    if (nowTs < endTs) return {
      displayStatus: 'upcoming',
      displayStatusText: '可开始使用'
    }
    return {
      displayStatus: 'past',
      displayStatusText: '已过期'
    }
  },

  /** 解析预约时间戳（优先用 _ts 字段，兜底解析时间字符串） */
  resolveReserveTimestamp: function (reserve, field) {
    var tsKey = field + '_ts'
    var timeKey = field + '_time'
    var ts = Number(reserve && reserve[tsKey])
    if (isFinite(ts) && ts > 0) return ts
    var d = this.parseDateTime(reserve && reserve[timeKey])
    return d ? d.getTime() : 0
  },

  // ==================== 通知发布（Tab 2） ====================

  onTitleInput: function (e) {
    this.setData({
      msgTitle: e.detail.value
    })
  },
  onContentInput: function (e) {
    this.setData({
      msgContent: e.detail.value
    })
  },
  onDocUrlInput: function (e) {
    this.setData({
      msgDocUrl: e.detail.value.trim()
    })
  },

  /** 发布通知到 notice 集合，并触发订阅消息全推 */
  sendMessage: function () {
    var self = this
    var title = String(self.data.msgTitle || '').trim()
    var content = String(self.data.msgContent || '').trim()
    var docUrl = String(self.data.msgDocUrl || '').trim()

    if (!title) return wx.showToast({
      title: '请填写标题',
      icon: 'none'
    })

    if (!content) return wx.showToast({
      title: '请填写内容',
      icon: 'none'
    })

    if (docUrl) {
      var urlPattern = /^https?:\/\/docs\.qq\.com(\/|$)/
      if (!urlPattern.test(docUrl)) {
        self.setData({
          isSending: false
        })
        return wx.showToast({
          title: '请输入有效的腾讯文档链接',
          icon: 'none'
        })
      }
    }

    self.setData({
      isSending: true
    })

    var now = new Date()
    var noticeId = 'ADMIN_' + now.getTime()
    var publishDate = now.toISOString()

    db.collection('notice').add({
      data: {
        title: title,
        content: content,
        doc_url: docUrl || '',
        publish_date: publishDate,
        notice_id: noticeId,
        type: 'admin',
        created_by: self.data.adminName || '管理员'
      }
    }).then(function () {
      // 发布成功后再触发订阅消息全推，不阻塞用户提示
      wx.cloud.callFunction({
        name: 'sendNoticeSubMsg',
        data: {
          title: title,
          content: content,
          publishDate: publishDate,
          page: 'pages/notice/list' // 按你实际路径改
        }
      }).then(function (res) {
        console.log('订阅消息推送结果:', res.result)
      }).catch(function (err) {
        console.error('订阅消息推送失败:', err)
      })

      self.setData({
        isSending: false,
        msgTitle: '',
        msgContent: '',
        msgDocUrl: ''
      })

      wx.showToast({
        title: '发布成功',
        icon: 'success'
      })

      self.loadSentMessages()
    }).catch(function (err) {
      self.setData({
        isSending: false
      })
      console.error('发布失败:', err)
      wx.showToast({
        title: '发布失败，请重试',
        icon: 'none'
      })
    })
  },

  openDoc: function (e) {
    var url = e.currentTarget.dataset.url
    wx.navigateToMiniProgram({
      appId: 'wxd45c635d754dbf59', // 腾讯文档小程序 AppID
      path: 'pages/detail/detail?url=' + encodeURIComponent(url),
      fail: function () {
        // 兜底：跳转失败就复制链接，让用户去微信粘贴打开
        wx.setClipboardData({
          data: url,
          success: function () {
            wx.showToast({
              title: '链接已复制，去微信粘贴打开',
              icon: 'none'
            })
          }
        })
      }
    })
  },

  /** 显示文档链接填写提示 */
  showDocUrlHint: function () {
    wx.showModal({
      title: '协作文档链接',
      content: '请粘贴腾讯文档的分享链接（需以 https://docs.qq.com/ 开头）。\n\n在腾讯文档中点击"分享"→"复制链接"，权限需设为"任何人可编辑"，学生点击即可协作。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /** 删除通知（带二次确认） */
  deleteNotice: function (e) {
    var self = this
    var dataset = e.currentTarget.dataset
    // 优先用 _id，兜底用 notice_id
    var noticeId = dataset.id || dataset.noticeid

    if (!noticeId) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条通知吗？删除后不可恢复。',
      confirmColor: '#e74c3c',
      success: function (modal) {
        if (!modal.confirm) return

        wx.showLoading({
          title: '删除中...'
        })

        wx.cloud.callFunction({
          name: 'deleteNotice',
          data: {
            noticeId: noticeId
          }
        }).then(function (res) {
          wx.hideLoading()

          if (res.result.code === 0) {
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            })
            // 前端列表立即移除，无需重新拉取
            var list = self.data.sentMessages.filter(function (item) {
              return item._id !== noticeId && item.notice_id !== noticeId
            })
            self.setData({
              sentMessages: list
            })
          } else {
            wx.showToast({
              title: res.result.message || '删除失败',
              icon: 'none'
            })
          }
        }).catch(function (err) {
          wx.hideLoading()
          console.error('删除通知失败:', err)
          wx.showToast({
            title: '删除失败，请重试',
            icon: 'none'
          })
        })
      }
    })
  },
  /** 加载已发布的历史通知 */
  loadSentMessages: function () {
    var self = this
    self.setData({
      isLoadingMessages: true
    })
    db.collection('notice')
      .where({
        type: 'admin'
      })
      .orderBy('publish_date', 'desc')
      .limit(20)
      .get()
      .then(function (res) {
        var list = []
        for (var i = 0; i < (res.data || []).length; i++) {
          list.push({
            ...res.data[i],
            dateDisplay: self.formatTime(res.data[i].publish_date)
          })
        }
        self.setData({
          sentMessages: list,
          isLoadingMessages: false
        })
      })
      .catch(function (err) {
        console.error('加载通知历史失败:', err)
        self.setData({
          isLoadingMessages: false
        })
      })
  },

  // ==================== 卫生打卡记录（Tab 3） ====================

  /** 加载卫生打卡记录（第一页） */
  loadDutyRecords: function () {
    var self = this
    if (!self.currentSession) return
    self.setData({
      isLoadingDuty: true,
      dutyPage: 1
    })

    self.fetchAllByCloud('duty_records', {}, self.data.dutyPageSize, 'submit_time').then(function (records) {
      return self.resolveDutyImages(records).then(function (formatted) {
        self.setData({
          dutyRecords: formatted,
          hasMoreDuty: records.length === self.data.dutyPageSize,
          isLoadingDuty: false
        })
      })
    }).catch(function (err) {
      console.error('加载卫生记录失败', err)
      self.setData({
        isLoadingDuty: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    })
  },

  /** 加载更多卫生记录 */
  loadMoreDuty: function () {
    var self = this
    if (self.data.isLoadingDuty || !self.data.hasMoreDuty) return
    self.setData({
      isLoadingDuty: true
    })
    var nextPage = self.data.dutyPage + 1
    var skip = (nextPage - 1) * self.data.dutyPageSize

    wx.cloud.callFunction({
      name: 'getCollectionData',
      data: {
        collectionName: 'duty_records',
        whereCondition: {},
        pageSize: self.data.dutyPageSize,
        startSkip: skip,
        sortField: 'submit_time'
      }
    }).then(function (res) {
      if (res.result.code !== 0) throw new Error(res.result.message)
      return self.resolveDutyImages(res.result.data).then(function (newRecords) {
        self.setData({
          dutyRecords: self.data.dutyRecords.concat(newRecords),
          dutyPage: nextPage,
          hasMoreDuty: newRecords.length === self.data.dutyPageSize,
          isLoadingDuty: false
        })
      })
    }).catch(function (err) {
      console.error('加载更多失败:', err)
      self.setData({
        isLoadingDuty: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    })
  },

  /**
   * 解析卫生记录中的图片 fileID 为临时访问链接
   * 先收集所有 fileID → 调用 getBatchTempUrl 云函数 → 映射回记录
   */
  resolveDutyImages: function (records) {
    var self = this
    return new Promise(function (resolve) {
      if (!records || records.length === 0) {
        resolve([]);
        return
      }
      var allFileIds = []
      for (var i = 0; i < records.length; i++) {
        if (records[i].images && records[i].images.length) {
          for (var j = 0; j < records[i].images.length; j++) {
            allFileIds.push(records[i].images[j])
          }
        }
      }
      // 去重
      var dedupIds = []
      for (var k = 0; k < allFileIds.length; k++) {
        if (allFileIds[k] && dedupIds.indexOf(allFileIds[k]) === -1) dedupIds.push(allFileIds[k])
      }
      if (dedupIds.length === 0) {
        var emptyResult = []
        for (var m = 0; m < records.length; m++) emptyResult.push({
          ...records[m],
          imageUrls: []
        })
        resolve(emptyResult)
        return
      }
      wx.cloud.callFunction({
        name: 'getBatchTempUrl',
        data: {
          fileList: dedupIds
        }
      }).then(function (res) {
        var map = {}
        for (var f = 0; f < res.result.length; f++) {
          map[res.result[f].fileID] = res.result[f].tempFileURL || ''
        }
        var result = []
        for (var r = 0; r < records.length; r++) {
          var item = records[r]
          var urls = []
          if (item.images) {
            for (var u = 0; u < item.images.length; u++) {
              var url = map[item.images[u]] || ''
              if (url) urls.push(url)
            }
          }
          result.push({
            ...item,
            submit_time_display: self.formatTime(item.submit_time),
            imageUrls: urls
          })
        }
        resolve(result)
      })
    })
  },

  /** 预览卫生打卡图片 */
  previewDutyImage: function (e) {
    var src = e.currentTarget.dataset.src
    var list = e.currentTarget.dataset.list
    wx.previewImage({
      current: src,
      urls: list
    })
  },

  // ==================== 注册审批 ====================

  /** 查询待审批申请数量，用于卡片红点 */
  loadPendingApplyCount: function () {
    var self = this
    wx.cloud.callFunction({
      name: 'getCollectionData',
      data: {
        collectionName: 'user_apply',
        whereCondition: {
          status: 'pending'
        },
        pageSize: 100
      }
    }).then(function (res) {
      if (res.result.code !== 0) return
      var list = res.result.data || []
      self.setData({
        pendingApplyCount: list.length
      })
    }).catch(function (err) {
      console.error('查询待审批数量失败:', err)
    })
  },

  /** 跳转到注册审批页面 */
  goToApplyReview: function () {
    wx.navigateTo({
      url: '/pages/admin/apply-review/applyreview'
    })
  },

  // ==================== 退出登录 ====================

  confirmLogout: function () {
    this.setData({
      showExitConfirm: true
    })
  },
  cancelExit: function () {
    this.setData({
      showExitConfirm: false
    })
  },
  onBeforeLeaveExit: function () {
    this.setData({
      showExitConfirm: false
    })
  },

  /** 确认退出：清除缓存，跳转到登录页 */
  doLogout: function () {
    var self = this
    // 先关闭系统退出确认，防止 reLaunch 被拦截
    wx.disableAlertBeforeUnload()
    // 关闭弹窗
    this.setData({
      showExitConfirm: false
    }, function () {
      // setData 回调里再执行跳转，确保弹窗状态已更新
      wx.removeStorageSync('adminInfo')
      wx.reLaunch({
        url: '/pages/admin/login/adminlogin'
      })
    })
  },

  // ==================== 订阅消息 ====================

  /** 请求订阅消息授权 */
  requestSubscribeMessage: function () {
    const TMPL_IDS = [
      'rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY', // 故障告警
      '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg' // 通用（含新注册申请）
    ]
    wx.requestSubscribeMessage({
      tmplIds: TMPL_IDS,
      success: function (res) {
        TMPL_IDS.forEach(function (id) {
          if (res[id] === 'accept') {
            console.log('已订阅:', id)
          } else {
            console.log('未订阅:', id, res[id])
          }
        })
      },
      fail: function (err) {
        console.error('订阅授权失败:', err)
      }
    })
  },

  // ==================== 页面跳转 ====================

  goToReserveList: function () {
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

  /** 跳转到仪器详情页 */
  goToDeviceDetail: function (e) {
    var dataset = e.currentTarget.dataset
    var deviceName = String(dataset.deviceName || '')
    var labName = String(dataset.labName || '')
    var deviceType = String(dataset.deviceType || '')
    var model = String(dataset.model || '')
    var groupKey = String(dataset.groupKey || '')
    var rawKeyword = String(this.data.filters.searchKeyword || '').trim()
    var keyword = (rawKeyword && deviceName.toLowerCase().indexOf(rawKeyword.toLowerCase()) !== -1) ? '' : rawKeyword

    wx.navigateTo({
      url: '/pages/admin/device-detail/admindevicedetail?deviceName=' + encodeURIComponent(deviceName) + '&labName=' + encodeURIComponent(labName) + '&deviceType=' + encodeURIComponent(deviceType) + '&model=' + encodeURIComponent(model) + '&groupKey=' + encodeURIComponent(groupKey) + '&keyword=' + encodeURIComponent(keyword)
    })
  },

  // 预约状态快捷跳转
  gotoUpcoming: function () {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=upcoming'
    })
  },
  gotoUsing: function () {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=using'
    })
  },
  gotoCompleted: function () {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=completed'
    })
  },
  gotoAll: function () {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=all'
    })
  },
  gotoAbnormal: function () {
    wx.navigateTo({
      url: '/pages/admin/reserve-list/adminreservelist?status=abnormal'
    })
  },

  gotoReserveDetail: function (e) {
    wx.navigateTo({
      url: '/pages/reserve-detail/reserve-detail?id=' + e.currentTarget.dataset.id
    })
  },

  goResetPwd: function () {
    wx.navigateTo({
      url: '/pages/resetPwd/resetPwd'
    })
  },

  // ==================== 新增仪器 ====================

  /** 打开新增仪器弹窗，重置表单 */
  openAddDeviceModal: function () {
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

  closeDeviceForm: function () {
    this.setData({
      showDeviceForm: false
    })
  },

  onDeviceFormInput: function (e) {
    var field = e.currentTarget.dataset.field
    var value = e.detail.value
    this.setData({
      ['deviceForm.' + field]: value
    })
  },

  selectDeviceType: function (e) {
    this.setData({
      'deviceForm.device_type': e.currentTarget.dataset.type
    })
  },
  selectLabType: function (e) {
    this.setData({
      'deviceForm.lab_type': e.currentTarget.dataset.type
    })
  },

  /** 添加一台设备编号输入框 */
  addInstance: function () {
    var instances = this.data.deviceForm.instances.slice()
    instances.push({
      device_id: ''
    })
    this.setData({
      'deviceForm.instances': instances
    })
  },

  /** 删除指定索引的设备编号输入框 */
  deleteInstance: function (e) {
    var index = e.currentTarget.dataset.index
    var instances = this.data.deviceForm.instances.slice()
    instances.splice(index, 1)
    this.setData({
      'deviceForm.instances': instances
    })
  },

  onInstanceInput: function (e) {
    var index = e.currentTarget.dataset.index
    var value = e.detail.value
    var instances = this.data.deviceForm.instances.slice()
    instances[index].device_id = value
    this.setData({
      'deviceForm.instances': instances
    })
  },

  /** 选择并上传仪器图片 */
  chooseDevicePic: function () {
    var self = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        var tempPath = res.tempFiles[0].tempFilePath
        wx.showLoading({
          title: '上传中...'
        })
        wx.cloud.uploadFile({
          cloudPath: 'device_pics/' + Date.now() + '.jpg',
          filePath: tempPath,
          success: function (uploadRes) {
            wx.hideLoading()
            self.setData({
              'deviceForm.picture': uploadRes.fileID
            })
          },
          fail: function (err) {
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

  /** 将规格文本（key:value 每行一个）解析为对象 */
  parseSpecs: function (text) {
    var specs = {}
    if (!text) return specs
    var lines = text.split('\n')
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim()
      if (!line) continue
      var sepIndex = line.indexOf('\uff1a') !== -1 ? line.indexOf('\uff1a') : line.indexOf(':')
      if (sepIndex === -1) continue
      var key = line.substring(0, sepIndex).trim()
      var val = line.substring(sepIndex + 1).trim()
      if (key) specs[key] = val
    }
    return specs
  },

  /** 提交新增仪器表单（校验 → 去重 → 调用云函数） */
  submitDeviceForm: function () {
    var self = this
    var form = self.data.deviceForm

    if (!form.device_name.trim()) return wx.showToast({
      title: '请输入仪器名称',
      icon: 'none'
    })
    if (!form.lab_name.trim()) return wx.showToast({
      title: '请输入所属实验室',
      icon: 'none'
    })
    if (!form.device_room.trim()) return wx.showToast({
      title: '请输入房间位置',
      icon: 'none'
    })

    // 收集并校验设备编号
    var idList = []
    for (var i = 0; i < form.instances.length; i++) {
      var v = form.instances[i].device_id.trim()
      if (v) idList.push(v)
    }
    if (idList.length === 0) return wx.showToast({
      title: '请至少填写一台设备编号',
      icon: 'none'
    })

    // 去重校验
    var dedup = []
    for (var j = 0; j < idList.length; j++) {
      if (dedup.indexOf(idList[j]) === -1) dedup.push(idList[j])
    }
    if (dedup.length !== idList.length) return wx.showToast({
      title: '设备编号不能重复',
      icon: 'none'
    })

    self.setData({
      isSubmittingDevice: true
    })

    var submitData = {
      device_name: form.device_name.trim(),
      lab_name: form.lab_name.trim(),
      device_room: form.device_room.trim(),
      device_type: form.device_type,
      lab_type: form.lab_type,
      device_ids: idList,
      picture: form.picture,
      operation_procedure: form.operation_procedure.trim(),
      precautions: form.precautions.trim(),
      specifications: self.parseSpecs(form.specificationsText)
    }

    wx.cloud.callFunction({
        name: 'addDeviceGroup',
        data: submitData
      })
      .then(function (res) {
        self.setData({
          isSubmittingDevice: false
        })
        if (res.result.code === 0) {
          wx.showToast({
            title: '新增成功',
            icon: 'success'
          })
          setTimeout(function () {
            self.closeDeviceForm()
            self.loadDeviceStatus()
          }, 1500)
        } else {
          wx.showToast({
            title: res.result.message || '新增失败',
            icon: 'none'
          })
        }
      })
      .catch(function (err) {
        self.setData({
          isSubmittingDevice: false
        })
        console.error('新增仪器失败:', err)
        wx.showToast({
          title: '新增失败，请重试',
          icon: 'none'
        })
      })
  },

  // ==================== 删除仪器组 ====================

  /** 删除仪器组（带二次确认） */
  deleteDeviceGroup: function (e) {
    var self = this
    var dataset = e.currentTarget.dataset
    wx.showModal({
      title: '确认删除',
      content: '确定要删除「' + dataset.deviceName + '」该组所有仪器吗？删除后不可恢复。',
      confirmColor: '#e74c3c',
      success: function (modal) {
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
        }).then(function (res) {
          wx.hideLoading()
          if (res.result.code === 0) {
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            })
            self.loadDeviceStatus()
          } else {
            wx.showToast({
              title: res.result.message || '删除失败',
              icon: 'none'
            })
          }
        }).catch(function (err) {
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

  goToDutyRecords: function () {
    wx.navigateTo({
      url: '/pages/admin/duty-list/duty-list'
    })
  },
})