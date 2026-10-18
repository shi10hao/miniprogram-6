const db = wx.cloud.database()
const cloudFile = require('../../../utils/cloudFile.js')

// 每屏渲染的仪器卡片数量（滚动到底部自动追加）
const PAGE_SIZE = 20

Page({
  data: {
    devices: [],
    filteredDevices: [],
    // 分页渲染：一次性拿全量数据，但一屏只渲染 PAGE_SIZE 张卡片，
    // 滚到底部再追加，避免几百张卡片同时进渲染层造成卡顿
    displayedDevices: [],
    pageNum: 1,
    hasMore: false,
    isLoadingMore: false,
    isLoading: true,
    // 骨架屏占位行（仅用于加载态渲染，不参与业务逻辑）
    skeletonRows: [0, 1, 2],
    entryDeviceId: '',
    // 筛选条件
    filters: {
      labType: 'all', // all, public, group
      deviceType: 'all', // all, large, small
      searchKeyword: ''
    },
    // 是否存在生效中的筛选（决定结果条/空态里是否露出「重置筛选」）
    hasActiveFilter: false,
    // 统计信息
    stats: {
      total: 0,
      public: 0,
      group: 0,
      large: 0,
      small: 0,
      totalUnits: 0
    },
    isLoggedIn: false,
    guestVisibleCount: 3 // 游客可见条数
  },

  onLoad(options) {
    // 数据代次：每次重新拉取列表就 +1，用于丢弃过期的图片解析结果
    this._dataSeq = 0
    // 搜索防抖定时器
    this._searchTimer = null
    this.setData({
      entryDeviceId: (options && options.deviceId) || '',
      isLoggedIn: this.checkLogin()
    })
    this.getDevices()
  },
  onShow() {
    const loggedIn = this.checkLogin()
    if (loggedIn !== this.data.isLoggedIn) {
      this.setData({
        isLoggedIn: loggedIn
      })
      // 如果云函数按登录态返回不同数据量，这里要重新拉；否则 applyFilters 即可
      if (loggedIn) {
        this.getDevices(true)
      } else {
        this.setData({
          stats: { total: 0, public: 0, group: 0, large: 0, small: 0, totalUnits: 0 }
        })
        this.applyFilters()
      }
    }
  },
  onUnload() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
  },

  // 触底追加下一页（替代一次性渲染全部卡片）
  onReachBottom() {
    this.loadMoreDevices()
  },

  getUserGroupName() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    return (userInfo.groupName || '').trim()
  },

  getVisibleCondition(groupName) {
    const _ = db.command
    if (groupName) {
      return _.or([{
        lab_type: 'public'
      },
      {
        lab_name: groupName
      }
      ])
    }
    return {
      lab_type: 'public'
    }
  },

  getDeviceModel(device) {
    const specs = device.specifications || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs.model || '').trim()
    }
    return String(device.model || '').trim()
  },

  getGroupKey(device) {
    return (device.device_name || '') + '::' + this.getDeviceModel(device)
  },

  mergeDevices(devices) {
    const grouped = {}
    const that = this
    const entryDeviceId = this.data.entryDeviceId

    devices.forEach(function (device) {
      const key = that.getGroupKey(device)
      if (!grouped[key]) {
        grouped[key] = {
          groupKey: key,
          device_name: device.device_name || '未命名设备',
          model: that.getDeviceModel(device),
          picture: device.picture || '',
          description: device.description || '',
          // -----------------------------------------------------
          labTypes: device.lab_type ? [device.lab_type] : [],
          deviceTypes: device.device_type ? [device.device_type] : [],
          labNames: device.lab_name ? [device.lab_name] : [],
          deviceRooms: device.device_room ? [device.device_room] : [],
          primaryDeviceId: device.device_id,
          device_ids: device.device_id ? [device.device_id] : [],
          totalCount: 1,
          publicCount: device.lab_type === 'public' ? 1 : 0,
          groupCount: device.lab_type === 'group' ? 1 : 0,
          // labTypes: device.lab_type ? [device.lab_type] : [],
          // deviceTypes: device.device_type ? [device.device_type] : [],
          // labNames: device.lab_name ? [device.lab_name] : [],
          // deviceRooms: device.device_room ? [device.device_room] : [],
          // primaryDeviceId: device.device_id,
          // device_ids: device.device_id ? [device.device_id] : [],
          // totalCount: 1,
          matchesEntryDevice: device.device_id === entryDeviceId
        }
        return
      }

      const item = grouped[key]
      item.totalCount++
      if (device.lab_type === 'public') item.publicCount++
      if (device.lab_type === 'group') item.groupCount++
      if (device.device_id) {
        item.device_ids.push(device.device_id)
      }
      if (!item.picture && device.picture) {
        item.picture = device.picture
      }
      if (!item.description && device.description) {
        item.description = device.description
      }
      if (device.lab_type && item.labTypes.indexOf(device.lab_type) === -1) {
        item.labTypes.push(device.lab_type)
      }
      if (device.device_type && item.deviceTypes.indexOf(device.device_type) === -1) {
        item.deviceTypes.push(device.device_type)
      }
      if (device.lab_name && item.labNames.indexOf(device.lab_name) === -1) {
        item.labNames.push(device.lab_name)
      }
      if (device.device_room && item.deviceRooms.indexOf(device.device_room) === -1) {
        item.deviceRooms.push(device.device_room)
      }
      if (device.device_id === entryDeviceId) {
        item.matchesEntryDevice = true
      }
    })

    return Object.values(grouped).map(function (item) {
      const labType = item.labTypes.length === 1 ? item.labTypes[0] : 'mixed'
      const deviceType = item.deviceTypes.length === 1 ? item.deviceTypes[0] : 'mixed'
      return {
        ...item,
        lab_type: labType,
        device_type: deviceType,
        labTypeLabel: labType === 'public' ? '公共实验室' : (labType === 'group' ? '课题组' : '公共/课题组'),
        deviceTypeLabel: deviceType === 'large' ? '大型仪器' : (deviceType === 'small' ? '小型仪器' : '多类型'),
        lab_name: item.labNames.length > 0 ? item.labNames.join(' / ') : '未设置实验室',
        device_room: item.deviceRooms.length > 0 ? item.deviceRooms.join(' / ') : '未设置位置'
      }
    }).sort(function (a, b) {
      if (a.matchesEntryDevice && !b.matchesEntryDevice) {
        return -1
      }
      if (!a.matchesEntryDevice && b.matchesEntryDevice) {
        return 1
      }
      return a.device_name.localeCompare(b.device_name)
    })
  },

  getDevices(silent) {
    const that = this
    const groupName = this.getUserGroupName()

    // 静默模式下不置 isLoading，避免闪骨架屏
    if (!silent) {
      this.setData({ isLoading: true })
    }

    return wx.cloud.callFunction({
      name: 'getDevices',
      data: { groupName: groupName }
    })
      .then(function (res) {
        const devices = res.result || []
        that._dataSeq = (that._dataSeq || 0) + 1
        const groupedDevices = that.mergeDevices(devices)
        let stats = that.calculateStats(devices, groupedDevices)
        if (!that.data.isLoggedIn) {
          stats = { total: 0, public: 0, group: 0, large: 0, small: 0, totalUnits: 0 }
        }

        that.setData({
          devices: groupedDevices,
          stats: stats,
          isLoading: false // 静默模式也置 false，防止残留 true
        }, function () {
          that.applyFilters()
        })

        return groupedDevices
      })
      .catch(function (err) {
        that.setData({ isLoading: false })
        // 静默模式不弹 toast，避免登录返回时莫名报错打断体验
        if (!silent) {
          wx.showToast({ title: '加载失败', icon: 'none' })
        }
        throw err
      })
  },

  /**
   * 把 devices.picture 里的 cloud:// fileID 换成临时 https 链接。
   * 直接渲染 cloud:// 会触发渲染层 500 报错（Failed to load local image resource）。
   */
  resolveDevicePictures() {
    const that = this
    const devices = this.data.devices || []
    // 记住这次解析对应的数据代次，避免下拉刷新后旧结果覆盖新数据
    const seq = this._dataSeq || 0
    const rawIds = devices.map(function (item) {
      return item.picture
    }).filter(function (id) {
      return cloudFile.isCloudFileId(id)
    })

    if (!rawIds.length) return Promise.resolve()

    return cloudFile.resolveTempUrls(rawIds)
      .then(function (map) {
        if (seq !== (that._dataSeq || 0)) return

        // 更新 _allDevices 里的原始数据，只把「当前已渲染的那部分」写进 data。
        // 用路径 setData 而不是整表替换，避免把上百条记录重新推给渲染层。
        const updatedAll = devices.map(function (item) {
          if (!cloudFile.isCloudFileId(item.picture)) return item
          const url = cloudFile.resolveSingle(item.picture, map)
          if (!url) return item
          return Object.assign({}, item, {
            picture: url
          })
        })

        const patch = {
          devices: updatedAll
        }
        const displayed = that.data.displayedDevices || []
        if (displayed.length) {
          // 用 groupKey → 已解析图片 的映射做 O(n) 查找
          const pictureByKey = {}
          updatedAll.forEach(function (item) {
            pictureByKey[item.groupKey] = item.picture
          })
          displayed.forEach(function (item, index) {
            const picture = pictureByKey[item.groupKey]
            if (picture && picture !== item.picture) {
              patch['displayedDevices[' + index + '].picture'] = picture
            }
          })
        }
        that.setData(patch)
      })
      .catch(function (err) {
        console.error('解析仪器图片失败:', err)
      })
  },

  // 单张仪器图片加载失败 → 收起图片，避免反复重试刷屏
  onDeviceImageError(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    const patch = {}
    patch['displayedDevices[' + index + '].imgFailed'] = true
    this.setData(patch)
  },

  calculateStats(devices, groupedDevices) {
    const stats = {
      total: groupedDevices.length,
      public: 0,
      group: 0,
      large: 0,
      small: 0,
      totalUnits: devices.length
    }

    groupedDevices.forEach(function (device) {
      if (device.labTypes.indexOf('public') > -1) {
        stats.public++
      }
      if (device.labTypes.indexOf('group') > -1) {
        stats.group++
      }
      if (device.deviceTypes.indexOf('large') > -1) {
        stats.large++
      }
      if (device.deviceTypes.indexOf('small') > -1) {
        stats.small++
      }
    })
    return stats
  },

  // 重新应用筛选并回到第一页
  applyFilters() {
    const filters = this.data.filters
    const isLoggedIn = this.data.isLoggedIn
    const filtered = this.data.devices.filter(function (device) {
      // 实验室类型筛选
      if (filters.labType !== 'all' && device.labTypes.indexOf(filters.labType) === -1) {
        return false
      }

      // 仪器类型筛选
      if (filters.deviceType !== 'all' && device.deviceTypes.indexOf(filters.deviceType) === -1) {
        return false
      }

      // 关键词搜索
      if (filters.searchKeyword) {
        const keyword = filters.searchKeyword.toLowerCase()
        const deviceName = (device.device_name || '').toLowerCase()
        const model = (device.model || '').toLowerCase()
        const labName = (device.lab_name || '').toLowerCase()
        const room = (device.device_room || '').toLowerCase()
        const description = (device.description || '').toLowerCase()

        if (!deviceName.includes(keyword)
          && !model.includes(keyword)
          && !labName.includes(keyword)
          && !room.includes(keyword)
          && !description.includes(keyword)) {
          return false
        }
      }

      return true
    })

    const limit = isLoggedIn
      ? PAGE_SIZE
      : Math.min(this.data.guestVisibleCount, filtered.length)

    this.setData({
      filteredDevices: filtered,
      hasActiveFilter: !!(filters.searchKeyword || filters.labType !== 'all' || filters.deviceType !== 'all'),
      pageNum: 1,
      displayedDevices: filtered.slice(0, limit),
      hasMore: isLoggedIn && filtered.length > PAGE_SIZE,
      isLoadingMore: false
    }, () => {
      this.resolveDevicePictures()
    })
  },

  // 触底追加下一页
  loadMoreDevices() {
    if (!this.data.isLoggedIn) return
    if (!this.data.hasMore || this.data.isLoadingMore) return
    const nextPage = this.data.pageNum + 1
    const end = nextPage * PAGE_SIZE
    const filtered = this.data.filteredDevices || []

    this.setData({
      isLoadingMore: true
    })

    this.setData({
      displayedDevices: filtered.slice(0, end),
      pageNum: nextPage,
      hasMore: end < filtered.length,
      isLoadingMore: false
    }, () => {
      this.resolveDevicePictures()
    })
  },

  // 切换实验室类型筛选
  onLabTypeChange(e) {
    const labType = e.currentTarget.dataset.type
    this.setData({
      'filters.labType': labType
    }, () => {
      this.applyFilters()
    })
  },

  // 切换仪器类型筛选
  onDeviceTypeChange(e) {
    const deviceType = e.currentTarget.dataset.type
    this.setData({
      'filters.deviceType': deviceType
    }, () => {
      this.applyFilters()
    })
  },

  // 搜索输入：防抖，避免每敲一个字就重建整个列表
  onSearchInput(e) {
    this.setData({
      'filters.searchKeyword': e.detail.value
    })

    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
    }
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null
      this.applyFilters()
    }, 300)
  },

  // 一键重置全部筛选条件（空状态与结果条上的入口）
  resetFilters() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
    this.setData({
      'filters.labType': 'all',
      'filters.deviceType': 'all',
      'filters.searchKeyword': ''
    }, () => {
      this.applyFilters()
    })
  },

  // 清除搜索
  clearSearch() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
    this.setData({
      'filters.searchKeyword': ''
    }, () => {
      this.applyFilters()
    })
  },

  // 查看仪器详情
  goToDetail(e) {
    const deviceId = e.currentTarget.dataset.deviceid
    if (!deviceId) {
      wx.showToast({
        title: '设备信息缺失',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({
      url: '/pages/device/detail/devicedetail?deviceId=' + deviceId
    })
  },

  onPullDownRefresh() {
    this.getDevices()
      .then(function () {
        wx.stopPullDownRefresh()
      })
      .catch(function () {
        wx.stopPullDownRefresh()
      })
  },

  checkLogin() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    return !!(userInfo.openid || userInfo._openid || userInfo.userId)
  },

  handleLogin() {
    // 按你项目实际登录入口改：跳登录页 / 打开授权弹窗
    wx.navigateTo({
      url: '/pages/auth/auth'
    })
  }
})
