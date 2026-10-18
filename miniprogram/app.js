// app.js
const CLOUD_ENV = 'cloud1-d2g3kx3un05924a95'

App({
  onLaunch() {
    this.initCloud()
  },

  initCloud() {
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

  // 消息红点：多个 tab 页 onShow 都会调用，加 60 秒节流，避免重复 count 查询
  refreshMessageBadge() {
    const now = Date.now()
    if (this._badgeRefreshedAt && (now - this._badgeRefreshedAt) < 60000) {
      return
    }
    this._badgeRefreshedAt = now

    const userInfo = wx.getStorageSync('userInfo')
    if (!userInfo || !userInfo.userId) {
      this._lastBadgeTotal = 0
      wx.removeTabBarBadge({ index: 2 })
      return
    }

    const that = this
    const db = wx.cloud.database()
    const _ = db.command
    db.collection('messages')
      .where({
        user_id: userInfo.userId,
        is_read: _.neq(true)
      })
      .count()
      .then(function (res) {
        const total = res.total || 0
        if (total === that._lastBadgeTotal) {
          return
        }
        that._lastBadgeTotal = total
        if (total > 0) {
          wx.setTabBarBadge({ index: 2, text: String(total) })
        } else {
          wx.removeTabBarBadge({ index: 2 })
        }
      })
      .catch(function (err) {
        console.error('刷新消息红点失败:', err)
      })
  },

  globalData: {
    userInfo: null
  }
})
