const {
  PAGE_SIZE,
  appendNoticeList,
  hasMoreAfter,
  getListSummary
} = require('./noticeListModel')

// 静默刷新时最多补拉几页：翻得太深时不再整段重拉，避免一次 setData 过大
const MAX_SILENT_PAGES = 5

// 云数据库实例延迟创建。模块顶层直接 wx.cloud.database()，一旦 wx.cloud
// 还没 init 完成，整个页面模块加载就会抛错，用户看到的是一片白屏且没有报错入口
let cachedDb = null

function getDb() {
  if (!cachedDb) cachedDb = wx.cloud.database()
  return cachedDb
}

// notice 集合是全员广播的公告，字段见 pages/admin/admin.js 的发布逻辑：
// title / content / doc_url / publish_date / notice_id / type
Page({
  data: {
    noticeList: [],
    summaryText: '正在加载公告…',
    totalCount: 0,
    pageSize: PAGE_SIZE,
    page: 0, // 已加载到第几页（从 0 开始）
    hasMore: false,
    isLoading: true,
    isLoadingMore: false,
    hasError: false,
    // 骨架屏占位行，写在 data 里比 wxml 里塞数组字面量更好维护
    skeletonRows: [0, 1, 2]
  },

  onLoad() {
    // onShow 紧跟 onLoad 触发，用标记跳过第一次重复请求
    this._firstShow = true
    // 请求序号：只认最后一次请求的响应，防止旧响应覆盖新数据
    this._requestSeq = 0
    this.loadFirstPage()
  },

  onShow() {
    if (this._firstShow) {
      this._firstShow = false
      return
    }
    // 从详情页 / 管理端发布页返回时静默刷新：不闪骨架屏，也不把用户翻到的层级清空
    this.loadFirstPage({ silent: true })
  },

  onPullDownRefresh() {
    // 下拉刷新语义就是回到第一页，这里显式重置
    this.loadFirstPage({ silent: true, reset: true }).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  // ==================== 数据加载 ====================

  /**
   * 拉取某一页公告
   * @param {number} page 从 0 开始的页码
   * @returns {Promise<Array<Object>>}
   */
  fetchNotices(page) {
    return getDb().collection('notice')
      .field({
        title: true,
        content: true,
        publish_date: true,
        create_time: true,
        notice_id: true,
        doc_url: true,
        _id: true
      })
      // 按发布时间倒序：管理员发布逻辑（admin.js）一定会写 publish_date；
      // 极老的缺字段数据会被云开发直接排除在排序结果外，这里不再兜底
      .orderBy('publish_date', 'desc')
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()
      .then((res) => res.data || [])
  },

  /**
   * 连续拉取 [from, from + count) 这几页，用于静默刷新时补齐已加载层级
   * @param {number} from 起始页
   * @param {number} count 页数
   * @returns {Promise<Array<Object>>}
   */
  fetchPages(from, count) {
    const tasks = []
    for (let i = 0; i < count; i += 1) {
      tasks.push(this.fetchNotices(from + i))
    }
    return Promise.all(tasks).then((pages) => pages.reduce((all, list) => all.concat(list), []))
  },

  /**
   * 查公告总数，只用于副标题；查不到不影响列表
   * @returns {Promise<number>}
   */
  fetchTotal() {
    return getDb().collection('notice')
      .count()
      .then((res) => res.total || 0)
      .catch((err) => {
        console.error('[noticelist] 统计公告总数失败', err)
        return 0
      })
  },

  /**
   * 加载列表
   * @param {Object} [options] { silent, reset }
   *   silent 为真时不显示骨架屏；reset 为真时强制回到第一页
   * @returns {Promise<void>}
   */
  async loadFirstPage(options = {}) {
    const { silent = false, reset = false } = options
    // 首次加载、重试、下拉刷新都从第一页开始；只有静默刷新按已加载页数补齐，
    // 这样用户翻到第 3 页再返回时不会被压回第 1 页
    const wantedPages = silent && !reset ? Math.max(this.data.page + 1, 1) : 1
    // 翻得太深就放弃这次静默刷新：只重拉前 5 页会把用户手里的长列表截短，
    // 数据旧一点比列表突然变短好解释。想刷新就手动下拉
    if (silent && wantedPages > MAX_SILENT_PAGES) return

    const seq = (this._requestSeq || 0) + 1
    this._requestSeq = seq
    const targetPages = Math.min(wantedPages, MAX_SILENT_PAGES)

    if (!silent) {
      this.setData({
        isLoading: true,
        hasError: false,
        summaryText: getListSummary({ isLoading: true })
      })
    }

    try {
      const [rows, total] = await Promise.all([
        targetPages > 1 ? this.fetchPages(0, targetPages) : this.fetchNotices(0),
        this.fetchTotal()
      ])
      if (seq !== this._requestSeq) return

      const list = appendNoticeList([], rows)
      // 页码按实际拿到的条数倒推：只拉回 25 条时不能把 page 记成 2，
      // 否则下一次触底会先白请求一个空页
      const restoredPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
      this.setData({
        noticeList: list,
        totalCount: total,
        page: restoredPages - 1,
        hasMore: hasMoreAfter(list.length, rows.length, total),
        isLoading: false,
        hasError: false,
        summaryText: getListSummary({ total, count: list.length })
      })
    } catch (err) {
      if (seq !== this._requestSeq) return

      console.error('[noticelist] 加载公告列表失败', err)
      if (this.data.noticeList.length === 0) {
        this.setData({
          isLoading: false,
          hasError: true,
          summaryText: getListSummary({ hasError: true })
        })
      } else {
        // 静默刷新失败：保留旧列表，只收掉 loading
        this.setData({ isLoading: false })
      }
      if (!silent) {
        wx.showToast({ title: '公告加载失败，请重试', icon: 'none' })
      }
    }
  },

  // 触底加载下一页
  async loadMore() {
    if (this.data.isLoading || this.data.isLoadingMore || !this.data.hasMore) return

    // 记住发起时的序号：中途被静默刷新重置过就丢弃这次的响应，否则页码会错乱
    const seq = this._requestSeq || 0
    const nextPage = this.data.page + 1
    this.setData({ isLoadingMore: true })

    try {
      const rows = await this.fetchNotices(nextPage)
      if (seq !== (this._requestSeq || 0)) {
        this.setData({ isLoadingMore: false })
        return
      }

      const fresh = appendNoticeList(this.data.noticeList, rows)
      const loadedCount = this.data.noticeList.length + fresh.length
      const patch = {
        page: nextPage,
        hasMore: hasMoreAfter(loadedCount, rows.length, this.data.totalCount),
        isLoadingMore: false
      }
      // 只推增量：整表 setData 在长列表下会把已有数据再传一遍
      fresh.forEach((item, index) => {
        patch[`noticeList[${this.data.noticeList.length + index}]`] = item
      })
      this.setData(patch)
    } catch (err) {
      console.error('[noticelist] 加载更多公告失败', err)
      this.setData({ isLoadingMore: false })
      wx.showToast({ title: '加载更多失败，请重试', icon: 'none' })
    }
  },

  // ==================== 交互 ====================

  onRetry() {
    this.loadFirstPage()
  },

  // 跳转到详情页：公告与消息共用 messagedetail，用 source=notice 区分
  goToDetail(e) {
    const noticeId = e.currentTarget.dataset.noticeid
    if (!noticeId) {
      wx.showToast({ title: '公告标识缺失，无法打开', icon: 'none' })
      return
    }

    const url = `/pages/message/detail/messagedetail?messageId=${encodeURIComponent(noticeId)}&source=notice`
    wx.navigateTo({
      url,
      fail: (err) => {
        // 页面栈满（10 层）时 navigateTo 也会失败，退回重定向仍能打开详情
        console.error('[noticelist] 打开公告详情失败', err)
        wx.redirectTo({
          url,
          fail: (redirectErr) => {
            console.error('[noticelist] 重定向打开公告详情也失败', redirectErr)
            wx.showToast({ title: '打开失败，请重试', icon: 'none' })
          }
        })
      }
    })
  }
})
