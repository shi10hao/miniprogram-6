const db = wx.cloud.database()
const cloudFile = require('../../../utils/cloudFile.js')
// 纯逻辑（型号/编号排序/状态分组/资料格式化）在 lib 下，可被 node 直接断言
const detailCore = require('./lib/detailCore.js')
// 「去预约」：单台直进 / 多台先选实例
const reserveFlow = require('./lib/reserveFlow.js')
// 取数封装（可见性条件、翻页取全、使用中查询）在 lib/detailQuery.js
const detailQuery = require('./lib/detailQuery.js')

// onShow 静默刷新的最小间隔，从视频页/3D 页快速返回不再重复查库
const STATUS_REFRESH_GAP = 30 * 1000

Page({
  data: {
    device: null,
    isLoading: true,
    loadError: false,
    notFound: false,
    picFailed: false,
    hasPicture: false,
    currentDeviceId: '',
    // 展示用派生字段：WXML 只做渲染，判断和拼接都在 JS 里算好
    nameText: '',
    modelText: '',
    heroSub: '',
    labText: '',
    roomText: '',
    typeLabel: '',
    typeTagClass: 'ds-tag-primary',
    labTypeLabel: '',
    labTagClass: 'ds-tag-primary',
    coverIcon: '🔬',
    descriptionText: '',
    hasDescription: false,
    hasProcedure: false,
    hasPrecautions: false,
    hasVideo: false,
    // 同款仪器
    totalUnits: 0,
    statusKey: 'none',
    statusText: '状态未知',
    statusGroups: [],
    statusHint: '',
    // 吸底预约栏：能不能预约、左边那句话说什么
    availableCount: 0,
    canReserve: false,
    barText: '当前没有空闲仪器'
  },

  // ==================== 生命周期 ====================

  onLoad(options) {
    const deviceId = detailCore.parseDeviceId(options)
    if (!deviceId) {
      this.setData({
        isLoading: false,
        loadError: false,
        notFound: true
      })
      wx.showToast({ title: '缺少仪器编号', icon: 'none' })
      return
    }
    this.setData({ currentDeviceId: deviceId })
    this.loadDetail(deviceId)
  },

  onShow() {
    // 从使用页 / 预约页返回时状态可能已经变了，静默刷新一次，不闪骨架屏
    if (!this._hasLoaded || this.data.isLoading) return
    // 30 秒内刚刷过就不再打库：看视频、逛 3D 常常来回切，没必要每次都查
    const now = Date.now()
    if (this._lastStatusAt && now - this._lastStatusAt < STATUS_REFRESH_GAP) return
    this.refreshStatus(this._seq)
  },

  async onPullDownRefresh() {
    try {
      if (this.data.device) {
        // 下拉时保留现有内容只刷状态：整页换骨架屏会闪一下，像页面被重置了
        await this.refreshStatus(this._seq)
      } else {
        await this.reloadPage()
      }
    } finally {
      // 不管成功失败都要收起下拉动画，否则会一直挂在顶部
      wx.stopPullDownRefresh()
    }
  },

  onShareAppMessage() {
    const device = this.data.device
    const deviceId = this.data.currentDeviceId || ''
    // 没编号时不要拼出 ?deviceId= 这种空参数，落地页会判成"缺少仪器编号"
    const query = deviceId ? '?deviceId=' + encodeURIComponent(deviceId) : ''
    const share = {
      title: device ? device.device_name + ' · 仪器详情' : '仪器详情',
      path: '/pages/device/detail/devicedetail' + query
    }
    const cover = this.getShareCover()
    if (cover) share.imageUrl = cover
    return share
  },

  onShareTimeline() {
    const device = this.data.device
    const deviceId = this.data.currentDeviceId || ''
    const share = {
      title: device ? device.device_name + ' · 仪器详情' : '仪器详情',
      query: deviceId ? 'deviceId=' + encodeURIComponent(deviceId) : ''
    }
    const cover = this.getShareCover()
    if (cover) share.imageUrl = cover
    return share
  },

  // 分享卡片用仪器实拍图；cloud:// 换过 https 才能用，兜底图交给微信默认截图
  getShareCover() {
    const device = this.data.device
    if (!device || !this.data.hasPicture || this.data.picFailed) return ''
    const picture = String(device.picture || '')
    return /^https?:\/\//.test(picture) ? picture : ''
  },

  // ==================== 数据加载 ====================

  /**
   * 加载详情。每发起一次就递增代次，旧请求回来直接丢弃，
   * 避免下拉刷新和 onShow 静默刷新互相覆盖。
   * @param {string} deviceId
   * @returns {Promise<void>}
   */
  async loadDetail(deviceId) {
    const seq = (this._seq || 0) + 1
    this._seq = seq
    this.setData({
      isLoading: true,
      loadError: false,
      notFound: false,
      picFailed: false
    })

    try {
      const res = await db.collection('devices')
        .where(detailQuery.buildVisibleQuery({ device_id: deviceId }))
        .limit(1)
        .get()
      if (seq !== this._seq) return

      const device = (res.data || [])[0]
      if (!device) {
        // 查到空结果：设备被删了，或不在本课题组的可见范围内，跟"网络挂了"不是一回事
        this.setData({
          device: null,
          isLoading: false,
          loadError: false,
          notFound: true,
          statusGroups: [],
          totalUnits: 0
        })
        return
      }

      // 先渲染文字信息（不等图片和状态），首屏更快出来
      this.applyDevice(device)
      this._hasLoaded = true
      this.resolveDevicePicture(seq)
      this.refreshStatus(seq)
    } catch (err) {
      if (seq !== this._seq) return
      console.error('[devicedetail] 获取仪器详情失败', err)
      this.setData({ isLoading: false, loadError: true, notFound: false })
    }
  },

  /**
   * 把数据库记录转成页面字段
   * @param {Object} device
   */
  applyDevice(device) {
    const nameText = String(device.device_name || '').trim() || '未命名仪器'
    const modelText = detailCore.getDeviceModel(device)
    const labText = String(device.lab_name || '').trim() || '实验室未设置'
    const roomText = String(device.device_room || '').trim() || '位置未设置'
    const description = String(device.description || '').trim()
    const isLarge = device.device_type === 'large'

    this.setData({
      device,
      nameText,
      modelText,
      labText,
      roomText,
      heroSub: [modelText, roomText].filter(Boolean).join(' · '),
      typeLabel: isLarge ? '大型仪器' : '小型仪器',
      typeTagClass: isLarge ? 'ds-tag-danger' : 'ds-tag-success',
      labTypeLabel: device.lab_type === 'group' ? '课题组仪器' : '公共实验室',
      labTagClass: device.lab_type === 'group' ? 'ds-tag-warning' : 'ds-tag-primary',
      coverIcon: isLarge ? '🧪' : '🔬',
      descriptionText: description || '暂无仪器简介',
      hasDescription: !!description,
      // cloud:// 直接塞渲染层会先失败一次（还可能闪一下兜底图），等换成 https 再显示
      hasPicture: !!String(device.picture || '').trim() && !cloudFile.isCloudFileId(device.picture),
      hasProcedure: detailCore.hasGuideContent(device.operation_procedure),
      hasPrecautions: detailCore.hasGuideContent(device.precautions),
      hasVideo: !!String(device.video_url || '').trim(),
      isLoading: false,
      loadError: false,
      notFound: false
    })

    // 导航栏标题直接用仪器名，用户从列表点进来就知道自己停在哪台设备上
    wx.setNavigationBarTitle({ title: nameText })
  },

  // cloud:// fileID 必须换成 https 临时链接，否则 <image> 在渲染层会 500
  async resolveDevicePicture(seq) {
    const device = this.data.device
    if (!device || !cloudFile.isCloudFileId(device.picture)) return

    try {
      const map = await cloudFile.resolveTempUrls([device.picture])
      if (seq !== this._seq) return
      const url = cloudFile.resolveSingle(device.picture, map)
      if (!url) return
      this.setData({
        'device.picture': url,
        hasPicture: true,
        picFailed: false
      })
    } catch (err) {
      console.error('[devicedetail] 解析仪器图片失败', err)
    }
  },

  // 刷新同款仪器的三种状态，传了 seq 就校验这次请求是否已经过期
  async refreshStatus(seq) {
    const device = this.data.device
    if (!device) return
    // 无论成败都记时间戳：失败后立刻再触发一次没有意义，等下一个窗口
    this._lastStatusAt = Date.now()

    const currentModel = detailCore.getDeviceModel(device)
    const deviceName = String(device.device_name || '').trim()

    try {
      // 名称为空时按名称查会得到 0 条，看起来像"这台仪器不存在"；
      // 这种情况退化成只看当前这一台，状态至少是真的
      const sameModelDevices = deviceName
        ? await this.getSameModelDevices(deviceName, currentModel)
        : [device]
      if (seq && seq !== this._seq) return

      const deviceIds = sameModelDevices
        .map(item => item.device_id)
        .filter(Boolean)
      const usingIds = await detailQuery.getUsingDeviceIds(deviceIds)
      if (seq && seq !== this._seq) return

      this.renderStatus(sameModelDevices, usingIds)
    } catch (err) {
      if (seq && seq !== this._seq) return
      // 状态拿不到不该把已经加载好的详情整页判失败，降级展示即可
      console.error('[devicedetail] 获取同款仪器状态失败', err)
      this.setData({
        statusGroups: [],
        totalUnits: 0,
        statusKey: 'none',
        statusText: '状态未知',
        // 状态没拿到就不拦预约，让用户自己去预约页看实时情况
        availableCount: 0,
        canReserve: true,
        barText: '状态未知',
        statusHint: '仪器状态暂时获取失败，下拉可以重试'
      })
    }
  },

  // 同名且同型号才算同款：型号不同的是另一批仪器，混进来台数就不对了
  async getSameModelDevices(deviceName, currentModel) {
    const list = await detailQuery.fetchAllDocs(
      'devices',
      detailQuery.buildVisibleQuery({ device_name: deviceName })
    )
    return list.filter(item => detailCore.getDeviceModel(item) === currentModel)
  },

  // 把同款仪器按可用 / 使用中 / 维修中分类后写入页面
  renderStatus(devices, usingIds) {
    const statusGroups = detailCore.buildStatusGroups(devices, usingIds)
    const summary = detailCore.buildStatusSummary(statusGroups)
    const bar = detailCore.buildBarState(statusGroups)
    const hint = devices.length ? '' : '暂时没有查到同款仪器'

    this.setData(Object.assign({
      statusGroups,
      totalUnits: devices.length,
      statusHint: hint
    }, summary, bar))
  },

  // ==================== 交互 ====================

  onDeviceImageError() {
    this.setData({ picFailed: true, hasPicture: false })
  },

  // 点封面看大图：铭牌上的型号、量程经常要放大才看得清
  previewCover() {
    const device = this.data.device
    if (!device) return
    // 没有图或图已经加载失败时给个反馈，否则每次点都像按钮坏了
    if (!this.data.hasPicture || this.data.picFailed) {
      wx.showToast({ title: '这台仪器还没有图片', icon: 'none' })
      return
    }
    const picture = String(device.picture || '')
    const fail = err => console.error('[devicedetail] 预览图片失败', err)
    wx.previewImage({ urls: [picture], current: picture, fail })
  },

  // 卡 2 里的编号也能点一下就复制，复制的是那一台而不是当前这台
  copyCode(e) {
    const code = String((e.currentTarget.dataset.code) || '').trim()
    if (!code || code === '未编号') {
      wx.showToast({ title: '这台仪器还没有编号', icon: 'none' })
      return
    }
    wx.setClipboardData({ data: code, fail: err => console.error('[devicedetail] 复制编号失败', err) })
  },

  // 编号点一下就复制，报修 / 问询时经常要把编号发给管理员
  copyDeviceId() {
    const device = this.data.device
    const deviceId = device ? String(device.device_id || '').trim() : ''
    if (!deviceId) {
      wx.showToast({ title: '这台仪器还没有编号', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: deviceId,
      fail: err => console.error('[devicedetail] 复制仪器编号失败', err)
    })
  },

  // 空态里的出口：从列表点进来的直接退回，页面栈里没有上一层时才重建列表页
  goDeviceList() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.reLaunch({ url: '/pages/device/list/devicelist' })
  },

  // 把操作规程 / 注意事项的原始值转成子页面能吃的参数（实现在 lib/detailCore.js）
  viewProcedure() {
    const device = this.data.device
    if (!device || !detailCore.hasGuideContent(device.operation_procedure)) {
      wx.showToast({ title: '暂无操作规程', icon: 'none' })
      return
    }
    const guide = detailCore.formatGuide(device.operation_procedure)
    this.goGuidePage('procedure', guide)
  },

  viewPrecautions() {
    const device = this.data.device
    if (!device || !detailCore.hasGuideContent(device.precautions)) {
      wx.showToast({ title: '暂无注意事项', icon: 'none' })
      return
    }
    const guide = detailCore.formatGuide(device.precautions)
    this.goGuidePage('precautions', guide)
  },

  viewVideo() {
    const device = this.data.device
    const videoUrl = device ? String(device.video_url || '').trim() : ''
    if (!videoUrl) {
      wx.showToast({ title: '暂无操作视频', icon: 'none' })
      return
    }
    const videoName = encodeURIComponent(device.device_name || '')
    const videoFileID = encodeURIComponent(videoUrl)
    wx.navigateTo({
      url: '/pages/device/video/video?deviceName=' + videoName + '&fileID=' + videoFileID
    })
  },

  // 操作规程与注意事项共用同一个阅读页，只是页面目录不同
  goGuidePage(page, guide) {
    const device = this.data.device
    const baseUrl = '/pages/device/' + page + '/' + page + '?deviceName=' + encodeURIComponent(device.device_name || '')
    const content = encodeURIComponent(guide.content)
    wx.navigateTo({
      url: baseUrl + '&content=' + content + '&type=' + guide.type
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

  goReserve() {
    if (!this.data.canReserve) {
      wx.showToast({ title: '当前没有空闲的仪器', icon: 'none' })
      return
    }
    // 同款有多台可预约时先在这儿挑一台，一台的直接进（见 lib/reserveFlow.js）
    reserveFlow.enter({
      codes: reserveFlow.getAvailableCodes(this.data.statusGroups),
      currentDeviceId: this.data.currentDeviceId
    })
  },

  async reloadPage() {
    const deviceId = this.data.currentDeviceId || (this.data.device && this.data.device.device_id)
    if (!deviceId) {
      wx.showToast({ title: '缺少仪器编号', icon: 'none' })
      return
    }
    await this.loadDetail(deviceId)
  }
})
