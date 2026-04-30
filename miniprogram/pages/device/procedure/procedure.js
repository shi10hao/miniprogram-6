Page({
  data: {
    deviceName: '',
    pageTitle: '操作规程',
    sections: [],  // 结构化数据
    isStructured: false,
    plainText: ''  // 旧版纯文本
  },

  onLoad(options) {
    console.log('procedure页面参数:', options)

    if (options.deviceName) {
      this.setData({ deviceName: decodeURIComponent(options.deviceName) })
    }

    if (options.title) {
      this.setData({ pageTitle: decodeURIComponent(options.title) })
    }

    if (options.content) {
      let content = decodeURIComponent(options.content)

      // 判断是否是结构化数据
      if (options.type === 'structured') {
        try {
          const structuredData = JSON.parse(content)
          this.setData({
            sections: structuredData.sections || [],
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