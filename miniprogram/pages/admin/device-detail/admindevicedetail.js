const cloudFile = require('../../../utils/cloudFile')
const datetime = require('../../../utils/datetime')
const view = require('./lib/deviceDetailView')

const db = wx.cloud.database()
const _ = db.command

const ALLOWED_ROLES = ['teacher', 'admin']
const PAGE_SIZE = 20
const DEVICE_ID_CHUNK_SIZE = 50
const PHOTO_CANDIDATE_LIMIT_PER_CHUNK = 60
const PHOTO_DISPLAY_LIMIT = 20
const FUTURE_RESERVE_LIMIT_PER_CHUNK = 60
const DEVICE_DISPLAY_LIMIT = 5

Page({
  data: {
    deviceName: '',
    labName: '',
    deviceType: '',
    deviceModel: '',
    groupKey: '',
    filterKeyword: '',
    showAllFiltered: false,

    isLoading: true,
    loadError: false,
    notFound: false,
    noMatch: false,

    summary: {
      total: 0,
      available: 0,
      using: 0,
      maintenance: 0,
      statusKey: 'none',
      statusText: ''
    },

    devices: [],
    renderDevices: [],
    deviceDisplayLimit: DEVICE_DISPLAY_LIMIT,
    showAllDevices: false,

    usages: [],
    usagePhotos: [],
    reserves: [],

    deviceInfo: null,

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
    // 编辑态下当前图片的临时链接（editForm.picture 存的是 fileID，不能直接给 image 用）
    editPictureUrl: '',
    newPictureUrl: '',
    newVideoName: '',
    newVideoTempPath: '',
    hasNewPicture: false,
    hasNewVideo: false,
    isSaving: false,

    sectionCollapsed: {
      devices: false,
      usages: false,
      photos: true,
      reserves: true
    },

    newDeviceId: '',
    isAddingDevice: false
  },

  onLoad(options) {
    const params = options || {}
    const deviceName = this.safeDecode(params.deviceName)
    if (!deviceName) {
      wx.showToast({
        title: '缺少设备参数',
        icon: 'none'
      })
      this.setData({
        isLoading: false,
        notFound: true
      })
      return
    }

    this.setData({
      deviceName,
      labName: this.safeDecode(params.labName),
      deviceType: this.safeDecode(params.deviceType),
      deviceModel: this.safeDecode(params.model),
      groupKey: this.safeDecode(params.groupKey),
      filterKeyword: this.safeDecode(params.keyword)
    })

    this.bootstrapPage()
  },

  // 从预约详情/实例详情返回时刷新，但正在编辑或保存时不能把表单冲掉
  onShow() {
    if (!this._ready || !this.data.deviceName) return
    if (this.data.isEditing || this.data.isSaving) return
    this.loadDeviceDetail({ silent: true })
  },

  async onPullDownRefresh() {
    if (this.data.isEditing || this.data.isSaving || this.data.isAddingDevice) {
      wx.stopPullDownRefresh()
      return
    }
    try {
      await this.loadDeviceDetail({ silent: true })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  safeDecode(value) {
    const text = String(value || '').trim()
    if (!text) return ''
    try {
      return decodeURIComponent(text).trim()
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
    if (message) {
      wx.showToast({
        title: message,
        icon: 'none'
      })
    }
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

  // 可见范围：admin 全量，teacher 只看公共实验室 + 本课题组
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
    const chunks = view.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []

    for (let i = 0; i < chunks.length; i += 1) {
      const idCondition = { device_id: _.in(chunks[i]) }
      const condition = extraCondition ? _.and([extraCondition, idCondition]) : idCondition
      const rows = await this.fetchAllByWhere(collectionName, condition)
      all.push(...rows)
    }

    return all
  },

  buildNowText() {
    const now = new Date()
    const pad = datetime.pad2
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  },

  // 预约未结束 = 结束时间还没到（库里有 'YYYY-MM-DD HH:mm' 与 ISO 两种写法）
  async fetchFutureReservesByDeviceIds(deviceIds, perChunkLimit = FUTURE_RESERVE_LIMIT_PER_CHUNK) {
    if (!deviceIds.length) return []

    const nowText = this.buildNowText()
    const nowIso = new Date().toISOString()
    const notEndedCondition = _.or([
      { end_time: _.gt(nowText) },
      { end_time: _.gt(nowIso) }
    ])

    const chunks = view.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []
    for (let i = 0; i < chunks.length; i += 1) {
      const baseCondition = _.and([
        { status: 'approved' },
        { device_id: _.in(chunks[i]) },
        notEndedCondition,
        _.or([
          { usage_status: _.exists(false) },
          { usage_status: 'not_started' }
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
    const chunks = view.chunkArray(deviceIds, DEVICE_ID_CHUNK_SIZE)
    const all = []

    for (let i = 0; i < chunks.length; i += 1) {
      const condition = { device_id: _.in(chunks[i]) }
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

  /**
   * 参数里的 model / groupKey 只是跳转时带过来的线索：
   * 设备改过名或型号之后旧键就对不上了，匹配不到时按查到的数据重新收拢成一组，
   * 否则页面会莫名其妙显示「设备不存在」。
   */
  pickGroupDevices(devices) {
    const list = devices || []
    const modelFilter = String(this.data.deviceModel || '').trim()
    const expectedKey = String(this.data.groupKey || '').trim()

    // 型号匹配不上（改名/换型号）时不能直接判成「没有设备」，退回按 groupKey 收拢
    if (modelFilter) {
      const byModel = list.filter(item => view.getDeviceModel(item) === modelFilter)
      if (byModel.length) return this.matchGroupKey(byModel, expectedKey)
      console.warn('[仪器详情] 型号与库里的记录不一致，改按分组键匹配')
    }

    return this.matchGroupKey(list, expectedKey)
  },

  matchGroupKey(list, expectedKey) {
    if (expectedKey) {
      const matched = list.filter(item => view.buildGroupKey(item) === expectedKey)
      if (matched.length) return matched
      console.warn('[仪器详情] groupKey 与库里的分组不一致，按查到的数据重新分组')
    }

    if (!list.length) return list
    const fallbackKey = view.buildGroupKey(list[0])
    return list.filter(item => view.buildGroupKey(item) === fallbackKey)
  },

  // 头部信息以库里的记录为准，避免跳转参数过期导致标题/型号不对
  applyGroupInfo(device) {
    if (!device) return
    const next = {
      deviceName: String(device.device_name || '').trim() || this.data.deviceName,
      labName: String(device.lab_name || '').trim(),
      deviceType: String(device.device_type || '').trim(),
      deviceModel: view.getDeviceModel(device),
      groupKey: view.buildGroupKey(device)
    }
    const changed = Object.keys(next).some(key => next[key] !== this.data[key])
    if (changed) this.setData(next)
  },

  /**
   * @param {Object} [options] { silent: true } 时不闪骨架屏，用于返回页面/保存后的静默刷新
   */
  async loadDeviceDetail(options) {
    const silent = !!(options && options.silent)

    if (!this.currentSession) {
      const session = await this.validateAdminSession()
      if (!session) return
      this.currentSession = session
    }

    if (silent) {
      this.setData({ loadError: false })
    } else {
      this.setData({
        isLoading: true,
        loadError: false
      })
    }

    try {
      const condition = this.buildVisibleGroupCondition(this.currentSession)
      const queried = await this.fetchAllByWhere('devices', condition)
      const devices = this.pickGroupDevices(queried)

      if (!devices.length) {
        this.groupDevices = []
        this.setData({
          isLoading: false,
          notFound: true,
          noMatch: false,
          devices: [],
          renderDevices: [],
          usages: [],
          usagePhotos: [],
          reserves: [],
          summary: view.summarizeDevices([])
        })
        return
      }

      // 编辑、新增都以「整组设备」为准：页面上的 devices 可能被关键词过滤过
      this.groupDevices = devices
      const deviceIds = devices.map(item => String(item.device_id || '').trim()).filter(Boolean)

      const [usingRaw, photoRaw, reserveRaw] = await Promise.all([
        this.fetchByDeviceIds('device_usage', deviceIds, { status: 'using' }),
        this.fetchRecentUsageCandidatesByDeviceIds(deviceIds),
        this.fetchFutureReservesByDeviceIds(deviceIds)
      ])

      const usingRecords = view.uniqueById(usingRaw)
      const deviceViews = view.buildDeviceViews(devices, usingRecords)
      const summary = view.summarizeDevices(deviceViews)
      const usageViews = view.buildUsageViews(usingRecords, Date.now())
      const reserveViews = view.buildReserveViews(view.uniqueById(reserveRaw), Date.now())

      // 照片：先剔掉「一张都拿不出来」的记录，再占名额、再换链接
      const photoCandidates = view.uniqueById(photoRaw)
        .filter(item => view.collectUsagePhotoIds(item).length > 0)
        .sort((a, b) => this.timeValue(b.start_time) - this.timeValue(a.start_time))
        .slice(0, PHOTO_DISPLAY_LIMIT)

      const photoIds = []
      photoCandidates.forEach((item) => {
        view.collectUsagePhotoIds(item).forEach((id) => {
          if (photoIds.indexOf(id) === -1) photoIds.push(id)
        })
      })

      const first = devices[0]
      const mediaIds = photoIds.concat([first.picture, first.video_url].filter(Boolean))
      const mediaMap = await cloudFile.resolveTempUrls(mediaIds)

      const photoViews = view.buildPhotoRecordViews(
        photoCandidates,
        fileId => cloudFile.resolveSingle(fileId, mediaMap)
      )

      const deviceInfo = this.buildDeviceInfo(first, mediaMap)
      this.applyGroupInfo(first)

      // 关键词过滤：设备列表变了，其它三块跟着一起收窄
      let finalDevices = deviceViews
      let finalUsages = usageViews
      let finalPhotos = photoViews
      let finalReserves = reserveViews
      let noMatch = false

      const keyword = String(this.data.filterKeyword || '').trim()
      if (keyword && !this.data.showAllFiltered) {
        finalDevices = view.filterDeviceViews(deviceViews, keyword)
        const keptIds = finalDevices.map(item => item.deviceId)
        if (keptIds.length) {
          const keep = item => keptIds.indexOf(String(item.deviceId || '')) > -1
          finalUsages = usageViews.filter(keep)
          finalPhotos = photoViews.filter(keep)
          finalReserves = reserveViews.filter(keep)
        } else {
          finalUsages = []
          finalPhotos = []
          finalReserves = []
          noMatch = true
        }
      }

      this.setData({
        isLoading: false,
        loadError: false,
        notFound: false,
        noMatch,
        summary,
        devices: finalDevices,
        renderDevices: this.visibleDevices(finalDevices),
        usages: finalUsages,
        usagePhotos: finalPhotos,
        reserves: finalReserves,
        deviceInfo
      })
    } catch (err) {
      console.error('加载设备详情失败:', err)
      this.setData({
        isLoading: false,
        loadError: true
      })
    }
  },

  buildDeviceInfo(device, mediaMap) {
    if (!device) return null
    const procedureText = view.buildRichText(device.operation_procedure)
    const precautionsText = view.buildRichText(device.precautions)

    return {
      pictureId: String(device.picture || '').trim(),
      pictureUrl: cloudFile.resolveSingle(device.picture, mediaMap),
      videoId: String(device.video_url || '').trim(),
      videoUrl: cloudFile.resolveSingle(device.video_url, mediaMap),
      description: String(device.description || '').trim(),
      procedureText,
      precautionsText,
      specs: view.buildSpecList(device.specifications),
      hasDescription: !!String(device.description || '').trim(),
      hasVideo: !!String(device.video_url || '').trim(),
      hasProcedure: !!procedureText,
      hasPrecautions: !!precautionsText,
      rawProcedure: device.operation_procedure,
      rawPrecautions: device.precautions,
      rawSpecs: device.specifications
    }
  },

  timeValue(rawValue) {
    const date = datetime.parseDateTime(rawValue)
    return date ? date.getTime() : 0
  },

  visibleDevices(list) {
    const devices = list || []
    return this.data.showAllDevices ? devices : devices.slice(0, this.data.deviceDisplayLimit)
  },

  retryLoad() {
    this.loadDeviceDetail()
  },

  // ==================== 仪器信息编辑 ====================

  toggleEdit() {
    if (!this.data.deviceInfo) return

    if (this.data.isEditing) {
      this.setData({
        isEditing: false,
        hasNewPicture: false,
        hasNewVideo: false,
        newPictureUrl: '',
        newVideoName: '',
        newVideoTempPath: ''
      })
      return
    }

    const info = this.data.deviceInfo
    const structured = this.isStructuredText(info.rawProcedure) || this.isStructuredText(info.rawPrecautions)
    this.setData({
      isEditing: true,
      editPictureUrl: info.pictureUrl,
      editForm: {
        device_name: this.data.deviceName || '',
        picture: info.pictureId,
        description: info.description,
        video_url: info.videoId,
        operation_procedure: view.buildRichText(info.rawProcedure),
        precautions: view.buildRichText(info.rawPrecautions),
        specifications: view.buildSpecText(info.rawSpecs)
      },
      newPictureUrl: '',
      newVideoName: '',
      newVideoTempPath: '',
      hasNewPicture: false,
      hasNewVideo: false
    })

    // 分步规程是结构化对象，改成纯文本会丢格式，进编辑态先说清楚
    if (structured) {
      wx.showToast({
        title: '规程为分步格式，改写后保存会变成纯文本',
        icon: 'none',
        duration: 2600
      })
    }
  },

  // 老的 operation_procedure / precautions 可能是 { sections: [...] } 结构
  isStructuredText(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  },

  onEditInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({
      [`editForm.${field}`]: e.detail.value
    })
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempFile = (res.tempFiles || [])[0]
        if (!tempFile) return
        this.setData({
          newPictureUrl: tempFile.tempFilePath,
          hasNewPicture: true
        })
      }
    })
  },

  chooseVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album'],
      maxDuration: 300,
      success: (res) => {
        const tempFile = (res.tempFiles || [])[0]
        if (!tempFile) return
        // 临时路径单独存，editForm.video_url 仍保存原 fileID，否则旧视频删不掉也恢复不了
        const fileName = String(tempFile.tempFilePath || '').split('/').pop() || 'video.mp4'
        this.setData({
          newVideoName: fileName,
          newVideoTempPath: tempFile.tempFilePath,
          hasNewVideo: true
        })
      }
    })
  },

  async saveDeviceInfo() {
    if (this.data.isSaving) return

    const info = this.data.deviceInfo || {}
    const form = this.data.editForm
    const deviceName = String(form.device_name || '').trim()
    if (!deviceName) {
      wx.showToast({
        title: '仪器名称不能为空',
        icon: 'none'
      })
      return
    }

    const updateData = {}
    if (deviceName !== this.data.deviceName) updateData.device_name = deviceName
    if (String(form.description || '').trim() !== info.description) {
      updateData.description = String(form.description || '').trim()
    }
    if (String(form.operation_procedure || '').trim() !== String(info.procedureText || '')) {
      updateData.operation_procedure = String(form.operation_procedure || '').trim()
    }
    if (String(form.precautions || '').trim() !== String(info.precautionsText || '')) {
      updateData.precautions = String(form.precautions || '').trim()
    }

    const specsObj = view.parseSpecText(form.specifications)
    if (JSON.stringify(specsObj) !== JSON.stringify(info.rawSpecs || {})) {
      updateData.specifications = specsObj
    }

    const groupDevices = this.groupDevices || []
    const deviceDocIds = groupDevices.map(item => item._id).filter(Boolean)
    if (!deviceDocIds.length) {
      wx.showToast({
        title: '没有可更新的设备',
        icon: 'none'
      })
      return
    }

    const hasNewPicture = this.data.hasNewPicture
    const hasNewVideo = this.data.hasNewVideo
    if (!Object.keys(updateData).length && !hasNewPicture && !hasNewVideo) {
      wx.showToast({
        title: '没有需要保存的修改',
        icon: 'none'
      })
      return
    }

    this.setData({ isSaving: true })
    wx.showLoading({
      title: '保存中...',
      mask: true
    })

    // 上传成功但保存失败的云端文件要回收，否则云存储里全是没人引用的垃圾
    const uploaded = []
    try {
      if (hasNewPicture) {
        const picPath = String(this.data.newPictureUrl || '')
        const picExt = (picPath.split('.').pop() || 'jpg').toLowerCase()
        const picRes = await wx.cloud.uploadFile({
          cloudPath: `device_pics/${Date.now()}.${picExt}`,
          filePath: picPath
        })
        uploaded.push(picRes.fileID)
        updateData.picture = picRes.fileID
      }

      if (hasNewVideo) {
        const vidPath = String(this.data.newVideoTempPath || '')
        if (!vidPath) throw new Error('视频文件丢失，请重新选择')
        const vidExt = (vidPath.split('.').pop() || 'mp4').toLowerCase()
        const vidRes = await wx.cloud.uploadFile({
          cloudPath: `device_videos/${Date.now()}.${vidExt}`,
          filePath: vidPath
        })
        uploaded.push(vidRes.fileID)
        updateData.video_url = vidRes.fileID
      }

      const res = await wx.cloud.callFunction({
        name: 'updateDeviceInfo',
        data: {
          deviceIds: deviceDocIds,
          updateData
        }
      })

      const result = (res && res.result) || {}
      if (result.code !== 0) {
        throw new Error(result.msg || result.message || '云函数更新失败')
      }

      // 换过图/视频才删旧文件，删失败不影响主流程
      const oldFiles = []
      if (updateData.picture && cloudFile.isCloudFileId(info.pictureId)) oldFiles.push(info.pictureId)
      if (updateData.video_url && cloudFile.isCloudFileId(info.videoId)) oldFiles.push(info.videoId)
      if (oldFiles.length) {
        wx.cloud.deleteFile({
          fileList: oldFiles,
          fail: err => console.warn('删除旧文件失败（不影响使用）:', err)
        })
      }

      // 改了名称/型号之后分组键必须跟着变，否则按旧键重新查询会一台都查不到
      const merged = Object.assign({}, groupDevices[0], updateData)
      this.setData({
        isEditing: false,
        isSaving: false,
        hasNewPicture: false,
        hasNewVideo: false,
        newPictureUrl: '',
        newVideoName: '',
        newVideoTempPath: '',
        deviceName: String(merged.device_name || this.data.deviceName),
        deviceModel: view.getDeviceModel(merged),
        groupKey: view.buildGroupKey(merged)
      })

      wx.hideLoading()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })
      await this.loadDeviceDetail({ silent: true })
    } catch (err) {
      console.error('保存仪器信息失败:', err)
      if (uploaded.length) {
        wx.cloud.deleteFile({
          fileList: uploaded,
          fail: cleanErr => console.warn('回收上传文件失败:', cleanErr)
        })
      }
      wx.hideLoading()
      wx.showToast({
        title: err && err.message ? err.message : '保存失败，请重试',
        icon: 'none'
      })
    } finally {
      // 成功与失败分支都已各自关掉 loading，这里只兜状态，避免二次 hideLoading 把 toast 一起关掉
      this.setData({ isSaving: false })
    }
  },

  // ==================== 折叠 / 过滤 ====================

  toggleSection(e) {
    const section = e.currentTarget.dataset.section
    if (!section) return
    this.setData({
      [`sectionCollapsed.${section}`]: !this.data.sectionCollapsed[section]
    })
  },

  toggleDevicesExpand() {
    const showAllDevices = !this.data.showAllDevices
    this.setData({
      showAllDevices,
      renderDevices: showAllDevices
        ? this.data.devices
        : this.data.devices.slice(0, this.data.deviceDisplayLimit)
    })
  },

  clearFilter() {
    this.setData({ showAllFiltered: true }, () => {
      this.loadDeviceDetail({ silent: true })
    })
  },

  // ==================== 跳转 ====================

  gotoReserveDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/reserve-detail/reserve-detail?id=${encodeURIComponent(id)}`
    })
  },

  gotoDeviceInstanceDetail(e) {
    const deviceId = e.currentTarget.dataset.deviceId
    if (!deviceId) return
    wx.navigateTo({
      url: `/pages/device-instance-detail/device-instance-detail?deviceId=${encodeURIComponent(deviceId)}`
    })
  },

  previewPhoto(e) {
    const dataset = e.currentTarget.dataset
    const current = dataset.url
    const rawUrls = dataset.urls
    const urls = Array.isArray(rawUrls) ? rawUrls.filter(Boolean) : []
    if (current && urls.indexOf(current) === -1) urls.unshift(current)
    if (!urls.length) {
      wx.showToast({
        title: '暂无可预览图片',
        icon: 'none'
      })
      return
    }
    wx.previewImage({ current: current || urls[0], urls })
  },

  previewVideo() {
    const info = this.data.deviceInfo
    if (!info || !info.videoUrl) {
      wx.showToast({
        title: '暂无操作视频',
        icon: 'none'
      })
      return
    }
    wx.previewMedia({
      sources: [{ url: info.videoUrl, type: 'video', poster: info.pictureUrl || '' }],
      current: 0
    })
  },

  // ==================== 实例增删与维护状态 ====================

  onNewDeviceIdInput(e) {
    this.setData({ newDeviceId: e.detail.value })
  },

  async addDeviceInstance() {
    if (this.data.isAddingDevice) return

    const newId = String(this.data.newDeviceId || '').trim()
    if (!newId) {
      wx.showToast({
        title: '请输入设备编号',
        icon: 'none'
      })
      return
    }

    const groupDevices = this.groupDevices || []
    const template = groupDevices[0]
    if (!template) {
      wx.showToast({
        title: '缺少模板设备，请刷新后重试',
        icon: 'none'
      })
      return
    }

    // 组内编号唯一：必须拿整组比，页面上的列表可能被关键词过滤过
    const exists = groupDevices.some(item => String(item.device_id || '').trim() === newId)
    if (exists) {
      wx.showToast({
        title: '该设备编号已存在',
        icon: 'none'
      })
      return
    }

    const confirmed = await this.confirmAction(`确认添加设备「${newId}」吗？`)
    if (!confirmed) return

    this.setData({ isAddingDevice: true })
    try {
      const nowText = this.buildNowText()
      await db.collection('devices').add({
        data: {
          device_id: newId,
          device_name: template.device_name || '',
          lab_name: template.lab_name || '',
          lab_type: template.lab_type || '',
          device_room: template.device_room || '',
          device_type: template.device_type || '',
          status: 'available',
          picture: template.picture || '',
          description: template.description || '',
          video_url: template.video_url || '',
          operation_procedure: template.operation_procedure || '',
          precautions: template.precautions || '',
          specifications: template.specifications || {},
          create_time: nowText,
          update_time: nowText
        }
      })

      wx.showToast({
        title: '添加成功',
        icon: 'success'
      })
      this.setData({ newDeviceId: '' })
      await this.loadDeviceDetail({ silent: true })
    } catch (err) {
      console.error('添加设备失败:', err)
      wx.showToast({
        title: '添加失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ isAddingDevice: false })
    }
  },

  async deleteDeviceInstance(e) {
    const dataset = e.currentTarget.dataset
    const docId = dataset.id
    const deviceId = dataset.deviceId
    if (!docId || !deviceId) return

    const confirmed = await this.confirmAction(`确认删除设备「${deviceId}」吗？删除后不可恢复。`)
    if (!confirmed) return

    wx.showLoading({
      title: '删除中...',
      mask: true
    })
    try {
      const active = await this.checkUsageOrWarn(deviceId)
      if (active === null) {
        wx.hideLoading()
        return
      }
      if (active) {
        wx.hideLoading()
        wx.showToast({
          title: '设备正在使用，无法删除',
          icon: 'none'
        })
        return
      }
      await db.collection('devices').doc(docId).remove()
      wx.hideLoading()
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      })
      await this.loadDeviceDetail({ silent: true })
    } catch (err) {
      console.error('删除设备失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '删除失败，请重试',
        icon: 'none'
      })
    }
  },

  /**
   * 查询失败时向上抛：宁可拦住删除/报修，也不能因为一次读失败就认为设备是空闲的
   */
  async hasActiveUsage(deviceId) {
    if (!deviceId) return false
    const res = await db.collection('device_usage')
      .where({
        device_id: deviceId,
        status: 'using'
      })
      .limit(1)
      .get()
    return (res.data || []).length > 0
  },

  // 读不到占用状态时返回 null（已经提示过用户），调用方直接中止操作
  async checkUsageOrWarn(deviceId) {
    try {
      return await this.hasActiveUsage(deviceId)
    } catch (err) {
      console.error('查询设备占用状态失败:', err)
      wx.showToast({
        title: '读取使用状态失败，请稍后重试',
        icon: 'none'
      })
      return null
    }
  },

  confirmAction(content) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认操作',
        content,
        success: res => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  },

  async toggleMaintenance(e) {
    const dataset = e.currentTarget.dataset
    const docId = dataset.id
    const deviceId = dataset.deviceId
    if (!docId || !deviceId) {
      wx.showToast({
        title: '缺少设备参数，无法更新',
        icon: 'none'
      })
      return
    }

    try {
      const active = await this.checkUsageOrWarn(deviceId)
      if (active === null) return
      if (active) {
        wx.showToast({
          title: '设备正在使用，无法切换维护状态',
          icon: 'none'
        })
        this.loadDeviceDetail({ silent: true })
        return
      }

      const latestRes = await db.collection('devices').doc(docId).get()
      const latest = latestRes && latestRes.data
      if (!latest || !latest._id) {
        wx.showToast({
          title: '设备不存在或已删除',
          icon: 'none'
        })
        this.loadDeviceDetail({ silent: true })
        return
      }

      const newStatus = String(latest.status || '') === 'maintenance' ? 'available' : 'maintenance'
      const statusText = newStatus === 'maintenance' ? '维修中' : '可用'
      const confirmed = await this.confirmAction(`确认把设备「${deviceId}」设为${statusText}吗？`)
      if (!confirmed) return

      const stillActive = await this.checkUsageOrWarn(deviceId)
      if (stillActive === null) return
      if (stillActive) {
        wx.showToast({
          title: '设备刚进入使用中，已取消切换',
          icon: 'none'
        })
        this.loadDeviceDetail({ silent: true })
        return
      }

      wx.showLoading({
        title: '更新中...',
        mask: true
      })
      try {
        let result = null
        let callFailed = false
        try {
          const res = await wx.cloud.callFunction({
            name: 'updateDeviceStatus',
            data: {
              docId,
              status: newStatus,
              adminUserId: (this.currentSession && this.currentSession.userId) || ''
            }
          })
          result = (res && res.result) || {}
        } catch (err) {
          callFailed = true
          console.warn('云函数更新失败，尝试前端直接更新:', err)
        }

        if (callFailed) {
          // 只有「云函数调不通」才退回前端直写；云函数返回拒绝时直接写等于绕过权限校验
          await db.collection('devices').doc(docId).update({
            data: { status: newStatus }
          })
        } else if (!result.success) {
          throw new Error(result.error || '更新失败')
        }

        wx.hideLoading()
        wx.showToast({
          title: '状态已更新',
          icon: 'success'
        })
        await this.loadDeviceDetail({ silent: true })
      } catch (err) {
        // 关掉 loading 再抛出，交给外层统一提示，避免同一个 toast 被 hideLoading 关掉
        wx.hideLoading()
        throw err
      }
    } catch (err) {
      console.error('更新设备状态失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: err && err.message ? err.message : '更新失败',
        icon: 'none'
      })
    }
  }
})
