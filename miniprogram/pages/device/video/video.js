Page({
  data: {
    deviceName: '',
    fileID: '',
    sourceUrl: '',
    sourceType: '',
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
      return
    }

    if (url.indexOf('cloud://') === 0) {
      this.setData({
        sourceType: 'cloud',
        fileID: url,
        isLoading: true,
        hasVideo: false
      })
      this.getVideoTempUrl(url)
      return
    }

    if (/^https?:\/\//i.test(url)) {
      this.setData({
        sourceType: 'http',
        fileID: '',
        videoUrl: url,
        isLoading: false,
        hasVideo: true
      })
      return
    }

    this.handleNoVideo('视频链接无效')
  },

  // 获取视频临时链接
  getVideoTempUrl(fileID) {
    const that = this
    wx.showLoading({
      title: '加载视频中...'
    })

    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        wx.hideLoading()
        console.log('获取临时链接成功:', res)

        if (res.fileList && res.fileList.length > 0 && res.fileList[0].tempFileURL) {
          that.setData({
            videoUrl: res.fileList[0].tempFileURL,
            isLoading: false,
            hasVideo: true
          })
        } else {
          that.handleVideoError('视频文件不存在或已删除')
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('获取临时链接失败:', err)
        that.handleNoVideo('视频加载失败，请检查网络')
      }
    })
  },

  handleNoVideo(message) {
    this.setData({
      sourceType: '',
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
