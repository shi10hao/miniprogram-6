/**
 * 管理端首页
 *
 * ├── 会话校验 —— 缓存里的 userId 回查 users，确认角色仍有效
 * ├── 仪器状态（Tab 0）—— 实验室 / 类型 / 关键词筛选，分页加载
 * ├── 预约概览（Tab 1）—— 状态统计 + 最近预约，按角色可见范围过滤
 * ├── 通知发布（Tab 2）—— 发布公告、触发订阅消息推送、历史管理
 * ├── 更多（Tab 3）—— 重置密码 / 卫生记录 / 注册审批 / 3D 看板
 * └── 仪器新增与删除 —— 弹窗表单 + 云函数
 */

const db = wx.cloud.database()
const _ = db.command
const cloudFile = require('../../utils/cloudFile.js')
const adminSubMsg = require('./adminSubMsgModel.js')

// ========== 常量 ==========

const ALLOWED_ROLES = ['teacher', 'admin'] // 允许进入管理端的角色
const ROLE_TEXT = {
  admin: '管理员',
  teacher: '实验室教师'
}
const PAGE_SIZE = 15 // 仪器组单页数量
const RESERVE_PREVIEW_COUNT = 10 // 预约概览展示条数
const MAX_DEVICE_SCAN = 2000 // 可见仪器扫描上限，防御性兜底
const MAX_RESERVE_SCAN = 1000 // 云函数单集合拉取上限
const CLIENT_BATCH_SIZE = 20 // 客户端单次查询条数
const DOC_URL_PATTERN = /^https?:\/\/docs\.qq\.com(\/|$)/
// 模板 id 与别名的对应关系集中在 adminSubMsgModel.js，这里不再重复维护
const SUBSCRIBE_TMPL_IDS = adminSubMsg.SUBSCRIBE_TMPL_IDS
const SUBMSG_REFRESH_GAP = 60000 // 剩余条数刷新间隔，避免每次 onShow 都打云函数
const EMPTY_RESERVE_STATS = {
  upcoming: 0,
  using: 0,
  completed: 0,
  abnormal: 0,
  total: 0
}

// ========== 页面实例 ==========

