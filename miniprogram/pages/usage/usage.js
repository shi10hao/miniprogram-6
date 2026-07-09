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
    endMode: false,
    endPhotos: [null, null, null],
    unreadReminder: null,
    isAuthenticated: false,
    ifWorkingOK: true,
    feedbackTitle: '',
    feedbackContent: '',
    currentReserveId: '' // 新增：当前反馈对应的预约ID
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
        currentUsage: null
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
        this.setData({
          currentUsage: usage ? this.formatUsage(usage) : null
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

    return db.collection('reserves')
      .where({
        user_id: userInfo.userId,
        status: 'approved'
      })
      .orderBy('start_time', 'asc')
      .limit(50)
      .get()
      .then(res => {
        var records = res.data || []
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
          return {
            _id: item._id,
            device_name: item.device_name || '',
            device_id: item.device_id || '',
            start_time: item.start_time || '',
            end_time: item.end_time || '',
            reserve_date: item.reserve_date || '',
            start_display: this.formatClock(item.start_time),
            end_display: this.formatClock(item.end_time),
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

    return Object.assign({}, usage, {
      start_time_display: startDisplay,
      end_time_display: endDisplay,
      usage_date_display: usage.start_time ? this.formatDateOnly(usage.start_time) : '',
      usage_period_display: usage.start_time && usage.end_time ?
        `${this.formatClock(usage.start_time)} - ${this.formatClock(usage.end_time)}` : ''
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
  startUsage() {
    if (this.data.isLoading) return

    this.requestSubscribeMessage()

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.handleStartPhoto(tempFilePath, null)
      },
      fail(err) {
        console.error('选择照片失败:', err)
      }
    })
  },

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
            .fields({ node: true, size: true })
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
                const xPos = Math.round(imgWidth / 3)  // 横向三分之一位置
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
  async startUsageFromReserve(e) {
    if (this.data.isLoading) return
    var ifWrong
    var reserveId = e.currentTarget.dataset.reserveid
    // 仪器是否启动
    await new Promise((resolve) => {
      wx.showModal({
        title: '仪器是否正常启动',
        content: '若出现问题请联系管理员',
        confirmText: '正常启动',
        cancelText: '出现问题',
        complete: (res) => {
          if (res.cancel) {
            console.log("仪器启动不正常")
            ifWrong = true
            this.ifWrong(reserveId) // 传入预约ID
            resolve()
          }

          if (res.confirm) {
            this.setData({
              ifWorkingOK: true
            })
            console.log("仪器正常启动")
            ifWrong = false
            resolve()
          }
        }
      })
    })

    if (ifWrong) return
    // 是否订阅消息
    await new Promise((resolve) => {
      if (!TEMPLATE_ID || TEMPLATE_ID === 'YOUR_TEMPLATE_ID_HERE') {
        resolve()
        return
      }
      wx.requestSubscribeMessage({
        tmplIds: [TEMPLATE_ID],
        success: res => {
          // accept=同意则累加1次推送额度；用户勾选“总是保持以上选择”后无弹窗自动累加
          console.log('订阅授权结果', res[TEMPLATE_ID])
          resolve()
        },
        fail: err => {
          console.error('订阅消息授权失败:', err)
          resolve()
        }
      })
    })
    // this.requestSubscribeMessage()
    wx.showLoading({
      title: '准备拍照...'
    })
    let deviceName = ''
    let deviceId = ''
    try {
      const reserveRes = await db.collection('reserves').doc(reserveId).get()
      const reserveItem = reserveRes.data
      if (reserveItem) {
        deviceName = reserveItem.device_name || ''
        deviceId = reserveItem.device_id || ''
      }
    } catch (err) {
      console.error('获取预约信息失败:', err)
    }

    wx.hideLoading()
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res)=> {
        const tempFilePath = res.tempFiles[0].tempFilePath
        // ===== 新增：给照片加水印 =====
        wx.showLoading({
          title: '添加水印...'
        })
        const watermarkedPath = await this.addWatermarkToPhoto(tempFilePath, deviceName, deviceId)
        wx.hideLoading()
        // ===== 新增结束 =====

        this.handleStartPhoto(watermarkedPath, reserveId)
      },
      fail(err) {
        console.error('选择照片失败:', err)
      }
    })
  },

  ifWrong(reserveId) {
    this.setData({
      ifWorkingOK: false,
      feedbackTitle: '',
      feedbackContent: '',
      currentReserveId: reserveId || ''
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
    const {
      feedbackTitle,
      feedbackContent,
      currentReserveId
    } = this.data
    // 校验：内容不能为空
    if (!feedbackContent.trim()) {
      wx.showToast({
        title: '请填写问题描述',
        icon: 'none'
      })
      return
    }
    if (!currentReserveId) {
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

    // 调用异常反馈云函数
    wx.cloud.callFunction({
      name: 'submitAbnormalFeedback',
      data: {
        reserveId: currentReserveId,
        feedbackTitle: feedbackTitle.trim(),
        feedbackContent: feedbackContent.trim(),
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
      if (result.success) {
        wx.showToast({
          title: '反馈提交成功',
          icon: 'success'
        })
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

        const reservePeriod = `${reserve.start_time || ''} - ${reserve.end_time || ''}`
        wx.showModal({
          title: '确认开始使用',
          content: `仪器：${reserve.device_name}\n预约时段：${reservePeriod}\n确认开始使用？`,
          confirmText: '确认',
          cancelText: '取消',
          success: modal => {
            if (modal.confirm) {
              this.createUsageRecord(reserve, tempFilePath, userInfo)
            }
          }
        })
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
    // this.requestSubscribeMessage()
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: () => {
        this.setData({
          endMode: true,
          endPhotos: [null, null, null]
        })
        this.writeUsageEndReminder()
      },
      fail(err) {
        console.error('选择照片失败:', err)
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
  // 15
  pickEndPhoto(e) {
    const slot = e.currentTarget.dataset.slot

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        const endPhotos = this.data.endPhotos.slice()
        endPhotos[slot] = tempFilePath
        this.setData({
          endPhotos
        })
      },
      fail(err) {
        console.error('选择照片失败:', err)
      }
    })
  },
  // 16
  confirmEndUsage() {
    // this.requestSubscribeMessage()
    const endPhotos = this.data.endPhotos
    if (!endPhotos[0] || !endPhotos[1] || !endPhotos[2]) {
      wx.showToast({
        title: '请上传全部3张照片',
        icon: 'none'
      })
      return
    }

    this.setData({
      isLoading: true
    })
    this.uploadEndPhotos(endPhotos)
  },
  // 17
  uploadEndPhotos(localPaths) {
    const currentUsage = this.data.currentUsage
    const labels = ['duty', 'device_off', 'door_closed']
    const uploadPromises = localPaths.map((path, i) => {
      return new Promise((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath: `usage_photos/end_${labels[i]}_${Date.now()}_${i}.jpg`,
          filePath: path,
          success(res) {
            resolve(res.fileID)
          },
          fail(err) {
            reject(err)
          }
        })
      })
    })

    Promise.all(uploadPromises)
      .then(fileIDs => {
        const endTime = new Date().toISOString()
        const usageCompletionData = {
          end_time: endTime,
          end_photos: {
            duty: fileIDs[0],
            device_off: fileIDs[1],
            door_closed: fileIDs[2]
          },
          status: 'completed'
        }

        return this.completeUsageAndReserve(currentUsage, usageCompletionData)
      })
      .then(() => {
        this.setData({
          isLoading: false,
          endMode: false,
          endPhotos: [null, null, null],
          currentUsage: null
        })
        wx.showToast({
          title: '使用已结束',
          icon: 'success'
        })
        this.loadData()
      })
      .catch(err => {
        this.setData({
          isLoading: false
        })
        console.error('结束使用失败:', err)
        wx.showToast({
          title: '结束失败，请重试',
          icon: 'none'
        })
      })
  },
  // 18
  completeUsageAndReserve(usage, usageCompletionData) {
    let reserveUpdated = false

    return Promise.resolve()
      .then(() => {
        if (!usage || !usage.reserve_id) {
          return null
        }

        return db.collection('reserves')
          .doc(usage.reserve_id)
          .update({
            data: {
              usage_status: 'completed'
            }
          })
          .then(() => {
            reserveUpdated = true
          })
      })
      .then(() => db.collection('device_usage')
        .doc(usage._id)
        .update({
          data: usageCompletionData
        }))
      .catch(err => {
        if (!reserveUpdated || !usage || !usage.reserve_id) {
          throw err
        }

        return db.collection('reserves')
          .doc(usage.reserve_id)
          .update({
            data: {
              usage_status: 'active'
            }
          })
          .catch(rollbackErr => {
            console.error('回滚预约状态失败:', rollbackErr)
          })
          .then(() => {
            throw err
          })
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
  }
})