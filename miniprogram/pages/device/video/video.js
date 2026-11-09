Page({
  data: {
    deviceName: '',
    fileID: '',
    sourceUrl: '',
    videoUrl: '',
    isLoading: true,
    hasVideo: false
  },

  onLoad(options) {
    const deviceName = this.safeDecode(options.deviceName || '设备')
    const sourceUrl = this.safeDecode(options.fileID || options.videoUrl || '')

    console.log('视频页面参数:', options)

    this.setData({
      deviceName: deviceName,
      sourceUrl: sourceUrl,
      isLoading: true
    })

    wx.setNavigationBarTitle({
      title: deviceName + ' - 操作视频'
    })

    this.loadVideoSource(sourceUrl)
  },

  // 下拉刷新：重新取一次视频临时链接（临时链接会过期，重取是有意义的）
  onPullDownRefresh() {
    this.loadVideoSource(this.data.sourceUrl).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  safeDecode(value) {
    const text = String(value || '')
    try {
      return decodeURIComponent(text)
    } catch (err) {
      return text
    }
  },

  loadVideoSource(sourceUrl) {
    const url = String(sourceUrl || '').trim()
    if (!url) {
      this.handleNoVideo('暂无视频链接')
      return Promise.resolve()
    }

    if (url.indexOf('cloud://') === 0) {
      this.setData({
        fileID: url,
        isLoading: true,
        hasVideo: false
      })
      return this.getVideoTempUrl(url)
    }

    if (/^https?:\/\//i.test(url)) {
      this.setData({
        fileID: '',
        videoUrl: url,
        isLoading: false,
        hasVideo: true
      })
      return Promise.resolve()
    }

    this.handleNoVideo('视频链接无效')
    return Promise.resolve()
  },

  /**
   * 获取视频临时链接
   * @param {string} fileID 云存储文件 id
   * @returns {Promise<void>} 成功失败都 resolve，供下拉刷新收尾
   */
  getVideoTempUrl(fileID) {
    wx.showLoading({
      title: '加载视频中...'
    })

    return wx.cloud.getTempFileURL({
      fileList: [fileID]
    }).then((res) => {
      wx.hideLoading()
      console.log('获取临时链接成功:', res)

      if (res.fileList && res.fileList.length > 0 && res.fileList[0].tempFileURL) {
        this.setData({
          videoUrl: res.fileList[0].tempFileURL,
          isLoading: false,
          hasVideo: true
        })
        return
      }

      this.handleVideoError('视频文件不存在或已删除')
    }).catch((err) => {
      wx.hideLoading()
      console.error('获取临时链接失败:', err)
      this.handleNoVideo('视频加载失败，请检查网络')
    })
  },

  handleNoVideo(message) {
    this.setData({
      fileID: '',
      videoUrl: '',
      isLoading: false,
      hasVideo: false
    })
    wx.showToast({
      title: message,
      icon: 'none',
      duration: 3000
    })
  },

  // 处理视频错误
  handleVideoError(message) {
    this.setData({
      isLoading: false,
      hasVideo: false
    })
    wx.showToast({
      title: message,
      icon: 'none',
      duration: 3000
    })
  },

  // 视频播放器错误处理
  onVideoError(e) {
    console.error('视频播放错误:', e.detail.errMsg)
    if (e.detail.errMsg.includes('MEDIA_ERR_NETWORK')) {
      this.handleVideoError('网络错误，请检查连接')
    } else if (e.detail.errMsg.includes('MEDIA_ERR_DECODE')) {
      this.handleVideoError('视频格式不支持')
    } else {
      this.handleVideoError('视频播放失败')
    }
  },

  // 重新加载
  reloadVideo() {
    this.setData({
      isLoading: true,
      hasVideo: false
    })
    this.loadVideoSource(this.data.sourceUrl)
  },

  onVideoPlay() {},

  onVideoEnded() {},

  onVideoLoad() {},

  navigateBack() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.switchTab({
          url: '/pages/index/index'
        })
      }
    })
  }
})
