Page({
  data: {
    version: '1.3.2',
    edition: '测试版',
    college: '安徽大学资源与环境工程学院'
  },
  onLoad() {
    // 页面加载时可以在这里添加逻辑
  },

  // 纯静态页面没有远端数据，下拉直接收起刷新动画（全局开启了 enablePullDownRefresh）
  onPullDownRefresh() {
    wx.stopPullDownRefresh()
  }
})
