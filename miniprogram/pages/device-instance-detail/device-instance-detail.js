const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    deviceId: '',
    deviceInstanceInfo: {},
    deviceUsages: [],
    deviceReserves: [],
    timelineItems: [],        // ← 原来是 timelineItems，少了 : []
    todayStats: {             // ← 原来是 todayStats，少了完整定义
      usageDuration: '',
      idleDuration: '',
      usageRate: ''
    },

    isLoading: false,
    sectionCollapsed: {
      timeline: false // false = 展开，true = 收起
    }
  },

  onLoad(options) {
    const deviceId = options.deviceId
    this.loadData(deviceId)
  },

  async loadData(deviceId) {
    const deviceInstanceInfo = await this.getDeviceInstanceInfo(deviceId)
    const deviceUsages = await this.getDeviceUsages(deviceId)
    const deviceReserves = await this.getDeviceReserves(deviceId)
    const timeline = this.buildTimeline(deviceUsages, deviceReserves)

    this.setData({
      deviceInstanceInfo,
      deviceUsages,
      deviceReserves,
      timelineItems: timeline.items,
      todayStats: timeline.stats
    })
  },

  async getDeviceInstanceInfo(deviceId) {
    if (!deviceId) return
    try {
      const res = await db.collection('devices')
        .where({
          device_id: deviceId
        })
        .limit(1)
        .get()
      const device = (res.data || [])[0]
      if (!device) {
        console.log("未找到该仪器")
        return null
      }
      return {
        device_name: device.device_name || '',
        device_id: device.device_id || '',
        lab_name: device.lab_name || '',
        device_room: device.device_room || '',
        displayStatus: device.status || 'available'
      }
    } catch (err) {
      console.log("获取仪器信息报错", err)
      return null
    }
  },
  async getDeviceUsages(deviceId) {
    if (!deviceId) return []
    try {
      const res = await db.collection('device_usage')
        .where({
          device_id: deviceId
        })
        .orderBy('start_time', 'desc')
        .limit(20)
        .get()

      return res.data || []
    } catch (err) {
      console.log("获取使用记录报错", err)
      return []
    }
  },
  async getDeviceReserves(deviceId) {
    if (!deviceId) return []
    try {
      const res = await db.collection('reserves')
        .where({
          device_id: deviceId,
          status: 'approved'
        })
        .orderBy('start_time', 'asc')
        .limit(20)
        .get()

      return res.data || []
    } catch (err) {
      console.log("获取预约记录报错", err)
      return []
    }
  },
  buildTimeline(usages, reserves) {
    // 1. 获取今天的日期字符串（用于筛选）
    const today = new Date()
    const pad = n => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    // 2. 从 usages 中筛选出今天的记录，标记为 type: 'usage'
    const todayUsages = (usages || []).filter(u => {
      const date = this.parseDateTime(u.start_time)
      if (!date) return false
      const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      return dateStr === todayStr
    }).map(u => ({
      type: 'usage',
      time: this.getTimeValue(u.start_time),
      endTime: this.getTimeValue(u.end_time) || Date.now(),
      userName: u.student_name || u.user_id || '未知用户',
      duration: '', // 后面再算
      abnormal: u.status === 'abnormal',
      raw: u
    }))
    // 3. 从 reserves 中筛选出今天的记录，标记为 type: 'reserve'
    // 3. 从 reserves 中筛选出今天的记录，标记为 type: 'reserve'
    const todayReserves = (reserves || []).filter(r => {
      // 只保留还未结束的预约
      return r.reserve_date === todayStr && this.getTimeValue(r.end_time) > Date.now()
    }).map(r => ({
      type: 'reserve',
      time: this.getTimeValue(r.start_time),
      endTime: this.getTimeValue(r.end_time),
      userName: r.student_name || r.user_id || '未知用户',
      duration: '',
      abnormal: false,
      raw: r
    }))
    // 4. 将所有事件合并到一个数组，按开始时间排序
    const events = [...todayUsages, ...todayReserves]
    events.sort((a, b) => a.time - b.time)
    // 5. 遍历事件数组，在事件之间插入空闲时段（type: 'idle'）
    // 5. 遍历事件数组，在事件之间插入空闲时段（type: 'idle'）
    const items = []
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0, 0).getTime()
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 22, 0, 0).getTime()
    let cursor = dayStart

    events.forEach(event => {
      // 如果当前事件开始时间晚于游标，插入空闲段
      if (event.time > cursor) {
        items.push({
          type: 'idle',
          timeRange: `${this.formatTime(cursor)} - ${this.formatTime(event.time)}`,
          duration: this.calcDuration(cursor, event.time)
        })
      }

      // 添加事件本身
      items.push({
        type: event.type,
        timeRange: `${this.formatTime(event.time)} - ${this.formatTime(event.endTime)}`,
        userName: event.userName,
        duration: event.duration || this.calcDuration(event.time, event.endTime),
        abnormal: event.abnormal
      })

      cursor = Math.max(cursor, event.endTime)
    })

    // 最后一段空闲（到晚上10点）
    if (cursor < dayEnd) {
      items.push({
        type: 'idle',
        timeRange: `${this.formatTime(cursor)} - ${this.formatTime(dayEnd)}`,
        duration: this.calcDuration(cursor, dayEnd)
      })
    }
    // 6. 计算今日统计（使用时长、空闲时长、利用率）
    // 6. 计算今日统计（使用时长、空闲时长、利用率）
    let usageMs = 0
    let idleMs = 0
    items.forEach(item => {
      if (item.type === 'usage' || item.type === 'reserve') {
        usageMs += this.parseDurationToMs(item.duration)
      } else if (item.type === 'idle') {
        idleMs += this.parseDurationToMs(item.duration)
      }
    })
    const totalMs = usageMs + idleMs
    const usageRate = totalMs > 0 ? Math.round(usageMs / totalMs * 100) + '%' : '0%'
    // 7. 返回 { items: 时间轴数组, stats: 统计对象 }
    // 7. 返回 { items: 时间轴数组, stats: 统计对象 }
    return {
      items,
      stats: {
        usageDuration: this.msToDurationStr(usageMs),
        idleDuration: this.msToDurationStr(idleMs),
        usageRate
      }
    }
  },
  // 点击切换
  toggleSection(e) {
    const section = e.currentTarget.dataset.section
    const key = `sectionCollapsed.${section}`
    this.setData({
      [key]: !this.data.sectionCollapsed[section]
    })
  },
  parseDateTime(rawValue) {
    if (!rawValue) return null
    if (rawValue instanceof Date) return rawValue
    const d = new Date(rawValue)
    return Number.isNaN(d.getTime()) ? null : d
  },
  getTimeValue(rawValue) {
    const d = this.parseDateTime(rawValue)
    return d ? d.getTime() : 0
  },
  formatTime(timestamp) {
    const d = new Date(timestamp)
    const pad = n => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  },
  calcDuration(start, end) {
    const diff = Math.floor((end - start) / 60000)
    if (diff <= 0) return '不足1分钟'
    if (diff < 60) return `${diff}分钟`
    const hours = Math.floor(diff / 60)
    const mins = diff % 60
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`
  },
  parseDurationToMs(durationStr) {
    if (!durationStr) return 0
    let totalMin = 0
    const hourMatch = durationStr.match(/(\d+)小时/)
    const minMatch = durationStr.match(/(\d+)分钟/)
    if (hourMatch) totalMin += parseInt(hourMatch[1]) * 60
    if (minMatch) totalMin += parseInt(minMatch[1])
    return totalMin * 60 * 1000
  },
  msToDurationStr(ms) {
    const totalMin = Math.floor(ms / 60000)
    if (totalMin <= 0) return '不足1分钟'
    if (totalMin < 60) return `${totalMin}分钟`
    const hours = Math.floor(totalMin / 60)
    const mins = totalMin % 60
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`
  }
})