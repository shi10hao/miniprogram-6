// pages/reserve-detail/reserve-detail.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    isLoading: false,
    status: 'using', // upcoming | using | completed | abnormal
    detail: {
      student_name: '',
      group_name: '',
      device_id: '',
      device_name: '',
      dateDisplay: '',
      timeDisplay: '',
      allPhotos: [],
      startPhotoUrl: '',
      usageImageUrls: [], // 多张
      endPhotoItems: [], // 结束核验照片数组
      reservePageUrl: '' // 系统预约单
    },
    feedback: {
      content: '',
      title: '',
      submit_time: '',
      submit_time_display: ''
    },
    isLoading: false,
    isHandlingAbnormal: false, // 新增
    status: 'using',
    // ... 其余不变
  },

  onLoad(options) {
    const reserveId = options.id
    console.log("id:", reserveId)
    if (!reserveId) return

    this.setData({
      reserveId
    }) // 新增：保存 reserveId
    this.bootstrapPage(reserveId)
  },

  bootstrapPage(reserveId) {
    this.loadReserveDetail(reserveId)
  },

  async loadReserveDetail(reserveId) {
    const db = wx.cloud.database()

    // 1. 查两条表
    const [reserveRes, usageRes] = await Promise.all([
      db.collection('reserves').doc(reserveId).get(),
      db.collection('device_usage')
      .where({
        reserve_id: reserveId
      })
      .get()
    ])
    const reserve = reserveRes.data
    const usage = usageRes.data[0] || null
    console.log('预约完整数据：', reserve)
    console.log('usage:', usage)
    if (usage && usage.feedback) {
      this.setData({
        feedback: {
          content: usage.feedback.content,
          submit_time: usage.feedback.submit_time,
          submit_time_display: this.formatUTCDisplay(usage.feedback.submit_time),
          title: usage.feedback.title
        }
      })
    }
    // 2. 收集所有 fileID
    const fileIDs = this.collectFileIDs(reserve, usage)

    // 3. 一次性转 URL
    const urlMap = await this.fetchTempURLs(fileIDs)

    // 4. 回填
    const photoUrls = this.applyPhotosToData(reserve, usage, urlMap)

    const allPhotos = [
      photoUrls.reservePageUrl,
      photoUrls.startPhotoUrl,
      ...photoUrls.usageImageUrls,
      photoUrls.endChecklistDisplay?.totalPageUrl,
      photoUrls.endChecklistDisplay?.supplementPageUrl,
      ...photoUrls.feedbackPhotoUrls
    ].filter(Boolean) // 去掉空字符串

    // 计算预约真实状态
    const status = this.calcReserveStatus(reserve, usage)
    // 计算时间显示（支持跨天）
    let timeDisplay = ''
    let dateDisplay = reserve.reserve_date || ''
    if (reserve.start_time && reserve.end_time) {
      const startDateOnly = this.formatDateOnly(reserve.start_time)
      const endDateOnly = this.formatDateOnly(reserve.end_time)
      const isCrossDay = startDateOnly && endDateOnly && startDateOnly !== endDateOnly

      if (isCrossDay) {
        // 跨天：2026-07-10 19:00 - 07-18 19:30
        const pad = n => String(n).padStart(2, '0')
        const startD = this.parseDateTime(reserve.start_time)
        const endD = this.parseDateTime(reserve.end_time)
        if (startD && endD) {
          const startTime = `${pad(startD.getHours())}:${pad(startD.getMinutes())}`
          const endDisplay = `${pad(endD.getMonth() + 1)}-${pad(endD.getDate())} ${pad(endD.getHours())}:${pad(endD.getMinutes())}`
          timeDisplay = `${startTime} - ${endDisplay}`
        } else {
          timeDisplay = `${this.formatTime(reserve.start_time)} - ${this.formatTime(reserve.end_time)}`
        }
      } else {
        // 同天：19:00 - 19:30
        timeDisplay = `${this.formatTime(reserve.start_time)} - ${this.formatTime(reserve.end_time)}`
      }
    }

    this.setData({
      detail: {
        student_name: reserve.student_name || '',
        group_name: reserve.research_group || '',
        device_id: reserve.device_id || '',
        device_name: reserve.device_name || '',
        dateDisplay: dateDisplay,
        timeDisplay: timeDisplay,
        ...photoUrls,
      },
      allPhotos,
      status,
      isLoading: false
    })
  },
  formatDateOnly(isoStr) {
    if (!isoStr) return ''
    const d = this.parseDateTime(isoStr)
    if (!d) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  formatUTCDisplay(utcStr) {
    if (!utcStr) return ''

    const d = new Date(utcStr)
    if (isNaN(d.getTime())) return utcStr

    // 转为北京时间（东八区）
    const beijing = new Date(d.getTime() + 8 * 60 * 60 * 1000)

    const pad = n => String(n).padStart(2, '0')
    const year = beijing.getUTCFullYear()
    const month = pad(beijing.getUTCMonth() + 1)
    const day = pad(beijing.getUTCDate())
    const hours = pad(beijing.getUTCHours())
    const minutes = pad(beijing.getUTCMinutes())
    const seconds = pad(beijing.getUTCSeconds())

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  },


  // 计算预约状态
  calcReserveStatus(reserve, usage) {
    const now = new Date()

    // 1. 使用记录优先判断
    if (usage) {
      if (usage.status === 'completed') return 'completed'
      if (usage.status === 'using') return 'using'
      if (usage.status === 'abnormal') return 'abnormal'
    }

    // 2. 按预约时间判断
    const startTime = this.parseDateTime(reserve.start_time)
    const endTime = this.parseDateTime(reserve.end_time)
    const nowTime = now.getTime()

    if (nowTime < startTime) return 'upcoming'
    if (nowTime >= startTime && nowTime < endTime) return 'using'
    return 'completed'
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
  collectFileIDs(reserve, usage) {
    const ids = []

    // 预约单
    if (reserve?.reserve_page) ids.push(reserve.reserve_page)

    if (usage) {
      // 开始照片
      if (usage.start_photo) ids.push(usage.start_photo)

      // 使用照片（数组）
      if (Array.isArray(usage.usage_images)) {
        ids.push(...usage.usage_images)
      }
      // 新增：结束信息中的图片
      const ec = usage.end_checklist
      if (ec) {
        if (ec.total_page) ids.push(ec.total_page)
        if (ec.device_page) ids.push(ec.device_page) // 新增：仪器关闭照片
        if (ec.room_page) ids.push(ec.room_page) // 新增：实验室关门照片
        if (ec.supplement_page) ids.push(ec.supplement_page)
      }
      // 新增：反馈照片
      const fb = usage.feedback
      if (fb && Array.isArray(fb.photos)) {
        fb.photos.forEach(pid => {
          if (pid) ids.push(pid)
        })
      }
    }

    // 去重 + 去掉空值
    return [...new Set(ids.filter(Boolean))]
  },

  async fetchTempURLs(fileIDs) {
    if (fileIDs.length === 0) return {}

    const res = await wx.cloud.getTempFileURL({
      fileList: fileIDs
    })

    const map = {}
    res.fileList.forEach(f => {
      map[f.fileID] = f.tempFileURL
    })
    return map
  },

  applyPhotosToData(reserve, usage, map) {
    let endChecklistDisplay = null
    const ec = usage?.end_checklist
    if (ec) {
      endChecklistDisplay = {
        instrumentOff: ec.instrument_off,
        computerOff: ec.computer_off,
        nextUser: ec.nextUser || '', // 新增：下一个使用者
        sampleCount: ec.sample_count,
        totalPageUrl: map[ec.total_page] || '',
        devicePageUrl: map[ec.device_page] || '', // 新增：仪器关闭照片
        roomPageUrl: map[ec.room_page] || '', // 新增：实验室关门照片
        needSupplement: ec.need_supplement,
        supplementPageUrl: map[ec.supplement_page] || ''
      }
    }
    let feedbackPhotoUrls = []
    const fb = usage?.feedback
    if (fb && Array.isArray(fb.photos)) {
      feedbackPhotoUrls = fb.photos.map(pid => map[pid] || '').filter(Boolean)
    }
    return {
      reservePageUrl: map[reserve?.reserve_page] || '',
      // 开始照片
      startPhotoUrl: map[usage?.start_photo] || '',
      // 使用照片（保持数组顺序）
      usageImageUrls: (usage?.usage_images || []).map(id => map[id] || ''),
      // 结束信息展示
      endChecklistDisplay,
      // 新增：反馈照片
      feedbackPhotoUrls
    }
  },

  formatTime(datetime) {
    return datetime.split(' ')[1] || ''
  },

  previewPhoto(e) {
    const current = e.currentTarget.dataset.url
    const urls = e.currentTarget.dataset.urls

    if (!current || !urls || urls.length === 0) return

    wx.previewImage({
      current,
      urls
    })
  },
  // 点击"标记为已处理"按钮
  onResolveAbnormal() {
    wx.showModal({
      title: '确认处理',
      content: '确认该异常已在线下处理完毕？此操作将把预约和使用记录标记为已完成。',
      confirmText: '确认处理',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.doResolveAbnormal()
        }
      }
    })
  },

  async doResolveAbnormal() {
    this.setData({
      isHandlingAbnormal: true
    })

    try {
      const db = wx.cloud.database()
      const reserveId = this.data.reserveId || '' // 需要在 onLoad 中保存 reserveId

      // 1. 查询当前的使用记录
      const usageRes = await db.collection('device_usage')
        .where({
          reserve_id: reserveId,
          status: 'abnormal'
        })
        .get()

      const usage = usageRes.data[0]
      if (!usage) {
        throw new Error('未找到对应的异常使用记录')
      }

      const now = new Date().toISOString()

      // 2. 更新 device_usage：status 改为 completed，补填 end_time
      await db.collection('device_usage').doc(usage._id).update({
        data: {
          status: 'completed',
          end_time: now
        }
      })

      // 3. 更新 reserves：usage_status 改为 completed
      await db.collection('reserves').doc(reserveId).update({
        data: {
          usage_status: 'completed'
        }
      })

      // 4. 更新页面状态
      this.setData({
        status: 'completed',
        isHandlingAbnormal: false
      })

      wx.showToast({
        title: '处理成功',
        icon: 'success'
      })

      // 5. 刷新页面数据
      this.loadReserveDetail(reserveId)

    } catch (err) {
      console.error('处理异常失败:', err)
      this.setData({
        isHandlingAbnormal: false
      })
      wx.showToast({
        title: err.message || '处理失败，请重试',
        icon: 'none'
      })
    }
  },
})