Page({
  data: {
    activeTab: 0,        // 0 待审批 / 1 已通过 / 2 已拒绝
    list: [],
    isLoading: false,
    emptyText: '暂无待审批的申请',
    pendingCount: 0,

    // 拒绝弹窗
    showRejectModal: false,
    rejectReason: '',
    rejectApplyId: '',
    rejectApplyName: '',
    isSubmitting: false
  },

  onShow() {
    // 每次进入/返回都重新加载当前 Tab
    this.loadList()
  },

  // ==================== Tab 切换 ====================
  switchTab(e) {
    const tab = Number(e.currentTarget.dataset.tab)
    if (tab === this.data.activeTab) return
    const emptyMap = ['暂无待审批的申请', '暂无已通过的申请', '暂无已拒绝的申请']
    this.setData({
      activeTab: tab,
      list: [],
      emptyText: emptyMap[tab]
    })
    this.loadList()
  },

  // ==================== 加载列表 ====================
  async loadList() {
    const tab = this.data.activeTab
    const statusMap = ['pending', 'approved', 'rejected']
    const status = statusMap[tab]

    this.setData({ isLoading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'getCollectionData',
        data: {
          collectionName: 'user_apply',
          whereCondition: { status: status },
          sortField: 'create_time',
          pageSize: 100
        }
      })

      if (res.result.code !== 0) {
        throw new Error(res.result.message || '加载失败')
      }

      const raw = res.result.data || []
      const list = raw.map(item => ({
        ...item,
        statusText: this.getStatusText(item.status),
        timeDisplay: this.formatTime(item.create_time)
      }))

      const updateData = { list: list, isLoading: false }
      // 待审批 Tab 时同时更新红点数量
      if (status === 'pending') {
        updateData.pendingCount = list.length
      }
      this.setData(updateData)
    } catch (err) {
      console.error('加载申请列表失败:', err)
      this.setData({ isLoading: false })
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
  },

  getStatusText(status) {
    if (status === 'pending') return '待审批'
    if (status === 'approved') return '已通过'
    if (status === 'rejected') return '已拒绝'
    return status
  },

  // ==================== 时间格式化 ====================
  formatTime(input) {
    if (!input) return ''
    let d
    if (input instanceof Date) {
      d = input
    } else if (typeof input === 'number') {
      d = new Date(input)
    } else {
      d = new Date(input)
    }
    if (isNaN(d.getTime())) return String(input)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  // ==================== 同意 ====================
  async onApprove(e) {
    if (this.data.isSubmitting) return
    const { id } = e.currentTarget.dataset

    this.setData({ isSubmitting: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'reviewUserApply',
        data: { applyId: id, action: 'approve' }
      })

      if (res.result.code !== 0) {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
        return
      }

      wx.showToast({ title: '已通过', icon: 'success' })
      this.loadList()
    } catch (err) {
      console.error('同意操作失败:', err)
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSubmitting: false })
    }
  },

  // ==================== 拒绝 ====================
  onReject(e) {
    const { id, name } = e.currentTarget.dataset
    this.setData({
      showRejectModal: true,
      rejectReason: '',
      rejectApplyId: id,
      rejectApplyName: name
    })
  },

  onRejectReasonInput(e) {
    this.setData({ rejectReason: e.detail.value })
  },

  cancelReject() {
    this.setData({
      showRejectModal: false,
      rejectReason: '',
      rejectApplyId: '',
      rejectApplyName: ''
    })
  },

  async confirmReject() {
    if (this.data.isSubmitting) return

    const reason = this.data.rejectReason.trim()
    if (!reason) {
      wx.showToast({ title: '请填写拒绝理由', icon: 'none' })
      return
    }
    if (reason.length > 20) {
      wx.showToast({ title: '拒绝理由不能超过20字', icon: 'none' })
      return
    }

    this.setData({ isSubmitting: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'reviewUserApply',
        data: {
          applyId: this.data.rejectApplyId,
          action: 'reject',
          rejectReason: reason
        }
      })

      if (res.result.code !== 0) {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
        return
      }

      wx.showToast({ title: '已拒绝', icon: 'success' })
      this.setData({ showRejectModal: false })
      this.loadList()
    } catch (err) {
      console.error('拒绝操作失败:', err)
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isSubmitting: false })
    }
  }
})