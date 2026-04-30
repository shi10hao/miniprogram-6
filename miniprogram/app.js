// app.js
const CLOUD_ENV = ''

App({
  onLaunch: function() {
    this.initCloud()
  },

  initCloud: function() {
    try {
      const cloudConfig = {
        traceUser: true
      }
      if (CLOUD_ENV) {
        cloudConfig.env = CLOUD_ENV
      }

      wx.cloud.init(cloudConfig)
      console.log('云开发初始化成功')
    } catch (err) {
      console.error('云开发初始化失败:', err)
    }
  },

  refreshMessageBadge: function() {
    var userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo.userId) {
      wx.removeTabBarBadge({ index: 2 })
      return
    }

    var db = wx.cloud.database()
    var _ = db.command
    db.collection('messages')
      .where({
        user_id: userInfo.userId,
        is_read: _.neq(true)
      })
      .count()
      .then(function(res) {
        var total = res.total || 0
        if (total > 0) {
          wx.setTabBarBadge({ index: 2, text: String(total) })
        } else {
          wx.removeTabBarBadge({ index: 2 })
        }
      })
      .catch(function(err) {
        console.error('刷新消息红点失败:', err)
      })
  },

  globalData: {
    userInfo: null
  }
})
