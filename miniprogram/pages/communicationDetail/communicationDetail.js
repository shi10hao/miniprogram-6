// 仪器历史使用者：按最近使用时间分页展示
const PAGE_SIZE = 10
const MAX_AUTO_RETRY = 2 // 某页全是已展示过的同学时，自动再往后翻几次
const PHONE_PATTERN = /^1\d{10}$/

/**
 * 从 query 中还原仪器名称，非法编码不至于让详情页白屏
 */
function decodeDeviceName(raw) {
  const text = String(raw || '')
  try {
    return decodeURIComponent(text).trim()
  } catch (err) {
    return text.trim()
  }
}

function pad(num) {
  return String(num).padStart(2, '0')
}

/**
 * 解析时间，兼容部分内核不识别 'YYYY-MM-DD HH:mm:ss' 的情况
 */
function parseTime(value) {
  const raw = String(value || '')
  if (!raw) return null

  let date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    date = new Date(raw.replace(/-/g, '/').replace('T', ' '))
  }

  return Number.isNaN(date.getTime()) ? null : date
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

/**
 * 最近使用时间：今天/昨天只显示时分，跨年才补年份
 */
function formatIsoTime(value) {
  const date = parseTime(value)
  if (!date) return '时间未知'

  const now = new Date()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`

  if (isSameDay(date, now)) return `今天 ${time}`

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (isSameDay(date, yesterday)) return `昨天 ${time}`

  let dateText = `${date.getMonth() + 1}月${date.getDate()}日`
  if (date.getFullYear() !== now.getFullYear()) {
    dateText = `${date.getFullYear()}年${dateText}`
  }

  return dateText
}

/**
 * 云函数返回的使用流水 -> 卡片要用的展示数据
 */
function buildUserView(raw) {
  const name = String(raw.student_name || '').trim()
  const phone = String(raw.phone || '').trim()

  return {
    userId: String(raw.userId || raw.student_id || ''),
    name: name || '未填写姓名',
    avatarText: name ? name.slice(0, 1) : '同',
    groupName: String(raw.group_name || '').trim(),
    studentId: String(raw.student_id || '').trim(),
    phone: phone || '未填写',
    canCall: PHONE_PATTERN.test(phone),
    useTime: formatIsoTime(raw.start_time)
  }
}

Page({
  data: {
    deviceName: '',
    userList: [],
    isLoading: false,
    btnLoading: false,
    hasError: false,
    errorText: '',
    hasMore: false,
    skeletonRows: [0, 1, 2, 3]
  },

  onLoad(options) {
    const deviceName = decodeDeviceName(options && options.deviceName)
    if (!deviceName) {
      this.setData({ hasError: true, errorText: '缺少仪器名称，请返回重新进入' })
      return
    }

    this.setData({ deviceName })
    this.loadFirstPage()
  },

  async onPullDownRefresh() {
    try {
      if (this.data.deviceName) await this.loadFirstPage()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // ==================== 取数 ====================
  /**
   * 请求一页使用者
   * @param {number} cursor 已扫描的原始流水条数
   * @param {string[]} excludeUserIds 已经在列表里的人，服务端跳过避免重复
   */
  async fetchUserPage(cursor, excludeUserIds) {
    const res = await wx.cloud.callFunction({
      name: 'getDeviceUserList',
      data: {
        deviceName: this.data.deviceName,
        cursor,
        pageSize: PAGE_SIZE,
        excludeUserIds
      }
    })

    const result = (res && res.result) || {}
    if (result.code !== 0) throw new Error(result.msg || '加载失败')

    const list = Array.isArray(result.data) ? result.data : []
    // 游标必须是数字；老版本云函数返回 _id 字符串时按「没有下一页」处理，避免死循环
    const nextCursor = typeof result.nextCursor === 'number' ? result.nextCursor : null

    return {
      list,
      nextCursor,
      finished: result.finished === true || nextCursor === null
    }
  },

  /**
   * 首屏加载 / 出错重试
   */
  async loadFirstPage() {
    if (this.data.isLoading) return

    this.setData({ isLoading: true, hasError: false, hasMore: false })
    this.cursor = 0
    try {
      const page = await this.fetchUserPage(0, [])
      this.cursor = page.nextCursor

      this.setData({
        userList: page.list.map(buildUserView),
        hasMore: !page.finished
      })
    } catch (err) {
      console.error('[communicationDetail] 加载使用者失败', err)
      this.setData({
        userList: [],
        hasError: true,
        errorText: '使用者信息加载失败',
        hasMore: false
      })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  /**
   * 加载更多：跳过已展示的人，若整页都是旧数据则自动往后翻
   */
  async loadMore() {
    if (this.data.btnLoading || this.data.isLoading || !this.data.hasMore) return

    this.setData({ btnLoading: true })
    try {
      const loadedIds = this.data.userList.map(item => item.userId)
      let retry = 0

      while (retry <= MAX_AUTO_RETRY) {
        const cursorBefore = this.cursor
        const page = await this.fetchUserPage(cursorBefore, loadedIds)
        this.cursor = page.nextCursor

        const fresh = page.list
          .map(buildUserView)
          .filter(item => !loadedIds.includes(item.userId))

        if (fresh.length) {
          this.setData({
            userList: this.data.userList.concat(fresh),
            hasMore: !page.finished
          })
          return
        }

        if (page.finished || page.nextCursor === null || page.nextCursor === cursorBefore) {
          this.setData({ hasMore: false })
          return
        }

        retry += 1
      }

      this.setData({ hasMore: false })
    } catch (err) {
      console.error('[communicationDetail] 加载更多失败', err)
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    } finally {
      this.setData({ btnLoading: false })
    }
  },

  // ==================== 其他动作 ====================
  onCall(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim()
    if (!PHONE_PATTERN.test(phone)) {
      wx.showToast({ title: '手机号不可用', icon: 'none' })
      return
    }

    wx.makePhoneCall({ phoneNumber: phone, fail() {} })
  }
})
