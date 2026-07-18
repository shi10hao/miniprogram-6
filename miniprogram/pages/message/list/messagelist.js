const db = wx.cloud.database()

const TYPE_LABELS = {
  reservation_success: '预约成功',
  reservation_remind: '预约提醒',
  usage_photo_remind: '照片提醒',
  usage_end_remind: '结束提醒',
  admin_notice: '管理员公告'
}
const PAGE_SIZE = 20

Page({
  data: {
    messageList: [],
    isLoading: true,
    isLoadingMore: false,
    unreadCount: 0,
    totalCount: 0, // 总消息数（含公告）
    hasMore: true, // 是否还有更多
    page: 0, // 当前页码
    allLoaded: false // 是否全部加载完毕
  },

  onLoad() {
    this.getMessageList(true)
  },

  onShow() {
    // 如果已经加载过数据，不再重新拉取（避免闪烁）
    if (this.data.messageList.length === 0) {
      this.getMessageList(true)
    }
  },

  getMessageList(isFirstLoad = false) {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) {
      this.setData({
        isLoading: false,
        messageList: [],
        unreadCount: 0,
        totalCount: 0,
        hasMore: false
      })
      this.updateTabBarBadge(0)
      return Promise.resolve([])
    }
    if (isFirstLoad) {
      this.setData({
        isLoading: true,
        page: 0,
        messageList: [],
        allLoaded: false
      })
    } else {
      this.setData({
        isLoadingMore: true
      })
    }
    const page = this.data.page

    const messagePromise = this.fetchPage('messages', {
      where: {
        user_id: userInfo.userId
      },
      orderByField: 'create_time',
      page: page,
      pageSize: PAGE_SIZE
    })
    const noticePromise = this.fetchPage('notice', {
      where: {
        type: 'admin'
      },
      orderByField: 'publish_date',
      page: page,
      pageSize: PAGE_SIZE
    })
    // 查询数据库中该用户的所有消息总数
    const totalCountPromise = db.collection('messages')
      .where({
        user_id: userInfo.userId
      })
      .count()
      .then(res => res.total || 0)
    // ===== 新增：查询数据库中该用户的真实未读数 =====
    const unreadCountPromise = db.collection('messages')
      .where({
        user_id: userInfo.userId,
        is_read: false
      })
      .count()
      .then(res => res.total || 0)

    return Promise.allSettled([messagePromise, noticePromise, totalCountPromise, unreadCountPromise])
      .then(results => {
        const messageRows = results[0].status === 'fulfilled' ? (results[0].value?.data || []) : []
        const noticeRows = results[1].status === 'fulfilled' ? (results[1].value?.data || []) : []
        const messageHasMore = results[0].status === 'fulfilled' ? (results[0].value?.hasMore || false) : false
        const noticeHasMore = results[1].status === 'fulfilled' ? (results[1].value?.hasMore || false) : false

        const dbTotalCount = results[2].status === 'fulfilled' ? (results[2].value || 0) : 0
        const dbUnreadCount = results[3].status === 'fulfilled' ? (results[3].value || 0) : 0
        const normalizedMessages = messageRows.map(item => this.normalizeMessageItem(item))
        const normalizedNotices = noticeRows.map(item => this.normalizeNoticeItem(item))
        const newItems = normalizedMessages.concat(normalizedNotices)
        // ===== 新代码 =====
        const mergedList = isFirstLoad ?
          newItems.sort((a, b) => b.sortTime - a.sortTime) :
          this.data.messageList.concat(newItems).sort((a, b) => b.sortTime - a.sortTime)
        const hasMore = messageHasMore || noticeHasMore
        this.setData({
          messageList: mergedList,
          unreadCount: dbUnreadCount,
          totalCount: isFirstLoad ? dbTotalCount : this.data.totalCount,
          isLoading: false,
          isLoadingMore: false,
          hasMore: hasMore,
          page: isFirstLoad ? 1 : this.data.page + 1,
          allLoaded: !hasMore
        })
        this.updateTabBarBadge(dbUnreadCount)

        return mergedList
      })
      .catch(err => {
        console.error('加载消息列表失败:', err)
        this.setData({
          isLoading: false,
          isLoadingMore: false,
          messageList: [],
          unreadCount: 0,
          totalCount: 0,
          hasMore: false
        })
        this.updateTabBarBadge(0)
        return []
      })
  },
  // ===== 最可靠的方案 =====
  fetchPage(collectionName, options) {
    const {
      where,
      orderByField,
      page,
      pageSize
    } = options
    const skip = page * pageSize

    let query = db.collection(collectionName)
    if (where) query = query.where(where)
    if (orderByField) query = query.orderBy(orderByField, 'desc')

    // 先查总数
    const countPromise = db.collection(collectionName)
      .where(where || {})
      .count()
      .then(res => res.total || 0)

    // 再查当前页数据
    const dataPromise = query
      .skip(skip)
      .limit(pageSize)
      .get()
      .then(res => res.data || [])

    return Promise.all([countPromise, dataPromise])
      .then(([total, rows]) => {
        const hasMore = skip + pageSize < total
        return {
          data: rows,
          hasMore
        }
      })
  },
  // 新增：加载更多
  loadMore() {
    if (this.data.isLoadingMore || this.data.allLoaded) return
    this.getMessageList(false)
  },

  normalizeMessageItem(item) {
    return {
      _id: item._id,
      source: 'message',
      title: item.title || this.getTypeLabel(item.type),
      content: item.content || '',
      preview: this.getPreview(item.type, item.content),
      type: item.type,
      styleType: this.getstyleType(item.type),
      typeLabel: this.getTypeLabel(item.type),
      create_time: this.formatRelativeTime(item.create_time),
      create_time_raw: item.create_time || '',
      sortTime: this.getTimeValue(item.create_time),
      is_read: !!item.is_read,
      canDelete: true
    }
  },

  normalizeNoticeItem(item) {
    const rawTime = item.publish_date || item.create_time || ''
    return {
      _id: item.notice_id || item._id,
      source: 'notice',
      title: item.title || '管理员公告',
      content: item.content || '',
      preview: this.getPreview('admin_notice', item.content),
      type: 'admin_notice',
      styleType: 'system',
      typeLabel: this.getTypeLabel('admin_notice'),
      create_time: this.formatRelativeTime(rawTime),
      create_time_raw: rawTime,
      sortTime: this.getTimeValue(rawTime),
      is_read: true,
      canDelete: false
    }
  },

  getstyleType(type) {
    if (type === 'reservation_success' || type === 'reservation_remind') return 'reservation'
    if (type === 'usage_photo_remind' || type === 'usage_end_remind') return 'usage'
    return 'system'
  },

  getTypeLabel(type) {
    return TYPE_LABELS[type] || '系统消息'
  },

  getPreview(type, content) {
    if (type === 'usage_photo_remind' || type === 'usage_end_remind') {
      return '请前往“仪器使用”页的“上传照片板块”完成照片上传。'
    }
    return this.truncateText(content || '', 48)
  },

  formatRelativeTime(value) {
    const time = this.getTimeValue(value)
    if (!time) return '未知时间'

    const now = Date.now()
    const diff = now - time
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.max(1, Math.floor(diff / (60 * 1000)))
      return `${minutes}分钟前`
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000))
      return `${hours}小时前`
    }

    const date = new Date(time)
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  },

  getTimeValue(value) {
    if (!value) return 0
    const text = String(value)
    const normalized = text
      .replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/, '$1 $2')
      .replace(' ', 'T')
    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? 0 : date.getTime()
  },

  viewMessageDetail(e) {
    const messageId = e.currentTarget.dataset.messageid
    const source = e.currentTarget.dataset.source || 'message'

    wx.navigateTo({
      url: `/pages/message/detail/messagedetail?messageId=${encodeURIComponent(messageId)}&source=${source}`
    })
  },

  markAllAsRead() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) return

    wx.showLoading({
      title: '处理中...'
    })

    wx.cloud.callFunction({
        name: 'batchMarkRead',
        data: {
          userId: userInfo.userId
        }
      })
      .then(res => {
        wx.hideLoading()
        const result = res.result || {}
        console.log("res:", res)
        console.log("result:", result)
        console.log('批量标记已读完成，共更新', result.updated, '条')
        // 直接更新本地数据
        const updatedList = this.data.messageList.map(item => {
          if (item.source === 'message' && !item.is_read) {
            return {
              ...item,
              is_read: true
            }
          }
          return item
        })
        this.setData({
          messageList: updatedList,
          unreadCount: 0
        })
        this.updateTabBarBadge(0)

        wx.showToast({
          title: '已全部标记为已读',
          icon: 'success'
        })
      })
      .catch(err => {
        wx.hideLoading()
        console.error('批量标记已读失败:', err)
        wx.showToast({
          title: '操作失败，请重试',
          icon: 'none'
        })
      })
  },
  deleteMessage(e) {
    const messageId = e.currentTarget.dataset.messageid
    const source = e.currentTarget.dataset.source || 'message'
    const userInfo = wx.getStorageSync('userInfo') || {}

    if (source !== 'message') {
      wx.showToast({
        title: '公告消息不支持删除',
        icon: 'none'
      })
      return
    }

    if (!userInfo.userId) {
      wx.showToast({
        title: '请先完成登录',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '删除消息',
      content: '确定要删除这条消息吗？',
      success: res => {
        if (!res.confirm) return

        wx.showLoading({
          title: '删除中...'
        })
        this.removeMessageRecord(messageId, userInfo.userId)
          .then(removeRes => {
            wx.hideLoading()
            if (this.getRemovedCount(removeRes) < 1) {
              wx.showToast({
                title: '消息不存在或无权限',
                icon: 'none'
              })
              return
            }

            wx.showToast({
              title: '删除成功',
              icon: 'success'
            })
            this.getMessageList(true)
          })
          .catch(err => {
            wx.hideLoading()
            console.error('删除消息失败:', err)
            wx.showToast({
              title: '删除失败，请重试',
              icon: 'none'
            })
          })
      }
    })
  },

  removeMessageRecord(messageId, userId) {
    return this.deleteMessageByCloudFunction(messageId, userId)
      .catch(err => {
        if (this.isDeleteCloudFunctionUnavailable(err)) {
          console.warn('deleteMessage cloud function unavailable, fallback to client delete:', err)
          return this.deleteMessageDirectly(messageId, userId)
        }
        throw err
      })
  },

  deleteMessageByCloudFunction(messageId, userId) {
    return wx.cloud.callFunction({
      name: 'deleteMessage',
      data: {
        messageId,
        userId
      }
    }).then(res => {
      const result = res && res.result ? res.result : {}
      if (result.success) {
        return result
      }

      const err = new Error(result.error || 'delete_message_failed')
      err.code = result.code || 'DELETE_MESSAGE_FAILED'
      throw err
    })
  },

  deleteMessageDirectly(messageId, userId) {
    return db.collection('messages')
      .where({
        _id: messageId,
        user_id: userId
      })
      .remove()
  },

  isDeleteCloudFunctionUnavailable(err) {
    const text = String((err && (err.errMsg || err.message || err.code)) || '')
    return text.indexOf('deleteMessage') !== -1 &&
      (text.indexOf('FunctionName') !== -1 ||
        text.indexOf('FUNCTION_NOT_FOUND') !== -1 ||
        text.indexOf('not found') !== -1 ||
        text.indexOf('not exist') !== -1)
  },

  getRemovedCount(removeRes) {
    if (!removeRes) return 0
    if (removeRes.stats && typeof removeRes.stats.removed === 'number') {
      return removeRes.stats.removed
    }
    if (typeof removeRes.removed === 'number') {
      return removeRes.removed
    }
    if (typeof removeRes.deleted === 'number') {
      return removeRes.deleted
    }
    return 0
  },

  updateTabBarBadge(unreadCount) {
    if (unreadCount > 0) {
      wx.setTabBarBadge({
        index: 2,
        text: String(unreadCount)
      })
      return
    }

    wx.removeTabBarBadge({
      index: 2
    })
  },

  truncateText(text, maxLength) {
    const value = String(text || '')
    if (value.length <= maxLength) {
      return value
    }
    return `${value.slice(0, maxLength - 1)}…`
  },

  onPullDownRefresh() {
    this.getMessageList(true).finally(() => { // ← 加 true
      wx.stopPullDownRefresh()
    })
  },

  // 删除所有已读消息（优化版）
  deleteReadMessages() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (!userInfo.userId) return

    wx.showModal({
      title: '删除已读消息',
      content: '确定要删除所有已读消息吗？此操作不可恢复。',
      success: res => {
        if (!res.confirm) return

        wx.showLoading({
          title: '删除中...'
        })

        wx.cloud.callFunction({
            name: 'batchDeleteReadMessages',
            data: {
              userId: userInfo.userId
            }
          })
          .then(res => {
            wx.hideLoading()
            const result = res.result || {}
            const deletedCount = result.deleted || 0

            wx.showToast({
              title: `已删除 ${deletedCount} 条已读消息`,
              icon: 'success'
            })
            this.getMessageList(true) // 重新加载
          })
          .catch(err => {
            wx.hideLoading()
            console.error('删除已读消息失败:', err)
            wx.showToast({
              title: '删除失败，请重试',
              icon: 'none'
            })
          })
      }
    })
  }
})