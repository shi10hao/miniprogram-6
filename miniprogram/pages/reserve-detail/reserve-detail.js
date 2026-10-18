// pages/reserve-detail/reserve-detail.js
const cloudFile = require('../../utils/cloudFile.js')
const datetime = require('../../utils/datetime.js')

// 与管理端一致：教师和管理员才能处理异常
const ADMIN_ROLES = ['teacher', 'admin']
const MAX_USAGE_QUERY = 10

const STATUS_META = {
  upcoming: { text: '即将到来' },
  using: { text: '使用中' },
  completed: { text: '已完成' },
  abnormal: { text: '待处理异常' }
}

Page({
  data: {
    isLoading: true,
    hasError: false,
    errorText: '',
    forbidden: false,
    isAdmin: false,
    status: 'upcoming',
    statusText: '即将到来',
    statusTip: '',
    detail: {
      studentName: '',
      groupName: '',
      deviceId: '',
      deviceName: '',
      dateDisplay: '',
      timeDisplay: '',
      startAtDisplay: '',
      endAtDisplay: '',
      startPhotoUrl: '',
      usageImageUrls: [],
      reservePageUrl: '',
      endChecklist: null
    },
    abnormal: {
      has: false,
      isResolved: false,
      pending: false,
      title: '',
      content: '',
      timeDisplay: '',
      photos: [],
      handledBy: '',
      handledTimeDisplay: ''
    },
    allPhotos: [],
    isHandling: false,
    skeletonRows: [0, 1, 2]
  },

  // ==================== 生命周期 ====================

  onLoad(options) {
    this.reserveId = this.resolveReserveId(options)
    this.setData({ isAdmin: this.isAdminViewer() })
    if (!this.reserveId) {
      this.setData({
        isLoading: false,
        hasError: true,
        errorText: '缺少预约编号，请返回重新进入'
      })
      return
    }
    this.loadDetail()
  },

  async onPullDownRefresh() {
    if (!this.reserveId) {
      wx.stopPullDownRefresh()
      return
    }
    try {
      await this.loadDetail({ silent: true })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // ==================== 身份与权限 ====================

  resolveReserveId(options) {
    const raw = (options && options.id) || ''
    if (!raw) return ''
    try {
      return String(decodeURIComponent(raw)).trim()
    } catch (err) {
      return String(raw).trim()
    }
  },

  /** 管理端身份（adminInfo 由 loginAdmin 写入），只用于决定按钮显隐 */
  isAdminViewer() {
    const adminInfo = wx.getStorageSync('adminInfo') || {}
    return Boolean(adminInfo.userId) && ADMIN_ROLES.indexOf(adminInfo.role) !== -1
  },

  /**
   * 谁可以看这条预约：管理员看全部，学生只能看自己的。
   * 注意：这里只是界面兜底，真正的数据安全依赖数据库安全规则。
   */
  canViewReserve(reserve) {
    if (!reserve) return false
    if (this.data.isAdmin) return true
    const userInfo = wx.getStorageSync('userInfo') || {}
    const myUserId = String(userInfo.userId || '').trim()
    if (!myUserId) return false
    return String(reserve.user_id || '').trim() === myUserId
  },

  // ==================== 数据加载 ====================

  /** silent: true 用于下拉刷新，保留当前内容不闪骨架屏 */
  async loadDetail(options) {
    const silent = Boolean(options && options.silent)
    const patch = { hasError: false, errorText: '' }
    if (!silent) patch.isLoading = true
    this.setData(patch)

    try {
      const snapshot = await this.fetchSnapshot()
      if (!snapshot.reserve) {
        this.setData({ isLoading: false, forbidden: true })
        return
      }
      if (!this.canViewReserve(snapshot.reserve)) {
        this.setData({ isLoading: false, forbidden: true })
        return
      }

      const fileIds = this.collectFileIDs(snapshot.reserve, snapshot.usage)
      let urlMap = {}
      try {
        urlMap = await cloudFile.resolveTempUrls(fileIds)
      } catch (err) {
        // 图片换链接失败不影响文字信息展示
        console.error('[reserve-detail] 换取图片临时链接失败', err)
      }

      const detail = this.buildDetail(snapshot.reserve, snapshot.usage, urlMap)
      const abnormal = this.buildAbnormal(snapshot.usage, urlMap)
      const status = this.calcStatus(snapshot.reserve, snapshot.usage)
      const meta = STATUS_META[status] || STATUS_META.completed

      this.setData({
        isLoading: false,
        status,
        statusText: meta.text,
        statusTip: this.buildStatusTip(status, detail),
        detail,
        abnormal,
        allPhotos: this.collectPhotos(detail, abnormal)
      })
    } catch (err) {
      console.error('[reserve-detail] 加载预约详情失败', err)
      this.setData({
        isLoading: false,
        hasError: true,
        errorText: '预约详情加载失败，请下拉刷新重试'
      })
    }
  },

  /** 一次取回预约与它的使用记录（用 where 查询，记录不存在时返回空数组而不是抛错） */
  async fetchSnapshot() {
    const db = wx.cloud.database()
    const [reserveRes, usageRes] = await Promise.all([
      db.collection('reserves')
        .where({ _id: this.reserveId })
        .limit(1)
        .get(),
      // 不用 orderBy：老记录可能缺 create_time，orderBy 会把它们整条滤掉，这里改在内存里排序
      db.collection('device_usage')
        .where({ reserve_id: this.reserveId })
        .limit(MAX_USAGE_QUERY)
        .get()
    ])

    const reserve = (reserveRes.data || [])[0] || null
    const usages = usageRes.data || []
    return { reserve, usage: this.pickUsage(reserve, usages) }
  },

  /** 优先取预约上登记的使用记录，其次取异常记录，最后取最新一条 */
  pickUsage(reserve, usages) {
    if (!usages.length) return null

    const sorted = usages.slice().sort((left, right) => {
      const leftTime = datetime.parseDateTime(left.create_time)
      const rightTime = datetime.parseDateTime(right.create_time)
      return (rightTime ? rightTime.getTime() : 0) - (leftTime ? leftTime.getTime() : 0)
    })

    const linkedId = reserve && reserve.linked_usage_id
    if (linkedId) {
      const linked = sorted.find(item => item._id === linkedId)
      if (linked) return linked
    }
    const abnormal = sorted.find(item => item.status === 'abnormal')
    if (abnormal) return abnormal
    return sorted[0]
  },

  // ==================== 视图组装 ====================

  collectFileIDs(reserve, usage) {
    const ids = []
    if (reserve && reserve.reserve_page) ids.push(reserve.reserve_page)
    if (!usage) return this.uniqueIds(ids)

    if (usage.start_photo) ids.push(usage.start_photo)
    if (Array.isArray(usage.usage_images)) ids.push(...usage.usage_images)

    const checklist = usage.end_checklist
    if (checklist) {
      ids.push(checklist.total_page, checklist.device_page, checklist.room_page, checklist.supplement_page)
    }

    const feedback = usage.feedback
    if (feedback && Array.isArray(feedback.photos)) ids.push(...feedback.photos)

    return this.uniqueIds(ids)
  },

  uniqueIds(list) {
    const result = []
    list.forEach((id) => {
      if (cloudFile.isCloudFileId(id) && result.indexOf(id) === -1) result.push(id)
    })
    return result
  },

  buildDetail(reserve, usage, urlMap) {
    const toUrl = value => cloudFile.resolveSingle(value, urlMap)
    const range = this.buildTimeRange(reserve)
    const checklist = this.buildEndChecklist(usage && usage.end_checklist, toUrl)

    return {
      studentName: reserve.student_name || reserve.user_id || '未知用户',
      groupName: reserve.research_group || reserve.group_name || '未填写',
      deviceId: reserve.device_id || '',
      deviceName: reserve.device_name || '',
      dateDisplay: range.dateDisplay,
      timeDisplay: range.timeDisplay,
      startAtDisplay: datetime.formatMoment(usage && usage.start_time),
      endAtDisplay: datetime.formatMoment(usage && usage.end_time),
      startPhotoUrl: toUrl(usage && usage.start_photo),
      usageImageUrls: ((usage && usage.usage_images) || []).map(toUrl).filter(Boolean),
      reservePageUrl: toUrl(reserve.reserve_page),
      endChecklist: checklist
    }
  },

  /** 预约时间段：同天只显示时钟，跨天带上结束日期 */
  buildTimeRange(reserve) {
    const range = datetime.formatTimeRange(reserve.start_time, reserve.end_time)
    if (!range.dateDisplay) {
      return { dateDisplay: reserve.reserve_date || '', timeDisplay: '' }
    }
    return range
  },

  buildEndChecklist(checklist, toUrl) {
    if (!checklist) return null
    return {
      instrumentOff: checklist.instrument_off === true,
      computerOff: checklist.computer_off === true,
      nextUser: checklist.nextUser || checklist.next_user || '',
      sampleCount: Number(checklist.sample_count) || 0,
      moreSample: checklist.more_sample === true,
      moreSampleCount: Number(checklist.more_sample_count) || 0,
      needSupplement: checklist.need_supplement === true,
      totalPageUrl: toUrl(checklist.total_page),
      devicePageUrl: toUrl(checklist.device_page),
      roomPageUrl: toUrl(checklist.room_page),
      supplementPageUrl: toUrl(checklist.supplement_page)
    }
  },

  /** 异常反馈：兼容 feedback 对象与只写了 abnormal_reason 的旧记录 */
  buildAbnormal(usage, urlMap) {
    const empty = {
      has: false,
      isResolved: false,
      pending: false,
      title: '',
      content: '',
      timeDisplay: '',
      photos: [],
      handledBy: '',
      handledTimeDisplay: ''
    }
    if (!usage) return empty

    const feedback = usage.feedback || {}
    const content = feedback.content || usage.abnormal_reason || ''
    const isAbnormalRecord = usage.status === 'abnormal' || usage.abnormal_resolved === true
    if (!isAbnormalRecord && !content) return empty

    const handler = usage.abnormal_handled_by || {}
    return {
      has: Boolean(content || feedback.title),
      isResolved: usage.abnormal_resolved === true,
      // 只有状态停在 abnormal 的记录才能被标记处理，否则云函数会找不到目标
      pending: usage.status === 'abnormal',
      title: feedback.title || '使用异常',
      content: content || '未填写详细说明',
      timeDisplay: datetime.formatMoment(feedback.submit_time || usage.abnormal_time || usage.end_time),
      photos: ((feedback.photos) || [])
        .map(id => cloudFile.resolveSingle(id, urlMap))
        .filter(Boolean),
      handledBy: handler.name || handler.user_id || '',
      handledTimeDisplay: datetime.formatMoment(usage.abnormal_handled_time)
    }
  },

  collectPhotos(detail, abnormal) {
    const checklist = detail.endChecklist || {}
    return [
      detail.reservePageUrl,
      detail.startPhotoUrl,
      ...detail.usageImageUrls,
      checklist.totalPageUrl,
      checklist.devicePageUrl,
      checklist.roomPageUrl,
      checklist.supplementPageUrl,
      ...abnormal.photos
    ].filter(Boolean)
  },

  // ==================== 状态 ====================

  /** 使用记录优先，其次按预约时间判断，时间缺失时退回预约上的 usage_status */
  calcStatus(reserve, usage) {
    if (usage) {
      if (usage.status === 'abnormal') return 'abnormal'
      if (usage.status === 'using') return 'using'
      if (usage.status === 'completed') return 'completed'
    }

    const start = datetime.parseDateTime(reserve.start_time)
    const end = datetime.parseDateTime(reserve.end_time)
    if (!start) {
      const usageStatus = reserve.usage_status
      if (usageStatus === 'completed') return 'completed'
      if (usageStatus === 'active') return 'using'
      if (usageStatus === 'abnormal') return 'abnormal'
      return 'upcoming'
    }

    const now = Date.now()
    if (now < start.getTime()) return 'upcoming'
    if (!end || now < end.getTime()) return 'using'
    return 'completed'
  },

  buildStatusTip(status, detail) {
    if (status === 'upcoming') {
      const when = [detail.dateDisplay, detail.timeDisplay].filter(Boolean).join(' ')
      return when ? `预约已通过，请在 ${when} 到实验室开始使用` : '预约已通过，请留意开始时间'
    }
    if (status === 'using') return '正在使用中，离开前请提交结束核验'
    if (status === 'abnormal') return '本次使用已上报异常，等待管理员处理'
    return '本次使用已完成，照片与核验信息可随时回看'
  },

  // ==================== 交互 ====================

  previewPhoto(e) {
    const current = e.currentTarget.dataset.url
    const urls = e.currentTarget.dataset.urls || []
    if (!current || !urls.length) return
    wx.previewImage({ current, urls })
  },

  onRetry() {
    if (!this.reserveId) {
      wx.navigateBack({ delta: 1 })
      return
    }
    this.loadDetail()
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/index/index' })
  },

  onResolveAbnormal() {
    if (this.data.isHandling) return
    wx.showModal({
      title: '确认已处理',
      content: '确认该异常已在线下处理完毕？标记后预约将变为「已完成」，异常记录会保留并标注处理人。',
      confirmText: '确认处理',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) this.doResolveAbnormal()
      }
    })
  },

  async doResolveAbnormal() {
    if (this.data.isHandling) return
    this.setData({ isHandling: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'resolveAbnormalUsage',
        data: { reserveId: this.reserveId }
      })
      const result = (res && res.result) || {}
      if (result.code !== 0) {
        throw new Error(result.msg || '处理失败，请重试')
      }
      wx.showToast({ title: '已标记为已处理', icon: 'success' })
      await this.loadDetail({ silent: true })
    } catch (err) {
      console.error('[reserve-detail] 标记异常已处理失败', err)
      wx.showToast({
        title: err.message || '处理失败，请重试',
        icon: 'none'
      })
    } finally {
      this.setData({ isHandling: false })
    }
  }
})
