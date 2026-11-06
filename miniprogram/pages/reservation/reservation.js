const db = wx.cloud.database()
const _ = db.command
const cloudFile = require('../../utils/cloudFile.js')
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
    // 当前选中的仪器编号。空字符串表示还没选编号
    // （选中态由 availableDevices[].deviceStatusList[].active 驱动，不再用下标）
    selectedDeviceId: '',
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
    // 从详情页带编号进来时：滚到那张卡 + 一句"还能换一台"的提示
    scrollTarget: '',
    preselectHint: '',

    // 预约时间
    reserveDate: '',
    startTime: '08:00',
    endTime: '09:00',
    timeSlots: [], // 8:00-22:00的时间段

    // 状态
    isLoading: false,
    // 「提交中」单独一个状态：原来复用 isLoading，导致筛选刷新列表时
    // 底部按钮也会显示「提交中…」，看起来像在重复提交
    isSubmitting: false,
    timeConflict: false,
    isPastTime: false, // 新增：是否是过去时间

    // 其他参数
    minDate: '', // 最小日期（今天）
    maxDate: '', // 最大日期（30天后）
    reservePage: '',
    reservePageFileID: '',
    maxEndDate: '' // 新增：结束日期最大可选值
  },

  onLoad(options) {
    // 登录态校验
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo) {
      wx.redirectTo({
        url: '/pages/auth/auth'
      })
      return
    }

    // 请求序号：只让最后一次请求的结果落地，丢弃过期的慢响应
    this._loadSeq = 0
    // 搜索/筛选防抖定时器
    this._searchTimer = null
    // 从仪器详情页「去预约」进来时带上的编号，列表加载完自动选中（用完即清空）
    this._preselectDeviceId = String((options && options.deviceId) || '').trim()

    this.initData()
    this.getUserInfo()
    this.getAvailableDevices()
  },

  onUnload() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
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
  // 搜索输入：防抖，避免每敲一个字就打一轮云函数
  onSearchInput(e) {
    const keyword = e.detail.value.trim()
    this.resetDeviceSelection({
      'filters.searchKeyword': keyword
    })

    this.scheduleReload()
  },

  // 清除搜索关键词（原来 wxml 绑定了 clearSearch 但 js 里没有实现，点了没反应）
  clearSearch() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
    this.resetDeviceSelection({
      'filters.searchKeyword': ''
    }, () => {
      this.getAvailableDevices()
    })
  },

  // 合并短时间内的多次「重新加载仪器列表」请求
  scheduleReload(delay = 350) {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
    }
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null
      this.getAvailableDevices()
    }, delay)
  },

  // 立即重载（用于点击筛选按钮这类明确的一次性操作）
  reloadNow() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer)
      this._searchTimer = null
    }
    this.getAvailableDevices()
  },

  // 注意！这是将       Object类型        的型号转为        String类型
  getDeviceModel(device) {
    const specs = device.specifications || {}
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

    // 请求序号：并发/连续触发时，只有最新一次的结果允许写入 data
    const seq = ++this._loadSeq

    try {
      const {
        filters,
        userInfo
      } = this.data
      const res = await wx.cloud.callFunction({
        name: 'getAvailableDevices',
        data: {
          filters: this.data.filters,
          userInfo: this.data.userInfo,
          reserveDate: this.data.reserveDate,
          startTime: this.data.startTime,
          endTime: this.data.endTime
        }
      })

      // 兼容新老两种返回结构：新的是对象，老的是数组
      const result = res.result || {}
      const devices = Array.isArray(result) ? result : (result.list || [])
      const conflictMap = (Array.isArray(result) ? {} : (result.conflictMap || {}))
      const reservedDevices = (Array.isArray(result) ? [] : (result.reservedDevices || []))
      const usingDeviceIds = (Array.isArray(result) ? null : (result.usingDeviceIds || null))

      // 如果有搜索关键词，先过滤原始设备，再分组
      const searchKeyword = filters.searchKeyword?.toLowerCase().trim()
      const rawDevices = searchKeyword
        ? devices.filter((d) => {
            const room = (d.device_room || '').toLowerCase()
            const name = (d.device_name || '').toLowerCase()
            const model = (this.getDeviceModel(d) || '').toLowerCase()
            const lab = (d.lab_name || '').toLowerCase()
            const desc = (d.description || '').toLowerCase()
            const id = (d.device_id || '').toLowerCase()
            return room.includes(searchKeyword) || name.includes(searchKeyword)
              || model.includes(searchKeyword) || lab.includes(searchKeyword)
              || desc.includes(searchKeyword) || id.includes(searchKeyword)
          })
        : devices

      const groupedMap = {}
      const that = this;

      (rawDevices || []).forEach(function (device) {
        const model = that.getDeviceModel(device)
        const key = (device.device_name || '') + '::' + model
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

      const valueOfGroupedMap = Object.values(groupedMap).map((item) => {
        const labType = item.labTypes.length === 1 ? item.labTypes[0] : 'mixed'
        const deviceType = item.deviceTypes.length === 1 ? item.deviceTypes[0] : 'mixed'
        return {
          ...item,
          lab_type: labType,
          device_type: deviceType
        }
      })

      const deviceIds = valueOfGroupedMap.flatMap(d => d.device_ids)

      // 「设备自身 status」与「使用中状态」原本是逐批串行 await，
      // 现在只保留 devices 自身 status 这一步，chunk 之间并发执行；
      // 使用中状态已由云函数一并返回，不再单独往返。
      const deviceSelfStatusMap = await this.fetchDeviceSelfStatusMap(deviceIds)
      const usingStatusMap = usingDeviceIds === null
        ? await this.fetchUsingStatusMap(deviceIds)
        : this.buildUsingStatusMap(usingDeviceIds)

      if (seq !== this._loadSeq) {
        // 已经有更新的请求在跑了，丢弃这次结果
        return
      }

      // 合成每个设备编号的综合状态
      const deviceStatusMap = this.getDeviceStatusMap(deviceIds, conflictMap, deviceSelfStatusMap, usingStatusMap)

      // 保留当前已选仪器：列表重新加载后选中态不应该丢失
      const keepDeviceId = this.data.selectedDeviceId || ''

      const devicesWithStatus = valueOfGroupedMap.map((group) => {
        let total = 0
        const deviceStatusList = []
        group.device_ids.forEach((id) => {
          total += conflictMap[id] || 0
          deviceStatusList.push({
            device_id: id,
            status: deviceStatusMap[id] || 'available',
            active: id === keepDeviceId
          })
        })

        return {
          ...group,
          conflictCount: total,
          remainingCount: Math.max(group.totalCount - total, 0),
          deviceStatusList // 每个设备编号的状态列表，与 device_ids 一一对应
        }
      })

      // 列表刷新后重新绑定选中项，避免 selectedDevice 指向已失效的数据
      let nextSelectedDevice = this.data.selectedDevice
      if (keepDeviceId) {
        const group = devicesWithStatus.find(g => g.device_ids.indexOf(keepDeviceId) !== -1)
        if (group) {
          nextSelectedDevice = group
        } else {
          // 选中的仪器被筛掉或不可用了，清空选中
          nextSelectedDevice = null
        }
      }

      this.setData({
        availableDevices: devicesWithStatus,
        reservedDevices,
        selectedDevice: nextSelectedDevice,
        selectedDeviceId: nextSelectedDevice ? keepDeviceId : '',
        isLoading: false
      }, () => {
        // 从详情页跳过来时，列表一就绪就把那一台选中
        this.applyPreselect(devicesWithStatus)
      })

      // 图片是 cloud:// fileID，异步换成临时链接，避免渲染层 500
      this.resolveDevicePictures()
    } catch (err) {
      if (seq !== this._loadSeq) {
        return
      }
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

  // 详情页带 deviceId 跳过来时自动选中那一台；只认可用状态的设备，其余给一句提示
  applyPreselect(devices) {
    const deviceId = this._preselectDeviceId
    if (!deviceId) return
    // 只消费一次，之后列表刷新（换日期、搜索）不再抢用户的手动选择
    this._preselectDeviceId = ''

    let groupIndex = -1
    let targetStatus = ''
    devices.forEach((group, gi) => {
      (group.deviceStatusList || []).forEach((item) => {
        if (item.device_id !== deviceId) return
        groupIndex = gi
        targetStatus = item.status
      })
    })

    if (groupIndex === -1 || targetStatus !== 'available') {
      wx.showToast({
        title: '这台仪器当前不可预约',
        icon: 'none'
      })
      return
    }

    const group = devices[groupIndex]
    const usable = group.deviceStatusList.filter(item => item.status === 'available').length
    const patch = {
      selectedDevice: group,
      selectedDeviceId: deviceId,
      preselectHint: usable > 1 ? '同款 ' + usable + ' 台可用，点下面的编号可以换一台' : ''
    }
    group.deviceStatusList.forEach((item, i) => {
      patch[`availableDevices[${groupIndex}].deviceStatusList[${i}].active`] = item.device_id === deviceId
    })

    this.setData(patch, () => {
      // 卡片已经渲染出来之后再滚，第一次 setData 时节点还不存在，滚不过去
      this.setData({ scrollTarget: 'device-' + group.device_ids[0] })
      this.checkTimeConflict(false)
    })
  },

  // 把仪器卡片的 cloud:// 图片换成临时链接（有缓存，重复加载几乎零开销）
  resolveDevicePictures() {
    const seq = this._loadSeq
    const devices = this.data.availableDevices || []
    const cloudIds = devices
      .map(d => d.picture)
      .filter(id => cloudFile.isCloudFileId(id))

    if (!cloudIds.length) return Promise.resolve()

    return cloudFile.resolveTempUrls(cloudIds)
      .then((map) => {
        if (seq !== this._loadSeq) return
        const patch = {}
        devices.forEach((d, i) => {
          if (!cloudFile.isCloudFileId(d.picture)) return
          const url = cloudFile.resolveSingle(d.picture, map)
          if (url) patch[`availableDevices[${i}].picture`] = url
        })
        if (Object.keys(patch).length) this.setData(patch)
      })
      .catch((err) => {
        console.error('解析仪器图片失败:', err)
      })
  },

  // 单张仪器图片加载失败 → 收起图片，避免反复重试刷屏
  onDeviceImgError(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    this.setData({
      [`availableDevices[${index}].imgFailed`]: true
    })
  },

  // 分批并发查询设备自身的 status 字段
  fetchDeviceSelfStatusMap(deviceIds) {
    const selfStatusMap = {}
    if (!deviceIds || deviceIds.length === 0) return Promise.resolve(selfStatusMap)

    const chunks = []
    for (let i = 0; i < deviceIds.length; i += 20) {
      chunks.push(deviceIds.slice(i, i + 20))
    }

    return Promise.all(chunks.map(chunk =>
      db.collection('devices')
        .where({ device_id: _.in(chunk) })
        .field({ device_id: true, status: true })
        .get()
        .catch((err) => {
          console.error('查询设备状态出错:', err)
          return { data: [] }
        })
    )).then((results) => {
      results.forEach((selfRes) => {
        (selfRes.data || []).forEach((item) => {
          if (item.device_id) {
            selfStatusMap[item.device_id] = item.status || 'available'
          }
        })
      })
      return selfStatusMap
    })
  },

  // 分批并发查询「使用中」的设备（云函数未返回时的兜底路径）
  fetchUsingStatusMap(deviceIds) {
    const statusMap = {}
    if (!deviceIds || deviceIds.length === 0) return Promise.resolve(statusMap)

    const chunks = []
    for (let i = 0; i < deviceIds.length; i += 20) {
      chunks.push(deviceIds.slice(i, i + 20))
    }

    return Promise.all(chunks.map(chunk =>
      db.collection('device_usage')
        .where({ device_id: _.in(chunk), status: 'using' })
        .field({ device_id: true })
        .get()
        .catch((err) => {
          console.error('查询使用中设备出错:', err)
          return { data: [] }
        })
    )).then((results) => {
      results.forEach((usingRes) => {
        (usingRes.data || []).forEach((item) => {
          if (item.device_id) {
            statusMap[item.device_id] = 'using'
          }
        })
      })
      return statusMap
    })
  },

  buildUsingStatusMap(usingDeviceIds) {
    const statusMap = {}
    ;(usingDeviceIds || []).forEach((id) => {
      statusMap[id] = 'using'
    })
    return statusMap
  },

  // 合成每个设备编号在当前时间段的状态（纯内存计算，不再访问网络）
  // 优先级：维修中 > 使用中 > 已预约 > 可用
  getDeviceStatusMap(deviceIds, conflictMap, deviceSelfStatusMap, usingStatusMap) {
    if (!deviceIds || deviceIds.length === 0) return {}

    const statusMap = {}
    // 默认所有设备为 available
    deviceIds.forEach((id) => {
      statusMap[id] = 'available'
    })

    // 1. 根据设备自身 status 标记维修中的设备（优先级最高）
    if (deviceSelfStatusMap) {
      Object.keys(deviceSelfStatusMap).forEach((id) => {
        if (deviceSelfStatusMap[id] === 'maintenance' && statusMap[id] !== undefined) {
          statusMap[id] = 'maintenance'
        }
      })
    }

    // 2. 根据 conflictMap 标记已被预约的设备
    if (conflictMap) {
      Object.keys(conflictMap).forEach((id) => {
        if (conflictMap[id] > 0 && statusMap[id] === 'available') {
          statusMap[id] = 'reserved'
        }
      })
    }

    // 3. 标记当前正在使用的设备
    if (usingStatusMap) {
      Object.keys(usingStatusMap).forEach((id) => {
        if (statusMap[id] === 'available') {
          statusMap[id] = 'using'
        }
      })
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
      // 本方法当前无调用方（死代码）。startDate/endDate 未定义，疑为 reserveDate 的笔误，
      // 改了会改变冲突检测行为，故只标注不改，等业务方确认。
      // eslint-disable-next-line no-undef
      const startDT = `${startDate} ${startTime}`
      // eslint-disable-next-line no-undef
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
    this.resetDeviceSelection({
      'filters.deviceType': type
    }, () => {
      this.reloadNow()
    })
    // console.log("filters", this.data.filters)
  },

  onLabTypeChange(e) {
    const type = e.currentTarget.dataset.type
    // console.log(type)
    this.resetDeviceSelection({
      'filters.labType': type
    }, () => {
      this.reloadNow()
    })
    // console.log("filters", this.data.filters)
  },

  // 统一清空「已选仪器 + 已选编号 + 编号高亮」
  // 只清 selectedDevice 是不够的：getAvailableDevices() 会拿 selectedDeviceId
  // 把选中态原样恢复回来，看起来就是「清空了又自己选上」
  // extra 里的字段会覆盖默认值，供 selectDevice 这类「换组但不清空」的场景复用
  resetDeviceSelection(extra = {}, callback) {
    const patch = Object.assign({
      selectedDevice: null,
      selectedDeviceId: ''
    }, extra)
    const groups = this.data.availableDevices || []
    groups.forEach((group, groupIndex) => {
      (group.deviceStatusList || []).forEach((item, deviceIndex) => {
        if (!item.active) return
        patch[`availableDevices[${groupIndex}].deviceStatusList[${deviceIndex}].active`] = false
      })
    })
    this.setData(patch, callback)
  },

  // 选择仪器组：只负责展开该组，具体编号由 onSelectDevice 选择
  selectDevice(e) {
    const device = e.currentTarget.dataset.device
    if (!device) return
    // 再次点同一组时保留已经选好的编号：原来会无脑清空 selectedDeviceId，
    // 结果编号块还高亮着、提交按钮却变灰，交互上很割裂
    const current = this.data.selectedDevice
    if (current && current.device_ids && device.device_ids
      && current.device_ids[0] === device.device_ids[0]) {
      return
    }
    // 这里不查冲突：此刻还没有具体编号，用组内首台去查没有意义
    // 换组时把上一组的编号高亮一起清掉，避免两组同时有选中态；
    // preselectHint 只对刚进来的那一组有效，换组后一并清空
    this.resetDeviceSelection({ selectedDevice: device, preselectHint: '' })
  },

  /**
   * 选择具体的仪器编号
   * 注意：必须用内层循环的下标 deviceIndex，不能用外层仪器组的 index。
   * 原来两者混用，导致在多组仪器时判断的是「另一个组第 N 个编号」的状态，
   * 会出现"可用"编号被拦下、"维修中"编号反而能选中。
   */
  onSelectDevice(e) {
    const { index: groupIndex, deviceIndex, id: deviceId, status } = e.currentTarget.dataset

    if (status === 'maintenance') {
      wx.showToast({ title: '该设备维修中，不可预约', icon: 'none' })
      return
    }
    if (status === 'using') {
      wx.showToast({ title: '该设备正在使用中，不可预约', icon: 'none' })
      return
    }
    if (status === 'reserved') {
      wx.showToast({ title: '该设备在该时段已被预约', icon: 'none' })
      return
    }

    const groups = this.data.availableDevices || []
    const group = groups[groupIndex]
    if (!group || !group.deviceStatusList) return
    if (!group.deviceStatusList[deviceIndex]) return

    // 用路径 setData 只更新变化的那几个字段，避免整表重刷
    const patch = {
      selectedDevice: group,
      selectedDeviceId: deviceId,
      // 换过编号就不再提"同款还有几台"，那句话只对刚进来时的那一组有效
      preselectHint: ''
    }
    group.deviceStatusList.forEach((item, i) => {
      patch[`availableDevices[${groupIndex}].deviceStatusList[${i}].active`] = (item.device_id === deviceId)
    })

    this.setData(patch, () => {
      this.checkTimeConflict(false)
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
      this.scheduleReload(250)
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
      this.scheduleReload(250)
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
      this.scheduleReload(250)
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
      this.scheduleReload(250)
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

    if (!selectedDevice || !startDate || !startTime || !endDate || !endTime) {
      // 条件不全时清掉旧的冲突状态，避免残留提示挂在新选择上
      if (this.data.timeConflict) {
        this.setData({ timeConflict: false })
      }
      return
    }

    try {
      const _ = db.command
      const startDT = `${startDate} ${startTime}`
      const endDT = `${endDate} ${endTime}`

      // 跨天冲突检测：查找任何与该时间段重叠的已批准预约
      const whereConditions = [{
        device_id: this.data.selectedDeviceId || selectedDevice.device_id
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
    // 提交中直接忽略重复点击
    if (this.data.isSubmitting) return

    // 列表还在刷新时不要拿旧数据提交
    if (this.data.isLoading) {
      wx.showToast({
        title: '仪器列表加载中，请稍候',
        icon: 'none'
      })
      return
    }

    // 验证表单（含「必须选择具体编号」，未选时这里会给出提示）
    if (!this.validateForm()) return
    if (!this.data.reservePage) {
      wx.showToast({
        title: '请上传系统预约单',
        icon: 'none'
      })
      return
    }

    this.setData({
      isSubmitting: true
    })

    // 提交成功后要等那 2 秒的「预约成功」提示走完再复位按钮，
    // 这期间保持「提交中…」的样子，避免用户以为没成功又点一次
    let submitted = false

    try {
      await this.requestSubscribeReminder()

      // 再次检查时间冲突
      const hasConflict = await this.checkTimeConflict(false)
      if (hasConflict) {
        wx.showToast({
          title: '该时间段与其他人预约时间段重叠',
          icon: 'none'
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
        return
      }
      this.setData({
        isPastTime: false
      })

      // 等待预约单上传完成，拿到 fileID 后再继续
      try {
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
        return
      }

      // 构建预约数据
      const storedUserInfo = wx.getStorageSync('userInfo') || {}
      const reserveData = {
        // 必须用用户实际选中的编号，不能用仪器组的第一个编号
        // （原来取 selectedDevice.device_id 是组内首台，选 B 号会存成 A 号）
        device_id: this.data.selectedDeviceId,
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

      let useCloudFunction = false
      try {
        const checkRes = await wx.cloud.callFunction({
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
      submitted = true
      const currentDevices = this.data.availableDevices
      const currentSelected = this.data.selectedDevice
      if (currentSelected && currentDevices.length > 0) {
        const updatedDevices = currentDevices.map(function (dev) {
          if (dev.device_ids.includes(currentSelected.device_id)) {
            const newConflict = (dev.conflictCount || 0) + 1 // 已预约次数+1
            let newRemaining = (dev.totalCount || 0) - newConflict // 剩余次数-1
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
        // 成功后退回「未选择」：编号和编号高亮也要一起清，
        // 否则列表刷新时又会按旧的 selectedDeviceId 把选中态恢复出来
        this.resetDeviceSelection({
          timeConflict: false,
          isPastTime: false,
          isSubmitting: false
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
      // 成功时按钮的复位交给上面的 setTimeout，这里只管失败/中途 return 的情况
      if (!submitted) {
        this.setData({
          isSubmitting: false
        })
      }
    }
  },

  async createReservationDirectly(reserveData) {
    const _ = db.command
    const startDT = reserveData.start_time
    const endDT = reserveData.end_time

    const overlapRes = await db.collection('reserves')
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

    const record = Object.assign({}, reserveData, {
      status: 'approved',
      usage_status: 'not_started',
      start_reminder_sent: false,
      start_reminder_sent_at: '',
      linked_usage_id: '',
      create_time: new Date().toISOString()
    })
    delete record._openid

    const addRes = await db.collection('reserves').add({
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
      selectedDeviceId,
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

    // 只选了仪器组、没选具体编号时不能提交：否则会回退成组内第一台，
    // 用户明明没选，却给某台设备下了单
    if (!selectedDeviceId) {
      wx.showToast({
        title: '请选择仪器编号',
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
    // 本方法当前无调用方（死代码）。RESERVATION_TEMPLATE_ID 未在本文件声明，
    // 同名常量见 pages/reservation/test.js，暂只标注不改，等业务方确认。
    // eslint-disable-next-line no-undef
    if (!RESERVATION_TEMPLATE_ID || RESERVATION_TEMPLATE_ID === 'your_template_id_here') return
    wx.requestSubscribeMessage({
      // eslint-disable-next-line no-undef
      tmplIds: [RESERVATION_TEMPLATE_ID],
      success(res) {
        // console.log('订阅消息授权结果:', res)
      },
      fail(err) {
        // console.log('订阅消息授权失败:', err)
      }
    })
  },

  pickReservePage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
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
