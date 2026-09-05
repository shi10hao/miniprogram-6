Page({
  data:{
    deviceName:"",
    isLoading:false,
    btnLoading:false,
    userList:[],
    lastCursor:null,   //传给云函数的游标
    hasMore:true
  },

  onLoad(options){
    const name = decodeURIComponent(options.deviceName || "")
    this.setData({
      deviceName: name,
      userList:[],
      lastCursor:null,
      hasMore:true
    })
    this.loadFirstPage()
  },

  //下拉刷新：重置全部状态，加载第一页
  onPullDownRefresh(){
    this.setData({
      userList:[],
      lastCursor:null,
      hasMore:true
    })
    this.loadFirstPage().finally(()=>{
      wx.stopPullDownRefresh()
    })
  },

  //时间格式化 ISO -> YYYY‑MM‑DD HH:mm
  formatIsoTime(isoStr){
    if(!isoStr) return ""
    const d = new Date(isoStr)
    const y = d.getFullYear()
    const m = String(d.getMonth()+1).padStart(2,"0")
    const day = String(d.getDate()).padStart(2,"0")
    const h = String(d.getHours()).padStart(2,"0")
    const mi = String(d.getMinutes()).padStart(2,"0")
    return `${y}-${m}-${day} ${h}:${mi}`
  },

  //首次加载第一页
  loadFirstPage(){
    const { deviceName } = this.data
    if(!deviceName) return Promise.resolve()
    this.setData({ isLoading:true })
    return wx.cloud.callFunction({
      name:"getDeviceUserList",
      data:{
        deviceName,
        cursor:null,
        pageSize:10
      }
    }).then(res=>{
      const { data, nextCursor, finished } = res.result
      const list = data.map(item=>{
        return {
          ...item,
          fmtTime: this.formatIsoTime(item.start_time)
        }
      })
      this.setData({
        userList: list,
        lastCursor: nextCursor,
        hasMore: !finished
      })
    }).catch(err=>{
      console.error("加载使用者列表失败",err)
      wx.showToast({ title:"加载使用者列表失败", icon:"none" })
    }).finally(()=>{
      this.setData({ isLoading:false })
    })
  },

  //点击加载更多
  loadMore(){
    const { deviceName, lastCursor, hasMore } = this.data
    if(!hasMore || !lastCursor) return
    this.setData({ btnLoading:true })
    wx.cloud.callFunction({
      name:"getDeviceUserList",
      data:{
        deviceName,
        cursor:lastCursor,
        pageSize:10
      }
    }).then(res=>{
      const { data, nextCursor, finished } = res.result
      const appendList = data.map(item=>{
        return {
          ...item,
          fmtTime: this.formatIsoTime(item.start_time)
        }
      })
      this.setData({
        userList: [...this.data.userList, ...appendList],
        lastCursor: nextCursor,
        hasMore: !finished
      })
    }).catch(err=>{
      console.error("加载更多失败",err)
      wx.showToast({ title:"加载更多失败", icon:"none" })
    }).finally(()=>{
      this.setData({ btnLoading:false })
    })
  }
})