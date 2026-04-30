const db = wx.cloud.database()
const _ = db.command

const ALLOWED_ROLES = ['teacher', 'admin']
const PAGE_SIZE = 100
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
    isLoading: true
  },

  onLoad(options) {
    const deviceName = this.safeDecode(options.deviceName || '')
    if (!deviceName) {
      wx.showToast({ title: '缺少设备参数', icon: 'none' })
      this.setData({ isLoading: false })
      return
    }

    this.setData({
      deviceName,
      labName: this.safeDecode(options.labName || ''),
      deviceType: this.safeDecode(options.deviceType || ''),
      deviceModel: this.safeDecode(options.model || ''),
      groupKey: this.safeDecode(options.groupKey || '')
    })

    this.bootstrapPage()
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
    if (message) wx.showToast({ title: message, icon: 'none' })
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/admin/login/adminlogin' })
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
    if (!session) return { _id: '__DENY__' }
    if (session.role === 'admin') return null

    if (session.role === 'teacher') {
      const groupName = String(session.groupName || '').trim()
      if (!groupName) return { lab_type: 'public' }
      return _.or([
        { lab_type: 'public' },
        { lab_name: groupName }
      ])
    }

    return { _id: '__DENY__' }
  },

  buildGroupCondition() {
    const { deviceName, labName, deviceType } = this.data
    const conditions = []
    if (deviceName) conditions.push({ device_name: deviceName })
    if (labName) conditions.push({ lab_name: labName })
    if (deviceType) conditions.push({ device_type: deviceType })

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
      const idCondition = { device_id: _.in(chunk) }
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
    const futureStartCondition = _.or([
      { start_time: _.gt(nowText) },
      { start_time: _.gt(nowIso) }
    ])

    const chunks = this.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      const baseCondition = _.and([
        { status: 'approved' },
        { device_id: _.in(chunk) },
        futureStartCondition
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
      const condition = { device_id: _.in(chunk) }
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
    const map = {}
    ;(rows || []).forEach(item => {
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

    this.setData({ isLoading: true })
    try {
      const condition = this.buildVisibleGroupCondition(this.currentSession)
      let devices = await this.fetchAllByWhere('devices', condition)

      const modelFilter = String(this.data.deviceModel || '').trim()
      if (modelFilter) {
        devices = devices.filter(item => this.getDeviceModel(item) === modelFilter)
      }

      const expectedGroupKey = String(this.data.groupKey || '').trim()
      if (expectedGroupKey) {
        devices = devices.filter(item => this.buildGroupKey(item) === expectedGroupKey)
      }

      if (!devices.length) {
        wx.showToast({ title: '设备不存在或无权限查看', icon: 'none' })
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
        this.fetchByDeviceIds('device_usage', visibleDeviceIds, { status: 'using' }),
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

      const reserves = this.uniqueById(futureReservesRaw)
        .filter(item => this.isFutureReserve(item))
        .map(item => ({
          ...item,
          dateDisplay: this.formatDate(item.reserve_date),
          timeDisplay: this.formatTimeRange(item.start_time, item.end_time)
        }))
        .sort((a, b) => this.getTimeValue(a.start_time) - this.getTimeValue(b.start_time))

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

      const usages = usagesRawSorted
        .map(item => this.decorateUsageRecord(item, tempUrlMap))
        .map(item => ({
          ...item,
          durationDisplay: this.calculateDuration(item.start_time)
        }))

      const usagePhotos = usagePhotoRaw
        .map(item => this.decorateUsageRecord(item, tempUrlMap))
        .filter(item => item.hasAnyPhoto)
        .slice(0, PHOTO_DISPLAY_LIMIT)

      this.setData({
        devices: devicesForView,
        usages,
        usagePhotos,
        reserves,
        isLoading: false
      })
    } catch (err) {
      console.error('加载设备详情失败:', err)
      this.setData({ isLoading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async hasActiveUsage(deviceId) {
    if (!deviceId) return false
    try {
      const res = await db.collection('device_usage')
        .where({ device_id: deviceId, status: 'using' })
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
      wx.showToast({ title: '缺少设备参数，无法更新', icon: 'none' })
      return
    }

    if (displayStatus === 'using') {
      wx.showToast({ title: '设备正在使用，无法切换维护状态', icon: 'none' })
      return
    }

    try {
      const beforeCheckUsing = await this.hasActiveUsage(deviceId)
      if (beforeCheckUsing) {
        wx.showToast({ title: '设备正在使用，无法切换维护状态', icon: 'none' })
        this.loadDeviceDetail()
        return
      }

      const latestRes = await db.collection('devices').doc(docId).get()
      const latestDevice = latestRes.data || {}
      if (!latestDevice._id) {
        wx.showToast({ title: '设备不存在或已删除', icon: 'none' })
        this.loadDeviceDetail()
        return
      }

      const newStatus = latestDevice.status === 'maintenance' ? 'available' : 'maintenance'
      const statusText = newStatus === 'maintenance' ? '维护中' : '可用'
      const confirmed = await this.confirmAction(`确认将设备设为${statusText}吗？`)
      if (!confirmed) return

      const beforeUpdateUsing = await this.hasActiveUsage(deviceId)
      if (beforeUpdateUsing) {
        wx.showToast({ title: '设备刚进入使用中，已取消切换', icon: 'none' })
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
          data: { status: newStatus }
        })
      }

      wx.showToast({ title: '状态已更新', icon: 'success' })
      this.loadDeviceDetail()
    } catch (err) {
      console.error('更新设备状态失败:', err)
      wx.showToast({ title: '更新失败', icon: 'none' })
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
      wx.showToast({ title: '暂无可预览图片', icon: 'none' })
      return
    }

    wx.previewImage({ current: current || urls[0], urls })
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

    ;(usages || []).forEach(item => {
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
        ;(list || []).forEach(item => {
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
      endPhotoItems = [
        { key: 'duty', label: '值班台照片', rawUrl: endPhotos.duty },
        { key: 'device_off', label: '设备断电照片', rawUrl: endPhotos.device_off },
        { key: 'door_closed', label: '门已关闭照片', rawUrl: endPhotos.door_closed }
      ]
        .map(photo => ({ ...photo, url: this.resolvePhotoUrl(photo.rawUrl, tempUrlMap) }))
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
  }
})
