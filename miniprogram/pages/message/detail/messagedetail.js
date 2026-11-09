const db = wx.cloud.database()
const {
  normalizeMessage,
  normalizeNotice,
  getEmptyState
} = require('./detailModel')

// 公告里的「协作文档」是腾讯文档链接，点按钮跳到腾讯文档小程序；
// 跳不过去就复制链接兜底（与合并前的 noticedetail 行为一致）
const TENCENT_DOC_APPID = 'wxd45c635d754dbf59'
const TENCENT_DOC_PAGE = 'pages/detail/detail?url='

Page({
  data: {
    detail: null,
    isLoading: true,
    source: 'message',
    emptyTitle: '消息不存在',
    emptyDesc: '该消息可能已被删除或无法访问'
  },

  onLoad(options) {
    // 消息与公告共用本页：列表统一传 messageId + source；
    // 旧公告入口的 noticeId 也认，避免历史跳转失效
    const source = options.source === 'notice' || options.noticeId ? 'notice' : 'message'
    const detailId = options.messageId || options.noticeId || ''
    const emptyState = getEmptyState(source)
    // 下拉刷新要重新拉同一个 id，onLoad 的参数不会再来一次，先记在实例上
    this._detailId = detailId

    this.setData({
      source,
      emptyTitle: emptyState.title,
      emptyDesc: emptyState.desc
    })

    wx.setNavigationBarTitle({
      title: source === 'notice' ? '公告详情' : '消息详情'
    })

    if (!detailId) {
      this.setData({ isLoading: false })
      wx.showToast({
        title: source === 'notice' ? '缺少公告ID' : '参数错误',
        icon: 'none'
      })
      return
    }

    this.getDetail(detailId, source)
  },

  // 下拉刷新：用 onLoad 记下的 id 重新拉一次详情
  onPullDownRefresh() {
    if (!this._detailId) {
      wx.stopPullDownRefresh()
      return
    }

    this.getDetail(this._detailId, this.data.source).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  getDetail(detailId, source) {
    this.setData({ isLoading: true })

    const request = source === 'notice'
      ? this.getNoticeDetail(detailId)
      : this.getUserMessageDetail(detailId)

    return request
      .then((detail) => {
        this.setData({
          detail,
          isLoading: false
        })
        return detail
      })
      .catch((err) => {
        console.error('获取消息详情失败:', err)
        this.setData({
          detail: null,
          isLoading: false
        })

        const reason = err && err.message
        if (reason === 'missing_user') {
          wx.showToast({ title: '请先完成登录', icon: 'none' })
        } else if (reason === 'message_not_found' || reason === 'notice_not_found') {
          wx.showToast({ title: this.data.emptyTitle, icon: 'none' })
        } else {
          wx.showToast({ title: '加载失败，请重试', icon: 'none' })
        }
        return null
      })
  },

  getUserMessageDetail(messageId) {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      return Promise.reject(new Error('missing_user'))
    }

    return db.collection('messages')
      .where({
        _id: messageId,
        user_id: userInfo.userId
      })
      .limit(1)
      .get()
      .then((res) => {
        const item = res.data && res.data.length > 0 ? res.data[0] : null
        if (!item) {
          throw new Error('message_not_found')
        }

        const detail = normalizeMessage(item)
        return this.markMessageAsRead(messageId, userInfo.userId).then((marked) => {
          if (marked) {
            detail.is_read = true
          }
          return detail
        })
      })
  },

  // 公告按唯一标识取即可，不再附加 type 过滤：
  // 合并前的 noticedetail 就没有这个限制，避免历史公告数据查不到
  getNoticeDetail(noticeId) {
    return db.collection('notice')
      .where({
        notice_id: noticeId
      })
      .limit(1)
      .get()
      .then((res) => {
        if (res.data && res.data.length > 0) {
          return normalizeNotice(res.data[0])
        }

        return db.collection('notice')
          .where({
            _id: noticeId
          })
          .limit(1)
          .get()
          .then((docRes) => {
            const item = docRes.data && docRes.data.length > 0 ? docRes.data[0] : null
            if (!item) {
              throw new Error('notice_not_found')
            }
            return normalizeNotice(item)
          })
      })
  },

  markMessageAsRead(messageId, userId) {
    const _ = db.command
    return db.collection('messages')
      .where({
        _id: messageId,
        user_id: userId,
        is_read: _.neq(true)
      })
      .update({
        data: {
          is_read: true,
          read_time: new Date().toISOString()
        }
      })
      .then(updateRes => !!(updateRes.stats && updateRes.stats.updated > 0))
      .catch((err) => {
        console.error('详情页标记已读失败:', err)
        return false
      })
  },

  // 打开协作文档（跳腾讯文档小程序，失败则复制链接）
  openDoc() {
    const url = this.data.detail && this.data.detail.doc_url
    if (!url) return

    wx.navigateToMiniProgram({
      appId: TENCENT_DOC_APPID,
      path: TENCENT_DOC_PAGE + encodeURIComponent(url),
      fail: () => {
        // 兜底：复制链接到剪贴板
        wx.setClipboardData({
          data: url,
          success: () => {
            wx.showToast({
              title: '链接已复制，去微信粘贴打开',
              icon: 'none'
            })
          },
          fail: () => {
            wx.showToast({
              title: '打开失败，请重试',
              icon: 'none'
            })
          }
        })
      }
    })
  }
})
