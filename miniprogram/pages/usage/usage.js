// 仪器使用页
// 三件事：扫码开始使用 / 上传过程照片 / 正常结束使用（异常则走反馈并直接结束）
// 页面只负责交互与云开发调用，时间、状态、校验等纯计算都在 usageModel.js 里
const db = wx.cloud.database()
const cloudFile = require('../../utils/cloudFile.js')
const datetime = require('../../utils/datetime.js')
const usageModel = require('./usageModel.js')

const TEMPLATE_ID = 'rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk'
const USAGE_COLLECTION = 'device_usage'
const RESERVE_COLLECTION = 'reserves'
const MESSAGE_COLLECTION = 'messages'

// 使用时长每 30 秒刷一次即可，没必要秒级重排
const ELAPSED_REFRESH_MS = 30 * 1000
const MAX_FEEDBACK_PHOTOS = 3
// 水印画布的长边上限：原图再大也只画到 1600，避免安卓端 canvas 内存爆掉
const MAX_WATERMARK_EDGE = 1600

Page({
  data: {
    isAuthenticated: false,
    isLoading: false,
    isUploading: false,
    isSubmittingFeedback: false,
    isSubmittingEnd: false,
    isHistoryLoading: true,

    currentUsage: null,
    elapsedText: '',
    selfUsageImages: [],
    photoLimit: usageModel.PHOTO_LIMIT,

    pendingReserves: [],
    usageHistory: [],
    unreadReminder: null,

    showFeedback: false,
    feedbackScene: 'start',
    currentReserveId: '',
    feedbackTitle: '',
    feedbackContent: '',
    feedbackPhotos: [],
    maxFeedbackPhotos: MAX_FEEDBACK_PHOTOS,

    showEndForm: false,
    endForm: usageModel.createEmptyEndForm()
  },

  // ==================== 生命周期 ====================

  onLoad() {
    // onShow 紧跟 onLoad 触发，数据统一放在 onShow 里加载，
    // 避免旧实现首次进入时每个查询都跑两遍
    this.checkAuth()
  },

  onShow() {
    this.checkAuth()
    this.refreshAll()
  },

  onHide() {
    this.stopElapsedTimer()
  },

  onUnload() {
    this.stopElapsedTimer()
  },

  async onPullDownRefresh() {
    try {
      await this.refreshAll()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // ==================== 身份 ====================

  checkAuth() {
    const userInfo = wx.getStorageSync('userInfo')
    const isAuthenticated = !!(userInfo && userInfo.userId)
    if (isAuthenticated === this.data.isAuthenticated) return
    this.setData({ isAuthenticated })
  },

  goAuth() {
    wx.navigateTo({ url: '/pages/auth/auth' })
  },

  getCachedUserInfo() {
    return wx.getStorageSync('userInfo') || {}
  },

  // ==================== 数据加载 ====================

  refreshAll() {
    return Promise.all([
      this.loadCurrentUsage(),
      this.loadPendingReserves(),
      this.loadUsageHistory(),
      this.loadUnreadReminder()
    ])
  },

  async loadCurrentUsage() {
    const userInfo = this.getCachedUserInfo()
    if (!userInfo.userId) {
      this.clearCurrentUsage()
      return null
    }

    try {
      const res = await db.collection(USAGE_COLLECTION)
        .where({ user_id: userInfo.userId, status: 'using' })
        .orderBy('start_time', 'desc')
        .limit(1)
        .get()
      const record = (res.data && res.data[0]) || null
      if (!record) {
        this.clearCurrentUsage()
        return null
      }

      this.setData({
        currentUsage: usageModel.buildUsageView(record),
        elapsedText: usageModel.formatElapsedText(record.start_time)
      })
      this.startElapsedTimer()
      await this.resolveUsageImages()
      return record
    } catch (err) {
      console.error('[usage] 获取当前使用记录失败', err)
      return null
    }
  },

  clearCurrentUsage() {
    this.stopElapsedTimer()
    const patch = { elapsedText: '' }
    if (this.data.currentUsage) patch.currentUsage = null
    if (this.data.selfUsageImages.length) patch.selfUsageImages = []
    this.setData(patch)
  },

  // 使用时长在页面上实时走，避免用户开一小时还看到「已使用 3 分钟」
  startElapsedTimer() {
    this.stopElapsedTimer()
    this.elapsedTimer = setInterval(() => {
      const usage = this.data.currentUsage
      if (!usage) return
      const elapsedText = usageModel.formatElapsedText(usage.start_time)
      if (elapsedText && elapsedText !== this.data.elapsedText) {
        this.setData({ elapsedText })
      }
    }, ELAPSED_REFRESH_MS)
  },

  stopElapsedTimer() {
    if (!this.elapsedTimer) return
    clearInterval(this.elapsedTimer)
    this.elapsedTimer = null
  },

  async resolveUsageImages() {
    const usage = this.data.currentUsage
    const rawList = (usage && usage.usage_images) || []
    if (!rawList.length) {
      if (this.data.selfUsageImages.length) this.setData({ selfUsageImages: [] })
      return
    }

    try {
      // cloud:// 不能直接给 <image src>，必须换成 https 临时链接（cloudFile 内有 5 分钟缓存）
      const urlMap = await cloudFile.resolveTempUrls(rawList)
      const images = rawList
        .map(fileId => ({ fileId, url: cloudFile.resolveSingle(fileId, urlMap), failed: false }))
        .filter(item => item.url)
      this.setData({ selfUsageImages: images })
    } catch (err) {
      console.error('[usage] 解析使用过程照片失败', err)
    }
  },

  // 待使用预约只关心「今天及以后还没结束」的单子，
  // 旧实现在 while 里把所有历史预约全量翻页拉回本地过滤，白跑一堆请求
  async loadPendingReserves() {
    const userInfo = this.getCachedUserInfo()
    if (!userInfo.userId) {
      this.setData({ pendingReserves: [] })
      return []
    }

    const now = Date.now()
    const dayStartTs = usageModel.getDayStartTs(now)
    const _ = db.command

    try {
      // 服务端就把「今天之前已经结束」的预约过滤掉，
      // 只把可能还在等待中/正在时间窗内的记录取回来（需 user_id + status + end_ts 组合索引）
      const records = await this.fetchReserves({
        user_id: userInfo.userId,
        status: 'approved',
        end_ts: _.gte(dayStartTs)
      })

      const pendingReserves = usageModel.buildPendingReserveList(records, now)
      this.setData({ pendingReserves })
      return pendingReserves
    } catch (err) {
      console.error('[usage] 获取待使用预约失败', err)
      this.setData({ pendingReserves: [] })
      return []
    }
  },

  async fetchReserves(condition) {
    const res = await db.collection(RESERVE_COLLECTION)
      .where(condition)
      .orderBy('end_ts', 'asc')
      .limit(usageModel.PENDING_LIMIT)
      .get()
    return (res && res.data) || []
  },

  async loadUsageHistory() {
    const userInfo = this.getCachedUserInfo()
    if (!userInfo.userId) {
      this.setData({ usageHistory: [], isHistoryLoading: false })
      return []
    }

    const _ = db.command
    this.setData({ isHistoryLoading: true })
    try {
      const res = await db.collection(USAGE_COLLECTION)
        .where({ user_id: userInfo.userId, status: _.in(['completed', 'abnormal']) })
        .orderBy('start_time', 'desc')
        .limit(usageModel.HISTORY_LIMIT)
        .get()
      const usageHistory = usageModel.buildHistoryList(res.data || [])
      this.setData({ usageHistory })
      return usageHistory
    } catch (err) {
      console.error('[usage] 获取使用历史失败', err)
      return []
    } finally {
      this.setData({ isHistoryLoading: false })
    }
  },

  async loadUnreadReminder() {
    const userInfo = this.getCachedUserInfo()
    if (!userInfo.userId) {
      this.setData({ unreadReminder: null })
      return null
    }

    const _ = db.command
    try {
      const res = await db.collection(MESSAGE_COLLECTION)
        .where({
          user_id: userInfo.userId,
          is_read: _.neq(true),
          type: _.in(usageModel.REMINDER_TYPES)
        })
        .orderBy('create_time', 'desc')
        .limit(1)
        .get()
      const item = (res.data && res.data[0]) || null
      this.setData({ unreadReminder: item ? usageModel.buildReminderView(item) : null })
      return item
    } catch (err) {
      console.error('[usage] 获取未读提醒失败', err)
      this.setData({ unreadReminder: null })
      return null
    }
  },

  // ==================== 提醒 ====================

  goToReminder() {
    const reminder = this.data.unreadReminder
    if (!reminder || !reminder._id) return

    // 先本地收掉横幅再发网络请求，点一下就有反馈
    this.setData({ unreadReminder: null })
    this.markReminderRead(reminder._id)

    if (reminder.is_photo && this.data.currentUsage) {
      wx.pageScrollTo({ selector: '#photoSection', offsetTop: -12, duration: 260 })
      return
    }
    wx.navigateTo({
      url: `/pages/message/detail/messagedetail?messageId=${reminder._id}&source=message`
    })
  },

  markReminderRead(messageId) {
    if (!messageId) return
    db.collection(MESSAGE_COLLECTION)
      .doc(messageId)
      .update({ data: { is_read: true } })
      .catch(err => console.error('[usage] 标记提醒已读失败', err))
  },

  closeReminder() {
    const reminder = this.data.unreadReminder
    if (!reminder || !reminder._id) return
    this.setData({ unreadReminder: null })
    this.markReminderRead(reminder._id)
  },

  // ==================== 使用过程照片 ====================

  onUsagePhotoError(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    if (!this.data.selfUsageImages[index]) return
    this.setData({ [`selfUsageImages[${index}].failed`]: true })
  },

  previewUsagePhoto(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const urls = this.data.selfUsageImages
      .filter(item => item.url && !item.failed)
      .map(item => item.url)
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  async uploadUsagePhoto() {
    const usage = this.data.currentUsage
    if (!usage || !usage._id) {
      wx.showToast({ title: '当前没有进行中的使用', icon: 'none' })
      return
    }
    if (this.data.isUploading) return

    const remain = usageModel.PHOTO_LIMIT - this.data.selfUsageImages.length
    if (remain <= 0) {
      wx.showToast({ title: `最多上传 ${usageModel.PHOTO_LIMIT} 张照片`, icon: 'none' })
      return
    }

    let tempFiles = []
    try {
      const mediaRes = await wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      tempFiles = (mediaRes && mediaRes.tempFiles) || []
    } catch (err) {
      if (!this.isUserCancel(err)) console.error('[usage] 选择照片失败', err)
      return
    }
    if (!tempFiles.length) return

    this.requestSubscribeMessage()
    this.setData({ isUploading: true })
    wx.showLoading({ title: '上传中…', mask: true })

    const uploaded = []
    try {
      for (let i = 0; i < tempFiles.length; i += 1) {
        const file = tempFiles[i]
        // 过程照片同样打水印，管理员核对时能一眼看出时间与仪器
        wx.showLoading({ title: `处理第 ${i + 1}/${tempFiles.length} 张`, mask: true })
        const watermarkedPath = await this.addWatermarkToPhoto(
          file.tempFilePath,
          usage.device_name,
          usage.device_id
        )
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `usage_photos/mid_${Date.now()}_${this.randomSuffix()}.jpg`,
          filePath: watermarkedPath
        })
        uploaded.push(uploadRes.fileID)
      }

      await db.collection(USAGE_COLLECTION).doc(usage._id).update({
        data: { usage_images: db.command.push(uploaded) }
      })
      wx.hideLoading()
      wx.showToast({ title: `已上传 ${uploaded.length} 张`, icon: 'success' })
      await this.loadCurrentUsage()
    } catch (err) {
      wx.hideLoading()
      console.error('[usage] 上传使用过程照片失败', err)
      // 半途失败时把已经传上去的文件删掉，别在云存储留垃圾
      if (uploaded.length) await this.cleanupCloudFiles(uploaded)
      wx.showToast({ title: '照片上传失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isUploading: false })
    }
  },

  // ==================== 开始使用 ====================

  async startUsageFromReserve(e) {
    if (this.data.isLoading) return
    const reserveId = e.currentTarget.dataset.reserveid
    if (!reserveId) return

    const isNormal = await this.confirmDeviceStart(reserveId)
    if (!isNormal) return

    this.setData({ isLoading: true })
    try {
      const reserveInfo = await this.fetchReserveInfo(reserveId)
      if (!reserveInfo) return

      const scannedDeviceId = await this.scanDeviceQR()
      if (!this.validateScanResult(scannedDeviceId, reserveInfo.deviceId)) return

      const confirmed = await this.confirmStartUsage(reserveInfo.deviceName, scannedDeviceId)
      if (!confirmed) return

      const photoPath = await this.takeAndProcessPhoto(reserveInfo.deviceName, scannedDeviceId)
      if (!photoPath) return

      await this.handleStartPhoto(reserveId, photoPath)
    } catch (err) {
      // 用户点取消不是错误，别弹「操作失败」
      if (this.isUserCancel(err)) return
      console.error('[usage] 开始使用失败', err)
      wx.showToast({ title: (err && err.message) || '操作失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  confirmDeviceStart(reserveId) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '仪器是否正常启动',
        content: '点「出现问题」可直接提交异常反馈。',
        confirmText: '正常启动',
        cancelText: '出现问题',
        success: (res) => {
          if (!res.confirm) {
            this.openStartFeedback(reserveId)
            resolve(false)
            return
          }
          this.requestSubscribeMessage()
          resolve(true)
        },
        fail: () => resolve(false)
      })
    })
  },

  openStartFeedback(reserveId) {
    this.setData({
      showFeedback: true,
      feedbackScene: 'start',
      feedbackTitle: '',
      feedbackContent: '',
      feedbackPhotos: [],
      currentReserveId: reserveId || ''
    })
  },

  async fetchReserveInfo(reserveId) {
    try {
      const res = await db.collection(RESERVE_COLLECTION).doc(reserveId).get()
      const reserve = res && res.data
      if (!reserve) {
        wx.showToast({ title: '预约不存在或已失效', icon: 'none' })
        return null
      }
      return {
        deviceId: String(reserve.device_id || '').trim(),
        deviceName: reserve.device_name || '未知仪器'
      }
    } catch (err) {
      console.error('[usage] 获取预约信息失败', err)
      wx.showToast({ title: '预约不存在或已失效', icon: 'none' })
      return null
    }
  },

  scanDeviceQR() {
    return new Promise((resolve, reject) => {
      wx.scanCode({
        onlyFromCamera: true,
        scanType: ['qrCode'],
        success: (res) => {
          const parsed = this.parseSchoolQRCode(res.result)
          if (!parsed || !parsed.deviceId) {
            reject(new Error('无法识别仪器二维码'))
            return
          }
          resolve(parsed.deviceId)
        },
        fail: err => reject(this.normalizeError(err, '扫码失败，请重试'))
      })
    })
  },

  // 学校二维码是带 yqbh 参数的 URL，老自研码是纯编号，两种都认
  parseSchoolQRCode(content) {
    const raw = String(content || '').trim()
    if (!raw) return null

    const matched = raw.match(/[?&]yqbh=([^&#\s]+)/i)
    if (matched && matched[1]) {
      return { deviceId: decodeURIComponent(matched[1]).trim(), source: 'url' }
    }

    if (/^[A-Za-z0-9-]{3,32}$/.test(raw)) {
      return { deviceId: raw, source: 'legacy' }
    }
    return null
  },

  validateScanResult(scannedDeviceId, expectedDeviceId) {
    if (!expectedDeviceId) return true
    if (String(scannedDeviceId).toUpperCase() === String(expectedDeviceId).toUpperCase()) return true

    wx.showModal({
      title: '设备不匹配',
      content: `该预约对应仪器为 ${expectedDeviceId}，请扫描正确的仪器二维码。`,
      showCancel: false
    })
    return false
  },

  confirmStartUsage(deviceName, deviceId) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认开始使用',
        content: `即将开始使用「${deviceName}」（${deviceId}），请拍摄仪器正在运行的照片。`,
        confirmText: '去拍照',
        success: res => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
  },

  async takeAndProcessPhoto(deviceName, deviceId) {
    let tempFilePath = ''
    try {
      const mediaRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera']
      })
      const file = mediaRes && mediaRes.tempFiles && mediaRes.tempFiles[0]
      tempFilePath = (file && file.tempFilePath) || ''
    } catch (err) {
      throw this.normalizeError(err, '无法拍照，请重试')
    }
    if (!tempFilePath) return ''

    wx.showLoading({ title: '添加水印…', mask: true })
    try {
      return await this.addWatermarkToPhoto(tempFilePath, deviceName, deviceId)
    } finally {
      wx.hideLoading()
    }
  },

  async handleStartPhoto(reserveId, photoPath) {
    const userInfo = this.getCachedUserInfo()
    if (!userInfo.userId) {
      wx.showToast({ title: '请先完成身份认证', icon: 'none' })
      return
    }

    wx.showLoading({ title: '创建使用记录…', mask: true })
    try {
      // 再过一遍预约状态：从弹窗到拍照中间可能已经过期或被别的端开始
      const reserveRes = await db.collection(RESERVE_COLLECTION).doc(reserveId).get()
      const reserve = reserveRes && reserveRes.data
      if (!reserve) throw new Error('该预约已失效，请下拉刷新')
      if (reserve.status !== 'approved') throw new Error('当前预约不可开始使用')
      if (String(reserve.user_id || '').trim() !== String(userInfo.userId).trim()) {
        throw new Error('无权开始该预约')
      }
      if (reserve.usage_status && reserve.usage_status !== 'not_started') {
        throw new Error('该预约已开始使用，请勿重复操作')
      }

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `usage_photos/start_${Date.now()}_${this.randomSuffix()}.jpg`,
        filePath: photoPath
      })
      const startPhotoId = uploadRes.fileID

      let callRes = null
      try {
        callRes = await wx.cloud.callFunction({
          name: 'startUsage',
          data: {
            reserveId,
            startPhotoId,
            userInfo: {
              userId: userInfo.userId,
              name: userInfo.name || '',
              phone: userInfo.phone || '',
              groupName: userInfo.groupName || '',
              openid: userInfo.openid || ''
            }
          }
        })
      } catch (err) {
        // 云函数调用失败：把刚传的照片删掉，避免占空间
        await this.cleanupCloudFiles([startPhotoId])
        throw err
      }

      const result = (callRes && callRes.result) || {}
      if (!result.success) {
        await this.cleanupCloudFiles([startPhotoId])
        throw new Error(this.getStartUsageErrorMessage(result))
      }

      wx.hideLoading()
      wx.showToast({ title: '开始使用成功', icon: 'success' })
      await this.refreshAll()
    } catch (err) {
      wx.hideLoading()
      throw err
    }
  },

  getStartUsageErrorMessage(result) {
    const code = result && result.code
    if (code === 'ALREADY_STARTED') return '该预约已开始使用，请勿重复操作'
    if (code === 'INVALID_TIME_WINDOW' || code === 'RESERVE_NOT_FOUND') return '当前时间无可开始使用的预约'
    if (code === 'FORBIDDEN') return '无权开始该预约'
    return (result && result.error) || '开始使用失败，请重试'
  },

  // ==================== 异常反馈（提交即结束） ====================

  openUsageFeedback() {
    const usage = this.data.currentUsage
    if (!usage || !usage.reserve_id) {
      wx.showToast({ title: '未找到对应的预约记录，请下拉刷新', icon: 'none' })
      return
    }
    this.setData({
      showFeedback: true,
      feedbackScene: 'using',
      feedbackTitle: '',
      feedbackContent: '',
      feedbackPhotos: [],
      currentReserveId: usage.reserve_id
    })
  },

  closeFeedback() {
    if (this.data.isSubmittingFeedback) return
    this.setData({ showFeedback: false })
  },

  onFeedbackTitleInput(e) {
    this.setData({ feedbackTitle: e.detail.value })
  },

  onFeedbackContentInput(e) {
    this.setData({ feedbackContent: e.detail.value })
  },

  async chooseFeedbackPhoto() {
    const remain = MAX_FEEDBACK_PHOTOS - this.data.feedbackPhotos.length
    if (remain <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_FEEDBACK_PHOTOS} 张照片`, icon: 'none' })
      return
    }

    try {
      const mediaRes = await wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const files = (mediaRes && mediaRes.tempFiles) || []
      if (!files.length) return
      this.setData({
        feedbackPhotos: this.data.feedbackPhotos.concat(files.map(file => file.tempFilePath))
      })
    } catch (err) {
      if (!this.isUserCancel(err)) console.error('[usage] 选择反馈照片失败', err)
    }
  },

  deleteFeedbackPhoto(e) {
    const index = e.currentTarget.dataset.index
    const photos = this.data.feedbackPhotos.slice()
    photos.splice(index, 1)
    this.setData({ feedbackPhotos: photos })
  },

  previewFeedbackPhoto(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ current: url, urls: this.data.feedbackPhotos })
  },

  async uploadFeedbackPhotos() {
    const uploaded = []
    for (let i = 0; i < this.data.feedbackPhotos.length; i += 1) {
      const filePath = this.data.feedbackPhotos[i]
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `feedback_pics/${Date.now()}_${i}_${this.randomSuffix()}.jpg`,
        filePath
      })
      uploaded.push(uploadRes.fileID)
    }
    return uploaded
  },

  async submitFeedback() {
    if (this.data.isSubmittingFeedback) return

    const { feedbackTitle, feedbackContent, feedbackScene, currentReserveId } = this.data
    const content = String(feedbackContent || '').trim()
    if (!content) {
      wx.showToast({ title: '请填写问题描述', icon: 'none' })
      return
    }
    // 这里不再用 pendingReserves[0] 兜底：猜错预约会把反馈挂到别人的记录上
    if (!currentReserveId) {
      wx.showToast({ title: '预约信息异常，请重新进入页面', icon: 'none' })
      return
    }

    const userInfo = this.getCachedUserInfo()
    this.setData({ isSubmittingFeedback: true })
    wx.showLoading({ title: '提交中…', mask: true })

    let uploadedPhotos = []
    try {
      uploadedPhotos = await this.uploadFeedbackPhotos()
      const res = await wx.cloud.callFunction({
        name: 'submitAbnormalFeedback',
        data: {
          reserveId: currentReserveId,
          feedbackTitle: String(feedbackTitle || '').trim(),
          feedbackContent: content,
          feedbackScene,
          feedbackPhotos: uploadedPhotos,
          // 反馈即结束：不留「已反馈但还在使用中」的中间态
          endUsage: true,
          userInfo: {
            userId: userInfo.userId || '',
            name: userInfo.name || '',
            phone: userInfo.phone || '',
            groupName: userInfo.groupName || '',
            openid: userInfo.openid || ''
          }
        }
      })

      const result = (res && res.result) || {}
      if (!result.success) throw new Error(result.error || '提交失败')

      wx.hideLoading()
      this.setData({ showFeedback: false })
      this.notifyAbnormalFeedback(currentReserveId, feedbackTitle, content, userInfo)
      wx.showToast({
        title: feedbackScene === 'using' ? '反馈已提交，本次使用已结束' : '反馈已提交',
        icon: 'none',
        duration: 2000
      })
      await this.refreshAll()
    } catch (err) {
      wx.hideLoading()
      console.error('[usage] 提交异常反馈失败', err)
      if (uploadedPhotos.length) await this.cleanupCloudFiles(uploadedPhotos)
      wx.showToast({ title: (err && err.message) || '提交失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSubmittingFeedback: false })
    }
  },

  // 通知失败不影响反馈已提交的事实，只记日志
  notifyAbnormalFeedback(reserveId, title, content, userInfo) {
    const usage = this.data.currentUsage || {}
    wx.cloud.callFunction({
      name: 'sendAbnormalNotification',
      data: {
        reserveId,
        deviceName: usage.device_name || '',
        deviceId: usage.device_id || '',
        userName: userInfo.name || userInfo.userId || '未知用户',
        feedbackTitle: String(title || '').trim(),
        feedbackContent: String(content || '').trim()
      }
    }).catch(err => console.error('[usage] 发送异常通知失败', err))
  },

  // ==================== 正常结束使用 ====================

  startEndUsage() {
    if (!this.data.currentUsage) {
      wx.showToast({ title: '当前没有进行中的使用', icon: 'none' })
      return
    }
    this.setData({
      showEndForm: true,
      endForm: usageModel.createEmptyEndForm()
    })
  },

  cancelEndForm() {
    if (this.data.isSubmittingEnd) return
    this.setData({ showEndForm: false })
  },

  updateEndForm(key, value) {
    this.setData({ [`endForm.${key}`]: value })
  },

  selectInstrumentOff(e) {
    this.updateEndForm('instrumentOff', e.currentTarget.dataset.value === 'true')
  },

  selectComputerOff(e) {
    this.updateEndForm('computerOff', e.currentTarget.dataset.value === 'true')
  },

  selectMoreSample(e) {
    this.updateEndForm('moreSample', e.currentTarget.dataset.value === 'true')
  },

  selectNeedSupplement(e) {
    this.updateEndForm('needSupplement', e.currentTarget.dataset.value === 'true')
  },

  onNextUserInput(e) {
    this.updateEndForm('nextUser', e.detail.value)
  },

  onSampleCountInput(e) {
    const value = this.normalizeCountInput(e.detail.value)
    this.updateEndForm('sampleCount', value)
    // 返回过滤后的值，输入框里的非法字符会被立刻吃掉
    return value
  },

  onMoreSampleCountInput(e) {
    const value = this.normalizeCountInput(e.detail.value)
    this.updateEndForm('moreSampleCount', value)
    return value
  },

  // 只留数字，且不允许前导 0（'0' 直接清空，免得不小心提交 0 个样品）
  normalizeCountInput(value) {
    const digits = String(value || '').replace(/\D/g, '')
    if (!digits) return ''
    const trimmed = digits.replace(/^0+/, '')
    return trimmed
  },

  async pickEndPhoto(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return

    try {
      const mediaRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const file = mediaRes && mediaRes.tempFiles && mediaRes.tempFiles[0]
      if (file && file.tempFilePath) this.updateEndForm(key, file.tempFilePath)
    } catch (err) {
      if (!this.isUserCancel(err)) console.error('[usage] 选择结束照片失败', err)
    }
  },

  clearEndPhoto(e) {
    const key = e.currentTarget.dataset.key
    if (key) this.updateEndForm(key, '')
  },

  async submitEndForm() {
    if (this.data.isSubmittingEnd) return

    const usage = this.data.currentUsage
    if (!usage || !usage._id) {
      wx.showToast({ title: '使用记录已失效，请下拉刷新', icon: 'none' })
      return
    }

    const endForm = this.data.endForm
    const formError = usageModel.getEndFormError(endForm)
    if (formError) {
      wx.showToast({ title: formError, icon: 'none' })
      return
    }

    this.setData({ isSubmittingEnd: true })
    wx.showLoading({ title: '提交中…', mask: true })

    const uploaded = []
    try {
      const fileIds = {
        totalPage: await this.uploadEndPhoto('end_check/total_', endForm.totalPage, uploaded),
        devicePage: await this.uploadEndPhoto('end_check/device_', endForm.devicePage, uploaded),
        roomPage: await this.uploadEndPhoto('end_check/room_', endForm.roomPage, uploaded),
        supplementPage: ''
      }
      if (endForm.needSupplement) {
        fileIds.supplementPage = await this.uploadEndPhoto(
          'end_check/supplement_',
          endForm.supplementPage,
          uploaded
        )
      }

      const endChecklist = usageModel.buildEndChecklist(endForm, fileIds)

      await db.collection(USAGE_COLLECTION).doc(usage._id).update({
        data: {
          end_time: new Date().toISOString(),
          status: 'completed',
          end_checklist: endChecklist
        }
      })

      if (usage.reserve_id) {
        await db.collection(RESERVE_COLLECTION).doc(usage.reserve_id).update({
          data: { usage_status: 'completed' }
        })
      }

      wx.hideLoading()
      this.stopElapsedTimer()
      this.setData({
        showEndForm: false,
        currentUsage: null,
        selfUsageImages: [],
        elapsedText: ''
      })
      wx.showToast({ title: '使用已结束', icon: 'success' })
      await this.refreshAll()
    } catch (err) {
      wx.hideLoading()
      console.error('[usage] 结束使用失败', err)
      if (uploaded.length) await this.cleanupCloudFiles(uploaded)
      wx.showToast({ title: '结束失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSubmittingEnd: false })
    }
  },

  async uploadEndPhoto(prefix, filePath, uploadedList) {
    const uploadRes = await wx.cloud.uploadFile({
      cloudPath: `${prefix}${Date.now()}_${this.randomSuffix()}.jpg`,
      filePath
    })
    uploadedList.push(uploadRes.fileID)
    return uploadRes.fileID
  },

  // ==================== 历史记录 ====================

  openHistoryDetail(e) {
    const reserveId = e.currentTarget.dataset.reserveid
    if (!reserveId) {
      wx.showToast({ title: '该记录没有关联预约', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/reserve-detail/reserve-detail?id=${reserveId}` })
  },

  // ==================== 通用工具 ====================

  async addWatermarkToPhoto(tempFilePath, deviceName, deviceId) {
    if (!tempFilePath) return ''
    try {
      const info = await this.getImageInfo(tempFilePath)
      return await this.drawWatermark(info, tempFilePath, deviceName, deviceId)
    } catch (err) {
      // 水印失败不该挡住主流程，退回原图继续上传
      console.warn('[usage] 添加水印失败，使用原图', err)
      return tempFilePath
    }
  },

  getImageInfo(src) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src,
        success: resolve,
        fail: reject
      })
    })
  },

  drawWatermark(info, tempFilePath, deviceName, deviceId) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#watermarkCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node
          if (!canvas) {
            reject(new Error('水印画布未就绪'))
            return
          }

          // 原图动辄 4000px，直接开这么大的画布在安卓上会 OOM，长边压到 1600 足够看清水印
          const rawWidth = info.width || 750
          const rawHeight = info.height || 1000
          const scale = Math.min(1, MAX_WATERMARK_EDGE / Math.max(rawWidth, rawHeight))
          const width = Math.max(Math.round(rawWidth * scale), 1)
          const height = Math.max(Math.round(rawHeight * scale), 1)

          // 先定画布尺寸再取上下文，避免 resize 把已设置的绘制状态清掉
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')

          const image = canvas.createImage()
          image.onload = () => {
            ctx.clearRect(0, 0, width, height)
            ctx.drawImage(image, 0, 0, width, height)

            const now = new Date()
            const lines = [
              `${datetime.formatDateKey(now)} ${datetime.formatClock(now)}`,
              `${deviceName || ''} ${deviceId || ''}`.trim()
            ].filter(Boolean)

            const fontSize = Math.max(Math.round(width / 24), 14)
            const x = Math.round(width / 24)
            let y = Math.round(height / 3)

            ctx.textBaseline = 'top'
            ctx.font = `${fontSize}px sans-serif`
            ctx.lineWidth = Math.max(Math.round(fontSize / 6), 2)
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
            ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
            lines.forEach((line) => {
              ctx.strokeText(line, x, y)
              ctx.fillText(line, x, y)
              y += Math.round(fontSize * 1.5)
            })

            wx.canvasToTempFilePath({
              canvas,
              x: 0,
              y: 0,
              width,
              height,
              destWidth: width,
              destHeight: height,
              fileType: 'jpg',
              quality: 0.92,
              success: out => resolve(out.tempFilePath || tempFilePath),
              fail: () => reject(new Error('导出水印照片失败'))
            })
          }
          image.onerror = () => reject(new Error('读取照片失败'))
          image.src = tempFilePath
        })
    })
  },

  async cleanupCloudFiles(fileIds) {
    const list = (fileIds || []).filter(Boolean)
    if (!list.length) return
    try {
      await wx.cloud.deleteFile({ fileList: list })
    } catch (err) {
      console.warn('[usage] 清理云端文件失败', err)
    }
  },

  requestSubscribeMessage() {
    // 同一次会话里只问一次，用户拒绝后不再骚扰
    if (wx.getStorageSync(`msg_subscribed_${TEMPLATE_ID}`)) return
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: (res) => {
        if (res && res[TEMPLATE_ID] === 'accept') {
          wx.setStorageSync(`msg_subscribed_${TEMPLATE_ID}`, true)
        }
      },
      fail: err => console.warn('[usage] 订阅消息授权失败', err)
    })
  },

  randomSuffix() {
    return Math.random().toString(36).slice(2, 8)
  },

  // 弹层上挡住穿透滚动的占位处理器
  noop() {},

  // 把 wx 的 fail 回调统一成 Error，并标出「用户自己取消」
  normalizeError(err, fallbackMessage) {
    const message = (err && (err.errMsg || err.message)) || ''
    const error = new Error(message || fallbackMessage || '操作失败')
    error.isUserCancel = message.indexOf('cancel') !== -1 || message.indexOf('取消') !== -1
    return error
  },

  isUserCancel(err) {
    if (!err) return false
    if (err.isUserCancel) return true
    const message = err.errMsg || err.message || ''
    return message.indexOf('cancel') !== -1 || message.indexOf('取消') !== -1
  }
})
