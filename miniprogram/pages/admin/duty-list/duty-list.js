// pages/admin/duty-list/dutylist.js

const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    dutyRecords: [],       // 卫生记录列表
    isLoadingDuty: false,  // 加载状态
    dutyPage: 1,           // 当前页码
    dutyPageSize: 20,      // 每页条数
    hasMoreDuty: true      // 是否还有更多
  },

  // ==================== 生命周期 ====================

  onLoad: function () {
    this.loadDutyRecords()
  },

  // 下拉刷新
  onPullDownRefresh: function () {
    this.loadDutyRecords()
    wx.stopPullDownRefresh()
  },

  // ==================== 数据加载 ====================

  /** 加载第一页 */
  loadDutyRecords: function () {
    var self = this
    self.setData({
      isLoadingDuty: true,
      dutyPage: 1
    })

    wx.cloud.callFunction({
      name: 'getCollectionData',
      data: {
        collectionName: 'duty_records',
        whereCondition: {},
        pageSize: self.data.dutyPageSize,
        startSkip: 0,
        sortField: 'submit_time'
      }
    }).then(function (res) {
      console.log("res1:",res)
      if (res.result.code !== 0) throw new Error(res.result.message)
      return self.resolveDutyImages(res.result.data).then(function (formatted) {
        self.setData({
          dutyRecords: formatted,
          hasMoreDuty: res.result.data.length === self.data.dutyPageSize,
          isLoadingDuty: false
        })
      })
    }).catch(function (err) {
      console.error('加载卫生记录失败:', err)
      self.setData({ isLoadingDuty: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  },

  /** 加载更多 */
  loadMoreDuty: function () {
    var self = this
    if (self.data.isLoadingDuty || !self.data.hasMoreDuty) return
    self.setData({ isLoadingDuty: true })
    var nextPage = self.data.dutyPage + 1
    var skip = (nextPage - 1) * self.data.dutyPageSize

    wx.cloud.callFunction({
      name: 'getCollectionData',
      data: {
        collectionName: 'duty_records',
        whereCondition: {},
        pageSize: self.data.dutyPageSize,
        startSkip: skip,
        sortField: 'submit_time'
      }
    }).then(function (res) {
      if (res.result.code !== 0) throw new Error(res.result.message)
      return self.resolveDutyImages(res.result.data).then(function (newRecords) {
        self.setData({
          dutyRecords: self.data.dutyRecords.concat(newRecords),
          dutyPage: nextPage,
          hasMoreDuty: newRecords.length === self.data.dutyPageSize,
          isLoadingDuty: false
        })
      })
    }).catch(function (err) {
      console.error('加载更多失败:', err)
      self.setData({ isLoadingDuty: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  },

  // ==================== 图片处理 ====================

  /**
   * 解析 fileID → 临时访问链接
   * 收集所有 fileID → 调用 getBatchTempUrl → 映射回记录
   */
  resolveDutyImages: function (records) {
    var self = this
    return new Promise(function (resolve) {
      if (!records || records.length === 0) {
        resolve([])
        return
      }

      // 收集所有 fileID
      var allFileIds = []
      for (var i = 0; i < records.length; i++) {
        if (records[i].images && records[i].images.length) {
          for (var j = 0; j < records[i].images.length; j++) {
            allFileIds.push(records[i].images[j])
          }
        }
      }

      // 去重
      var dedupIds = []
      for (var k = 0; k < allFileIds.length; k++) {
        if (allFileIds[k] && dedupIds.indexOf(allFileIds[k]) === -1) {
          dedupIds.push(allFileIds[k])
        }
      }

      if (dedupIds.length === 0) {
        var result = []
        for (var m = 0; m < records.length; m++) {
          result.push({
            ...records[m],
            imageUrls: [],
            submit_time_display: self.formatTime(records[m].submit_time)
          })
        }
        resolve(result)
        return
      }

      // 批量换取临时链接
      wx.cloud.callFunction({
        name: 'getBatchTempUrl',
        data: { fileList: dedupIds }
      }).then(function (res) {
        var map = {}
        for (var f = 0; f < res.result.length; f++) {
          map[res.result[f].fileID] = res.result[f].tempFileURL || ''
        }

        var formatted = []
        for (var r = 0; r < records.length; r++) {
          var item = records[r]
          var urls = []
          if (item.images) {
            for (var u = 0; u < item.images.length; u++) {
              var url = map[item.images[u]] || ''
              if (url) urls.push(url)
            }
          }
          formatted.push({
            ...item,
            submit_time_display: self.formatTime(item.submit_time),
            imageUrls: urls
          })
        }
        resolve(formatted)
      })
    })
  },

  // ==================== 工具方法 ====================

  /** 格式化时间 "YYYY-MM-DD HH:mm" */
  formatTime: function (isoStr) {
    if (!isoStr) return ''
    var d = new Date(isoStr)
    if (isNaN(d.getTime())) return String(isoStr)
    var pad = function (n) { return String(n).padStart(2, '0') }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  },

  // ==================== 交互 ====================

  /** 预览图片 */
  previewImage: function (e) {
    var src = e.currentTarget.dataset.src
    var list = e.currentTarget.dataset.list
    wx.previewImage({
      current: src,
      urls: list
    })
  }
})