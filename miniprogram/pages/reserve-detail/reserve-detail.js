// pages/reserve-detail/reserve-detail.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    isLoading: false,
    status: 'using', // upcoming | using | completed
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
      endPhotoUrls: [], // 多张
      reservePageUrl: '' // 系统预约单
    }
  },

  onLoad(options) {
    const reserveId = options.id
    console.log("id:", reserveId)
    if (!reserveId) return
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
      ...Object.values(photoUrls.endPhotoUrls || {})
    ].filter(Boolean) // 去掉空字符串

    this.setData({
      detail:{
        student_name:reserve.student_name || '',
        group_name: reserve.research_group || '',
        device_id:reserve.device_id || '',
        device_name:reserve.device_name || '',
        dateDisplay: reserve.reserve_date,
        timeDisplay: `${this.formatTime(reserve.start_time)}-${this.formatTime(reserve.end_time)}`,
        ...photoUrls,
      },
      allPhotos,
      isLoading: false
    })
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
  
      // 结束照片（对象，只要 value）
      if (usage.end_photos && typeof usage.end_photos === 'object') {
        Object.values(usage.end_photos).forEach(v => {
          if (v) ids.push(v)
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
    return {
      // 预约单
      reservePageUrl: map[reserve?.reserve_page] || '',
  
      // 开始照片
      startPhotoUrl: map[usage?.start_photo] || '',
  
      // 使用照片（保持数组顺序）
      usageImageUrls: (usage?.usage_images || []).map(id => map[id] || ''),
  
      // 结束照片（保持 key 不变）
      endPhotoUrls: usage?.end_photos ? Object.fromEntries(
        Object.entries(usage.end_photos).map(([k, v]) => [k, map[v] || ''])
      ) : {}
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
  }
})