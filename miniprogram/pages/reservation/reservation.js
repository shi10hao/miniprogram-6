const db = wx.cloud.database()
const RESERVATION_TEMPLATE_ID = 'FClBgpZO9KXJ79M0ZAqqrEDoqWlXWPmRz862s6zVP4M'

Page({
  data: {
    // 用户信息
    userInfo: {
      userId: '',
      name: '',
      researchGroup: '', // 课题组
      phone: ''
    },

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
    maxDate: '' // 最大日期（30天后）
  },

  onLoad() {
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
    this.setData({
      minDate: this.formatDate(today),
      maxDate: this.formatDate(maxDate),
      reserveDate: initialSlot.reserveDate,
      startTime: initialSlot.startTime
    }, () => {
      const endTime = this.calculateEndTime(this.data.startTime)
      this.setData({
        endTime
      })
    })

    this.generateTimeSlots()
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
      console.error('读取用户信息失败:', err)
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

      console.log("res",res)
      console.log("devices",devices)
      var groupedMap = {}
      var that = this;

      (devices || []).forEach(function (device) {
        var model = that.getDeviceModel(device)
        var key = (device.device_name || '') + '::' + model
        if (!groupedMap[key]) {
          groupedMap[key] = {
            device_name: device.device_name,
            deviceModel: model,
            lab_type: device.lab_type,
            device_type: device.device_type,
            lab_name: device.lab_name,
            device_room: device.device_room,
            totalCount: 1,
            primaryDeviceId: device.device_id,
            device_id: device.device_id,
            picture: device.picture,
            conflictCount: 0
          }
        } else {
          groupedMap[key].totalCount++
        }
      })

      const deviceIds = Object.values(groupedMap).map(d => d.primaryDeviceId)
      let conflictMap = {}
      try {
        const res = await wx.cloud.callFunction({
          name: 'checkDeviceConflictsBatch',
          data: {
            deviceIds,
            reserveDate: this.data.reserveDate,
            startTime: this.data.startTime,
            endTime: this.data.endTime
          }
        })
        conflictMap = res.result || {}
      } catch (err) {
        console.error('批量检查冲突失败:', err)
      }
      let devicesWithStatus = Object.values(groupedMap).map(device => {
        const conflictCount = conflictMap[device.primaryDeviceId] || 0
        const remaining = Math.max(device.totalCount - conflictCount, 0)
      
        return {
          ...device,
          conflictCount,
          remainingCount: remaining
        }
      })
      // var devicesWithStatus = await Promise.all(
      //   Object.values(groupedMap).map(async (device) => {
      //     var conflictCount = await that.checkDeviceConflicts(device.primaryDeviceId)
      //     var remaining = device.totalCount - conflictCount
      //     if (remaining < 0) remaining = 0
      //     return {
      //       ...device,
      //       conflictCount: conflictCount,
      //       remainingCount: remaining
      //     }
      //   })
      // )

      if (filters.searchKeyword) {
        const keyword = filters.searchKeyword.toLowerCase()

        devicesWithStatus = devicesWithStatus.filter(device => {
          const deviceName = (device.device_name || '').toLowerCase()
          const model = (device.deviceModel || '').toLowerCase()
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

      this.setData({
        availableDevices: devicesWithStatus,
        isLoading: false
      })
    } catch (err) {
      console.error('获取仪器列表失败:', err)
      this.setData({
        isLoading: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
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
      const startDT = `${reserveDate} ${startTime}`
      const endDT = `${reserveDate} ${endTime}`
      const whereConditions = [{
          device_id: deviceId,
          reserve_date: reserveDate
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
      console.error('检查冲突失败:', err)
      return 0
    }
  },

  // 仪器类型筛选
  onDeviceTypeChange(e) {
    const type = e.currentTarget.dataset.type
    console.log('type',type)
    this.setData({
      'filters.deviceType': type,
      selectedDevice: null // 清空已选仪器
    }, () => {
      this.getAvailableDevices()
    })
    console.log("filters",this.data.filters)
  },

  onLabTypeChange(e) {
    const type = e.currentTarget.dataset.type
    console.log(type)
    this.setData({
      'filters.labType': type,
      selectedDevice: null
    }, () => {
      this.getAvailableDevices()
    })
    console.log("filters",this.data.filters)
  },

  // 选择仪器
  selectDevice(e) {
    const device = e.currentTarget.dataset.device
    this.setData({
      selectedDevice: device
    }, () => {
      this.checkTimeConflict()
      this.checkPastTime()
    })
  },

  // 日期选择
  onDateChange(e) {
    const selectedDate = e.detail.value
    this.setData({
      reserveDate: selectedDate
    }, () => {
      this.getAvailableDevices()
      this.checkTimeConflict()
      this.checkPastTime()
    })
  },

  // 开始时间选择
  onStartTimeChange(e) {
    const startTime = e.detail.value
    const endTime = this.calculateEndTime(startTime)

    this.setData({
      startTime: startTime,
      endTime: endTime
    }, () => {
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
      this.checkTimeConflict()
      this.checkPastTime()
    })
  },

  // 检查时间冲突
  async checkTimeConflict(showToast = true) {
    const {
      selectedDevice,
      reserveDate,
      startTime,
      endTime
    } = this.data

    if (!selectedDevice || !reserveDate || !startTime || !endTime) return

    try {
      const _ = db.command
      const startDT = `${reserveDate} ${startTime}`
      const endDT = `${reserveDate} ${endTime}`
      const whereConditions = [{
          device_id: selectedDevice.device_id,
          reserve_date: reserveDate
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
      console.error('检查时间冲突失败:', err)
      return false
    }
  },

  // 检查是否是过去时间
  checkPastTime() {
    const {
      reserveDate,
      startTime
    } = this.data

    if (!reserveDate || !startTime) return

    if (!this.isFutureReservationStart(reserveDate, startTime)) {
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

  // 提交预约
  async submitReservation() {
    if (this.data.isLoading) return

    // 验证表单
    if (!this.validateForm()) return

    this.requestSubscribeMessage()

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
    if (!this.isFutureReservationStart(this.data.reserveDate, this.data.startTime)) {
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

    // 构建预约数据
    const storedUserInfo = wx.getStorageSync('userInfo') || {}
    const reserveData = {
      device_id: this.data.selectedDevice.device_id,
      device_name: this.data.selectedDevice.device_name,
      device_type: this.data.selectedDevice.device_type,
      lab_type: this.data.selectedDevice.lab_type,
      lab_name: this.data.selectedDevice.lab_name,

      reserve_date: this.data.reserveDate,
      start_time: `${this.data.reserveDate} ${this.data.startTime}`,
      end_time: `${this.data.reserveDate} ${this.data.endTime}`,
      start_ts: this.getReservationTimeMs(this.data.reserveDate, this.data.startTime),
      end_ts: this.getReservationTimeMs(this.data.reserveDate, this.data.endTime),

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
          console.warn('云函数调用失败，降级为前端直接写入:', cloudErr)
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
          if (dev.device_id === currentSelected.device_id) {
            var newConflict = (dev.conflictCount || 0) + 1
            var newRemaining = (dev.totalCount || 0) - newConflict
            if (newRemaining < 0) newRemaining = 0
            return Object.assign({}, dev, {
              conflictCount: newConflict,
              remainingCount: newRemaining
            })
          }
          return dev
        })
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
      console.error('提交预约失败:', err)
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
          device_id: reserveData.device_id,
          reserve_date: reserveData.reserve_date
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

  // 表单验证 - 添加时间验证
  validateForm() {
    const {
      selectedDevice,
      reserveDate,
      startTime,
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

    if (!reserveDate) {
      wx.showToast({
        title: '请选择预约日期',
        icon: 'none'
      })
      return false
    }

    if (!startTime || !endTime) {
      wx.showToast({
        title: '请选择预约时间',
        icon: 'none'
      })
      return false
    }

    // 检查时间是否在8:00-22:00范围内
    const startHour = parseInt(startTime.split(':')[0])
    const startMinute = parseInt(startTime.split(':')[1])
    const endHour = parseInt(endTime.split(':')[0])
    const endMinute = parseInt(endTime.split(':')[1])

    // 开始时间检查
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

    // 结束时间检查
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

    // 结束时间必须晚于开始时间
    const startTotalMinutes = startHour * 60 + startMinute
    const endTotalMinutes = endHour * 60 + endMinute

    if (endTotalMinutes <= startTotalMinutes) {
      wx.showToast({
        title: '结束时间必须晚于开始时间',
        icon: 'none'
      })
      return false
    }

    // 检查是否是当前或过去时间
    if (!this.isFutureReservationStart(reserveDate, startTime)) {
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
    return Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0)
  },

  isFutureReservationStart(dateStr, timeStr) {
    return this.getReservationTimeMs(dateStr, timeStr) > Date.now()
  },

  requestSubscribeMessage() {
    if (!RESERVATION_TEMPLATE_ID || RESERVATION_TEMPLATE_ID === 'your_template_id_here') return
    wx.requestSubscribeMessage({
      tmplIds: [RESERVATION_TEMPLATE_ID],
      success(res) {
        console.log('订阅消息授权结果:', res)
      },
      fail(err) {
        console.log('订阅消息授权失败:', err)
      }
    })
  }
})