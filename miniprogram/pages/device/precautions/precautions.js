Page({
  data: {
    deviceName: '',
    categories: [],  // 结构化数据
    isStructured: false,
    plainText: ''    // 旧版纯文本
  },

  onLoad(options) {
    console.log('precautions页面参数:', options)
    
    if (options.deviceName) {
      this.setData({ deviceName: decodeURIComponent(options.deviceName) })
    }
    
    if (options.content) {
      let content = decodeURIComponent(options.content)
      
      // 判断是否是结构化数据
      if (options.type === 'structured') {
        try {
          const structuredData = JSON.parse(content)
          this.setData({
            categories: structuredData.categories || [],
            isStructured: true
          })
        } catch (e) {
          // 解析失败，按纯文本处理
          this.setData({ plainText: content })
        }
      } else {
        // 旧版纯文本
        this.setData({ plainText: content })
      }
    }
  }
})