const db = wx.cloud.database()
const _ = db.command
const RESERVE_REMIND_TPL_ID = 'rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk'

Page({
  data: {
    // 用户信息
    userInfo: {
      userId: '',
      name: '',
      researchGroup: '', // 课题组
      phone: ''
    },
    reservedDevices: [],
    // 默认选中第一个
    selectedIndex: 0,
    device_id: null,
    // 仪器筛选
    // 筛选条件
    filters: {
      labType: 'all', // all, public, group
      deviceType: 'all', // all, large, small
      searchKeyword: ''
    },
    deviceType: 'all', // all, public, group
    availableDevices: [], // 可用的仪器列表
    selectedDevice: null, // 选择的仪器

    // 预约时间
    reserveDate: '',
    startTime: '08:00',
    endTime: '09:00',
    timeSlots: [], // 8:00-22:00的时间段

    // 状态
    isLoading: false,
    timeConflict: false,
    isPastTime: false, // 新增：是否是过去时间

    // 其他参数
    minDate: '', // 最小日期（今天）
    maxDate: '', // 最大日期（30天后）
    reservePage: '',
    reservePageFileID: '',
    maxEndDate: '', // 新增：结束日期最大可选值
  },

  onLoad() {
    // 登录态校验
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo) {
      wx.redirectTo({
        url: '/pages/auth/auth'
      })
      return
    }

    this.initData()
    this.getUserInfo()
    this.getAvailableDevices()
  },

  // 初始化数据
  initData() {
    const today = new Date()
    const maxDate = new Date()
    maxDate.setDate(today.getDate() + 30)
    const initialSlot = this.getInitialReservationSlot(today)
    //   reserveDate: this.formatDate(reserveDate),
    //   startTime: '08:00'
    const startDateObj = new Date(initialSlot.reserveDate)
    const maxEndDateObj = new Date(startDateObj)
    maxEndDateObj.setDate(startDateObj.getDate() + 2)
    this.setData({
      minDate: this.formatDate(today),
      maxDate: this.formatDate(maxDate),
      startDate: initialSlot.reserveDate,
      startTime: initialSlot.startTime,
      endDate: initialSlot.reserveDate,
      endTime: this.calculateEndTime(initialSlot.startTime),
      maxEndDate: this.formatDate(maxEndDateObj)
    })
  },

  getInitialReservationSlot(now = new Date()) {
    const reserveDate = new Date(now)
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()

    if (currentHour < 8) {
      return {
        reserveDate: this.formatDate(reserveDate),
        startTime: '08:00'
      }
    }

    if (currentHour > 21 || (currentHour === 21 && currentMinute >= 30)) {
      reserveDate.setDate(reserveDate.getDate() + 1)
      return {
        reserveDate: this.formatDate(reserveDate),
        startTime: '08:00'
      }
    }

    let nextHour = currentHour
    let nextMinute = 0

    if (currentMinute < 30) {
      nextMinute = 30
    } else {
      nextHour += 1
      nextMinute = 0
    }

    return {
      reserveDate: this.formatDate(reserveDate),
      startTime: `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`
    }
  },
  // return {
  //   reserveDate: this.formatDate(reserveDate),
  //   startTime: '08:00'
  // }

  // 计算结束时间（默认比开始时间晚1小时）
  calculateEndTime(startTime) {
    const [hours, minutes] = startTime.split(':').map(Number)
    let endHours = hours + 1
    let endMinutes = minutes

    // 处理进位和边界
    if (endHours > 22) {
      endHours = 22
      endMinutes = 0
    } else if (endHours === 22 && endMinutes > 0) {
      endMinutes = 0
    }

    return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`
  },

  // 获取用户信息
  getUserInfo() {
    try {
      const userInfo = wx.getStorageSync('userInfo')
      if (userInfo) {
        this.setData({
          'userInfo.userId': userInfo.userId || userInfo.studentId || '',
          'userInfo.name': userInfo.name || '',
          'userInfo.researchGroup': userInfo.groupName || '',
          'userInfo.phone': userInfo.phone || ''
        })
      }
    } catch (err) {
      // console.error('读取用户信息失败:', err)
    }
  },
  onSearchInput(e) {
    this.setData({
      'filters.searchKeyword': e.detail.value.trim(),
      selectedDevice: null
    }, () => {
      this.getAvailableDevices()
    })
  },

  // 注意！这是将       Object类型        的型号转为        String类型
  getDeviceModel: function (device) {
    var specs = device.specifications || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs.model || '').trim()
    }
    return String(device.model || '').trim()
  },
  // 获取可用仪器
  async getAvailableDevices() {
    this.setData({
      isLoading: true
    })

    try {
      const {
        filters,
        userInfo
      } = this.data
      const res = await wx.cloud.callFunction({
        name: 'getAvailableDevices',
        data: {
          filters: this.data.filters,
          userInfo: this.data.userInfo
        }
      })

      const devices = res.result || []

      // console.log("res:", res)
      // console.log("devices:", devices)

      // 如果有搜索关键词，先过滤原始设备，再分组
      const searchKeyword = filters.searchKeyword?.toLowerCase().trim()
      let rawDevices = searchKeyword ? devices.filter(d => {
        const room = (d.device_room || '').toLowerCase()
        const name = (d.device_name || '').toLowerCase()
        const model = (this.getDeviceModel(d) || '').toLowerCase()
        const lab = (d.lab_name || '').toLowerCase()
        const desc = (d.description || '').toLowerCase()
        const id = (d.device_id || '').toLowerCase()
        return room.includes(searchKeyword) || name.includes(searchKeyword) ||
          model.includes(searchKeyword) || lab.includes(searchKeyword) ||
          desc.includes(searchKeyword) || id.includes(searchKeyword)
      }) : devices

      var groupedMap = {}
      var that = this;

      (rawDevices || []).forEach(function (device) {
        var model = that.getDeviceModel(device)
        var key = (device.device_name || '') + '::' + model
        if (!groupedMap[key]) {
          groupedMap[key] = {
            device_name: device.device_name,
            deviceModel: model,
            labTypes: device.lab_type ? [device.lab_type] : [],
            deviceTypes: device.device_type ? [device.device_type] : [],
            lab_name: device.lab_name,
            device_room: device.device_room,
            totalCount: 1,
            primaryDeviceId: device.device_id,
            device_id: device.device_id,
            picture: device.picture,
            conflictCount: 0,
            // 注意！在这里添加了所有同名设施的device_id
            device_ids: [device.device_id]
          }
        } else {
          groupedMap[key].totalCount++
          // 按部就班添加到数组中
          groupedMap[key].device_ids.push(device.device_id)
          if (device.lab_type && groupedMap[key].labTypes.indexOf(device.lab_type) === -1) {
            groupedMap[key].labTypes.push(device.lab_type)
          }
          if (device.device_type && groupedMap[key].deviceTypes.indexOf(device.device_type) === -1) {
            groupedMap[key].deviceTypes.push(device.device_type)
          }
        }
      })
      // console.log("groupedMap:", groupedMap)
      // console.log("Object.values(groupedMap):", Object.values(groupedMap))
      const valueOfGroupedMap = Object.values(groupedMap).map(item => {
        var labType = item.labTypes.length === 1 ? item.labTypes[0] : 'mixed'
        var deviceType = item.deviceTypes.length === 1 ? item.deviceTypes[0] : 'mixed'
        return {
          ...item,
          lab_type: labType,
          device_type: deviceType
        }
      })
      const deviceIds = valueOfGroupedMap.flatMap(d => d.device_ids)
      // console.log("deviceIds:", deviceIds)
      let conflictMap = {}
      try {
        const res = await wx.cloud.callFunction({
          name: 'checkDeviceConflictsBatch',
          data: {
            valueOfGroupedMap,
            deviceIds,
            reserveDate: this.data.reserveDate,
            startTime: this.data.startTime,
            endTime: this.data.endTime
          }
        })
        // console.log("res2:", res)
        conflictMap = res.result.map || {}
        let reservedDevices = res.result.reservedDevices
        this.setData({
          reservedDevices
        })
        // 
        // console.log("conflictMap,reservedDevices:", conflictMap, this.data.reservedDevices)
      } catch (err) {
        // console.error('批量检查冲突失败:', err)
      }
      // 查询每个设备自身的 status 字段
      const deviceSelfStatusMap = {}
      const deviceIdChunks = []
      for (let i = 0; i < deviceIds.length; i += 20) {
        deviceIdChunks.push(deviceIds.slice(i, i + 20))
      }
      // console.log("deviceIdChunks:",deviceIdChunks)
      for (const chunk of deviceIdChunks) {
        let selfRes
        try {
          selfRes = await db.collection('devices')
            .where({
              device_id: _.in(chunk)
            })
            .field({
              device_id: true,
              status: true
            })
            .get()
        } catch (err) {
          console.error("查询设备状态出错:", err)
        }
        (selfRes.data || []).forEach(item => {
          if (item.device_id) {
            deviceSelfStatusMap[item.device_id] = item.status || 'available'
          }
        })
      }

      // console.log("deviceSelfStatusMap:",deviceSelfStatusMap)
      // 获取每个设备编号的综合状态
      const deviceStatusMap = await this.getDeviceStatusMap(deviceIds, conflictMap, deviceSelfStatusMap)

      let devicesWithStatus = valueOfGroupedMap.map(group => {
        let total = 0
        const deviceStatusList = []
        group.device_ids.forEach(id => {
          total += conflictMap[id] || 0
          deviceStatusList.push({
            device_id: id,
            status: deviceStatusMap[id] || 'available'
          })
        })

        return {
          ...group,
          conflictCount: total,
          remainingCount: Math.max(group.totalCount - total, 0),
          deviceStatusList // 新增：每个设备编号的状态列表
        }
      })

      this.setData({
        availableDevices: devicesWithStatus,
        isLoading: false
      })
    } catch (err) {
      // console.error('获取仪器列表失败:', err)
      this.setData({
        isLoading: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  // 获取每个设备编号在当前时间段的状态
  async getDeviceStatusMap(deviceIds, conflictMap, deviceSelfStatusMap) {
    if (!deviceIds || deviceIds.length === 0) return {}

    const statusMap = {}
    // 默认所有设备为 available
    deviceIds.forEach(id => {
      statusMap[id] = 'available'
    })

    try {
      // 1. 根据设备自身 status 标记维修中的设备（优先级最高）
      if (deviceSelfStatusMap) {
        Object.keys(deviceSelfStatusMap).forEach(id => {
          if (deviceSelfStatusMap[id] === 'maintenance' && statusMap[id] !== undefined) {
            statusMap[id] = 'maintenance'
          }
        })
      }

      // 2. 根据 conflictMap 标记已被预约的设备
      if (conflictMap) {
        Object.keys(conflictMap).forEach(id => {
          if (conflictMap[id] > 0 && statusMap[id] === 'available') {
            statusMap[id] = 'reserved'
          }
        })
      }

      // 3. 分批查询当前正在使用的设备
      const chunkSize = 20
      const chunks = []
      for (let i = 0; i < deviceIds.length; i += chunkSize) {
        chunks.push(deviceIds.slice(i, i + chunkSize))
      }

      for (const chunk of chunks) {
        const usingRes = await db.collection('device_usage')
          .where({
            device_id: _.in(chunk),
            status: 'using'
          })
          .get()

        ;
        (usingRes.data || []).forEach(item => {
          if (item.device_id && statusMap[item.device_id] === 'available') {
            statusMap[item.device_id] = 'using'
          }
        })
      }

    } catch (err) {
      console.error('获取设备状态失败:', err)
    }

    return statusMap
  },

  // 检查仪器冲突
  async checkDeviceConflicts(deviceId) {
    try {
      const {
        reserveDate,
        startTime,
        endTime
      } = this.data
      if (!reserveDate || !startTime || !endTime) return 0

      const _ = db.command
      const startDT = `${startDate} ${startTime}`
      const endDT = `${endDate} ${endTime}`
      const whereConditions = [{
          device_id: deviceId
        },
        {
          status: 'approved'
        },
        _.or([
          _.and([{
            start_time: _.lte(startDT)
          }, {
            end_time: _.gt(startDT)
          }]),
          _.and([{
            start_time: _.lt(endDT)
          }, {
            end_time: _.gte(endDT)
          }]),
          _.and([{
            start_time: _.gte(startDT)
          }, {
            end_time: _.lte(endDT)
          }])
        ])
      ]

      const res = await db.collection('reserves')
        .where(_.and(whereConditions))
        .count()

      return res.total || 0
    } catch (err) {
      // console.error('检查冲突失败:', err)
      return 0
    }
  },

  // 仪器类型筛选
  onDeviceTypeChange(e) {
    const type = e.currentTarget.dataset.type
    // console.log('type', type)
    this.setData({
      'filters.deviceType': type,
      selectedDevice: null // 清空已选仪器
    }, () => {
      this.getAvailableDevices()
    })
    // console.log("filters", this.data.filters)
  },

  onLabTypeChange(e) {
    const type = e.currentTarget.dataset.type
    // console.log(type)
    this.setData({
      'filters.labType': type,
      selectedDevice: null
    }, () => {
      this.getAvailableDevices()
    })
    // console.log("filters", this.data.filters)
  },

  // 选择仪器
  selectDevice(e) {
    const device = e.currentTarget.dataset.device
    this.setData({
      selectedDevice: device,
      selectedIndex: 0
    }, () => {
      this.checkTimeConflict()
      this.checkPastTime()
      // console.log("selectedDevice:", this.data.selectedDevice)
    })
  },

  onStartDateChange(e) {
    const selectedDate = e.detail.value

    // 计算最大结束日期（开始日期+2天）
    const startDateObj = new Date(selectedDate)
    const maxEndDateObj = new Date(startDateObj)
    maxEndDateObj.setDate(startDateObj.getDate() + 2)

    // 如果当前结束日期早于开始日期或超出最大范围，自动调整
    let newEndDate = this.data.endDate
    if (newEndDate < selectedDate || newEndDate > this.formatDate(maxEndDateObj)) {
      newEndDate = selectedDate
    }

    this.setData({
      startDate: selectedDate,
      endDate: newEndDate,
      maxEndDate: this.formatDate(maxEndDateObj)
    }, () => {
      this.getAvailableDevices()
      this.checkTimeConflict()
      this.checkPastTime()
    })
  },

  onEndDateChange(e) {
    const selectedDate = e.detail.value

    // 验证：结束日期不能早于开始日期
    if (selectedDate < this.data.startDate) {
      wx.showToast({
        title: '结束日期不能早于开始日期',
        icon: 'none'
      })
      return
    }

    // 验证：结束日期不能晚于开始日期+2天
    const startDateObj = new Date(this.data.startDate)
    const maxEndDateObj = new Date(startDateObj)
    maxEndDateObj.setDate(startDateObj.getDate() + 2)
    const maxEndDateStr = this.formatDate(maxEndDateObj)

    if (selectedDate > maxEndDateStr) {
      wx.showToast({
        title: '预约最多跨越2天',
        icon: 'none'
      })
      return
    }

    this.setData({
      endDate: selectedDate
    }, () => {
      this.getAvailableDevices()
      this.checkTimeConflict()
      this.checkPastTime()
    })
  },

  // 开始时间选择
  onStartTimeChange(e) {
    const startTime = e.detail.value
    this.setData({
      startTime: startTime
    }, () => {
      this.getAvailableDevices()
      this.checkTimeConflict()
      this.checkPastTime()
    })
  },

  // 结束时间选择
  onEndTimeChange(e) {
    const endTime = e.detail.value
    this.setData({
      endTime: endTime
    }, () => {
      this.getAvailableDevices()
      this.checkTimeConflict()
      this.checkPastTime()
    })
  },

  // 检查时间冲突
  async checkTimeConflict(showToast = true) {
    const {
      selectedDevice,
      startDate,
      startTime,
      endDate,
      endTime
    } = this.data

    if (!selectedDevice || !startDate || !startTime || !endDate || !endTime) return

    try {
      const _ = db.command
      const startDT = `${startDate} ${startTime}`
      const endDT = `${endDate} ${endTime}`

      // 跨天冲突检测：查找任何与该时间段重叠的已批准预约
      const whereConditions = [{
          device_id: selectedDevice.device_id
        },
        {
          status: 'approved'
        },
        _.or([
          // 新预约的开始时间在已有预约时间段内
          _.and([{
            start_time: _.lte(startDT)
          }, {
            end_time: _.gt(startDT)
          }]),
          // 新预约的结束时间在已有预约时间段内
          _.and([{
            start_time: _.lt(endDT)
          }, {
            end_time: _.gte(endDT)
          }]),
          // 新预约完全包含已有预约
          _.and([{
            start_time: _.gte(startDT)
          }, {
            end_time: _.lte(endDT)
          }])
        ])
      ]

      const res = await db.collection('reserves')
        .where(_.and(whereConditions))
        .get()

      const hasConflict = res.data.length > 0
      this.setData({
        timeConflict: hasConflict
      })

      if (hasConflict && showToast) {
        wx.showToast({
          title: '该时间段与其他人预约时间段重叠',
          icon: 'none',
          duration: 3000
        })
      }

      return hasConflict
    } catch (err) {
      return false
    }
  },

  // 检查是否是过去时间
  checkPastTime() {
    const {
      startDate,
      startTime
    } = this.data
    if (!startDate || !startTime) return
    if (!this.isFutureReservationStart(startDate, startTime)) {
      this.setData({
        isPastTime: true
      })
      wx.showToast({
        title: '预约开始时间必须晚于当前时间',
        icon: 'none',
        duration: 3000
      })
      return
    }
    this.setData({
      isPastTime: false
    })
  },

  // 生成时间槽（8:00-22:00）
  generateTimeSlots() {
    const slots = []
    for (let hour = 8; hour <= 22; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`)
      if (hour < 22) {
        slots.push(`${hour.toString().padStart(2, '0')}:30`)
      }
    }
    this.setData({
      timeSlots: slots
    })
  },

  requestSubscribeReminder() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '开启预约开始提醒',
        content: '系统将在您预约开始前30分钟通过微信服务通知提醒您。\n\n点击"允许"将在下一步请求订阅授权，请在授权弹窗中选择"允许接收"。',
        confirmText: '去授权',
        cancelText: '暂不',
        success: (res) => {
          if (res.confirm) {
            wx.requestSubscribeMessage({
              tmplIds: [RESERVE_REMIND_TPL_ID],
              success: (subRes) => {
                console.log('预约开始提醒订阅结果:', subRes[RESERVE_REMIND_TPL_ID])
                resolve()
              },
              fail: (err) => {
                console.error('预约开始提醒订阅失败:', err)
                resolve()
              }
            })
          } else {
            console.log('用户取消预约开始提醒订阅')
            resolve()
          }
        },
        fail: () => {
          resolve()
        }
      })
    })
  },

  // 提交预约                      checkTimeConflict
  async submitReservation() {
    if (this.data.isLoading) return

    // 验证表单
    if (!this.validateForm()) return
    if (!this.data.reservePage) {
      wx.showToast({
        title: '请上传系统预约单',
        icon: 'none'
      })
      return
    }
    await this.requestSubscribeReminder()
    this.setData({
      isLoading: true
    })

    // 再次检查时间冲突
    const hasConflict = await this.checkTimeConflict(false)
    if (hasConflict) {
      wx.showToast({
        title: '该时间段与其他人预约时间段重叠',
        icon: 'none'
      })
      this.setData({
        isLoading: false
      })
      return
    }

    // 再次检查是否是当前或过去时间
    if (!this.isFutureReservationStart(this.data.startDate, this.data.startTime)) {
      this.setData({
        isPastTime: true
      })
      wx.showToast({
        title: '预约开始时间必须晚于当前时间',
        icon: 'none'
      })
      this.setData({
        isLoading: false
      })
      return
    }
    this.setData({
      isPastTime: false
    })

    try {
      // 等待预约单上传完成，拿到 fileID 后再继续
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `reserve_pages/${Date.now()}.jpg`,
        filePath: this.data.reservePage
      })
      const reservePageFileID = uploadRes.fileID
      console.log('预约单上传成功：', reservePageFileID)
      this.setData({
        reservePageFileID
      })
    } catch (err) {
      console.error('预约单上传失败:', err)
      wx.showToast({
        title: '预约单上传失败，请重试',
        icon: 'none'
      })
      this.setData({
        isLoading: false
      })
      return
    }

    // 构建预约数据

    // 构建预约数据
    const storedUserInfo = wx.getStorageSync('userInfo') || {}
    const reserveData = {
      device_id: this.data.selectedDevice.device_id,
      device_name: this.data.selectedDevice.device_name,
      device_type: this.data.selectedDevice.device_type,
      lab_type: this.data.selectedDevice.lab_type,
      lab_name: this.data.selectedDevice.lab_name,

      reserve_date: this.data.startDate, // 以开始日期为主
      start_time: `${this.data.startDate} ${this.data.startTime}`,
      end_time: `${this.data.endDate} ${this.data.endTime}`,
      start_ts: this.getReservationTimeMs(this.data.startDate, this.data.startTime),
      end_ts: this.getReservationTimeMs(this.data.endDate, this.data.endTime),
      reserve_page: this.data.reservePageFileID,

      user_id: this.data.userInfo.userId,
      student_name: this.data.userInfo.name,
      research_group: this.data.userInfo.researchGroup,
      phone: this.data.userInfo.phone,
      _openid: storedUserInfo.openid || '',

      create_time: new Date().toISOString()
    }

    try {
      var useCloudFunction = false
      try {
        var checkRes = await wx.cloud.callFunction({
          name: 'getOpenId'
        })
        if (checkRes && checkRes.result) {
          useCloudFunction = true
        }
      } catch (e) {
        useCloudFunction = false
      }

      if (useCloudFunction) {
        try {
          const cloudRes = await wx.cloud.callFunction({
            name: 'createReservation',
            data: {
              reserveData
            }
          })
          const result = cloudRes && cloudRes.result ? cloudRes.result : {}

          if (!result.success) {
            if (result.code === 'TIME_CONFLICT') {
              wx.showToast({
                title: '该时间段与其他人预约时间段重叠',
                icon: 'none'
              })
              this.setData({
                timeConflict: true
              })
              return
            }

            if (result.code === 'INVALID_TIME') {
              wx.showToast({
                title: result.error || '预约时间无效',
                icon: 'none'
              })
              return
            }

            throw new Error(result.error || '预约失败，请重试')
          }
        } catch (cloudErr) {
          // console.warn('云函数调用失败，降级为前端直接写入:', cloudErr)
          await this.createReservationDirectly(reserveData)
        }
      } else {
        await this.createReservationDirectly(reserveData)
      }

      wx.showToast({
        title: '预约成功！',
        icon: 'success',
        duration: 2000
      })
      var currentDevices = this.data.availableDevices
      var currentSelected = this.data.selectedDevice
      if (currentSelected && currentDevices.length > 0) {
        var updatedDevices = currentDevices.map(function (dev) {
          if (dev.device_ids.includes(currentSelected.device_id)) {
            var newConflict = (dev.conflictCount || 0) + 1 // 已预约次数+1
            var newRemaining = (dev.totalCount || 0) - newConflict // 剩余次数-1
            if (newRemaining < 0) newRemaining = 0
            return Object.assign({}, dev, {
              conflictCount: newConflict,
              remainingCount: newRemaining
            })
          }
          return dev
        })
        // 更新页面设备列表
        this.setData({
          availableDevices: updatedDevices
        })
      }

      setTimeout(() => {
        this.setData({
          selectedDevice: null,
          timeConflict: false,
          isPastTime: false
        })
        this.getAvailableDevices()
      }, 2000)

    } catch (err) {
      // console.error('提交预约失败:', err)
      wx.showToast({
        title: '预约失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({
        isLoading: false
      })
    }
  },

  async createReservationDirectly(reserveData) {
    var _ = db.command
    var startDT = reserveData.start_time
    var endDT = reserveData.end_time

    var overlapRes = await db.collection('reserves')
      .where(_.and([{
          device_id: reserveData.device_id
        },
        {
          status: 'approved'
        },
        _.or([
          _.and([{
            start_time: _.lte(startDT)
          }, {
            end_time: _.gt(startDT)
          }]),
          _.and([{
            start_time: _.lt(endDT)
          }, {
            end_time: _.gte(endDT)
          }]),
          _.and([{
            start_time: _.gte(startDT)
          }, {
            end_time: _.lte(endDT)
          }])
        ])
      ]))
      .limit(1)
      .get()

    if (overlapRes.data && overlapRes.data.length > 0) {
      this.setData({
        timeConflict: true
      })
      throw new Error('该时间段与其他人预约时间段重叠')
    }

    var record = Object.assign({}, reserveData, {
      status: 'approved',
      usage_status: 'not_started',
      start_reminder_sent: false,
      start_reminder_sent_at: '',
      linked_usage_id: '',
      create_time: new Date().toISOString()
    })
    delete record._openid

    var addRes = await db.collection('reserves').add({
      data: record
    })

    await db.collection('messages').add({
      data: {
        user_id: reserveData.user_id,
        title: '预约成功',
        content: '您已成功预约' + reserveData.device_name + '，预约时间为' + reserveData.start_time + ' 至 ' + reserveData.end_time + '。',
        type: 'reservation_success',
        related_id: addRes._id,
        message_key: 'reservation_success:' + addRes._id,
        is_read: false,
        create_time: new Date().toISOString()
      }
    })
  },

  validateForm() {
    const {
      selectedDevice,
      startDate,
      startTime,
      endDate,
      endTime,
      userInfo
    } = this.data

    if (!selectedDevice) {
      wx.showToast({
        title: '请选择仪器',
        icon: 'none'
      })
      return false
    }

    if (!startDate) {
      wx.showToast({
        title: '请选择开始日期',
        icon: 'none'
      })
      return false
    }

    if (!startTime) {
      wx.showToast({
        title: '请选择开始时间',
        icon: 'none'
      })
      return false
    }

    if (!endDate) {
      wx.showToast({
        title: '请选择结束日期',
        icon: 'none'
      })
      return false
    }

    if (!endTime) {
      wx.showToast({
        title: '请选择结束时间',
        icon: 'none'
      })
      return false
    }

    // 检查开始时间是否在8:00-22:30范围内
    // 检查开始时间是否在8:00-22:00范围内
    const startHour = parseInt(startTime.split(':')[0])
    const startMinute = parseInt(startTime.split(':')[1])
    if (startHour < 8 || startHour > 22) {
      wx.showToast({
        title: '开始时间必须在8:00-22:00之间',
        icon: 'none'
      })
      return false
    }
    if (startHour === 22 && startMinute > 0) {
      wx.showToast({
        title: '开始时间不能晚于22:00',
        icon: 'none'
      })
      return false
    }

    // 检查结束时间是否在8:00-22:00范围内
    const endHour = parseInt(endTime.split(':')[0])
    const endMinute = parseInt(endTime.split(':')[1])
    if (endHour < 8 || endHour > 22) {
      wx.showToast({
        title: '结束时间必须在8:00-22:00之间',
        icon: 'none'
      })
      return false
    }
    if (endHour === 22 && endMinute > 0) {
      wx.showToast({
        title: '结束时间不能晚于22:00',
        icon: 'none'
      })
      return false
    }

    // 结束日期不能早于开始日期
    if (endDate < startDate) {
      wx.showToast({
        title: '结束日期不能早于开始日期',
        icon: 'none'
      })
      return false
    }

    // 结束日期不能晚于开始日期+2天
    const startDateObj = new Date(startDate)
    const maxEndDateObj = new Date(startDateObj)
    maxEndDateObj.setDate(startDateObj.getDate() + 2)
    const maxEndDateStr = this.formatDate(maxEndDateObj)
    if (endDate > maxEndDateStr) {
      wx.showToast({
        title: '预约最多跨越2天',
        icon: 'none'
      })
      return false
    }

    // 如果是同一天，结束时间必须晚于开始时间
    if (endDate === startDate) {
      const startTotalMinutes = startHour * 60 + startMinute
      const endTotalMinutes = endHour * 60 + endMinute
      if (endTotalMinutes <= startTotalMinutes) {
        wx.showToast({
          title: '结束时间必须晚于开始时间',
          icon: 'none'
        })
        return false
      }
    }

    // 检查是否是当前或过去时间
    if (!this.isFutureReservationStart(startDate, startTime)) {
      wx.showToast({
        title: '预约开始时间必须晚于当前时间',
        icon: 'none'
      })
      return false
    }

    // 检查用户信息
    if (!userInfo.userId || !userInfo.name || !userInfo.researchGroup) {
      wx.showToast({
        title: '请先完成用户认证',
        icon: 'none'
      })
      return false
    }

    return true
  },

  // 辅助函数：格式化日期为 YYYY-MM-DD
  formatDate(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  parseDateTime(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('-').map(Number)
    const [hours, minutes] = timeStr.split(':').map(Number)
    return new Date(year, month - 1, day, hours, minutes, 0, 0)
  },

  getReservationTimeMs(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('-').map(Number)
    const [hours, minutes] = timeStr.split(':').map(Number)
    return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime()
  },

  isFutureReservationStart(dateStr, timeStr) {
    return this.getReservationTimeMs(dateStr, timeStr) > Date.now()
  },

  requestSubscribeMessage() {
    if (!RESERVATION_TEMPLATE_ID || RESERVATION_TEMPLATE_ID === 'your_template_id_here') return
    wx.requestSubscribeMessage({
      tmplIds: [RESERVATION_TEMPLATE_ID],
      success(res) {
        // console.log('订阅消息授权结果:', res)
      },
      fail(err) {
        // console.log('订阅消息授权失败:', err)
      }
    })
  },

  onSelectDevice(e) {
    const index = e.currentTarget.dataset.index;
    const device_id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;

    // 维修中或使用中的设备不可预约
    if (status === 'maintenance') {
      wx.showToast({
        title: '该设备维修中，不可预约',
        icon: 'none'
      })
      return
    }
    if (status === 'using') {
      wx.showToast({
        title: '该设备正在使用中，不可预约',
        icon: 'none'
      })
      return
    }

    const selectedDevice = this.data.selectedDevice;
    this.setData({
      selectedIndex: index,
      selectedDevice: {
        ...selectedDevice,
        device_id: device_id
      }
    }, () => {
      this.checkTimeConflict();
      this.checkPastTime();
    });
  },

  pickReservePage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        const reservePage = tempFilePath
        this.setData({
          reservePage
        })
        console.log('reservePage:', reservePage)
      },
      fail(err) {
        console.log('选择预约单失败：', err)
      }
    })
  }
})