Page({
  data: {
    activeTab: 0,
    filters: {
      labType: 'all', // all | public | group
      deviceType: 'all', // all | large | small
      searchKeyword: ''
    },

    // 仪器列表
    pageSize: PAGE_SIZE,
    currentPage: 1,
    displayedGroups: [],
    allGroupTotal: 0,
    hasMore: false,
    isLoadingDevices: true,
    isLoadingMoreDevices: false,
    deletingGroupKey: '', // 正在删除的仪器组，用于按钮态
    skeletonRows: [1, 2, 3],

    // 预约概览
    recentReserves: [],
    reserveStats: EMPTY_RESERVE_STATS,
    isLoadingReserves: false,

    // 通知发布
    msgTitle: '',
    msgContent: '',
    msgDocUrl: '',
    isSending: false,
    sentMessages: [],
    isLoadingMessages: false,
    deletingNoticeId: '',

    // 新增仪器弹窗
    showDeviceForm: false,
    isSubmittingDevice: false,
    isUploadingPic: false,
    deviceForm: {
      device_name: '',
      lab_name: '',
      device_room: '',
      device_type: 'large',
      lab_type: 'public',
      instances: [{ device_id: '' }],
      picture: '',
      pictureUrl: '',
      operation_procedure: '',
      precautions: '',
      specificationsText: ''
    },

    // 注册审批
    pendingApplyCount: 0,

    // 顶部信息
    adminName: '',
    adminRoleText: '管理员',

    // 订阅提醒：剩余可收条数（apply + abnormal），只有本地估算，真值以微信下发结果为准
    adminSubMsgText: '未订阅',
    isSubscribing: false,
    subscribeHint: adminSubMsg.SUBSCRIBE_HINT,

    // 退出确认弹窗
    showExitConfirm: false
  },

  // ==================== 工具方法 ====================

  /** 补零 */
  pad(n) {
    return String(n).padStart(2, '0')
  },

  /** ISO 字符串 → "YYYY-MM-DD HH:mm" */
  formatTime(isoStr) {
    if (!isoStr) return ''
    const d = this.parseDateTime(isoStr)
    if (!d) return String(isoStr)
    return d.getFullYear() + '-' + this.pad(d.getMonth() + 1) + '-' + this.pad(d.getDate()) + ' ' + this.pad(d.getHours()) + ':' + this.pad(d.getMinutes())
  },

  /** 仅保留日期 "YYYY-MM-DD" */
  formatDateOnly(isoStr) {
    if (!isoStr) return ''
    const d = this.parseDateTime(isoStr)
    if (!d) return ''
    return d.getFullYear() + '-' + this.pad(d.getMonth() + 1) + '-' + this.pad(d.getDate())
  },

  /**
   * 解析多种格式的时间字符串
   * 支持 ISO 8601、YYYY-MM-DD HH:mm、时间戳；纯本地字符串按东八区还原
   */
  parseDateTime(dtStr) {
    if (!dtStr) return null
    if (dtStr instanceof Date) return isNaN(dtStr.getTime()) ? null : dtStr
    if (typeof dtStr === 'number') {
      const d = new Date(dtStr)
      return isNaN(d.getTime()) ? null : d
    }
    const text = String(dtStr).trim().replace(/\//g, '-')
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T-](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
    if (match) {
      const year = Number(match[1])
      const month = Number(match[2])
      const day = Number(match[3])
      const hour = match[4] ? Number(match[4]) : 0
      const minute = match[5] ? Number(match[5]) : 0
      const second = match[6] ? Number(match[6]) : 0
      return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, 0))
    }
    const d2 = new Date(text.replace(' ', 'T'))
    return isNaN(d2.getTime()) ? null : d2
  },

  /** 提取时间部分 "HH:mm" */
  getTimePart(dtStr) {
    if (!dtStr) return '--:--'
    if (dtStr.indexOf(' ') !== -1) return dtStr.split(' ')[1].substring(0, 5)
    if (dtStr.indexOf('T') !== -1) {
      const timePart = dtStr.split('T')[1]
      if (timePart) return timePart.substring(0, 5)
    }
    return dtStr
  },

  /** 时间字符串 → 毫秒时间戳，失败返回 0 */
  getDateTimeValue(dtStr) {
    if (!dtStr) return 0
    const d = this.parseDateTime(dtStr)
    return d ? d.getTime() : 0
  },

  /** 统一确认弹窗，返回 Promise<{ confirm }> */
  showConfirm(options) {
    return new Promise((resolve) => {
      wx.showModal({
        title: options.title || '提示',
        content: options.content || '',
        confirmText: options.confirmText || '确定',
        confirmColor: options.confirmColor || '#ef4444',
        success: res => resolve({ confirm: !!res.confirm }),
        fail: () => resolve({ confirm: false })
      })
    })
  },

  // ==================== 生命周期 ====================

  onLoad() {
    wx.enableAlertBeforeUnload({ message: '确定要退出管理端吗？' })
    this.bootstrapPage()
  },

  onUnload() {
    wx.disableAlertBeforeUnload()
    clearTimeout(this._searchTimer)
  },

  async onPullDownRefresh() {
    try {
      await this.refreshCurrentTab()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  /** 回到页面时按当前 Tab 刷新，避免从子页返回后看到旧数据 */
  onShow() {
    if (!this._ready) return
    this.loadAdminSubMsgCount()
    this.refreshCurrentTab()
  },

  onHide() {
    this.setData({ showExitConfirm: false })
  },

  /** 刷新当前 Tab 的数据 */
  async refreshCurrentTab() {
    const tab = this.data.activeTab
    if (tab === 0) await this.loadDeviceStatus()
    else if (tab === 1) await this.loadReserveSummary()
    else if (tab === 2) await this.loadSentMessages()
    else await this.loadPendingApplyCount()
  },

  // ==================== 会话管理 ====================

  /** 启动页：校验会话后加载仪器列表 */
  async bootstrapPage() {
    this.setData({ isLoadingDevices: true })
    const session = await this.validateAdminSession()
    if (!session) {
      this.setData({ isLoadingDevices: false })
      return
    }
    this.currentSession = session
    this._ready = true
    this.setData({
      adminName: session.name || '管理员',
      adminRoleText: ROLE_TEXT[session.role] || '管理员'
    })
    await this.loadDeviceStatus()
    await this.loadAdminSubMsgCount()
  },

  /** 清除登录态并回到登录页 */
  redirectToLogin(message) {
    wx.removeStorageSync('adminInfo')
    if (message) wx.showToast({ title: message, icon: 'none' })
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/admin/login/adminlogin' })
    }, 400)
  },

  /** 校验管理员会话是否仍然有效 */
  async validateAdminSession() {
    const localSession = wx.getStorageSync('adminInfo') || {}
    const userId = String(localSession.userId || '').trim()
    if (!userId) {
      this.redirectToLogin('请先登录')
      return null
    }
    try {
      const res = await db.collection('users')
        .where({ user_id: userId, role: _.in(ALLOWED_ROLES) })
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
      console.error('[admin] 校验会话失败', err)
      this.redirectToLogin('登录状态校验失败，请重试')
      return null
    }
  },

  // ==================== 云函数通用封装 ====================

  /**
   * 通过云函数 getCollectionData 拉取集合数据
   * 云函数内部已自行翻页（单次最多返回 MAX_LIMIT 1000 条），所以这里一次调用取满
   */
  async fetchAllByCloud(collectionName, whereCondition) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getCollectionData',
        data: {
          collectionName,
          whereCondition: whereCondition || {},
          pageSize: MAX_RESERVE_SCAN,
          startSkip: 0
        }
      })
      const result = res.result || {}
      if (result.code !== 0) throw new Error(result.message || '查询失败')
      return result.data || []
    } catch (err) {
      console.error('[admin] 拉取集合失败 ' + collectionName, err)
      throw err
    }
  },

  // ==================== Tab 切换 ====================

  switchTab(e) {
    const tab = Number(e.currentTarget.dataset.tab)
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })

    if (tab === 0 && this.data.displayedGroups.length === 0) this.loadDeviceStatus()
    else if (tab === 1) this.loadReserveSummary()
    else if (tab === 2) this.loadSentMessages()
    else if (tab === 3) this.loadPendingApplyCount()
  },

  // ==================== 仪器状态管理（Tab 0） ====================

  onLabTypeChange(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.filters.labType) return
    this.setData({ 'filters.labType': type }, () => this.loadDeviceStatus())
  },

  onDeviceTypeChange(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.filters.deviceType) return
    this.setData({ 'filters.deviceType': type }, () => this.loadDeviceStatus())
  },

  /** 输入防抖：停止输入 400ms 后再查询 */
  onSearchInput(e) {
    const value = String(e.detail.value || '').trim()
    clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      if (value === this.data.filters.searchKeyword) return
      this.setData({ 'filters.searchKeyword': value }, () => this.loadDeviceStatus())
    }, 400)
  },

  /** 清空搜索：必须同时清掉防抖定时器，否则旧关键词会被回写 */
  clearSearch() {
    clearTimeout(this._searchTimer)
    if (!this.data.filters.searchKeyword) return
    this.setData({ 'filters.searchKeyword': '' }, () => this.loadDeviceStatus())
  },

  /**
   * 仪器可见范围（客户端直连数据库时使用）
   * admin 返回 null（不限制）；teacher 返回 OR 条件；其余角色一律查不到数据
   */
  buildDeviceScope() {
    const session = this.currentSession || {}
    const groupName = String(session.groupName || '').trim()
    if (session.role === 'admin') return null
    if (session.role === 'teacher') {
      if (!groupName) return { lab_type: 'public' }
      return _.or([{ lab_type: 'public' }, { lab_name: groupName }])
    }
    return { _id: '__deny__' }
  },

  /** 仪器列表查询参数：交给云函数按 plain 字段解析，避免命令对象跨端序列化失效 */
  buildGroupQuery() {
    const session = this.currentSession || {}
    const filters = this.data.filters
    const isAdmin = session.role === 'admin'
    const groupName = String(session.groupName || '').trim()

    let labType = filters.labType
    // 教师没有课题组时，课题组筛选退化为公共实验室，避免查出别人的组
    if (!isAdmin && labType === 'group' && !groupName) labType = 'public'

    return {
      labType,
      groupName,
      role: session.role || '',
      deviceType: filters.deviceType === 'all' ? '' : filters.deviceType,
      keyword: String(filters.searchKeyword || '').trim()
    }
  },

  /** 加载仪器状态（入口，会话缺失时先补校验） */
  async loadDeviceStatus(options = {}) {
    if (!this.currentSession) {
      const session = await this.validateAdminSession()
      if (!session) return
      this.currentSession = session
    }
    await this.doLoadDeviceStatus(options)
  },

  /** 实际拉取第一页仪器组；列表已有数据时静默刷新，避免闪骨架屏 */
  async doLoadDeviceStatus(options = {}) {
    const seq = (this._deviceSeq || 0) + 1
    this._deviceSeq = seq
    const silent = options.silent || this.data.displayedGroups.length > 0
    this.setData({ isLoadingDevices: !silent, isLoadingMoreDevices: false })

    try {
      const query = this.buildGroupQuery()
      const res = await wx.cloud.callFunction({
        name: 'getAdminGroups',
        data: { ...query, pageSize: this.data.pageSize, pageNum: 1 }
      })
      // 快速切换筛选时会并发多次请求，只认最后一次的结果
      if (seq !== this._deviceSeq) return
      const result = res.result || {}
      if (result.code !== 0) throw new Error(result.message || '加载失败')
      const data = result.data || {}
      this.setData({
        displayedGroups: data.groups || [],
        allGroupTotal: data.total || 0,
        currentPage: 1,
        hasMore: !!data.hasMore
      })
      this.resolveGroupPictures('displayedGroups')
    } catch (err) {
      if (seq !== this._deviceSeq) return
      console.error('[admin] 加载仪器列表失败', err)
      wx.showToast({ title: '仪器列表加载失败', icon: 'none' })
    } finally {
      if (seq === this._deviceSeq && !silent) this.setData({ isLoadingDevices: false })
    }
  },

  /** 加载下一页仪器组，按 group_key 去重后追加 */
  async loadMoreDevices() {
    if (this.data.isLoadingMoreDevices || !this.data.hasMore || this.data.isLoadingDevices) return
    this.setData({ isLoadingMoreDevices: true })

    try {
      const query = this.buildGroupQuery()
      const res = await wx.cloud.callFunction({
        name: 'getAdminGroups',
        data: { ...query, pageSize: this.data.pageSize, pageNum: this.data.currentPage + 1 }
      })
      const result = res.result || {}
      if (result.code !== 0) throw new Error(result.message || '加载失败')
      const data = result.data || {}

      const merged = this.data.displayedGroups.slice()
      const seen = {}
      merged.forEach((group) => {
        seen[group.group_key] = true
      })
      const incoming = data.groups || []
      incoming.forEach((group) => {
        if (seen[group.group_key]) return
        seen[group.group_key] = true
        merged.push(group)
      })

      this.setData({
        displayedGroups: merged,
        currentPage: this.data.currentPage + 1,
        hasMore: !!data.hasMore,
        allGroupTotal: data.total || this.data.allGroupTotal
      })
      this.resolveGroupPictures('displayedGroups')
    } catch (err) {
      console.error('[admin] 加载更多仪器失败', err)
      wx.showToast({ title: '加载更多失败', icon: 'none' })
    } finally {
      this.setData({ isLoadingMoreDevices: false })
    }
  },

  /** 把 cloud:// 图片换成临时链接，否则 <image> 渲染报 500 */
  async resolveGroupPictures(field) {
    const list = this.data[field] || []
    if (!list.length) return
    try {
      const resolved = await cloudFile.resolveListField(list, 'picture')
      if (resolved === list) return
      this.setData({ [field]: resolved })
    } catch (err) {
      console.error('[admin] 解析仪器图片失败', err)
    }
  },

  /** 缩略图加载失败 → 标记后显示占位图，避免反复重试 */
  onGroupImageError(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || index === null) return
    this.setData({ ['displayedGroups[' + index + '].imgFailed']: true })
  },

  // ==================== 预约概览（Tab 1） ====================

  /**
   * 可见仪器编号集合
   * 返回 null 表示不限制（管理员）；返回空集合表示无可见仪器
   */
  async fetchVisibleDeviceIds() {
    const scope = this.buildDeviceScope()
    if (!scope) return null

    const ids = {}
    for (let skip = 0; skip < MAX_DEVICE_SCAN; skip += CLIENT_BATCH_SIZE) {
      const res = await db.collection('devices')
        .where(scope)
        .field({ device_id: true })
        .skip(skip)
        .limit(CLIENT_BATCH_SIZE)
        .get()
      const rows = res.data || []
      rows.forEach((row) => {
        if (row.device_id) ids[row.device_id] = true
      })
      if (rows.length < CLIENT_BATCH_SIZE) break
    }
    return ids
  },

  /** 加载预约概览：状态统计 + 最近预约 */
  async loadReserveSummary() {
    if (!this.currentSession) {
      const session = await this.validateAdminSession()
      if (!session) return
      this.currentSession = session
    }
    this.setData({ isLoadingReserves: true })

    try {
      const visibleIds = await this.fetchVisibleDeviceIds()
      if (visibleIds && Object.keys(visibleIds).length === 0) {
        this.setData({ recentReserves: [], reserveStats: EMPTY_RESERVE_STATS })
        return
      }

      const [allReserves, allUsages] = await Promise.all([
        this.fetchAllByCloud('reserves', { status: 'approved' }),
        this.fetchAllByCloud('device_usage', { status: 'using' })
      ])

      // 教师角色只统计自己可见的仪器，避免看到别人的预约
      const reserves = visibleIds ? allReserves.filter(item => visibleIds[item.device_id]) : allReserves
      const usages = visibleIds ? allUsages.filter(item => visibleIds[item.device_id]) : allUsages

      const usingReserveIdMap = {}
      usages.forEach((usage) => {
        if (usage.reserve_id) usingReserveIdMap[usage.reserve_id] = true
      })

      const now = new Date()
      const stats = { ...EMPTY_RESERVE_STATS, total: reserves.length }
      const processed = reserves.map((item) => {
        const statusInfo = this.getReserveDisplayStatus(item, usingReserveIdMap, now)
        if (stats[statusInfo.displayStatus] !== undefined) stats[statusInfo.displayStatus] += 1
        return {
          ...item,
          displayStatus: statusInfo.displayStatus,
          displayStatusText: statusInfo.displayStatusText,
          timeDisplay: this.buildTimeDisplay(item)
        }
      })

      processed.sort((a, b) => this.getDateTimeValue(b.start_time) - this.getDateTimeValue(a.start_time))

      this.setData({
        recentReserves: processed.slice(0, RESERVE_PREVIEW_COUNT),
        reserveStats: stats
      })
    } catch (err) {
      console.error('[admin] 加载预约概览失败', err)
      wx.showToast({ title: '预约数据加载失败', icon: 'none' })
    } finally {
      this.setData({ isLoadingReserves: false })
    }
  },

  /** 预约时间展示文本，处理跨天情况 */
  buildTimeDisplay(item) {
    if (!item.start_time || !item.end_time) return ''
    const startDateOnly = this.formatDateOnly(item.start_time)
    const endDateOnly = this.formatDateOnly(item.end_time)
    const isCrossDay = startDateOnly && endDateOnly && startDateOnly !== endDateOnly

    if (isCrossDay) {
      const startD = this.parseDateTime(item.start_time)
      const endD = this.parseDateTime(item.end_time)
      if (startD && endD) {
        const startTime = this.pad(startD.getHours()) + ':' + this.pad(startD.getMinutes())
        const endDisplay = this.pad(endD.getMonth() + 1) + '-' + this.pad(endD.getDate()) + ' ' + this.pad(endD.getHours()) + ':' + this.pad(endD.getMinutes())
        return item.reserve_date + ' ' + startTime + ' - ' + endDisplay
      }
    }
    return item.reserve_date + ' ' + this.getTimePart(item.start_time) + '-' + this.getTimePart(item.end_time)
  },

  /** 计算预约的展示状态 */
  getReserveDisplayStatus(item, usingReserveIdMap, now) {
    if (!item) return { displayStatus: 'past', displayStatusText: '已过期' }
    if (item.usage_status === 'abnormal') return { displayStatus: 'abnormal', displayStatusText: '异常' }
    if (item.usage_status === 'completed') return { displayStatus: 'completed', displayStatusText: '已完成' }
    if ((usingReserveIdMap && usingReserveIdMap[item._id]) || item.usage_status === 'active') {
      return { displayStatus: 'using', displayStatusText: '使用中' }
    }

    const startTs = this.resolveReserveTimestamp(item, 'start')
    const endTs = this.resolveReserveTimestamp(item, 'end')
    const nowTs = (now || new Date()).getTime()
    if (!startTs || !endTs) return { displayStatus: 'past', displayStatusText: '已过期' }

    if (nowTs < startTs) return { displayStatus: 'upcoming', displayStatusText: '即将使用' }
    if (nowTs < endTs) return { displayStatus: 'upcoming', displayStatusText: '可开始使用' }
    return { displayStatus: 'past', displayStatusText: '已过期' }
  },

  /** 优先用 *_ts 时间戳，兜底解析时间字符串 */
  resolveReserveTimestamp(reserve, field) {
    const ts = Number(reserve && reserve[field + '_ts'])
    if (isFinite(ts) && ts > 0) return ts
    const d = this.parseDateTime(reserve && reserve[field + '_time'])
    return d ? d.getTime() : 0
  },

  // ==================== 通知发布（Tab 2） ====================

  onTitleInput(e) {
    this.setData({ msgTitle: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ msgContent: e.detail.value })
  },

  onDocUrlInput(e) {
    this.setData({ msgDocUrl: e.detail.value.trim() })
  },

  /** 发布通知：写 notice 集合，再异步触发订阅消息推送 */
  async sendMessage() {
    if (this.data.isSending) return

    const title = String(this.data.msgTitle || '').trim()
    const content = String(this.data.msgContent || '').trim()
    const docUrl = String(this.data.msgDocUrl || '').trim()

    if (!title) return wx.showToast({ title: '请填写标题', icon: 'none' })
    if (!content) return wx.showToast({ title: '请填写内容', icon: 'none' })
    if (docUrl && !DOC_URL_PATTERN.test(docUrl)) {
      return wx.showToast({ title: '请填写腾讯文档分享链接', icon: 'none' })
    }

    this.setData({ isSending: true })
    const now = new Date()
    const publishDate = now.toISOString()

    try {
      await db.collection('notice').add({
        data: {
          title,
          content,
          doc_url: docUrl,
          publish_date: publishDate,
          notice_id: 'ADMIN_' + now.getTime(),
          type: 'admin',
          created_by: this.data.adminName || '管理员'
        }
      })

      this.setData({ msgTitle: '', msgContent: '', msgDocUrl: '' })
      wx.showToast({ title: '发布成功', icon: 'success' })
      this.loadSentMessages()
      this.pushNotice({ title, content, publishDate })
    } catch (err) {
      console.error('[admin] 发布通知失败', err)
      wx.showToast({ title: '发布失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSending: false })
    }
  },

  /** 订阅消息全推，失败不影响发布结果 */
  async pushNotice({ title, content, publishDate }) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'sendNoticeSubMsg',
        data: {
          title,
          content,
          publishDate,
          // 必须和 app.json 注册的路径一致，否则用户点通知打不开页面
          page: 'pages/notice/list/noticelist'
        }
      })
      const result = (res && res.result) || {}
      const payload = result.data || result
      console.log('[admin] 订阅消息推送结果', payload)
      if (typeof payload.sent === 'number') {
        wx.showToast({ title: '已推送给 ' + payload.sent + ' 位订阅用户', icon: 'none', duration: 2500 })
      }
    } catch (err) {
      console.error('[admin] 订阅消息推送失败', err)
    }
  },

  /** 打开腾讯文档：跳小程序，失败则复制链接 */
  openDoc(e) {
    const url = e.currentTarget.dataset.url
    wx.navigateToMiniProgram({
      appId: 'wxd45c635d754dbf59', // 腾讯文档小程序 AppID
      path: 'pages/detail/detail?url=' + encodeURIComponent(url),
      fail: () => {
        wx.setClipboardData({
          data: url,
          success: () => {
            wx.showToast({ title: '链接已复制，去微信粘贴打开', icon: 'none' })
          }
        })
      }
    })
  },

  showDocUrlHint() {
    wx.showModal({
      title: '协作文档链接',
      content: '请粘贴腾讯文档的分享链接（需以 https://docs.qq.com/ 开头）。\n\n在腾讯文档中点击「分享 → 复制链接」，权限设为「任何人可编辑」，学生点击即可协作。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /** 删除通知，先在本地列表移除，再同步云端 */
  async deleteNotice(e) {
    const dataset = e.currentTarget.dataset
    const noticeId = dataset.id || dataset.noticeid
    if (!noticeId) return wx.showToast({ title: '参数错误', icon: 'none' })

    const modal = await this.showConfirm({
      title: '删除通知',
      content: '删除后学生端将不再展示，且不可恢复。',
      confirmText: '删除'
    })
    if (!modal.confirm) return

    this.setData({ deletingNoticeId: noticeId })
    try {
      const res = await wx.cloud.callFunction({ name: 'deleteNotice', data: { noticeId } })
      const result = res.result || {}
      if (result.code !== 0) throw new Error(result.message || '删除失败')
      this.setData({
        sentMessages: this.data.sentMessages.filter(item => item._id !== noticeId && item.notice_id !== noticeId)
      })
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      console.error('[admin] 删除通知失败', err)
      wx.showToast({ title: '删除失败，请重试', icon: 'none' })
    } finally {
      this.setData({ deletingNoticeId: '' })
    }
  },

  /** 加载最近 20 条已发布通知 */
  async loadSentMessages() {
    this.setData({ isLoadingMessages: true })
    try {
      const res = await db.collection('notice')
        .where({ type: 'admin' })
        .orderBy('publish_date', 'desc')
        .limit(20)
        .get()
      const list = (res.data || []).map(item => ({
        ...item,
        dateDisplay: this.formatTime(item.publish_date)
      }))
      this.setData({ sentMessages: list })
    } catch (err) {
      console.error('[admin] 加载通知历史失败', err)
      wx.showToast({ title: '通知历史加载失败', icon: 'none' })
    } finally {
      this.setData({ isLoadingMessages: false })
    }
  },

  // ==================== 注册审批 ====================

  /** 待审批数量，用于「更多」页红点 */
  async loadPendingApplyCount() {
    try {
      const res = await db.collection('user_apply').where({ status: 'pending' }).count()
      this.setData({ pendingApplyCount: res.total || 0 })
    } catch (err) {
      console.error('[admin] 查询待审批数量失败', err)
    }
  },

  goToApplyReview() {
    wx.navigateTo({ url: '/pages/admin/apply-review/applyreview' })
  },

  // ==================== 退出登录 ====================

  confirmLogout() {
    this.setData({ showExitConfirm: true })
  },

  cancelExit() {
    this.setData({ showExitConfirm: false })
  },

  /** 确认退出：关掉系统的返回拦截，清缓存后回登录页 */
  doLogout() {
    wx.disableAlertBeforeUnload()
    this.setData({ showExitConfirm: false }, () => {
      wx.removeStorageSync('adminInfo')
      wx.reLaunch({ url: '/pages/admin/login/adminlogin' })
    })
  },

  // ==================== 订阅消息 ====================

  /**
   * 拉取剩余可收条数
   * 60 秒内不重复请求；失败静默（顶部小字退回上一次的值，不影响主流程）
   */
  async loadAdminSubMsgCount() {
    const now = Date.now()
    if (this._subMsgLoadedAt && now - this._subMsgLoadedAt < SUBMSG_REFRESH_GAP) return
    this._subMsgLoadedAt = now
    try {
      const res = await wx.cloud.callFunction({ name: 'getAdminSubMsgCount' })
      const result = adminSubMsg.readAdminSubMsgResult(res && res.result)
      if (!result.ok) return
      this.applyAdminSubMsgCounts(result.counts)
    } catch (err) {
      console.error('[admin] 加载订阅剩余条数失败', err)
    }
  },

  /** 把云端条数同步到顶部小字 */
  applyAdminSubMsgCounts(counts) {
    this.setData({
      adminSubMsgText: adminSubMsg.buildSubMsgText(counts)
    })
  },

  /**
   * 请求订阅授权：必须由用户点击触发，两个模板共用同一个授权面板
   * 加锁防连点：连点会连续弹面板 + 连续记账，额度会和用户看到的操作次数对不上
   */
  async requestSubscribeMessage() {
    if (this.data.isSubscribing) return

    this.setData({ isSubscribing: true })
    try {
      const res = await wx.requestSubscribeMessage({ tmplIds: SUBSCRIBE_TMPL_IDS })
      const accepted = adminSubMsg.readAcceptedTmplIds(res)

      if (!accepted.length) {
        this.handleSubscribeRejected(res)
        return
      }

      // 只有 accept 才记账：一次 accept = 微信侧一条下发额度
      // 记账单独 try：云函数没上传时授权其实已经成功，不能报成「订阅失败」
      let result = null
      try {
        const called = await wx.cloud.callFunction({
          name: 'addAdminSubMsgCount',
          data: { tmplIds: accepted }
        })
        result = adminSubMsg.readAdminSubMsgResult(called && called.result)
      } catch (err) {
        console.error('[admin] 订阅次数记账失败', err)
      }

      if (!result || !result.ok) {
        // 授权其实已经成功，只是额度没记上：这是配置问题，用弹窗讲清楚（toast 装不下）
        this._subMsgLoadedAt = 0
        if (result && result.code === -3) {
          wx.showModal({
            title: '订阅成功，但少一个集合',
            content: '云开发里还没有 admin_sub_msg 集合，剩余次数记不下来。到云开发控制台新建这个集合，再点一次「订阅提醒」即可。',
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#62BCC4'
          })
          return
        }
        wx.showToast({
          title: adminSubMsg.buildSyncFailText(result),
          icon: 'none',
          duration: 2500
        })
        return
      }

      this.applyAdminSubMsgCounts(result.counts)
      this._subMsgLoadedAt = Date.now()
      // 条数是纯展示：拿不到就只说「订阅成功」，不要写「可收 0 条」误导人
      const total = adminSubMsg.totalCount(result.counts)
      wx.showToast({
        title: total > 0 ? '订阅成功，可收 ' + total + ' 条' : '订阅成功',
        icon: 'none',
        duration: 2000
      })
    } catch (err) {
      console.error('[admin] 订阅授权失败', err)
      wx.showToast({ title: '订阅失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ isSubscribing: false })
    }
  },

  /** 没拿到额度：被系统关掉要引导去设置页，其余按状态给不同文案 */
  handleSubscribeRejected(res) {
    const statuses = adminSubMsg.readAllStatuses(res)
    if (statuses.indexOf(adminSubMsg.SUBSCRIBE_STATUS.BAN) !== -1) {
      this.showConfirm({
        title: '通知已被关闭',
        content: '你在小程序设置里关掉了订阅通知。去设置页重新打开后，再点一次「订阅提醒」即可。',
        confirmText: '去设置',
        confirmColor: '#62BCC4'
      }).then(({ confirm }) => {
        if (confirm) wx.openSetting({})
      })
      return
    }
    wx.showToast({ title: adminSubMsg.buildSubscribeFailText(statuses[0]), icon: 'none' })
  },

  // ==================== 页面跳转 ====================

  goToReserveList() {
    wx.navigateTo({ url: '/pages/admin/reserve-list/adminreservelist' })
  },

  /** 3D 看板（暂时下线，入口保留占位，恢复时再接回 scene3d） */
  goTo3DBoard() {
    wx.showToast({ title: '三维看板正在升级，敬请期待', icon: 'none' })
  },

  goToDeviceDetail(e) {
    const dataset = e.currentTarget.dataset
    const deviceName = String(dataset.deviceName || '')
    const labName = String(dataset.labName || '')
    const deviceType = String(dataset.deviceType || '')
    const model = String(dataset.model || '')
    const groupKey = String(dataset.groupKey || '')
    const rawKeyword = String(this.data.filters.searchKeyword || '').trim()
    // 详情页会按关键词二次过滤，命中当前搜索词的组会把自身过滤掉，这里主动清空
    const keyword = rawKeyword && deviceName.toLowerCase().indexOf(rawKeyword.toLowerCase()) === -1 ? rawKeyword : ''

    wx.navigateTo({
      url: '/pages/admin/device-detail/admindevicedetail?deviceName=' + encodeURIComponent(deviceName)
        + '&labName=' + encodeURIComponent(labName)
        + '&deviceType=' + encodeURIComponent(deviceType)
        + '&model=' + encodeURIComponent(model)
        + '&groupKey=' + encodeURIComponent(groupKey)
        + '&keyword=' + encodeURIComponent(keyword)
    })
  },

  gotoUpcoming() {
    wx.navigateTo({ url: '/pages/admin/reserve-list/adminreservelist?status=upcoming' })
  },

  gotoUsing() {
    wx.navigateTo({ url: '/pages/admin/reserve-list/adminreservelist?status=using' })
  },

  gotoCompleted() {
    wx.navigateTo({ url: '/pages/admin/reserve-list/adminreservelist?status=completed' })
  },

  gotoAbnormal() {
    wx.navigateTo({ url: '/pages/admin/reserve-list/adminreservelist?status=abnormal' })
  },

  gotoAll() {
    wx.navigateTo({ url: '/pages/admin/reserve-list/adminreservelist?status=all' })
  },

  gotoReserveDetail(e) {
    wx.navigateTo({ url: '/pages/reserve-detail/reserve-detail?id=' + e.currentTarget.dataset.id })
  },

  goResetPwd() {
    wx.navigateTo({ url: '/pages/resetPwd/resetPwd' })
  },

  goToDutyRecords() {
    wx.navigateTo({ url: '/pages/admin/duty-list/duty-list' })
  },

  /** 表单遮罩层吞掉点击，避免误关弹窗 */
  noop() {},

  // ==================== 新增仪器 ====================

  openAddDeviceModal() {
    this.setData({
      showDeviceForm: true,
      isSubmittingDevice: false,
      isUploadingPic: false,
      deviceForm: {
        device_name: '',
        lab_name: '',
        device_room: '',
        device_type: 'large',
        lab_type: 'public',
        instances: [{ device_id: '' }],
        picture: '',
        pictureUrl: '',
        operation_procedure: '',
        precautions: '',
        specificationsText: ''
      }
    })
  },

  closeDeviceForm() {
    if (this.data.isSubmittingDevice) return
    this.setData({ showDeviceForm: false })
  },

  onDeviceFormInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['deviceForm.' + field]: e.detail.value })
  },

  selectDeviceType(e) {
    this.setData({ 'deviceForm.device_type': e.currentTarget.dataset.type })
  },

  selectLabType(e) {
    this.setData({ 'deviceForm.lab_type': e.currentTarget.dataset.type })
  },

  addInstance() {
    const instances = this.data.deviceForm.instances.concat([{ device_id: '' }])
    this.setData({ 'deviceForm.instances': instances })
  },

  deleteInstance(e) {
    const index = Number(e.currentTarget.dataset.index)
    const instances = this.data.deviceForm.instances.slice()
    if (instances.length <= 1) return
    instances.splice(index, 1)
    this.setData({ 'deviceForm.instances': instances })
  },

  onInstanceInput(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ ['deviceForm.instances[' + index + '].device_id']: e.detail.value })
  },

  /** 选择并上传仪器图片：picture 存 fileID，pictureUrl 只用于预览 */
  async chooseDevicePic() {
    if (this.data.isUploadingPic) return
    try {
      const media = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      const tempPath = media.tempFiles && media.tempFiles[0] && media.tempFiles[0].tempFilePath
      if (!tempPath) return

      this.setData({ isUploadingPic: true })
      this._picLoading = true
      wx.showLoading({ title: '图片上传中', mask: true })
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: 'device_pics/' + Date.now() + '.jpg',
        filePath: tempPath
      })
      const fileID = uploadRes.fileID
      let previewUrl = ''
      try {
        const map = await cloudFile.resolveTempUrls([fileID])
        previewUrl = map[fileID] || ''
      } catch (err) {
        console.error('[admin] 解析图片临时链接失败', err)
      }
      this.setData({ 'deviceForm.picture': fileID, 'deviceForm.pictureUrl': previewUrl })
    } catch (err) {
      const errMsg = String((err && err.errMsg) || '')
      if (errMsg.indexOf('cancel') !== -1) return
      console.error('[admin] 上传仪器图片失败', err)
      wx.showToast({ title: '图片上传失败', icon: 'none' })
    } finally {
      // 只有真的调用过 showLoading 才 hide，否则控制台会报警告
      if (this._picLoading) {
        wx.hideLoading()
        this._picLoading = false
      }
      this.setData({ isUploadingPic: false })
    }
  },

  /** 规格文本（每行 key:value）→ 对象 */
  parseSpecs(text) {
    const specs = {}
    if (!text) return specs
    text.split('\n').forEach((rawLine) => {
      const line = rawLine.trim()
      if (!line) return
      const cnIndex = line.indexOf('\uff1a')
      const sepIndex = cnIndex !== -1 ? cnIndex : line.indexOf(':')
      if (sepIndex === -1) return
      const key = line.substring(0, sepIndex).trim()
      const val = line.substring(sepIndex + 1).trim()
      if (key) specs[key] = val
    })
    return specs
  },

  /** 提交新增仪器表单（校验 → 去重 → 云函数） */
  async submitDeviceForm() {
    if (this.data.isSubmittingDevice) return
    const form = this.data.deviceForm

    const deviceName = String(form.device_name || '').trim()
    const labName = String(form.lab_name || '').trim()
    const deviceRoom = String(form.device_room || '').trim()
    if (!deviceName) return wx.showToast({ title: '请输入仪器名称', icon: 'none' })
    if (!labName) return wx.showToast({ title: '请输入所属实验室', icon: 'none' })
    if (!deviceRoom) return wx.showToast({ title: '请输入房间位置', icon: 'none' })

    const idList = form.instances.map(item => String(item.device_id || '').trim()).filter(Boolean)
    if (idList.length === 0) return wx.showToast({ title: '请至少填写一台设备编号', icon: 'none' })

    const seen = {}
    for (let i = 0; i < idList.length; i++) {
      if (seen[idList[i]]) return wx.showToast({ title: '设备编号不能重复', icon: 'none' })
      seen[idList[i]] = true
    }

    this.setData({ isSubmittingDevice: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'addDeviceGroup',
        data: {
          device_name: deviceName,
          lab_name: labName,
          device_room: deviceRoom,
          device_type: form.device_type,
          lab_type: form.lab_type,
          device_ids: idList,
          picture: form.picture,
          operation_procedure: String(form.operation_procedure || '').trim(),
          precautions: String(form.precautions || '').trim(),
          specifications: this.parseSpecs(form.specificationsText)
        }
      })
      const result = res.result || {}
      if (result.code !== 0) {
        wx.showToast({ title: result.message || '新增失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '新增成功', icon: 'success' })
      this.setData({ showDeviceForm: false })
      await this.loadDeviceStatus()
    } catch (err) {
      console.error('[admin] 新增仪器失败', err)
      wx.showToast({ title: '新增失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSubmittingDevice: false })
    }
  },

  // ==================== 删除仪器组 ====================

  async deleteDeviceGroup(e) {
    const dataset = e.currentTarget.dataset
    const groupKey = String(dataset.groupKey || '')
    if (!groupKey) return

    const payload = {
      device_name: dataset.deviceName,
      lab_name: dataset.labName,
      device_room: dataset.deviceRoom,
      device_type: dataset.deviceType,
      model: dataset.model || ''
    }

    const modal = await this.showConfirm({
      title: '删除仪器组',
      content: '将删除「' + dataset.deviceName + '」这一组的全部仪器，删除后不可恢复。',
      confirmText: '删除'
    })
    if (!modal.confirm) return

    this.setData({ deletingGroupKey: groupKey })
    try {
      // 云函数发现组内还有未结束的预约会返回 1004，这里再确认一次后强制删除
      let result = await this.callDeleteGroup(payload)
      if (result.code === 1004) {
        const second = await this.showConfirm({
          title: '该组还有进行中的预约',
          content: (result.message || '') + '。仍然删除吗？',
          confirmText: '仍然删除'
        })
        if (!second.confirm) return
        result = await this.callDeleteGroup({ ...payload, force: true })
      }
      if (result.code !== 0) {
        wx.showToast({ title: result.message || '删除失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '删除成功', icon: 'success' })
      await this.loadDeviceStatus()
    } catch (err) {
      console.error('[admin] 删除仪器组失败', err)
      wx.showToast({ title: '删除失败，请重试', icon: 'none' })
    } finally {
      this.setData({ deletingGroupKey: '' })
    }
  },

  /** 调用 deleteDeviceGroup 云函数，统一取 result 对象 */
  async callDeleteGroup(payload) {
    const res = await wx.cloud.callFunction({ name: 'deleteDeviceGroup', data: payload })
    return res.result || {}
  }
})
