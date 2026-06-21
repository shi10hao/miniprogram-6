const db = wx.cloud.database()

Page({
  data: {
    devices: [],
    filteredDevices: [],
    isLoading: true,
    entryDeviceId: '',
    // 筛选条件
    filters: {
      labType: 'all', // all, public, group
      deviceType: 'all', // all, large, small
      searchKeyword: ''
    },
    // 统计信息
    stats: {
      total: 0,
      public: 0,
      group: 0,
      large: 0,
      small: 0,
      totalUnits: 0
    }
  },

  onLoad: function(options) {
    this.setData({
      entryDeviceId: (options && options.deviceId) || ''
    })
    this.getDevices()
  },

  getUserGroupName: function() {
    var userInfo = wx.getStorageSync('userInfo') || {}
    return (userInfo.groupName || '').trim()
  },

  getVisibleCondition: function(groupName) {
    var _ = db.command
    if (groupName) {
      return _.or([
        { lab_type: 'public' },
        { lab_name: groupName }
      ])
    }
    return { lab_type: 'public' }
  },

  getDeviceModel: function(device) {
    var specs = device.specifications || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs.model || '').trim()
    }
    return String(device.model || '').trim()
  },

  getGroupKey: function(device) {
    return (device.device_name || '') + '::' + this.getDeviceModel(device)
  },

  mergeDevices: function(devices) {
    var grouped = {}
    var that = this
    var entryDeviceId = this.data.entryDeviceId

    devices.forEach(function(device) {
      var key = that.getGroupKey(device)
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

      var item = grouped[key]
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

    return Object.values(grouped).map(function(item) {
      var labType = item.labTypes.length === 1 ? item.labTypes[0] : 'mixed'
      var deviceType = item.deviceTypes.length === 1 ? item.deviceTypes[0] : 'mixed'
      return {
        ...item,
        lab_type: labType,
        device_type: deviceType,
        labTypeLabel: labType === 'public' ? '公共实验室' : (labType === 'group' ? '课题组' : '公共/课题组'),
        deviceTypeLabel: deviceType === 'large' ? '大型仪器' : (deviceType === 'small' ? '小型仪器' : '多类型'),
        lab_name: item.labNames.length > 0 ? item.labNames.join(' / ') : '未设置实验室',
        device_room: item.deviceRooms.length > 0 ? item.deviceRooms.join(' / ') : '未设置位置'
      }
    }).sort(function(a, b) {
      if (a.matchesEntryDevice && !b.matchesEntryDevice) {
        return -1
      }
      if (!a.matchesEntryDevice && b.matchesEntryDevice) {
        return 1
      }
      return a.device_name.localeCompare(b.device_name)
    })
  },

  getDevices: function() {
    var that = this
    var groupName = this.getUserGroupName()
    this.setData({ isLoading: true })

    return wx.cloud.callFunction({
      name: 'getDevices',
      data: {
        groupName: groupName
      }
    })
      .then(function(res) {
        // console.log("res",res)
        var devices = res.result || []
        var groupedDevices = that.mergeDevices(devices)
        var stats = that.calculateStats(devices, groupedDevices)
        // console.log('原始设备数据条数:', res.result.length)
        that.setData({
          devices: groupedDevices,
          filteredDevices: groupedDevices,
          stats: stats,
          isLoading: false
        })
      })
      .catch(function(err) {
        // console.error('加载仪器数据失败：', err)
        that.setData({ isLoading: false })
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        })
        throw err
      })
  },

  calculateStats: function(devices, groupedDevices) {
    var stats = {
      total: groupedDevices.length,
      public: 0,
      group: 0,
      large: 0,
      small: 0,
      totalUnits: devices.length
    }

    groupedDevices.forEach(function(device) {
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

  // 筛选设备
  filterDevices: function() {
    var filters = this.data.filters
    var filtered = this.data.devices.filter(function(device) {
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
        var keyword = filters.searchKeyword.toLowerCase()
        var deviceName = (device.device_name || '').toLowerCase()
        var model = (device.model || '').toLowerCase()
        var labName = (device.lab_name || '').toLowerCase()
        var room = (device.device_room || '').toLowerCase()
        var description = (device.description || '').toLowerCase()
        
        if (!deviceName.includes(keyword) && 
            !model.includes(keyword) &&
            !labName.includes(keyword) && 
            !room.includes(keyword) &&
            !description.includes(keyword)) {
          return false
        }
      }
      
      return true
    })
    
    this.setData({
      filteredDevices: filtered
    })
  },

  // 切换实验室类型筛选
  onLabTypeChange: function(e) {
    var labType = e.currentTarget.dataset.type
    var filters = this.data.filters
    filters.labType = labType
    this.setData({
      filters: filters
    })
    this.filterDevices()
  },

  // 切换仪器类型筛选
  onDeviceTypeChange: function(e) {
    var deviceType = e.currentTarget.dataset.type
    var filters = this.data.filters
    filters.deviceType = deviceType
    this.setData({
      filters: filters
    })
    this.filterDevices()
  },

  // 搜索输入
  onSearchInput: function(e) {
    var filters = this.data.filters
    filters.searchKeyword = e.detail.value
    this.setData({
      filters: filters
    })
    this.filterDevices()
  },

  // 清除搜索
  clearSearch: function() {
    var filters = this.data.filters
    filters.searchKeyword = ''
    this.setData({
      filters: filters
    })
    this.filterDevices()
  },

  // 查看仪器详情
  goToDetail: function(e) {
    var deviceId = e.currentTarget.dataset.deviceid
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

  onPullDownRefresh: function() {
    this.getDevices()
      .then(function() {
        wx.stopPullDownRefresh()
      })
      .catch(function() {
        wx.stopPullDownRefresh()
      })
  }
})
