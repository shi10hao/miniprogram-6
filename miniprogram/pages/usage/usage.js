const db = wx.cloud.database()
const TEMPLATE_ID = 'rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk'
const BANNER_REMINDER_TYPES = ['reservation_remind', 'usage_photo_remind', 'usage_end_remind']
const PHOTO_REMINDER_TYPES = ['usage_photo_remind', 'usage_end_remind']

Page({
  data: {
    currentUsage: null,
    pendingReserves: [],
    usageHistory: [],
    isLoading: false,
    unreadReminder: null,
    isAuthenticated: false,
    ifWorkingOK: true,
    feedbackTitle: '',
    feedbackContent: '',
    currentReserveId: '', // 新增：当前反馈对应的预约ID
    feedbackScene: 'start',
    feedbackPhotos: [],
    endWithFeedback: false,
    // 结束信息表单
    showEndForm: false,
    endForm: {
      instrumentOff: null, // true/false，仪器是否关闭
      computerOff: null, // true/false，电脑是否关闭
      nextUser: '',
      moreSample: null,
      sampleCount: '', // 运行样品总数
      moreSampleCount: '',
      totalPage: '', // 总的预约单本地路径
      needSupplement: null, // true/false，是否需要补充预约
      supplementPage: '', // 补充预约单本地路径
      devicePage: '',
      roomPage: ''
    },
  },

  onLoad() {
    this.checkAuth()
    this.loadData()
    this.loadUnreadReminder()
  },

  onShow() {
    this.checkAuth()
    this.loadCurrentUsage()
    this.loadPendingReserves()
    this.loadUnreadReminder()
  },

  checkAuth() {
    const userInfo = wx.getStorageSync('userInfo')
    this.setData({
      isAuthenticated: !!(userInfo && userInfo.userId)
    })
  },

  loadData() {
    this.loadCurrentUsage()
    this.loadPendingReserves()
    this.loadUsageHistory()
  },

  /*
    输入：无参数，依赖本地缓存userInfo
    输出：Promise，成功返回记录对象/null，失败返回null
    依赖函数： this.formatUage()  格式化使用记录数据
    使用API：云数据库查询
  */
  loadCurrentUsage() {
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo.userId) {
      this.setData({
        currentUsage: null,
        currentReserveId: '' // 同步清空
      })
      return Promise.resolve(null)
    }

    return db.collection('device_usage')
      .where({
        user_id: userInfo.userId,
        status: 'using'
      })
      .get()
      .then(res => {
        const usage = res.data && res.data.length > 0 ? res.data[0] : null
        const formattedUsage = usage ? this.formatUsage(usage) : null
        this.setData({
          currentUsage: formattedUsage,
          currentReserveId: formattedUsage ? formattedUsage.reserve_id : '' // 同步赋值
        })
        return usage || null
      })
      .catch(err => {
        console.error('获取当前使用记录失败:', err)
        return null
      })
  },
  //
  loadUsageHistory() {
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo.userId) {
      this.setData({
        isLoading: false,
        usageHistory: []
      })
      return Promise.resolve([])
    }
    const _ = db.command // 新增：获取数据库操作符
    return db.collection('device_usage')
      .where({
        user_id: userInfo.userId,
        status: _.in(['completed', 'abnormal']) // 修改这一行
      })
      .orderBy('start_time', 'desc')
      .limit(10)
      .get()
      .then(res => {
        const usageHistory = (res.data || []).map(item => this.formatUsage(item))
        this.setData({
          usageHistory
        })
        return usageHistory
      })
      .catch(err => {
        console.error('获取使用历史失败:', err)
        return []
      })
  },
  //
  loadPendingReserves() {
    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo.userId) {
      this.setData({
        pendingReserves: []
      })
      return Promise.resolve([])
    }

    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const todayStartTs = this.getReservationTimeMs(todayStr, '00:00')

    const queryAllReserves = async () => {
      let allRecords = []
      let lastId = null
      let lastTime = null
      const pageSize = 20

      while (true) {
        let query = db.collection('reserves').where({
          user_id: userInfo.userId,
          status: 'approved'
        }).orderBy('start_time', 'asc').orderBy('_id', 'asc').limit(pageSize)

        // 核心修正：用 start_time 做主游标，_id 兜底
        if (lastTime && lastId) {
          const _ = db.command
          query = query.where(_.or([{
              start_time: _.gt(lastTime)
            },
            {
              start_time: _.eq(lastTime),
              _id: _.gt(lastId)
            }
          ]))
        }

        const res = await query.get()
        const records = res.data || []

        if (records.length === 0) break
        allRecords = allRecords.concat(records)
        if (records.length < pageSize) break

        // 更新游标
        const lastItem = records[records.length - 1]
        lastTime = lastItem.start_time
        lastId = lastItem._id
      }
      return allRecords
    }
    return queryAllReserves()
      .then(res => {
        var records = res || []
        // console.log("records:", records)
        var pending = records.filter(function (item) {
          var usageNotStarted = !item.usage_status || item.usage_status === 'not_started'
          var endTs = this.getReserveTimestamp(item, 'end')
          return usageNotStarted && endTs && endTs >= todayStartTs
        }, this).map(item => {
          var startTs = this.getReserveTimestamp(item, 'start')
          var endTs = this.getReserveTimestamp(item, 'end')
          return Object.assign({}, item, {
            _sort_ts: startTs || 0,
            _end_ts: endTs || 0
          })
        }).sort(function (a, b) {
          return a._sort_ts - b._sort_ts
        }).map(item => {
          var startTs = item._sort_ts
          var endTs = item._end_ts
          var state = 'expired'
          if (startTs && endTs) {
            if (now.getTime() < startTs) {
              state = 'pending'
            } else if (now.getTime() >= startTs && now.getTime() < endTs) {
              state = 'ready'
            }
          }
          // 判断是否跨天
          const startDateOnly = item.start_time ? this.formatDateOnly(item.start_time) : ''
          const endDateOnly = item.end_time ? this.formatDateOnly(item.end_time) : ''
          const isCrossDay = startDateOnly && endDateOnly && startDateOnly !== endDateOnly

          let startDisplay = ''
          let endDisplay = ''
          if (isCrossDay) {
            const pad = n => String(n).padStart(2, '0')
            const startD = this.parseDateValue(item.start_time)
            const endD = this.parseDateValue(item.end_time)
            if (startD && endD) {
              startDisplay = `${pad(startD.getMonth() + 1)}-${pad(startD.getDate())} ${pad(startD.getHours())}:${pad(startD.getMinutes())}`
              endDisplay = `${pad(endD.getMonth() + 1)}-${pad(endD.getDate())} ${pad(endD.getHours())}:${pad(endD.getMinutes())}`
            } else {
              startDisplay = this.formatClock(item.start_time)
              endDisplay = this.formatClock(item.end_time)
            }
          } else {
            startDisplay = this.formatClock(item.start_time)
            endDisplay = this.formatClock(item.end_time)
          }

          return {
            _id: item._id,
            device_name: item.device_name || '',
            device_id: item.device_id || '',
            start_time: item.start_time || '',
            end_time: item.end_time || '',
            reserve_date: item.reserve_date || '',
            start_display: startDisplay,
            end_display: endDisplay,
            state: state
          }
        })
        this.setData({
          pendingReserves: pending
        })
        return pending
      })
      .catch(err => {
        console.error('获取待使用预约失败:', err)
        this.setData({
          pendingReserves: []
        })
        return []
      })
  },
  //
  loadUnreadReminder() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      this.setData({
        unreadReminder: null
      })
      return Promise.resolve(null)
    }

    const _ = db.command
    return db.collection('messages')
      .where({
        user_id: userInfo.userId,
        is_read: _.neq(true),
        type: _.in(BANNER_REMINDER_TYPES)
      })
      .orderBy('create_time', 'desc')
      .limit(1)
      .get()
      .then(res => {
        const item = res.data && res.data.length > 0 ? res.data[0] : null
        this.setData({
          unreadReminder: item ? this.normalizeUnreadReminder(item) : null
        })
        return item
      })
      .catch(err => {
        console.error('获取未读提醒失败:', err)
        this.setData({
          unreadReminder: null
        })
        return null
      })
  },
  //
  normalizeUnreadReminder(item) {
    return {
      _id: item._id,
      type: item.type,
      title: item.title || '未读提醒',
      content: this.getReminderSummary(item),
      related_id: item.related_id || '',
      create_time: this.formatTime(item.create_time)
    }
  },
  //
  getReminderSummary(item) {
    if (PHOTO_REMINDER_TYPES.indexOf(item.type) !== -1) {
      return '请前往“仪器使用”页的“上传照片板块”完成照片上传。'
    }
    return this.truncateText(item.content || '', 48)
  },
  // 1
  goToReminder() {
    const reminder = this.data.unreadReminder
    if (!reminder) return

    // 新增：点击横幅自动标记消息为已读
    db.collection('messages').doc(reminder._id).update({
      data: {
        is_read: true
      }
    }).then(() => {
      this.setData({
        unreadReminder: null
      })
    }).catch(err => console.error('标记已读失败', err))

    if (PHOTO_REMINDER_TYPES.indexOf(reminder.type) !== -1) {
      wx.pageScrollTo({
        scrollTop: 0,
        duration: 200
      })
      return
    }

    wx.navigateTo({
      url: `/pages/message/detail/messagedetail?messageId=${reminder._id}&source=message`
    })
  },
  //
  formatUsage(usage) {
    const startDisplay = usage.start_time ? this.formatTime(usage.start_time) : ''
    const endDisplay = usage.end_time ? this.formatTime(usage.end_time) : ''

    // 判断是否跨天：比较开始和结束的日期部分
    const startDateOnly = usage.start_time ? this.formatDateOnly(usage.start_time) : ''
    const endDateOnly = usage.end_time ? this.formatDateOnly(usage.end_time) : ''
    const isCrossDay = startDateOnly && endDateOnly && startDateOnly !== endDateOnly

    let periodDisplay = ''
    if (usage.start_time && usage.end_time) {
      if (isCrossDay) {
        // 跨天显示完整格式：07-17 18:00 - 07-18 10:00
        const pad = n => String(n).padStart(2, '0')
        const startD = this.parseDateValue(usage.start_time)
        const endD = this.parseDateValue(usage.end_time)
        if (startD && endD) {
          periodDisplay = `${pad(startD.getMonth() + 1)}-${pad(startD.getDate())} ${pad(startD.getHours())}:${pad(startD.getMinutes())} - ${pad(endD.getMonth() + 1)}-${pad(endD.getDate())} ${pad(endD.getHours())}:${pad(endD.getMinutes())}`
        } else {
          periodDisplay = `${this.formatClock(usage.start_time)} - ${this.formatClock(usage.end_time)}`
        }
      } else {
        // 同天显示完整格式：2026-07-17 15:52 - 15:53
        const pad = n => String(n).padStart(2, '0')
        const startD = this.parseDateValue(usage.start_time)
        if (startD) {
          periodDisplay = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())} ${pad(startD.getHours())}:${pad(startD.getMinutes())} - ${this.formatClock(usage.end_time)}`
        } else {
          periodDisplay = `${this.formatClock(usage.start_time)} - ${this.formatClock(usage.end_time)}`
        }
      }
    }

    return Object.assign({}, usage, {
      start_time_display: startDisplay,
      end_time_display: endDisplay,
      usage_date_display: usage.start_time ? this.formatDateOnly(usage.start_time) : '',
      usage_period_display: periodDisplay
    })
  },
  //
  formatTime(isoStr) {
    if (!isoStr) return ''
    const d = this.parseDateValue(isoStr)
    if (!d) return String(isoStr)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },
  //
  formatDateOnly(isoStr) {
    if (!isoStr) return ''
    const d = this.parseDateValue(isoStr)
    if (!d) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },
  //
  formatClock(isoStr) {
    if (!isoStr) return ''
    const d = this.parseDateValue(isoStr)
    if (!d) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  },
  //
  parseDateValue(value) {
    if (!value) return null
    if (typeof value === 'number') {
      const numericDate = new Date(value)
      return Number.isNaN(numericDate.getTime()) ? null : numericDate
    }

    const text = String(value).trim().replace(/\//g, '-')
    if (!text) return null

    const beijingTimestamp = this.parseBeijingDateTimeMs(text)
    if (beijingTimestamp) {
      return new Date(beijingTimestamp)
    }

    const normalized = text.replace(' ', 'T')
    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? null : date
  },
  //
  parseBeijingDateTimeMs(text) {
    const match = String(text || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T-](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
    if (!match) return 0

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = Number(match[4] || 0)
    const minute = Number(match[5] || 0)
    const second = Number(match[6] || 0)
    if (!year || !month || !day || hour > 23 || minute > 59 || second > 59) return 0

    return Date.UTC(year, month - 1, day, hour - 8, minute, second, 0)
  },
  //
  getReservationTimeMs(dateStr, timeStr) {
    return this.parseBeijingDateTimeMs(`${dateStr} ${timeStr}`)
  },
  //
  getReserveTimestamp(reserve, field) {
    const tsKey = `${field}_ts`
    const timeKey = `${field}_time`
    const timestamp = Number(reserve && reserve[tsKey])
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp
    }

    const date = this.parseDateValue(reserve && reserve[timeKey])
    return date ? date.getTime() : 0
  },
  // 2
  isReserveReady(reserve, now = new Date()) {
    const startTs = this.getReserveTimestamp(reserve, 'start')
    const endTs = this.getReserveTimestamp(reserve, 'end')
    const nowTs = now.getTime()
    return !!(startTs && endTs && nowTs >= startTs && nowTs < endTs)
  },
  // 3
  formatReserveDateTime(date) {
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },
  // 4
  findCurrentValidReserve(userId) {

    return db.collection('reserves')
      .where({
        user_id: userId,
        status: 'approved'
      })
      .orderBy('start_time', 'desc')
      .limit(50)
      .get()
      .then(res => {
        const records = res.data || []
        return records.find(item => {
          if (item.usage_status && item.usage_status !== 'not_started') return false
          return true
        }) || null
      })
  },
  // 5


  addWatermarkToPhoto(tempFilePath, deviceName, deviceId) {
    return new Promise((resolve, reject) => {
      // 获取图片信息
      wx.getImageInfo({
        src: tempFilePath,
        success: (imgInfo) => {
          const imgWidth = imgInfo.width
          const imgHeight = imgInfo.height

          // 创建离屏 canvas
          const query = wx.createSelectorQuery()
          query.select('#watermarkCanvas')
            .fields({
              node: true,
              size: true
            })
            .exec((res) => {
              if (!res || !res[0]) {
                resolve(tempFilePath)
                return
              }

              const canvas = res[0].node
              const ctx = canvas.getContext('2d')

              // 设置 canvas 尺寸与图片一致
              canvas.width = imgWidth
              canvas.height = imgHeight

              const img = canvas.createImage()
              img.onload = () => {
                // 1. 绘制原图
                ctx.drawImage(img, 0, 0, imgWidth, imgHeight)

                // 2. 准备水印文字
                const now = new Date()
                const pad = n => String(n).padStart(2, '0')
                const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
                const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

                const watermarks = [
                  `${dateStr} ${timeStr}`,
                  `${deviceName || ''} ${deviceId || ''}`
                ]

                // 3. 设置水印样式 - 描边文字
                const fontSize = Math.max(Math.round(imgWidth / 30), 24)
                ctx.font = `bold ${fontSize}px sans-serif`
                ctx.textAlign = 'left'
                ctx.textBaseline = 'top'

                // 描边（黑色边框）
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
                ctx.lineWidth = 4
                ctx.shadowColor = 'transparent'
                ctx.shadowBlur = 0

                // 填充（白色文字）
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'

                // 4. 在左上角绘制水印（大约在长宽各三分之一的位置）
                const xPos = Math.round(imgWidth / 3) // 横向三分之一位置
                const yPos = Math.round(imgHeight / 3) // 纵向三分之一位置
                const lineHeight = fontSize * 1.4

                watermarks.forEach((text, index) => {
                  // 先描边
                  ctx.strokeText(text, xPos, yPos + index * lineHeight)
                  // 再填充（文字在描边之上）
                  ctx.fillText(text, xPos, yPos + index * lineHeight)
                })

                // 5. 导出带水印图片
                wx.canvasToTempFilePath({
                  canvas,
                  x: 0,
                  y: 0,
                  width: imgWidth,
                  height: imgHeight,
                  destWidth: imgWidth,
                  destHeight: imgHeight,
                  fileType: 'jpg',
                  quality: 0.92,
                  success: (res2) => {
                    resolve(res2.tempFilePath)
                  },
                  fail: (err) => {
                    console.error('导出水印图片失败:', err)
                    resolve(tempFilePath)
                  }
                })
              }
              img.onerror = (err) => {
                console.error('加载图片失败:', err)
                resolve(tempFilePath)
              }
              img.src = tempFilePath
            })
        },
        fail: (err) => {
          console.error('获取图片信息失败:', err)
          resolve(tempFilePath)
        }
      })
    })
  },
  // 6
  // ===== 优化：扫码开始使用 =====
  async startUsageFromReserve(e) {
    if (this.data.isLoading) return

    const reserveId = e.currentTarget.dataset.reserveid
    const userInfo = wx.getStorageSync('userInfo') || {}

    // 第一步：仪器启动确认
    const isNormal = await this.confirmDeviceStart(reserveId)
    if (!isNormal) return

    // 第二步：获取预约信息
    const reserveInfo = await this.fetchReserveInfo(reserveId)
    if (!reserveInfo) return

    const {
      deviceId: expectedDeviceId,
      deviceName
    } = reserveInfo

    // 第三步：扫码
    wx.showLoading({
      title: '请扫描仪器二维码...'
    })

    try {
      const scanResult = await this.scanDeviceQR()
      wx.hideLoading()

      // 第四步：验证扫码结果
      if (!this.validateScanResult(scanResult, expectedDeviceId)) return

      // 第五步：确认开始使用
      const confirmed = await this.confirmStartUsage(deviceName, scanResult)
      if (!confirmed) return

      // 第六步：拍照加水印
      await this.takeAndProcessPhoto(deviceName, scanResult, reserveId)

    } catch (err) {
      wx.hideLoading()
      console.error('开始使用流程失败:', err)
      wx.showToast({
        title: '操作失败，请重试',
        icon: 'none'
      })
    }
  },

  // ===== 拆分出的辅助函数 =====

  // 确认设备启动
  confirmDeviceStart(reserveId) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '仪器是否正常启动',
        content: '若出现问题请联系管理员',
        confirmText: '正常启动',
        cancelText: '出现问题',
        success: (res) => {
          if (res.cancel) {
            console.log("仪器启动不正常")
            this.setData({
              ifWorkingOK: false,
              feedbackTitle: '',
              feedbackContent: '',
              currentReserveId: reserveId || ''
            })
            resolve(false)
          }

          if (res.confirm) {
            // 订阅消息（仅在用户首次操作时触发）
            this.requestSubscribeMessageOnce()

            this.setData({
              ifWorkingOK: true,
              currentReserveId: reserveId
            })
            console.log("仪器正常启动")
            resolve(true)
          }
        }
      })
    })
  },

  // 获取预约信息
  async fetchReserveInfo(reserveId) {
    try {
      const reserveRes = await db.collection('reserves').doc(reserveId).get()
      const reserveItem = reserveRes.data
      if (!reserveItem) {
        wx.showToast({
          title: '预约信息不存在',
          icon: 'none'
        })
        return null
      }
      return {
        deviceId: reserveItem.device_id || '',
        deviceName: reserveItem.device_name || ''
      }
    } catch (err) {
      console.error('获取预约信息失败:', err)
      wx.showToast({
        title: '获取预约信息失败',
        icon: 'none'
      })
      return null
    }
  },

  // 扫码
  scanDeviceQR() {
    return new Promise((resolve, reject) => {
      wx.scanCode({
        onlyFromCamera: true,
        scanType: ['qrCode'],
        success: (res) => resolve(res.result),
        fail: (err) => {
          console.error('扫码失败:', err)
          wx.showToast({
            title: '扫码失败，请重试',
            icon: 'none'
          })
          reject(err)
        }
      })
    })
  },

  // 验证扫码结果
  validateScanResult(scannedCode, expectedDeviceId) {
    if (expectedDeviceId && scannedCode !== expectedDeviceId) {
      wx.showModal({
        title: '设备不匹配',
        content: `扫描到的设备编号 "${scannedCode}" 与预约的 "${expectedDeviceId}" 不一致，无法开始使用`,
        showCancel: false,
        confirmText: '知道了'
      })
      return false
    }
    return true
  },

  // 确认开始使用
  confirmStartUsage(deviceName, deviceId) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认开始使用',
        content: `仪器：${deviceName}\n编号：${deviceId}\n确认开始使用？`,
        confirmText: '确认',
        cancelText: '取消',
        success: (res) => resolve(res.confirm)
      })
    })
  },

  // 拍照并处理
  async takeAndProcessPhoto(deviceName, deviceId, reserveId) {
    try {
      const mediaRes = await this.chooseCameraPhoto()
      const tempFilePath = mediaRes.tempFiles[0].tempFilePath

      // 加水印
      wx.showLoading({
        title: '添加水印...'
      })
      const watermarkedPath = await this.addWatermarkToPhoto(tempFilePath, deviceName, deviceId)
      wx.hideLoading()

      // 走原有的开始使用流程
      this.handleStartPhoto(watermarkedPath, reserveId)

    } catch (err) {
      console.error('拍照失败:', err)
      wx.showToast({
        title: '拍照失败，请重试',
        icon: 'none'
      })
    }
  },

  // 选择相机拍照
  chooseCameraPhoto() {
    return new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera'],
        success: resolve,
        fail: reject
      })
    })
  },

  // 订阅消息（只订阅一次）
  requestSubscribeMessageOnce() {
    if (!TEMPLATE_ID || TEMPLATE_ID === 'YOUR_TEMPLATE_ID_HERE') return

    // 检查是否已经订阅过（用本地缓存标记）
    const subscribed = wx.getStorageSync('msg_subscribed_' + TEMPLATE_ID)
    if (subscribed) return

    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: (res) => {
        if (res[TEMPLATE_ID] === 'accept') {
          // 标记已订阅，下次不再弹窗
          wx.setStorageSync('msg_subscribed_' + TEMPLATE_ID, true)
        }
        console.log('订阅授权结果', res[TEMPLATE_ID])
      },
      fail: (err) => {
        console.error('订阅消息授权失败:', err)
      }
    })
  },

  // ===== 新增结束 =====
  ifWrong(reserveId) {
    console.log("ifWrong被调用，reserveId:", reserveId)
    this.setData({
      ifWorkingOK: false,
      feedbackTitle: '',
      feedbackContent: '',
      currentReserveId: reserveId || ''
    })
  },
  openUsageFeedback() {
    const currentUsage = this.data.currentUsage
    console.log('openUsageFeedback - currentUsage:', currentUsage) // 加日志
    // 兜底校验：没有使用记录时不允许提交
    if (!currentUsage || !currentUsage.reserve_id) {
      wx.showToast({
        title: '未找到对应使用记录',
        icon: 'none'
      })
      return
    }
    this.setData({
      feedbackScene: 'using',
      ifWorkingOK: false,
      feedbackTitle: '',
      feedbackContent: '',
      currentReserveId: currentUsage.reserve_id, // 核心：从当前使用记录取预约ID
      feedbackPhotos: [],
      endWithFeedback: true // 默认不结束
    })
  },
  closeFeedback() {
    this.setData({
      ifWorkingOK: true
    })
  },

  // 标题输入
  onTitleInput(e) {
    this.setData({
      feedbackTitle: e.detail.value
    })
  },

  // 内容输入
  onContentInput(e) {
    this.setData({
      feedbackContent: e.detail.value
    })
  },

  submitFeedback() {
    // console.log("0")
    const {
      feedbackTitle,
      feedbackContent,
      currentReserveId,
      feedbackScene,
      feedbackPhotos,
      endWithFeedback
    } = this.data
    console.log("this.data.currentReserveId:", this.data.currentReserveId)
    console.log("解构的currentReserveId:", currentReserveId)
    // 兜底：如果 currentReserveId 为空，从 pendingReserves 中查找
    let finalReserveId = currentReserveId
    if (!finalReserveId) {
      const pending = this.data.pendingReserves
      if (pending && pending.length > 0) {
        finalReserveId = pending[0]._id
      }
    }
    // 校验：内容不能为空
    if (!feedbackContent.trim()) {
      wx.showToast({
        title: '请填写问题描述',
        icon: "none"
      })
      return
    }
    if (!finalReserveId) {
      console.log("预约信息异常")
      wx.showToast({
        title: '预约信息异常',
        icon: 'none'
      })
      return
    }
    wx.showLoading({
      title: '提交中...'
    })
    const userInfo = wx.getStorageSync('userInfo') || {}
    console.log("feedbackScene:", feedbackScene)
    // 调用异常反馈云函数
    wx.cloud.callFunction({
      name: 'submitAbnormalFeedback',
      data: {
        reserveId: finalReserveId,
        feedbackTitle: feedbackTitle.trim(),
        feedbackContent: feedbackContent.trim(),
        feedbackScene: feedbackScene,
        feedbackPhotos: feedbackPhotos,
        endUsage: endWithFeedback,
        userInfo: {
          userId: userInfo.userId,
          name: userInfo.name || '',
          phone: userInfo.phone || '',
          groupName: userInfo.groupName || '',
          openid: userInfo.openid || ''
        }
      }
    }).then(res => {
      wx.hideLoading()
      const result = res.result || {}
      console.log("res:", res)
      if (result.success) {
        if (feedbackScene === 'using' || feedbackScene === 'start') {
          wx.cloud.callFunction({
            name: 'sendAbnormalNotification',
            data: {
              reserveId: finalReserveId,
              deviceName: this.data.currentUsage?.device_name || '',
              deviceId: this.data.currentUsage?.device_id || '',
              userName: userInfo.name || userInfo.userId || '未知用户',
              feedbackTitle: feedbackTitle.trim(),
              feedbackContent: feedbackContent.trim()
            }
          }).then(notifyRes => {
            console.log('异常通知发送结果:', notifyRes)
          }).catch(err => {
            console.error('发送异常通知失败:', err)
          })
        }
        if (feedbackScene === 'using' && endWithFeedback) {
          wx.showToast({
            title: '反馈已提交，使用已异常结束',
            icon: 'none',
            duration: 2000
          })
          this.loadCurrentUsage()
          this.loadUsageHistory()
        } else {
          wx.showToast({
            title: '反馈提交成功',
            icon: 'success'
          })
        }
        this.setData({
          ifWorkingOK: true
        })
        this.loadPendingReserves() // 刷新预约列表，异常预约会被过滤
      } else {
        wx.showToast({
          title: result.error || '提交失败',
          icon: 'none'
        })
      }
    }).catch(err => {
      wx.hideLoading()
      console.error('提交反馈失败:', err)
      wx.showToast({
        title: '提交失败，请重试',
        icon: 'none'
      })
    })

  },
  // 7
  handleStartPhoto(tempFilePath, specificReserveId) {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      wx.showToast({
        title: '请先完成身份认证',
        icon: 'none'
      })
      return
    }

    wx.showLoading({
      title: '获取预约信息...'
    })

    var reservePromise
    if (specificReserveId) {
      reservePromise = db.collection('reserves').doc(specificReserveId).get()
        .then(res => {
          var item = res.data
          if (!item || item.status !== 'approved') return null
          if (String(item.user_id || '').trim() !== String(userInfo.userId || '').trim()) return null
          if (item.usage_status && item.usage_status !== 'not_started') return null
          // if (!this.isReserveReady(item, new Date())) return null
          return item
        })
    } else {
      reservePromise = this.findCurrentValidReserve(userInfo.userId)
    }

    reservePromise.then(reserve => {
        wx.hideLoading()
        if (!reserve) {
          wx.showToast({
            title: '当前时间无可开始使用的预约',
            icon: 'none'
          })
          return
        }
        this.createUsageRecord(reserve, tempFilePath, userInfo)
        
      })
      .catch(err => {
        wx.hideLoading()
        console.error('获取预约失败:', err)
        wx.showToast({
          title: '获取预约信息失败',
          icon: 'none'
        })
      })
  },
  // 8
  createUsageRecord(reserve, startPhotoPath, userInfo) {
    this.setData({
      isLoading: true
    })

    wx.cloud.uploadFile({
      cloudPath: `usage_photos/start_${Date.now()}.jpg`,
      filePath: startPhotoPath,
      success: uploadRes => {
        const startPhotoId = uploadRes.fileID
        wx.cloud.callFunction({
          name: 'startUsage',
          data: {
            reserveId: reserve._id,
            startPhotoId,
            userInfo: {
              userId: userInfo.userId,
              name: userInfo.name || '',
              phone: userInfo.phone || '',
              groupName: userInfo.groupName || '',
              openid: userInfo.openid || ''
            }
          }
        }).then(callRes => {
          const result = callRes && callRes.result ? callRes.result : {}
          if (!result.success) {
            throw new Error(this.getStartUsageErrorMessage(result))
          }

          this.setData({
            isLoading: false
          })
          wx.showToast({
            title: '开始使用成功',
            icon: 'success'
          })
          this.loadCurrentUsage()
          this.loadPendingReserves()
          this.loadUsageHistory()
        }).catch(err => {
          this.cleanupCloudFiles([startPhotoId]).then(() => {
            this.setData({
              isLoading: false
            })
            console.error('创建使用记录失败:', err)
            wx.showToast({
              title: err && err.message ? err.message : '开始使用失败',
              icon: 'none'
            })
          })
        })
      },
      fail: err => {
        this.setData({
          isLoading: false
        })
        console.error('上传照片失败:', err)
        wx.showToast({
          title: '照片上传失败',
          icon: 'none'
        })
      }
    })
  },
  // 9
  getStartUsageErrorMessage(result) {
    const code = result && result.code ? result.code : ''
    if (code === 'ALREADY_STARTED') {
      return '该预约已开始使用，请勿重复操作'
    }
    if (code === 'INVALID_TIME_WINDOW' || code === 'RESERVE_NOT_FOUND') {
      return '当前时间无可开始使用的预约'
    }
    if (code === 'FORBIDDEN') {
      return '无权开始该预约'
    }
    return (result && result.error) || '开始使用失败'
  },
  // 10
  cleanupCloudFiles(fileList) {
    const validFiles = (fileList || []).filter(Boolean)
    if (validFiles.length === 0) {
      return Promise.resolve()
    }

    return wx.cloud.deleteFile({
        fileList: validFiles
      })
      .catch(err => {
        console.error('清理云文件失败:', err)
      })
  },
  // 11
  requestSubscribeMessage() {
    if (!TEMPLATE_ID || TEMPLATE_ID === 'YOUR_TEMPLATE_ID_HERE') return
    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success: res => {
        // accept=同意则累加1次推送额度；用户勾选“总是保持以上选择”后无弹窗自动累加
        console.log('订阅授权结果', res[TEMPLATE_ID])
      },
      fail: err => {
        console.error('订阅消息授权失败:', err)
      }
    })
  },
  // 12
  uploadUsagePhoto() {
    if (!this.data.currentUsage) return
    this.requestSubscribeMessage()

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.setData({
          isLoading: true
        })
        wx.cloud.uploadFile({
          cloudPath: `usage_photos/mid_${Date.now()}.jpg`,
          filePath: tempFilePath,
          success: uploadRes => {
            db.collection('device_usage')
              .doc(this.data.currentUsage._id)
              .update({
                data: {
                  usage_images: db.command.push(uploadRes.fileID)
                }
              })
              .then(() => {
                this.setData({
                  isLoading: false
                })
                wx.showToast({
                  title: '照片上传成功',
                  icon: 'success'
                })
                this.loadCurrentUsage()
              })
              .catch(err => {
                this.setData({
                  isLoading: false
                })
                console.error('更新使用记录失败:', err)
                wx.showToast({
                  title: '上传失败',
                  icon: 'none'
                })
              })
          },
          fail: err => {
            this.setData({
              isLoading: false
            })
            console.error('上传照片失败:', err)
            wx.showToast({
              title: '上传失败',
              icon: 'none'
            })
          }
        })
      }
    })
  },
  // 13
  startEndUsage() {
    // 弹出结束信息表单，不再进入 endMode
    this.setData({
      showEndForm: true,
      endForm: {
        instrumentOff: null,
        computerOff: null,
        sampleCount: '',
        moreSample: null,
        moreSampleCount: '',
        totalPage: '',
        needSupplement: null,
        supplementPage: ''
      }
    })
  },
  // 14
  writeUsageEndReminder() {
    const currentUsage = this.data.currentUsage
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!currentUsage || !userInfo.userId) {
      return Promise.resolve()
    }

    const messageKey = `usage_end_remind:${currentUsage._id}`
    const messageDocId = `usage_end_remind_${currentUsage._id}`

    return db.collection('messages')
      .doc(messageDocId)
      .set({
        data: {
          user_id: userInfo.userId,
          title: '结束使用前请上传三张照片',
          content: `您已进入${currentUsage.device_name || '仪器'}的结束使用流程。请前往“仪器使用”页的“上传照片板块”，依次上传值日照、仪器关闭照、实验室关门照三张照片。`,
          type: 'usage_end_remind',
          related_id: currentUsage._id,
          message_key: messageKey,
          is_read: false,
          create_time: new Date().toISOString()
        }
      })
      .then(() => {
        this.loadUnreadReminder()
      })
      .catch(err => {
        console.error('写入结束使用提醒失败:', err)
      })
  },


  // 19
  cancelEnd() {
    this.setData({
      endMode: false,
      endPhotos: [null, null, null]
    })
  },
  // 20
  truncateText(text, maxLength) {
    const value = String(text || '')
    if (value.length <= maxLength) {
      return value
    }
    return `${value.slice(0, maxLength - 1)}…`
  },
  goAuth() {
    wx.navigateTo({
      url: '/pages/auth/auth'
    })
  },
  // 选择故障照片
  chooseFeedbackPhoto() {
    const maxCount = 3 - this.data.feedbackPhotos.length
    if (maxCount <= 0) {
      wx.showToast({
        title: '最多上传3张照片',
        icon: 'none'
      })
      return
    }

    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFiles = res.tempFiles || []
        this.uploadFeedbackPhotos(tempFiles)
      }
    })
  },

  // 批量上传故障照片到云存储
  uploadFeedbackPhotos(tempFiles) {
    wx.showLoading({
      title: '上传中...'
    })
    const uploadTasks = tempFiles.map(file => {
      return new Promise((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath: `feedback_pics/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
          filePath: file.tempFilePath,
          success: res => resolve(res.fileID),
          fail: reject
        })
      })
    })

    Promise.all(uploadTasks)
      .then(fileIDs => {
        wx.hideLoading()
        this.setData({
          feedbackPhotos: this.data.feedbackPhotos.concat(fileIDs)
        })
      })
      .catch(err => {
        wx.hideLoading()
        console.error('反馈照片上传失败:', err)
        wx.showToast({
          title: '照片上传失败',
          icon: 'none'
        })
      })
  },

  // 删除已选故障照片
  deleteFeedbackPhoto(e) {
    const index = e.currentTarget.dataset.index
    const photos = this.data.feedbackPhotos.slice()
    photos.splice(index, 1)
    this.setData({
      feedbackPhotos: photos
    })
  },

  // 结束使用复选框切换
  onEndWithFeedbackChange(e) {
    const checked = e.detail.value.includes('1')
    this.setData({
      endWithFeedback: checked
    })
  },
  // 取消结束表单
  cancelEndForm() {
    this.setData({
      showEndForm: false
    })
  },
  // 选择仪器是否关闭
  selectInstrumentOff(e) {
    const value = e.currentTarget.dataset.value === 'true'
    this.setData({
      'endForm.instrumentOff': value
    })
  },
  // 选择电脑是否关闭
  selectComputerOff(e) {
    const value = e.currentTarget.dataset.value === 'true'
    this.setData({
      'endForm.computerOff': value
    })
  },
  selectMoreSample(e) {
    const value = e.currentTarget.dataset.value === 'true'
    this.setData({
      'endForm.moreSample': value
    })
  },
  onNextUserInput(e) {
    let val = e.detail.value.trim()
    this.setData({
      'endForm.nextUser': val
    })
  },
  // 输入运行样品总数
  onSampleCountInput(e) {
    let val = e.detail.value
    // 只允许正整数
    val = val.replace(/\D/g, '')
    if (val === '0') val = ''
    this.setData({
      'endForm.sampleCount': val
    })
  },
  onMoreSampleCountInput(e) {
    let val = e.detail.value
    // 只允许正整数
    val = val.replace(/\D/g, '')
    if (val === '0') val = ''
    this.setData({
      'endForm.moreSampleCount': val
    })
  },
  // 上传总的预约单
  pickTotalPage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        this.setData({
          'endForm.totalPage': res.tempFiles[0].tempFilePath
        })
      },
      fail: err => {
        console.error('选择预约单失败:', err)
      }
    })
  },
  pickDevicePage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        this.setData({
          'endForm.devicePage': res.tempFiles[0].tempFilePath
        })
      },
      fail: err => {
        console.error('选择仪器关闭照片失败:', err)
      }
    })
  },
  pickRoomPage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        this.setData({
          'endForm.roomPage': res.tempFiles[0].tempFilePath
        })
      },
      fail: err => {
        console.error('选择实验室关门照片失败:', err)
      }
    })
  },
  // 选择是否需要补充预约
  selectNeedSupplement(e) {
    const value = e.currentTarget.dataset.value === 'true'
    this.setData({
      'endForm.needSupplement': value,
      'endForm.supplementPage': '' // 切换时清空已选的补充预约单
    })
  },
  // 上传补充预约单
  pickSupplementPage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        this.setData({
          'endForm.supplementPage': res.tempFiles[0].tempFilePath
        })
      },
      fail: err => {
        console.error('选择补充预约单失败:', err)
      }
    })
  },
  // 提交结束表单
  async submitEndForm() {
    const endForm = this.data.endForm

    // 表单验证
    if (endForm.instrumentOff === null) {
      wx.showToast({
        title: '请选择仪器是否关闭',
        icon: 'none'
      })
      return
    }
    if (endForm.computerOff === null) {
      wx.showToast({
        title: '请选择电脑是否关闭',
        icon: 'none'
      })
      return
    }
    if (!endForm.sampleCount) {
      wx.showToast({
        title: '请填写运行样品总数',
        icon: 'none'
      })
      return
    }
    if (endForm.moreSample === null) {
      wx.showToast({
        title: '请选择是否多余预约',
        icon: 'none'
      })
      return
    }
    if (endForm.moreSample && !endForm.moreSampleCount) {
      wx.showToast({
        title: '请填写剩余样品数量',
        icon: 'none'
      })
      return
    }
    if (!endForm.totalPage) {
      wx.showToast({
        title: '请上传总的预约单',
        icon: 'none'
      })
      return
    }
    if (!endForm.devicePage) {
      wx.showToast({
        title: '请上传仪器关闭照片',
        icon: 'none'
      })
      return
    }
    if (!endForm.roomPage) {
      wx.showToast({
        title: '请上传实验室关门',
        icon: 'none'
      })
      return
    }
    if (endForm.needSupplement === null) {
      wx.showToast({
        title: '请选择是否需要补充预约',
        icon: 'none'
      })
      return
    }
    if (endForm.needSupplement && !endForm.supplementPage) {
      wx.showToast({
        title: '请上传补充预约单',
        icon: 'none'
      })
      return
    }
    if (endForm.computerOff === false && !endForm.nextUser) {
      wx.showToast({
        title: '请上传下一个使用者姓名',
        icon: 'none'
      })
      return
    }

    this.setData({
      isLoading: true
    })

    try {
      // 上传所有图片
      const uploadTasks = []
      const fileMap = {}

      // 上传总的预约单
      const totalPageTask = wx.cloud.uploadFile({
        cloudPath: `end_check/total_${Date.now()}.jpg`,
        filePath: endForm.totalPage
      })
      uploadTasks.push(totalPageTask)
      const devicePageTask = wx.cloud.uploadFile({
        cloudPath: `end_check/device_${Date.now()}.jpg`,
        filePath: endForm.devicePage
      })
      uploadTasks.push(devicePageTask)
      const roomPageTask = wx.cloud.uploadFile({
        cloudPath: `end_check/room_${Date.now()}.jpg`,
        filePath: endForm.roomPage
      })
      uploadTasks.push(roomPageTask)
      // 如果需要补充预约，上传补充预约单
      let supplementTask = null
      if (endForm.needSupplement) {
        supplementTask = wx.cloud.uploadFile({
          cloudPath: `end_check/supplement_${Date.now()}.jpg`,
          filePath: endForm.supplementPage
        })
        uploadTasks.push(supplementTask)
      }
      const uploadResults = await Promise.all(uploadTasks)
      const totalPageFileID = uploadResults[0].fileID
      const devicePageFileID = uploadResults[1].fileID
      const roomPageFileID = uploadResults[2].fileID
      const supplementPageFileID = supplementTask ? uploadResults[3].fileID : ''
      // 构建结束信息数据
      const currentUsage = this.data.currentUsage
      const endTime = new Date().toISOString()

      const endChecklist = {
        instrument_off: endForm.instrumentOff,
        computer_off: endForm.computerOff,
        nextUser: endForm.nextUser || '',
        sample_count: parseInt(endForm.sampleCount),
        more_sample: endForm.moreSample,
        more_sample_count: endForm.moreSample ? parseInt(endForm.moreSampleCount) : 0,
        total_page: totalPageFileID,
        device_page: devicePageFileID, // 新增
        room_page: roomPageFileID, // 新增
        need_supplement: endForm.needSupplement,
        supplement_page: supplementPageFileID || ''
      }

      // 更新 device_usage 表
      await db.collection('device_usage').doc(currentUsage._id).update({
        data: {
          end_time: endTime,
          status: 'completed',
          end_checklist: endChecklist
        }
      })

      // 更新 reserves 表
      if (currentUsage.reserve_id) {
        await db.collection('reserves').doc(currentUsage.reserve_id).update({
          data: {
            usage_status: 'completed'
          }
        })
      }

      this.setData({
        isLoading: false,
        showEndForm: false,
        currentUsage: null
      })

      wx.showToast({
        title: '使用已结束',
        icon: 'success'
      })
      this.loadData()

    } catch (err) {
      this.setData({
        isLoading: false
      })
      console.error('结束使用失败:', err)
      wx.showToast({
        title: '结束失败，请重试',
        icon: 'none'
      })
    }
  },
})