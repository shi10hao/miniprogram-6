Page({
  data: {
    functionList: [
      {
        id: 1,
        name: '仪器预约',
        desc: '预约实验室仪器设备',
        icon: '📅',
        url: '/pages/reservation/reservation',
        color: '#62BCC4'
      },
      {
        id: 2,
        name: '仪器使用',
        desc: '开始使用仪器设备',
        icon: '🔧',
        url: '/pages/usage/usage',
        color: '#07c160'
      },
      {
        id: 3,
        name: '我的预约',
        desc: '查看预约记录',
        icon: '📋',
        url: '/pages/appointment/appointment',
        color: '#ffc107'
      }
    ]
  },

  onLoad: function() {
    console.log('应用页面加载')
  },

  onShow: function() {
    getApp().refreshMessageBadge()
  },

  // 跳转到功能页面
  navigateToFunction: function(e) {
    const url = e.currentTarget.dataset.url
    if (url) {
      wx.navigateTo({
        url: url
      })
    }
  },

  // 跳转到仪器列表
  navigateToDeviceList: function() {
    wx.navigateTo({
      url: '/pages/device/list/devicelist'
    })
  }
})