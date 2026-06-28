const db = wx.cloud.database()
const _ = db.command

const ALLOWED_ROLES = ['teacher', 'admin']
const PAGE_SIZE = 20

Page({
  data: {
    allReserves: [],
    filteredReserves: [],
    isLoading: true,
    filterStatus: 'all',
    searchKeyword: '',
    hasMore: true,
    currentPage: 0,
    currentSession: null,
    pageSize: 20,
    totalLoaded: 0,
  },

  onLoad(options) {
    this.bootstrapPage()
    console.log("options.status:",options.status)
    if (options.status)
    {
      this.setData({
        filterStatus: options.status
      })
      console.log("filterStatus:",this.data.filterStatus)
      this.applyFilter()
    }
  },

  onUnload() {
    wx.disableAlertBeforeUnload()
  },

  onShow() {
    if (this._ready) {
      this.refreshData()
    }
  },

  onPullDownRefresh() {
    this.refreshData().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  async bootstrapPage() {
    const session = await this.validateAdminSession()
    if (!session) return
    console.log("session:", session)
    this.currentSession = session
    this._ready = true
    this.refreshData()
  },

  redirectToLogin(message) {
    wx.removeStorageSync('adminInfo')
    if (message) wx.showToast({
      title: message,
      icon: 'none'
    })
    setTimeout(() => {
      wx.redirectTo({
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

      return {
        userId: user.user_id,
        name: user.name || localSession.name || '管理员',
        role: user.role,
        groupName: user.group_name || ''
      }
    } catch (err) {
      console.error('校验管理端会话失败:', err)
      this.redirectToLogin('登录状态校验失败，请重试')
      return null
    }
  },

  buildVisibleDeviceIdsCondition(session) {
    if (!session) return {
      _id: '__DENY__'
    }
    if (session.role === 'admin') return null

    if (session.role === 'teacher') {
      const groupName = String(session.groupName || '').trim()
      if (!groupName) return {
        lab_type: 'public'
      }
      return _.or([{
          lab_type: 'public'
        },
        {
          lab_name: groupName
        }
      ])
    }

    return {
      _id: '__DENY__'
    }
  },

  async fetchAllByWhere(collectionName, whereCondition, pageSize) {
    pageSize = pageSize || 100
    let skip = 0
    const all = []

    while (true) {
      let query = db.collection(collectionName)
      if (whereCondition) query = query.where(whereCondition)
      const res = await query.skip(skip).limit(pageSize).get()
      const rows = res.data || []
      all.push(...rows)
      if (rows.length < pageSize) break
      skip += pageSize
    }

    return all
  },

  async refreshData() {
    this.setData({
      isLoading: true,
      currentPage: 0,
      totalLoaded: 0,
      hasMore: true,
      allReserves: []
    })
    try {
      await this.loadReserves(true)
    } catch (err) {
      console.error('加载预约数据失败:', err)
      this.setData({
        isLoading: false
      })
    } finally {
      this.setData({
        isLoading: false
      })
    }
  },

  async loadReserves(isRefresh = false) {
    if (!this.currentSession) return

    const pageSize = this.data.pageSize
    const page = isRefresh ? 0 : this.data.currentPage
    try {
      const visibleCondition = this.buildVisibleDeviceIdsCondition(this.currentSession) //admin返回null

      //
      console.log("visibleCondition:", visibleCondition)
      let visibleDeviceIds = null
      if (visibleCondition) {
        const devices = await this.fetchAllByWhere('devices', visibleCondition)
        visibleDeviceIds = Array.from(new Set(
          (devices || []).map(function (d) {
            return d.device_id
          }).filter(Boolean)
        ))
        if (visibleDeviceIds.length === 0) {
          this.setData({
            allReserves: [],
            filteredReserves: [],
            isLoading: false,
            hasMore: false
          })
          return
        }
      }
      console.log("visibleDeviceIds:",visibleDeviceIds)
      var reserveCondition = {
        status: 'approved'
      }
      if (visibleDeviceIds) {
        reserveCondition.device_id = _.in(visibleDeviceIds)
      }
      //
      console.log("reserveCondition:", reserveCondition)

      // var allReserves = await this.fetchAllByWhere('reserves', reserveCondition)
      const reserveRes = await db.collection('reserves')
        .where(reserveCondition)
        .skip(page * pageSize)
        .limit(pageSize)
        .get()

      const newReserves = reserveRes.data || []

      let mergedReserves = []

      if (isRefresh) {
        mergedReserves = newReserves
      } else {
        mergedReserves = [...this.data.allReserves, ...newReserves]
      }

      const hasMore = newReserves.length === pageSize

      this.setData({
        allReserves: mergedReserves,
        currentPage: page + 1,
        totalLoaded: mergedReserves.length,
        hasMore
      })
      var activeUsages = await this.fetchAllByWhere('device_usage', {
        status: 'using'
      })
      var usingReserveIdMap = {};
      (activeUsages || []).forEach(function (u) {
        if (u.reserve_id) usingReserveIdMap[u.reserve_id] = true
      })

      var now = new Date()
      var processed  = mergedReserves.map(function (item)  {
        var statusInfo = getReserveDisplayStatus(item, usingReserveIdMap, now)

        return Object.assign({}, item, {
          displayStatus: statusInfo.displayStatus,
          displayStatusText: statusInfo.displayStatusText,
          start_time_display: getTimePart(item.start_time),
          end_time_display: getTimePart(item.end_time)
        })
      })

      processed.sort(function (a, b) {
        return getTimeValue(b.start_time) - getTimeValue(a.start_time)
      })

      this.setData({
        allReserves: processed,
        isLoading: false
      })

      this.applyFilter()
    } catch (err) {
      console.error('加载预约列表失败:', err)
      this.setData({
        isLoading: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  onFilterChange(e) {
    var status = e.currentTarget.dataset.status
    this.setData({
      filterStatus: status
    })
    this.applyFilter()
  },

  onSearchInput(e) {
    this.setData({
      searchKeyword: e.detail.value
    })
    this.applyFilter()
  },

  clearSearch() {
    this.setData({
      searchKeyword: ''
    })
    this.applyFilter()
  },

  applyFilter() {
    var allReserves = this.data.allReserves
    var filterStatus = this.data.filterStatus
    var searchKeyword = String(this.data.searchKeyword || '').trim().toLowerCase()

    var filtered = allReserves

    if (filterStatus !== 'all') {
      filtered = filtered.filter(function (item) {
        return item.displayStatus === filterStatus
      })
    }

    if (searchKeyword) {
      filtered = filtered.filter(function (item) {
        var name = String(item.device_name || '').toLowerCase()
        var person = String(item.student_name || '').toLowerCase()
        var userId = String(item.user_id || '').toLowerCase()
        var deviceId = String(item.device_id || '').toLowerCase()
        return name.indexOf(searchKeyword) !== -1 ||
          person.indexOf(searchKeyword) !== -1 ||
          userId.indexOf(searchKeyword) !== -1 ||
          deviceId.indexOf(searchKeyword) !== -1
      })
    }

    this.setData({
      filteredReserves: filtered
    })
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.isLoading) return
    this.setData({ isLoading: true })
    await this.loadReserves(false)
    this.setData({ isLoading: false })
  },

  getReserveDisplayStatus(item, usingReserveIdMap, now) {
    return getReserveDisplayStatus(item, usingReserveIdMap, now)
  }
})

function parseDateTime(dtStr) {
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
  if (isNaN(d.getTime())) return null
  return d
}

function resolveReserveTimestamp(reserve, field) {
  var tsKey = field + '_ts'
  var timeKey = field + '_time'
  var timestamp = Number(reserve && reserve[tsKey])
  if (isFinite(timestamp) && timestamp > 0) {
    return timestamp
  }

  var d = parseDateTime(reserve && reserve[timeKey])
  return d ? d.getTime() : 0
}

function getReserveDisplayStatus(item, usingReserveIdMap, now) {
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

  var startTs = resolveReserveTimestamp(item, 'start')
  var endTs = resolveReserveTimestamp(item, 'end')
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
}

function getTimePart(dtStr) {
  if (!dtStr) return '--:--'
  if (dtStr.indexOf(' ') !== -1) return dtStr.split(' ')[1]
  if (dtStr.indexOf('T') !== -1) {
    var timePart = dtStr.split('T')[1]
    if (timePart) return timePart.substring(0, 5)
  }
  return dtStr
}

function getTimeValue(dtStr) {
  if (!dtStr) return 0
  var d = parseDateTime(dtStr)
  return d ? d.getTime() : 0
}