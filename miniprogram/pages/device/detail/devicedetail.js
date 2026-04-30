const db = wx.cloud.database()

Page({
  data: {
    device: null,
    deviceModel: '',
    isLoading: true,
    usageStatus: 'idle',
    loadError: false,
    currentDeviceId: '',
    availableDevices: [],
    usingDevices: [],
    maintenanceDevices: []
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

  buildVisibleQuery: function(extraCondition) {
    var _ = db.command
    return _.and([
      extraCondition,
      this.getVisibleCondition(this.getUserGroupName())
    ])
  },

  getShortDeviceId: function(deviceId) {
    var rawId = String(deviceId || '')
    var match = rawId.match(/(\d{3})$/)
    if (match) {
      return match[1]
    }
    var digits = rawId.replace(/\D/g, '')
    if (digits) {
      return digits.slice(-3).padStart(3, '0')
    }
    return rawId.slice(-3)
  },

  getDeviceModel: function(device) {
    var specs = (device && device.specifications) || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs.model || '').trim()
    }
    return String((device && device.model) || '').trim()
  },

  classifyDevices: function(allDevices, usingDeviceIdMap) {
    var availableDevices = []
    var usingDevices = []
    var maintenanceDevices = []

    allDevices.forEach(function(device) {
      var withShortId = {
        ...device,
        shortId: this.getShortDeviceId(device.device_id)
      }
      if (usingDeviceIdMap[withShortId.device_id]) {
        usingDevices.push(withShortId)
      } else if (withShortId.status === 'maintenance') {
        maintenanceDevices.push(withShortId)
      } else {
        availableDevices.push(withShortId)
      }
    }, this)

    return {
      availableDevices: availableDevices,
      usingDevices: usingDevices,
      maintenanceDevices: maintenanceDevices
    }
  },

  onLoad: function(options) {
    var deviceId = options.deviceId
    if (deviceId) {
      this.setData({ currentDeviceId: deviceId })
      this.getDeviceDetail(deviceId)
    } else {
      this.setData({ 
        isLoading: false,
        loadError: true 
      })
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      })
    }
  },

  getDeviceDetail: function(deviceId) {
    var that = this
    this.setData({ 
      currentDeviceId: deviceId,
      isLoading: true,
      loadError: false 
    })
    
    // 获取当前设备信息
    db.collection('devices')
      .where(this.buildVisibleQuery({ device_id: deviceId }))
      .get()
      .then(function(res) {
        if (res.data && res.data.length > 0) {
          var device = res.data[0]
          that.setData({ 
            device: device,
            deviceModel: that.getDeviceModel(device)
          })
          
          // 获取同款所有设备并检查使用状态
          that.getAllDevicesStatus(device)
        } else {
          that.setData({ 
            isLoading: false,
            loadError: true 
          })
          wx.showToast({
            title: '设备不存在或无权限查看',
            icon: 'none'
          })
        }
      })
      .catch(function(err) {
        console.error('获取仪器详情失败：', err)
        that.setData({ 
          isLoading: false,
          loadError: true 
        })
      })
  },

  // 获取所有同款设备并检查使用状态
  getAllDevicesStatus: function(device) {
    var that = this
    var deviceName = device.device_name
    var currentModel = this.getDeviceModel(device)
    
    // 获取所有同款设备
    db.collection('devices')
      .where(this.buildVisibleQuery({ device_name: deviceName }))
      .get()
      .then(function(devicesRes) {
        var allDevices = (devicesRes.data || []).filter(function(item) {
          return that.getDeviceModel(item) === currentModel
        })
        var visibleDeviceIdMap = {}
        allDevices.forEach(function(device) {
          visibleDeviceIdMap[device.device_id] = true
        })
        
        // 获取使用中的设备
        db.collection('device_usage')
          .where({
            device_name: deviceName,
            status: 'using'
          })
          .get()
          .then(function(usageRes) {
            var usingDeviceIdMap = {}
            ;(usageRes.data || []).forEach(function(usage) {
              if (visibleDeviceIdMap[usage.device_id]) {
                usingDeviceIdMap[usage.device_id] = true
              }
            })

            var classified = that.classifyDevices(allDevices, usingDeviceIdMap)
            that.setData({
              availableDevices: classified.availableDevices,
              usingDevices: classified.usingDevices,
              maintenanceDevices: classified.maintenanceDevices,
              usageStatus: classified.usingDevices.length > 0 ? 'using' : 'idle',
              isLoading: false
            })
          })
          .catch(function(err) {
            console.error('获取使用状态失败:', err)
            var classified = that.classifyDevices(allDevices, {})

            that.setData({ 
              availableDevices: classified.availableDevices,
              usingDevices: [],
              maintenanceDevices: classified.maintenanceDevices,
              usageStatus: 'idle',
              isLoading: false
            })
          })
      })
      .catch(function(err) {
        console.error('获取同款设备失败:', err)
        that.setData({ 
          isLoading: false,
          loadError: true 
        })
      })
  },

  // 查看操作规程
  viewProcedure: function() {
    var device = this.data.device
    if (!device.operation_procedure) {
      wx.showToast({ title: '暂无操作规程', icon: 'none' })
      return
    }
    var isObj = typeof device.operation_procedure === 'object'
    var content = isObj
      ? JSON.stringify(device.operation_procedure)
      : device.operation_procedure
    wx.navigateTo({
      url: '/pages/device/procedure/procedure?deviceName=' +
          encodeURIComponent(device.device_name) +
          '&content=' + encodeURIComponent(content) +
          '&type=' + (isObj ? 'structured' : 'plain')
    })
  },

  // 查看注意事项
  viewPrecautions: function() {
    var device = this.data.device
    if (!device.precautions) {
      wx.showToast({ title: '暂无注意事项', icon: 'none' })
      return
    }
    var isObj = typeof device.precautions === 'object'
    var content = isObj
      ? JSON.stringify(device.precautions)
      : device.precautions
    wx.navigateTo({
      url: '/pages/device/precautions/precautions?deviceName=' +
          encodeURIComponent(device.device_name) +
          '&content=' + encodeURIComponent(content) +
          '&type=' + (isObj ? 'structured' : 'plain')
    })
  },

  // 查看操作视频
  viewVideo: function() {
    var device = this.data.device
    var videoUrl = String(device.video_url || '').trim()
    if (videoUrl) {
      wx.navigateTo({
        url: '/pages/device/video/video?deviceName=' + 
            encodeURIComponent(device.device_name) + 
            '&fileID=' + encodeURIComponent(videoUrl)
      })
    } else {
      wx.showToast({
        title: '暂无操作视频',
        icon: 'none'
      })
    }
  },

  // 查看规格参数
  viewSpecifications: function() {
    var device = this.data.device
    var specs = device.specifications
    if (!specs || typeof specs !== 'object' || Object.keys(specs).length === 0) {
      wx.showToast({ title: '暂无规格参数', icon: 'none' })
      return
    }
    var content = Object.keys(specs).map(function(key) {
      return key + '：' + specs[key]
    }).join('\n')
    wx.navigateTo({
      url: '/pages/device/procedure/procedure?deviceName=' +
          encodeURIComponent(device.device_name) +
          '&content=' + encodeURIComponent(content) +
          '&type=plain&title=' + encodeURIComponent('规格参数')
    })
  },

  view3DLocation: function() {
    var device = this.data.device
    if (!device) return

    var deviceId = device.device_id || ''
    wx.navigateTo({
      url: '/pages/webview/3dscene/scene3d?device_id=' + encodeURIComponent(deviceId) + '&role=student'
    })
  },

  reloadPage: function() {
    var deviceId = this.data.currentDeviceId || (this.data.device && this.data.device.device_id)
    if (deviceId) {
      this.getDeviceDetail(deviceId)
    }
  }
})
