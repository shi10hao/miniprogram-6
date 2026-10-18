const db = wx.cloud.database()
const cloudFile = require('../../../utils/cloudFile.js')

Page({
  data: {
    device: null,
    deviceModel: '',
    isLoading: true,
    usageStatus: 'idle',
    loadError: false,
    currentDeviceId: '',
    picFailed: false,
    availableDevices: [],
    usingDevices: [],
    maintenanceDevices: []
  },

  getUserGroupName() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    return (userInfo.groupName || '').trim()
  },

  getVisibleCondition(groupName) {
    const _ = db.command
    if (groupName) {
      return _.or([
        { lab_type: 'public' },
        { lab_name: groupName }
      ])
    }
    return { lab_type: 'public' }
  },

  buildVisibleQuery(extraCondition) {
    const _ = db.command
    return _.and([
      extraCondition,
      this.getVisibleCondition(this.getUserGroupName())
    ])
  },

  getShortDeviceId(deviceId) {
    const rawId = String(deviceId || '')
    const match = rawId.match(/(\d{3})$/)
    if (match) {
      return match[1]
    }
    const digits = rawId.replace(/\D/g, '')
    if (digits) {
      return digits.slice(-3).padStart(3, '0')
    }
    return rawId.slice(-3)
  },

  getDeviceModel(device) {
    const specs = (device && device.specifications) || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs.model || '').trim()
    }
    return String((device && device.model) || '').trim()
  },

  classifyDevices(allDevices, usingDeviceIdMap) {
    const availableDevices = []
    const usingDevices = []
    const maintenanceDevices = []

    allDevices.forEach(function (device) {
      const withShortId = {
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

  onLoad(options) {
    const deviceId = options.deviceId
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

  // 解析仪器图片为临时链接（cloud:// 不能直接给 <image> 用）
  resolveDevicePicture() {
    const that = this
    const device = this.data.device
    if (!device || !cloudFile.isCloudFileId(device.picture)) return Promise.resolve()

    return cloudFile.resolveTempUrls([device.picture])
      .then(function (map) {
        const url = cloudFile.resolveSingle(that.data.device.picture, map)
        if (url) {
          that.setData({
            'device.picture': url,
            picFailed: false
          })
        }
      })
      .catch(function (err) {
        console.error('解析仪器图片失败:', err)
      })
  },

  onDeviceImageError() {
    this.setData({ picFailed: true })
  },

  getDeviceDetail(deviceId) {
    const that = this
    this.setData({
      currentDeviceId: deviceId,
      isLoading: true,
      loadError: false,
      picFailed: false
    })

    // 获取当前设备信息
    db.collection('devices')
      .where(this.buildVisibleQuery({ device_id: deviceId }))
      .get()
      .then(function (res) {
        if (res.data && res.data.length > 0) {
          const device = res.data[0]
          that.setData({
            device: device,
            deviceModel: that.getDeviceModel(device)
          })

          // 把 cloud:// fileID 换成临时链接，否则 <image> 会报渲染层 500
          that.resolveDevicePicture()

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
      .catch(function (err) {
        console.error('获取仪器详情失败：', err)
        that.setData({
          isLoading: false,
          loadError: true
        })
      })
  },

  // 获取所有同款设备并检查使用状态
  getAllDevicesStatus(device) {
    const that = this
    const deviceName = device.device_name
    const currentModel = this.getDeviceModel(device)

    // 获取所有同款设备
    db.collection('devices')
      .where(this.buildVisibleQuery({ device_name: deviceName }))
      .get()
      .then(function (devicesRes) {
        const allDevices = (devicesRes.data || []).filter(function (item) {
          return that.getDeviceModel(item) === currentModel
        })
        const visibleDeviceIdMap = {}
        allDevices.forEach(function (device) {
          visibleDeviceIdMap[device.device_id] = true
        })

        // 获取使用中的设备
        db.collection('device_usage')
          .where({
            device_name: deviceName,
            status: 'using'
          })
          .get()
          .then(function (usageRes) {
            const usingDeviceIdMap = {}
            ;(usageRes.data || []).forEach(function (usage) {
              if (visibleDeviceIdMap[usage.device_id]) {
                usingDeviceIdMap[usage.device_id] = true
              }
            })

            const classified = that.classifyDevices(allDevices, usingDeviceIdMap)
            that.setData({
              availableDevices: classified.availableDevices,
              usingDevices: classified.usingDevices,
              maintenanceDevices: classified.maintenanceDevices,
              usageStatus: classified.usingDevices.length > 0 ? 'using' : 'idle',
              isLoading: false
            })
          })
          .catch(function (err) {
            console.error('获取使用状态失败:', err)
            const classified = that.classifyDevices(allDevices, {})

            that.setData({
              availableDevices: classified.availableDevices,
              usingDevices: [],
              maintenanceDevices: classified.maintenanceDevices,
              usageStatus: 'idle',
              isLoading: false
            })
          })
      })
      .catch(function (err) {
        console.error('获取同款设备失败:', err)
        that.setData({
          isLoading: false,
          loadError: true
        })
      })
  },

  // 查看操作规程
  viewProcedure() {
    const device = this.data.device
    if (!device.operation_procedure) {
      wx.showToast({ title: '暂无操作规程', icon: 'none' })
      return
    }
    const isObj = typeof device.operation_procedure === 'object'
    const content = isObj
      ? JSON.stringify(device.operation_procedure)
      : device.operation_procedure
    wx.navigateTo({
      url: '/pages/device/procedure/procedure?deviceName='
        + encodeURIComponent(device.device_name)
        + '&content=' + encodeURIComponent(content)
        + '&type=' + (isObj ? 'structured' : 'plain')
    })
  },

  // 查看注意事项
  viewPrecautions() {
    const device = this.data.device
    if (!device.precautions) {
      wx.showToast({ title: '暂无注意事项', icon: 'none' })
      return
    }
    const isObj = typeof device.precautions === 'object'
    const content = isObj
      ? JSON.stringify(device.precautions)
      : device.precautions
    wx.navigateTo({
      url: '/pages/device/precautions/precautions?deviceName='
        + encodeURIComponent(device.device_name)
        + '&content=' + encodeURIComponent(content)
        + '&type=' + (isObj ? 'structured' : 'plain')
    })
  },

  // 查看操作视频
  viewVideo() {
    const device = this.data.device
    const videoUrl = String(device.video_url || '').trim()
    if (videoUrl) {
      wx.navigateTo({
        url: '/pages/device/video/video?deviceName='
          + encodeURIComponent(device.device_name)
          + '&fileID=' + encodeURIComponent(videoUrl)
      })
    } else {
      wx.showToast({
        title: '暂无操作视频',
        icon: 'none'
      })
    }
  },

  // 查看规格参数
  viewSpecifications() {
    const device = this.data.device
    const specs = device.specifications
    if (!specs || typeof specs !== 'object' || Object.keys(specs).length === 0) {
      wx.showToast({ title: '暂无规格参数', icon: 'none' })
      return
    }
    const content = Object.keys(specs).map(function (key) {
      return key + '：' + specs[key]
    }).join('\n')
    wx.navigateTo({
      url: '/pages/device/procedure/procedure?deviceName='
        + encodeURIComponent(device.device_name)
        + '&content=' + encodeURIComponent(content)
        + '&type=plain&title=' + encodeURIComponent('规格参数')
    })
  },

  view3DLocation() {
    const device = this.data.device
    if (!device) return

    const deviceId = device.device_id || ''
    wx.navigateTo({
      url: '/pages/webview/3dscene/scene3d?device_id=' + encodeURIComponent(deviceId) + '&role=student'
    })
  },

  reloadPage() {
    const deviceId = this.data.currentDeviceId || (this.data.device && this.data.device.device_id)
    if (deviceId) {
      this.getDeviceDetail(deviceId)
    }
  }
})
