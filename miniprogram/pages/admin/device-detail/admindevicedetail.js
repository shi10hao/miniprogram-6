const db = wx.cloud.database()
const _ = db.command

const ALLOWED_ROLES = ['teacher', 'admin']
const PAGE_SIZE = 20
const DEVICE_ID_CHUNK_SIZE = 50
const PHOTO_CANDIDATE_LIMIT_PER_CHUNK = 60
const PHOTO_DISPLAY_LIMIT = 20
const FUTURE_RESERVE_LIMIT_PER_CHUNK = 60

Page({
  data: {
    deviceName: '',
    labName: '',
    deviceType: '',
    deviceModel: '',
    groupKey: '',
    devices: [],
    usages: [],
    usagePhotos: [],
    reserves: [],
    isLoading: true,
    deviceInfo: null,
    filterKeyword: '',
    showAllFiltered: false,
    isEditing: false,
    editForm: {
      device_name: '',
      picture: '',
      description: '',
      video_url: '',
      operation_procedure: '',
      precautions: '',
      specifications: ''
    },
    newPictureUrl: '',
    newVideoName: '',
    hasNewPicture: false,
    hasNewVideo: false,
    isSaving: false,
    // 折叠控制
    sectionCollapsed: {
      devices: false, // 仪器实例：默认展开
      usages: false, // 当前使用：默认展开
      photos: true, // 使用照片记录：默认收起
      reserves: true // 即将到来的预约：默认收起
    },
    deviceDisplayLimit: 5, // 仪器实例初始只显示5条
    showAllDevices: false, // 是否显示全部仪器实例
    renderDevices: [],
    newDeviceId: '',// 删去收尾空格
    isAddingDevice: false
  },

  onLoad(options) {
    // console.log("options:", options)
    const deviceName = this.safeDecode(options.deviceName || '')
    if (!deviceName) {
      wx.showToast({
        title: '缺少设备参数',
        icon: 'none'
      })
      this.setData({
        isLoading: false
      })
      return
    }

    this.setData({
      deviceName,
      labName: this.safeDecode(options.labName || ''),
      deviceType: this.safeDecode(options.deviceType || ''),
      deviceModel: this.safeDecode(options.model || ''),
      groupKey: this.safeDecode(options.groupKey || ''),
      filterKeyword: this.safeDecode(options.keyword || '')
    })

    this.bootstrapPage()
    // console.log("deviceInfo:",this.data.deviceInfo)
  },

  onUnload() {
    wx.disableAlertBeforeUnload()
  },

  onShow() {
    if (this._ready && this.data.deviceName) {
      this.loadDeviceDetail()
    }
  },

  safeDecode(value) {
    const text = String(value || '')
    try {
      return decodeURIComponent(text)
    } catch (err) {
      return text
    }
  },

  async bootstrapPage() {
    const session = await this.validateAdminSession()
    if (!session) return

    this.currentSession = session
    this._ready = true
    this.loadDeviceDetail()
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

  buildGroupCondition() {
    const {
      deviceName,
      labName,
      deviceType
    } = this.data
    const conditions = []
    if (deviceName) conditions.push({
      device_name: deviceName
    })
    if (labName) conditions.push({
      lab_name: labName
    })
    if (deviceType) conditions.push({
      device_type: deviceType
    })

    if (!conditions.length) return null
    if (conditions.length === 1) return conditions[0]
    return _.and(conditions)
  },

  buildVisibleGroupCondition(session) {
    const visibleCondition = this.buildVisibleDeviceCondition(session)
    const groupCondition = this.buildGroupCondition()
    if (groupCondition && visibleCondition) return _.and([groupCondition, visibleCondition])
    return groupCondition || visibleCondition
  },

  getDeviceModel(device) {
    const specs = (device && device.specifications) || {}
    if (specs && typeof specs === 'object') {
      return String(specs['型号'] || specs['鍨嬪彿'] || specs.model || device.model || '').trim()
    }
    return String((device && device.model) || '').trim()
  },

  buildGroupKey(device) {
    return [
      String(device.device_name || ''),
      String(device.lab_name || ''),
      String(device.device_room || ''),
      String(device.device_type || ''),
      this.getDeviceModel(device)
    ].join('||')
  },

  chunkArray(list, size) {
    const chunks = []
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size))
    }
    return chunks
  },

  async fetchAllByWhere(collectionName, whereCondition, pageSize = PAGE_SIZE) {
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

  async fetchByDeviceIds(collectionName, deviceIds, extraCondition) {
    if (!deviceIds.length) return []
    const chunks = this.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      const idCondition = {
        device_id: _.in(chunk)
      }
      const condition = extraCondition ? _.and([extraCondition, idCondition]) : idCondition
      const rows = await this.fetchAllByWhere(collectionName, condition)
      all.push(...rows)
    }

    return all
  },

  buildNowStringForReserve() {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  buildNowIsoString() {
    return new Date().toISOString()
  },

  async fetchFutureReservesByDeviceIds(deviceIds, perChunkLimit = FUTURE_RESERVE_LIMIT_PER_CHUNK) {
    if (!deviceIds.length) return []

    const nowText = this.buildNowStringForReserve()
    const nowIso = this.buildNowIsoString()
    // 预约未结束：只要还没到结束时间且未开始使用，都纳入列表
    const notEndedCondition = _.or([{
        end_time: _.gt(nowText)
      },
      {
        end_time: _.gt(nowIso)
      }
    ])

    const chunks = this.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      const baseCondition = _.and([{
          status: 'approved'
        },
        {
          device_id: _.in(chunk)
        },
        notEndedCondition,
        _.or([{
            usage_status: _.exists(false)
          },
          {
            usage_status: 'not_started'
          }
        ])
      ])

      try {
        const orderedRes = await db.collection('reserves')
          .where(baseCondition)
          .orderBy('start_time', 'asc')
          .limit(perChunkLimit)
          .get()
        all.push(...(orderedRes.data || []))
      } catch (err) {
        console.error('未来预约有序查询失败，使用有界回退:', err)
        const fallbackRes = await db.collection('reserves')
          .where(baseCondition)
          .limit(perChunkLimit)
          .get()
        all.push(...(fallbackRes.data || []))
      }
    }

    return all
  },

  async fetchRecentUsageCandidatesByDeviceIds(deviceIds, perChunkLimit = PHOTO_CANDIDATE_LIMIT_PER_CHUNK) {
    if (!deviceIds.length) return []
    const chunks = this.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      const condition = {
        device_id: _.in(chunk)
      }
      try {
        const orderedRes = await db.collection('device_usage')
          .where(condition)
          .orderBy('start_time', 'desc')
          .limit(perChunkLimit)
          .get()
        all.push(...(orderedRes.data || []))
      } catch (err) {
        console.error('照片候选有序查询失败，使用有界回退:', err)
        const fallbackRes = await db.collection('device_usage')
          .where(condition)
          .limit(perChunkLimit)
          .get()
        all.push(...(fallbackRes.data || []))
      }
    }
    return all
  },

  uniqueById(rows) {
    const map = {};
    (rows || []).forEach(item => {
      const key = String((item && item._id) || '')
      if (!key) return
      if (!map[key]) map[key] = item
    })
    return Object.values(map)
  },

  hasRawPhoto(usage) {
    const startPhoto = String((usage && usage.start_photo) || '').trim()
    if (startPhoto) return true

    const usageImages = this.normalizeImageList(usage && usage.usage_images)
    if (usageImages.length > 0) return true

    const endPhotos = usage && usage.end_photos
    if (endPhotos && typeof endPhotos === 'object' && !Array.isArray(endPhotos)) {
      const duty = String(endPhotos.duty || '').trim()
      const deviceOff = String(endPhotos.device_off || '').trim()
      const doorClosed = String(endPhotos.door_closed || '').trim()
      return !!(duty || deviceOff || doorClosed)
    }
    return false
  },

  async loadDeviceDetail() {
    if (!this.currentSession) {
      const session = await this.validateAdminSession()
      if (!session) return
      this.currentSession = session
    }

    this.setData({
      isLoading: true
    })
    try {
      const condition = this.buildVisibleGroupCondition(this.currentSession)
      let devices = await this.fetchAllByWhere('devices', condition)
      // console.log("condition:",condition)
      // console.log("devices:",devices)

      const modelFilter = String(this.data.deviceModel || '').trim()
      if (modelFilter) {
        devices = devices.filter(item => this.getDeviceModel(item) === modelFilter)
      }

      const expectedGroupKey = String(this.data.groupKey || '').trim()
      if (expectedGroupKey) {
        devices = devices.filter(item => this.buildGroupKey(item) === expectedGroupKey)
      }

      if (!devices.length) {
        wx.showToast({
          title: '设备不存在或无权限查看',
          icon: 'none'
        })
        this.setData({
          devices: [],
          usages: [],
          usagePhotos: [],
          reserves: [],
          isLoading: false
        })
        return
      }

      const visibleDeviceIds = Array.from(new Set(devices.map(item => item.device_id).filter(Boolean)))

      const [usingUsagesRaw, photoCandidatesRaw, futureReservesRaw] = await Promise.all([
        this.fetchByDeviceIds('device_usage', visibleDeviceIds, {
          status: 'using'
        }),
        this.fetchRecentUsageCandidatesByDeviceIds(visibleDeviceIds),
        this.fetchFutureReservesByDeviceIds(visibleDeviceIds)
      ])

      const usingUsagesSorted = [...usingUsagesRaw].sort(
        (a, b) => this.getTimeValue(b.start_time) - this.getTimeValue(a.start_time)
      )
      const usingMap = {}
      usingUsagesSorted.forEach(item => {
        if (item && item.device_id && !usingMap[item.device_id]) usingMap[item.device_id] = item
      })

      const devicesForView = devices
        .map(item => {
          const usingRecord = usingMap[item.device_id]
          const displayStatus = usingRecord ? 'using' : item.status
          return {
            ...item,
            model: this.getDeviceModel(item),
            displayStatus,
            isUsing: !!usingRecord,
            usingUser: usingRecord ? (usingRecord.student_name || usingRecord.user_id || '') : ''
          }
        })
        .sort((a, b) => String(a.device_id || '').localeCompare(String(b.device_id || '')))
      console.log('devicesForView:', devicesForView)

      const nowTimestamp = Date.now()
      const reserves = this.uniqueById(futureReservesRaw)
        .map(item => {
          const startTimeVal = this.getTimeValue(item.start_time)
          let displayStatus = 'upcoming'
          let statusText = '即将到来'
          // 已到开始时间但未开始使用，标记为待开始
          if (nowTimestamp >= startTimeVal) {
            displayStatus = 'overdue_start'
            statusText = '已到时间·待开始'
          }
          return {
            ...item,
            dateDisplay: this.formatDate(item.reserve_date),
            timeDisplay: this.formatTimeRange(item.start_time, item.end_time),
            displayStatus,
            statusText
          }
        })
        .sort((a, b) => {
          // 已到时间的预约优先排在最前面
          if (a.displayStatus === 'overdue_start' && b.displayStatus !== 'overdue_start') return -1
          if (a.displayStatus !== 'overdue_start' && b.displayStatus === 'overdue_start') return 1
          // 其余按开始时间升序排列
          return this.getTimeValue(a.start_time) - this.getTimeValue(b.start_time)
        })

      const usagesRawSorted = this.uniqueById(usingUsagesRaw).sort(
        (a, b) => this.getTimeValue(b.start_time) - this.getTimeValue(a.start_time)
      )
      const usagePhotoRaw = this.uniqueById(photoCandidatesRaw)
        .sort((a, b) => this.getTimeValue(b.start_time) - this.getTimeValue(a.start_time))
        .filter(item => this.hasRawPhoto(item))
        .slice(0, PHOTO_DISPLAY_LIMIT)

      const usageForTemp = this.uniqueById([].concat(usagesRawSorted, usagePhotoRaw))
      const allPhotoFileIds = this.collectCloudFileIds(usageForTemp)
      const tempUrlMap = await this.getTempUrlMap(allPhotoFileIds)


      // C
      const usages = usagesRawSorted
        .map(item => this.decorateUsageRecord(item, tempUrlMap))
        .map(item => ({
          ...item,
          durationDisplay: this.calculateDuration(item.start_time)
        }))
      // D
      const usagePhotos = usagePhotoRaw
        .map(item => this.decorateUsageRecord(item, tempUrlMap))
        .filter(item => item.hasAnyPhoto)
        .slice(0, PHOTO_DISPLAY_LIMIT)

      // B
      // 根据搜索关键词过滤仪器实例及关联数据
      let finalDevices = devicesForView
      let finalUsages = usages
      let finalUsagePhotos = usagePhotos
      let finalReserves = reserves
      // console.log('OUT IF finalDevices:',finalDevices)
      const kw = this.data.filterKeyword?.toLowerCase().trim()
      if (kw && !this.data.showAllFiltered) {
        finalDevices = devicesForView.filter(item => {
          const room = (item.device_room || '').toLowerCase()
          const name = (item.device_name || '').toLowerCase()
          const model = (item.model || '').toLowerCase()
          const lab = (item.lab_name || '').toLowerCase()
          const desc = (item.description || '').toLowerCase()
          const id = (item.device_id || '').toLowerCase()
          return room.includes(kw) || name.includes(kw) || model.includes(kw) ||
            lab.includes(kw) || desc.includes(kw) || id.includes(kw)
        })

        // 用过滤后的设备 ID 同步过滤其他区域
        const filteredIds = new Set(finalDevices.map(d => d.device_id).filter(Boolean))
        // console.log('In IF finalDevices:', finalDevices)
        if (filteredIds.size > 0) {
          finalUsages = usages.filter(u => u.device_id && filteredIds.has(u.device_id))
          finalUsagePhotos = usagePhotos.filter(p => p.device_id && filteredIds.has(p.device_id))
          finalReserves = reserves.filter(r => r.device_id && filteredIds.has(r.device_id))
        } else {
          finalUsages = []
          finalUsagePhotos = []
          finalReserves = []
        }
      }

      // E   
      let deviceInfo = null
      if (finalDevices.length > 0) {
        const picUrl = await this.getTempFileURL(finalDevices[0].picture)

        deviceInfo = {
          picture: picUrl || '',
          description: finalDevices[0].description || '',
          video_url: finalDevices[0].video_url || '',
          operation_procedure: finalDevices[0].operation_procedure || '',
          precautions: finalDevices[0].precautions || '',
          specifications: finalDevices[0].specifications || {}
        }
      }

      const renderDevices = this.data.showAllDevices ?
        finalDevices :
        finalDevices.slice(0, this.data.deviceDisplayLimit)

      this.setData({
        devices: finalDevices,
        usages: finalUsages,
        usagePhotos: finalUsagePhotos,
        reserves: finalReserves, // 即将到来的预约列表
        deviceInfo,
        isLoading: false,
        renderDevices // 渲染的设备
      })

      console.log('devices', devices)
      console.log('deviceInfo:', this.data.deviceInfo)
    } catch (err) {
      console.error('加载设备详情失败:', err)
      this.setData({
        isLoading: false
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  getTempFileURL(fileID) {
    return new Promise((resolve) => {
      if (!fileID) return resolve('')

      wx.cloud.getTempFileURL({
        fileList: [fileID],
        success: res => {
          resolve(res.fileList[0]?.tempFileURL || '')
        },
        fail: () => resolve('')
      })
    })
  },

  async hasActiveUsage(deviceId) {
    if (!deviceId) return false
    try {
      const res = await db.collection('device_usage')
        .where({
          device_id: deviceId,
          status: 'using'
        })
        .limit(1)
        .get()
      return (res.data || []).length > 0
    } catch (err) {
      console.error('查询设备占用状态失败:', err)
      return false
    }
  },

  confirmAction(content) {
    return new Promise(resolve => {
      wx.showModal({
        title: '确认操作',
        content,
        success: res => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  },

  async toggleMaintenance(e) {
    const docId = e.currentTarget.dataset.id
    const deviceId = e.currentTarget.dataset.deviceId
    const displayStatus = String(e.currentTarget.dataset.displayStatus || '')

    if (!docId || !deviceId) {
      wx.showToast({
        title: '缺少设备参数，无法更新',
        icon: 'none'
      })
      return
    }

    if (displayStatus === 'using') {
      wx.showToast({
        title: '设备正在使用，无法切换维护状态',
        icon: 'none'
      })
      return
    }

    try {
      const beforeCheckUsing = await this.hasActiveUsage(deviceId)
      if (beforeCheckUsing) {
        wx.showToast({
          title: '设备正在使用，无法切换维护状态',
          icon: 'none'
        })
        this.loadDeviceDetail()
        return
      }

      const latestRes = await db.collection('devices').doc(docId).get()
      const latestDevice = latestRes.data || {}
      if (!latestDevice._id) {
        wx.showToast({
          title: '设备不存在或已删除',
          icon: 'none'
        })
        this.loadDeviceDetail()
        return
      }

      const newStatus = latestDevice.status === 'maintenance' ? 'available' : 'maintenance'
      const statusText = newStatus === 'maintenance' ? '维护中' : '可用'
      const confirmed = await this.confirmAction(`确认将设备设为${statusText}吗？`)
      if (!confirmed) return

      const beforeUpdateUsing = await this.hasActiveUsage(deviceId)
      if (beforeUpdateUsing) {
        wx.showToast({
          title: '设备刚进入使用中，已取消切换',
          icon: 'none'
        })
        this.loadDeviceDetail()
        return
      }

      try {
        const adminInfo = wx.getStorageSync('adminInfo') || {}
        const cloudRes = await wx.cloud.callFunction({
          name: 'updateDeviceStatus',
          data: {
            docId: docId,
            status: newStatus,
            adminUserId: adminInfo.userId || ''
          }
        })
        const result = cloudRes && cloudRes.result ? cloudRes.result : {}
        if (!result.success) {
          throw new Error(result.error || '云函数更新失败')
        }
      } catch (cloudErr) {
        console.warn('云函数更新失败，尝试前端直接更新:', cloudErr)
        await db.collection('devices').doc(docId).update({
          data: {
            status: newStatus
          }
        })
      }

      wx.showToast({
        title: '状态已更新',
        icon: 'success'
      })
      this.loadDeviceDetail()
    } catch (err) {
      console.error('更新设备状态失败:', err)
      wx.showToast({
        title: '更新失败',
        icon: 'none'
      })
    }
  },

  previewPhoto(e) {
    const current = e.currentTarget.dataset.url
    const rawUrls = e.currentTarget.dataset.urls
    let urls = []

    if (Array.isArray(rawUrls)) {
      urls = rawUrls.filter(Boolean)
    } else if (typeof rawUrls === 'string' && rawUrls.trim()) {
      if (rawUrls.indexOf(',') > -1) {
        urls = rawUrls.split(',').map(item => item.trim()).filter(Boolean)
      } else {
        urls = [rawUrls.trim()]
      }
    }

    if (current && urls.indexOf(current) === -1) urls.unshift(current)
    if (!urls.length && current) urls = [current]
    if (!urls.length) {
      wx.showToast({
        title: '暂无可预览图片',
        icon: 'none'
      })
      return
    }

    wx.previewImage({
      current: current || urls[0],
      urls
    })
  },

  normalizeImageList(raw) {
    if (Array.isArray(raw)) return raw.filter(item => typeof item === 'string' && item.trim())
    if (typeof raw === 'string' && raw.trim()) return [raw.trim()]
    return []
  },

  isCloudFileId(value) {
    return typeof value === 'string' && value.trim().indexOf('cloud://') === 0
  },

  collectCloudFileIds(usages) {
    const ids = []
    const pushIfCloud = value => {
      if (this.isCloudFileId(value)) ids.push(value.trim())
    }

    ;
    (usages || []).forEach(item => {
      pushIfCloud(item.start_photo)
      this.normalizeImageList(item.usage_images).forEach(pushIfCloud)

      const endPhotos = item.end_photos
      if (endPhotos && typeof endPhotos === 'object' && !Array.isArray(endPhotos)) {
        pushIfCloud(endPhotos.duty)
        pushIfCloud(endPhotos.device_off)
        pushIfCloud(endPhotos.door_closed)
      }
    })

    return Array.from(new Set(ids))
  },

  getTempUrlMap(fileIds) {
    const uniqueIds = Array.from(new Set((fileIds || []).filter(id => this.isCloudFileId(id))))
    if (!uniqueIds.length) return Promise.resolve({})

    const chunks = this.chunkArray(uniqueIds, DEVICE_ID_CHUNK_SIZE)
    const tasks = chunks.map(chunk => new Promise(resolve => {
      wx.cloud.getTempFileURL({
        fileList: chunk,
        success: res => resolve(res.fileList || []),
        fail: err => {
          console.error('获取临时图片链接失败:', err)
          resolve([])
        }
      })
    }))

    return Promise.all(tasks).then(results => {
      const map = {}
      results.forEach(list => {
        ;
        (list || []).forEach(item => {
          if (item && item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL
        })
      })
      return map
    })
  },

  resolvePhotoUrl(rawUrl, tempUrlMap) {
    if (!rawUrl || typeof rawUrl !== 'string') return ''
    const value = rawUrl.trim()
    if (!value) return ''
    if (this.isCloudFileId(value)) return tempUrlMap[value] || ''
    return value
  },

  decorateUsageRecord(item, tempUrlMap) {
    const startPhotoUrl = this.resolvePhotoUrl(item.start_photo, tempUrlMap)
    const usageImageUrls = this.normalizeImageList(item.usage_images)
      .map(url => this.resolvePhotoUrl(url, tempUrlMap))
      .filter(Boolean)

    let endPhotoItems = []
    const endPhotos = item.end_photos
    if (endPhotos && typeof endPhotos === 'object' && !Array.isArray(endPhotos)) {
      endPhotoItems = [{
            key: 'duty',
            label: '值班台照片',
            rawUrl: endPhotos.duty
          },
          {
            key: 'device_off',
            label: '设备断电照片',
            rawUrl: endPhotos.device_off
          },
          {
            key: 'door_closed',
            label: '门已关闭照片',
            rawUrl: endPhotos.door_closed
          }
        ]
        .map(photo => ({
          ...photo,
          url: this.resolvePhotoUrl(photo.rawUrl, tempUrlMap)
        }))
        .filter(photo => !!photo.url)
    }

    const allPhotoUrls = []
    if (startPhotoUrl) allPhotoUrls.push(startPhotoUrl)
    usageImageUrls.forEach(url => allPhotoUrls.push(url))
    endPhotoItems.forEach(photo => allPhotoUrls.push(photo.url))

    return {
      ...item,
      startPhotoUrl,
      usageImageUrls,
      endPhotoItems,
      allPhotoUrls,
      hasAnyPhoto: allPhotoUrls.length > 0
    }
  },

  parseDateTime(rawValue) {
    if (!rawValue) return null
    if (rawValue instanceof Date) return Number.isNaN(rawValue.getTime()) ? null : rawValue

    const text = String(rawValue).trim()
    if (!text) return null

    let normalized = text
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      normalized = `${text}T00:00:00`
    } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) {
      normalized = text.replace(' ', 'T')
    }

    const d = new Date(normalized)
    return Number.isNaN(d.getTime()) ? null : d
  },

  getTimeValue(rawValue) {
    const d = this.parseDateTime(rawValue)
    return d ? d.getTime() : 0
  },

  isFutureReserve(reserve) {
    const startTime = this.parseDateTime(reserve && reserve.start_time)
    if (!startTime) return false
    return startTime.getTime() > Date.now()
  },

  calculateDuration(startTime) {
    const start = this.parseDateTime(startTime)
    if (!start) return ''

    const now = new Date()
    const diff = Math.floor((now.getTime() - start.getTime()) / 60000)
    if (diff <= 0) return '不足1分钟'
    if (diff < 60) return `${diff}分钟`

    const hours = Math.floor(diff / 60)
    const mins = diff % 60
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`
  },

  formatDate(isoStr) {
    const d = this.parseDateTime(isoStr)
    if (!d) return isoStr ? String(isoStr) : ''
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  extractTime(rawValue) {
    if (!rawValue) return ''
    const text = String(rawValue)
    const match = text.match(/(\d{2}:\d{2})/)
    if (match) return match[1]

    const d = this.parseDateTime(text)
    if (!d) return text

    const pad = n => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  formatTimeRange(start, end) {
    return `${this.extractTime(start)} - ${this.extractTime(end)}`
  },

  // 切换编辑模式
  toggleEdit() {
    // console.log('点击切换编辑，当前isEditing：', this.data.isEditing)
    if (!this.data.deviceInfo) return

    if (!this.data.isEditing) {
      // 进入编辑模式：把 deviceInfo 填入表单
      const info = this.data.deviceInfo
      // 规格参数对象转文本（每行 key：value）
      let specsText = ''
      if (info.specifications && typeof info.specifications === 'object') {
        specsText = Object.entries(info.specifications)
          .map(([k, v]) => `${k}：${v}`)
          .join('\n')
      }

      this.setData({
        isEditing: true,
        editForm: {
          device_name: this.data.deviceName || '',
          picture: info.picture || '',
          description: info.description || '',
          video_url: info.video_url || '',
          operation_procedure: typeof info.operation_procedure === 'object' ?
            JSON.stringify(info.operation_procedure) : (info.operation_procedure || ''),
          precautions: typeof info.precautions === 'object' ?
            JSON.stringify(info.precautions) : (info.precautions || ''),
          specifications: specsText
        },
        newPictureUrl: '',
        newVideoName: '',
        hasNewPicture: false,
        hasNewVideo: false
      })
    } else {
      // 退出编辑模式（不保存）
      this.setData({
        isEditing: false
      })
    }
  },

  // 切换区域折叠状态
  toggleSection(e) {
    const section = e.currentTarget.dataset.section
    const key = `sectionCollapsed.${section}`
    this.setData({
      [key]: !this.data.sectionCollapsed[section]
    })
  },

  // 展开全部仪器实例
  expandDevices() {
    this.setData({
      showAllDevices: true
    }, () => {
      // 此时showAllDevices已经更新完成
      const renderDevices = this.data.showAllDevices ?
        this.data.devices :
        this.data.devices.slice(0, this.data.deviceDisplayLimit)
      this.setData({
        renderDevices
      });
    });
  },

  foldDevices() {
    this.setData({
      showAllDevices: false
    }, () => {
      // 此时showAllDevices已经更新完成
      const renderDevices = this.data.showAllDevices ?
        this.data.devices :
        this.data.devices.slice(0, this.data.deviceDisplayLimit)
      this.setData({
        renderDevices
      });
    });
  },

  // 表单输入
  onEditInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    // console.log("e.currentTarget.dataset.field：",e.currentTarget.dataset.field)
    // console.log("e.detail.value",e.detail.value)
    this.setData({
      [`editForm.${field}`]: value
    })
    // console.log(this.data.editForm)
  },

  // 选择新图片
  chooseImage() {
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(res) {
        const tempFile = res.tempFiles[0]
        that.setData({
          newPictureUrl: tempFile.tempFilePath,
          hasNewPicture: true
        })
      }
    })
  },

  // 选择新视频
  chooseVideo() {
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album'],
      maxDuration: 300,
      success(res) {
        const tempFile = res.tempFiles[0]
        const fileName = tempFile.tempFilePath.split('/').pop() || 'video.mp4'
        that.setData({
          newVideoName: fileName,
          editForm: {
            ...that.data.editForm,
            video_url: tempFile.tempFilePath
          },
          hasNewVideo: true
        })
      }
    })
  },

  // 保存仪器信息
  async saveDeviceInfo() {
    if (this.data.isSaving) return
    this.setData({
      isSaving: true
    })

    try {
      const {
        editForm,
        hasNewPicture,
        hasNewVideo,
        devices
      } = this.data
      const updateData = {}

      // 0) 记录旧文件的 fileID（上传前记下，等保存成功后删除）
      const oldPictureId = hasNewPicture && editForm.picture && this.isCloudFileId(editForm.picture) ?
        editForm.picture : null
      const oldVideoId = hasNewVideo && editForm.video_url && this.isCloudFileId(editForm.video_url) ?
        editForm.video_url : null
      // 1) 上传新图片（如果有）
      if (hasNewPicture) {
        wx.showLoading({
          title: '上传图片中...'
        })
        const picPath = this.data.newPictureUrl
        const picExt = (picPath.split('.').pop() || 'jpg').toLowerCase()
        const picRes = await wx.cloud.uploadFile({
          cloudPath: `device_pics/${Date.now()}.${picExt}`,
          filePath: picPath
        })
        wx.hideLoading()
        updateData.picture = picRes.fileID
      }

      // 2) 上传新视频（如果有）
      if (hasNewVideo) {
        wx.showLoading({
          title: '上传视频中...'
        })
        const vidPath = editForm.video_url
        const vidExt = (vidPath.split('.').pop() || 'mp4').toLowerCase()
        const vidRes = await wx.cloud.uploadFile({
          cloudPath: `device_videos/${Date.now()}.${vidExt}`,
          filePath: vidPath
        })
        wx.hideLoading()
        updateData.video_url = vidRes.fileID
      }

      // 3) 文本字段：简介、操作规程、注意事项
      if (editForm.description !== undefined) {
        updateData.description = editForm.description
      }
      if (editForm.operation_procedure !== undefined) {
        updateData.operation_procedure = editForm.operation_procedure
      }
      if (editForm.precautions !== undefined) {
        updateData.precautions = editForm.precautions
      }
      if (editForm.device_name && editForm.device_name !== this.data.deviceName) {
        updateData.device_name = editForm.device_name
      }

      // 4) 规格参数：文本 → 对象
      if (editForm.specifications !== undefined) {
        const specsText = editForm.specifications.trim()
        if (specsText) {
          const specsObj = {}
          specsText.split('\n').forEach(line => {
            const sep = line.indexOf('：') > -1 ? '：' : (line.indexOf(':') > -1 ? ':' : null)
            if (sep) {
              const key = line.substring(0, line.indexOf(sep)).trim()
              const val = line.substring(line.indexOf(sep) + 1).trim()
              if (key) specsObj[key] = val
            }
          })
          updateData.specifications = specsObj
        } else {
          updateData.specifications = {}
        }
      }

      // 如果没有要更新的字段，直接退出
      if (Object.keys(updateData).length === 0) {
        wx.showToast({
          title: '没有需要保存的修改',
          icon: 'none'
        })
        this.setData({
          isSaving: false
        })
        return
      }

      // 5) 获取当前组所有设备的 _id，逐个更新
      const deviceIds = (devices || []).map(d => d._id).filter(Boolean)
      if (deviceIds.length === 0) {
        wx.showToast({
          title: '没有可更新的设备',
          icon: 'none'
        })
        this.setData({
          isSaving: false
        })
        return
      }

      wx.showLoading({
        title: '保存中...'
      })

      const res = await wx.cloud.callFunction({
        name: 'updateDeviceInfo',
        data: {
          deviceIds,
          updateData
        }
      })

      console.log('cloud function result:', res.result)
      if (res.result.code !== 0) {
        wx.hideLoading()
        wx.showModal({
          title: '保存失败',
          content: `错误码：${res.result.code}\n${res.result.message || '未知错误'}`,
          showCancel: false
        })
        this.setData({
          isSaving: false
        })
        return
      }

      // if (res.result.code !== 0) {
      //   throw new Error(res.result.message || '云函数更新失败')
      // }

      wx.hideLoading()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })

      const toDelete = []
      if (oldPictureId) toDelete.push(oldPictureId)
      if (oldVideoId) toDelete.push(oldVideoId)
      if (toDelete.length > 0) {
        wx.cloud.deleteFile({
          fileList: toDelete,
          success: res => console.log('已删除旧文件:', res.fileList),
          fail: err => console.warn('删除旧文件失败（不影响使用）:', err)
        })
      }
      // 测试
      // 6) 退出编辑模式，重新加载数据
      const newName = updateData.device_name || this.data.deviceName
      this.setData({
        isEditing: false,
        isSaving: false,
        hasNewPicture: false,
        hasNewVideo: false,
        newPictureUrl: '',
        newVideoName: '',
        deviceName: newName
      })
      this.loadDeviceDetail()

      console.log("updateData:", updateData)
    } catch (err) {
      wx.hideLoading()
      console.error('保存仪器信息失败:', err)
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      })
      this.setData({
        isSaving: false
      })
    }
  },
  // 清除筛选，显示全部
  clearFilter() {
    this.setData({
      showAllFiltered: true
    }, () => {
      this.loadDeviceDetail()
    })
  },

  // 跳转到预约详情（已存在，无需重复添加）
  gotoReserveDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return

    wx.navigateTo({
      url: `/pages/reserve-detail/reserve-detail?id=${encodeURIComponent(id)}`
    })
  },

  // 新增设备编号输入
  onNewDeviceIdInput(e) {
    const raw = e.detail.value
    this.setData({
      newDeviceId: raw
    })
  },

  // 添加单台仪器实例
  async addDeviceInstance() {
    const newId = this.data.newDeviceId.trim()
    if (!newId) {
      wx.showToast({
        title: '请输入设备编号',
        icon: 'none'
      })
      return
    }

    // 前端校验：同组内编号不能重复
    const exists = this.data.devices.some(d => d.device_id === newId)
    if (exists) {
      wx.showToast({
        title: '该设备编号已存在',
        icon: 'none'
      })
      return
    }

    const confirmed = await this.confirmAction(`确认添加设备「${newId}」吗？`)
    if (!confirmed) return

    this.setData({
      isAddingDevice: true
    })
    try {
      // 取组内第一台设备作为模板，继承所有公共字段
      const template = this.data.devices[0]
      const now = new Date().toISOString()

      const newDevice = {
        device_id: newId,
        device_name: template.device_name,
        lab_name: template.lab_name,
        lab_type: template.lab_type,
        device_room: template.device_room,
        device_type: template.device_type,
        status: 'available',
        picture: template.picture || '',
        operation_procedure: template.operation_procedure || '',
        precautions: template.precautions || '',
        specifications: template.specifications || {},
        create_time: now,
        update_time: now
      }

      // 写入数据库
      await db.collection('devices').add({
        data: newDevice
      })

      wx.showToast({
        title: '添加成功',
        icon: 'success'
      })
      this.setData({
        newDeviceId: '',
        isAddingDevice: false
      })
      // 复用原有加载逻辑刷新列表
      this.loadDeviceDetail()
    } catch (err) {
      console.error('添加设备失败:', err)
      this.setData({
        isAddingDevice: false
      })
      wx.showToast({
        title: '添加失败，请重试',
        icon: 'none'
      })
    }
  },

  // 删除单台仪器实例
  async deleteDeviceInstance(e) {
    const docId = e.currentTarget.dataset.id
    const deviceId = e.currentTarget.dataset.deviceId
    const displayStatus = e.currentTarget.dataset.displayStatus

    if (!docId || !deviceId) return
    if (displayStatus === 'using') {
      wx.showToast({
        title: '设备正在使用，无法删除',
        icon: 'none'
      })
      return
    }

    const confirmed = await this.confirmAction(`确认删除设备「${deviceId}」吗？删除后不可恢复。`)
    if (!confirmed) return

    wx.showLoading({
      title: '删除中...'
    })
    try {
      await db.collection('devices').doc(docId).remove()
      wx.hideLoading()
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      })
      this.loadDeviceDetail()
    } catch (err) {
      wx.hideLoading()
      console.error('删除设备失败:', err)
      wx.showToast({
        title: '删除失败，请重试',
        icon: 'none'
      })
    }
  },

})