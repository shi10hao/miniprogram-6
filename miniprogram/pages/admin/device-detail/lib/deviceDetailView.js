/**
 * 管理端仪器详情页的纯逻辑：不碰 wx.*、不碰数据库，可以在 node 里直接断言。
 * 页面只负责取数和 setData，状态判定、排序、时间文案、照片清单都在这里拼好。
 *
 * 这里踩过的坑都留了注释：
 *   - 结束信息里的 sample_count 是字符串时直接渲染会变成「undefined 个」
 *   - 有 end_photos 旧字段的使用记录曾经占满照片名额又被丢掉，实际展示条数莫名变少
 *   - 仪器编号按字符串排序会把 1001 排在 999 前面
 */

const datetime = require('../../../../utils/datetime')

// 仪器状态：key 与数据库 status 对齐，tagClass 直接用 app.wxss 的 ds-tag
const DEVICE_STATUS_META = {
  available: { key: 'available', text: '可用', tagClass: 'ds-tag-success' },
  using: { key: 'using', text: '使用中', tagClass: 'ds-tag-warning' },
  maintenance: { key: 'maintenance', text: '维修中', tagClass: 'ds-tag-danger' },
  unknown: { key: 'unknown', text: '状态未知', tagClass: 'ds-tag-muted' }
}

// 使用记录状态：abnormal 指异常结束（数据库里是 abnormal / 其它非使用中且非完成的值）
const USAGE_STATUS_META = {
  using: { key: 'using', text: '使用中', tagClass: 'ds-tag-warning' },
  completed: { key: 'completed', text: '已完成', tagClass: 'ds-tag-success' },
  abnormal: { key: 'abnormal', text: '异常结束', tagClass: 'ds-tag-danger' }
}

function getDeviceStatusMeta(status) {
  return DEVICE_STATUS_META[status] || DEVICE_STATUS_META.unknown
}

/**
 * 型号：优先 specifications 里的「型号」，其次老数据里的乱码键，
 * 再其次 specifications.model，最后顶层 model。
 */
function getDeviceModel(device) {
  const source = device || {}
  const specs = source.specifications
  if (specs && typeof specs === 'object' && !Array.isArray(specs)) {
    const model = specs['型号'] || specs['鍨嬪彿'] || specs.model || ''
    const text = String(model).trim()
    if (text) return text
  }
  return String(source.model || '').trim()
}

// 同款仪器的分组键：改名、换房间、换型号之后这个键必须跟着重算，否则按旧键查不到自己
function buildGroupKey(device) {
  const source = device || {}
  return [
    String(source.device_name || '').trim(),
    String(source.lab_name || '').trim(),
    String(source.device_room || '').trim(),
    String(source.device_type || '').trim(),
    getDeviceModel(source)
  ].join('||')
}

function chunkArray(list, size) {
  const chunks = []
  const step = Math.max(Number(size) || 1, 1)
  for (let i = 0; i < list.length; i += step) {
    chunks.push(list.slice(i, i + step))
  }
  return chunks
}

function uniqueById(rows) {
  const map = {}
  ;(rows || []).forEach((item) => {
    const key = String((item && item._id) || '')
    if (!key || map[key]) return
    map[key] = item
  })
  return Object.keys(map).map(key => map[key])
}

// 图片字段可能是数组，也可能是被人手填成逗号串的字符串
function normalizeImageList(raw) {
  if (Array.isArray(raw)) {
    return raw.map(item => String(item || '').trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(item => item.trim()).filter(Boolean)
  }
  return []
}

/**
 * 使用记录里所有「能显示出图片」的 fileID。
 * 顺序即展示顺序：开始照片 → 使用照片 → 结束时的预约单/补充预约单 → 老数据 end_photos。
 */
function collectUsagePhotoIds(usage) {
  const source = usage || {}
  const ids = []
  const push = (value) => {
    normalizeImageList(value).forEach((id) => {
      if (ids.indexOf(id) === -1) ids.push(id)
    })
  }

  push(source.start_photo)
  push(source.usage_images)

  const checklist = source.end_checklist
  if (checklist && typeof checklist === 'object') {
    push(checklist.total_page)
    push(checklist.supplement_page)
  }

  // 早期版本把结束照片存在 end_photos 里，不认它就会出现「有照片却被当成没照片」
  const endPhotos = source.end_photos
  if (endPhotos && typeof endPhotos === 'object' && !Array.isArray(endPhotos)) {
    push(endPhotos.duty)
    push(endPhotos.device_off)
    push(endPhotos.door_closed)
  }

  return ids
}

/**
 * 结束信息（仪器/电脑是否关闭、样品数量、是否补充预约）。
 * 数值字段一律兜底成数字：库里存成字符串时 WXML 会渲染出「undefined 个」。
 */
function buildEndChecklistView(checklist) {
  if (!checklist || typeof checklist !== 'object') return null
  const sampleCount = Number(checklist.sample_count)
  const moreSampleCount = Number(checklist.more_sample_count)

  return {
    instrumentOff: checklist.instrument_off === true,
    computerOff: checklist.computer_off === true,
    nextUser: String(checklist.next_user || checklist.nextUser || '').trim(),
    sampleCount: Number.isFinite(sampleCount) ? sampleCount : 0,
    moreSample: checklist.more_sample === true,
    moreSampleCount: Number.isFinite(moreSampleCount) ? moreSampleCount : 0,
    needSupplement: checklist.need_supplement === true,
    totalPageId: String(checklist.total_page || '').trim(),
    supplementPageId: String(checklist.supplement_page || '').trim()
  }
}

// 编号排序：先比数字尾号，避免 DEV-1001 排在 DEV-999 前面；没有数字的按字符串排
function compareDeviceCode(a, b) {
  const left = String(a || '')
  const right = String(b || '')
  const numA = parseInt(left.replace(/\D/g, ''), 10) || 0
  const numB = parseInt(right.replace(/\D/g, ''), 10) || 0
  if (numA !== numB) return numA - numB
  return left.localeCompare(right)
}

function getPersonName(record) {
  const source = record || {}
  return String(source.student_name || source.user_name || source.user_id || '').trim()
}

function getTimestamp(value) {
  const date = datetime.parseDateTime(value)
  return date ? date.getTime() : 0
}

/**
 * 同款仪器的视图：状态、使用人、型号、编号全部算好。
 * 使用中优先于库里写的 maintenance：一台设备正在用的时候不该显示「维修中」。
 */
function buildDeviceViews(devices, usingRecords) {
  const usingMap = {}
  ;(usingRecords || []).forEach((record) => {
    if (!record || !record.device_id) return
    const prev = usingMap[record.device_id]
    if (!prev || getTimestamp(record.start_time) >= getTimestamp(prev.start_time)) {
      usingMap[record.device_id] = record
    }
  })

  const views = (devices || []).map((device) => {
    const source = device || {}
    const deviceId = String(source.device_id || '').trim()
    const usingRecord = deviceId ? usingMap[deviceId] : null
    const rawStatus = String(source.status || '').trim()

    let statusKey = 'available'
    if (usingRecord || rawStatus === 'using') statusKey = 'using'
    else if (rawStatus === 'maintenance') statusKey = 'maintenance'

    const meta = getDeviceStatusMeta(statusKey)
    return {
      docId: String(source._id || ''),
      deviceId,
      name: String(source.device_name || '').trim(),
      room: String(source.device_room || '').trim(),
      labName: String(source.lab_name || '').trim(),
      labType: String(source.lab_type || '').trim(),
      deviceType: String(source.device_type || '').trim(),
      model: getDeviceModel(source),
      description: String(source.description || '').trim(),
      rawStatus,
      statusKey: meta.key,
      statusText: meta.text,
      tagClass: meta.tagClass,
      isUsing: statusKey === 'using',
      usingUser: getPersonName(usingRecord)
    }
  })

  return views.sort((a, b) => compareDeviceCode(a.deviceId || '未编号', b.deviceId || '未编号'))
}

/** 顶部概览：几个数字 + 一句状态徽标文案 */
function summarizeDevices(deviceViews) {
  const list = deviceViews || []
  const summary = {
    total: list.length,
    available: 0,
    using: 0,
    maintenance: 0
  }

  list.forEach((item) => {
    if (item.statusKey === 'using') summary.using += 1
    else if (item.statusKey === 'maintenance') summary.maintenance += 1
    else summary.available += 1
  })

  if (!summary.total) {
    summary.statusKey = 'none'
    summary.statusText = '暂无实例'
  } else if (summary.using > 0) {
    summary.statusKey = 'using'
    summary.statusText = `${summary.using} 台使用中`
  } else if (summary.available === 0) {
    summary.statusKey = 'maintenance'
    summary.statusText = '全部维修中'
  } else {
    summary.statusKey = 'available'
    summary.statusText = `${summary.available} 台可用`
  }

  return summary
}

/**
 * 即将到来的预约：已到开始时间但还没开始使用的排前面并标红，
 * 时间用 datetime 统一成「2026-11-08 / 09:00 - 10:30」，不把 ISO 原始串丢给用户。
 */
function buildReserveViews(reserves, now) {
  const nowTs = Number(now) || Date.now()
  const views = (reserves || []).map((reserve) => {
    const source = reserve || {}
    const range = datetime.formatTimeRange(source.start_time, source.end_time)
    const startTs = getTimestamp(source.start_time)
    const overdue = startTs > 0 && nowTs >= startTs

    return {
      docId: String(source._id || ''),
      deviceId: String(source.device_id || ''),
      studentName: getPersonName(source),
      dateDisplay: range.dateDisplay || String(source.reserve_date || ''),
      timeDisplay: range.timeDisplay,
      startTs,
      statusKey: overdue ? 'overdue' : 'upcoming',
      statusText: overdue ? '待开始' : '即将到来',
      tagClass: overdue ? 'ds-tag-warning' : 'ds-tag-primary'
    }
  })

  return views.sort((a, b) => {
    if (a.statusKey === 'overdue' && b.statusKey !== 'overdue') return -1
    if (a.statusKey !== 'overdue' && b.statusKey === 'overdue') return 1
    return a.startTs - b.startTs
  })
}

function formatDurationText(durationMs) {
  const diff = Number(durationMs) || 0
  if (diff < 60 * 1000) return '不足 1 分钟'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

/** 正在使用的记录：给出「已使用 1 小时 5 分钟」这类文案 */
function buildUsageViews(usages, now) {
  const nowTs = Number(now) || Date.now()

  return (usages || []).map((usage) => {
    const source = usage || {}
    const rawStatus = String(source.status || '').trim()
    let statusKey = 'abnormal'
    if (rawStatus === 'using') statusKey = 'using'
    else if (rawStatus === 'completed') statusKey = 'completed'

    const meta = USAGE_STATUS_META[statusKey]
    const startTs = getTimestamp(source.start_time)
    const endTs = getTimestamp(source.end_time)
    const meaningfulTime = startTs > 0
    const durationText = meaningfulTime ? formatDurationText((endTs || nowTs) - startTs) : ''
    const range = datetime.formatTimeRange(source.start_time, source.end_time)

    return {
      docId: String(source._id || ''),
      reserveId: String(source.reserve_id || ''),
      deviceId: String(source.device_id || ''),
      studentName: getPersonName(source),
      statusKey,
      statusText: meta.text,
      tagClass: meta.tagClass,
      dateDisplay: range.dateDisplay,
      timeDisplay: range.timeDisplay,
      durationLabel: statusKey === 'using'
        ? (durationText ? `已使用 ${durationText}` : '')
        : (durationText ? `用时 ${durationText}` : ''),
      endChecklist: buildEndChecklistView(source.end_checklist)
    }
  })
}

/**
 * 使用照片记录：只保留真能显示出图片的记录。
 * hasRawPhoto 与「能不能拿到 URL」必须是同一套判断，否则候选名额会被空记录吃掉。
 *
 * @param {Array<Object>} usages 候选使用记录
 * @param {Function} resolveUrl 传 fileID 返回可访问链接
 */
function buildPhotoRecordViews(usages, resolveUrl) {
  const resolve = typeof resolveUrl === 'function' ? resolveUrl : () => ''

  return (usages || []).map((usage) => {
    const source = usage || {}
    const rawStatus = String(source.status || '').trim()
    let statusKey = 'abnormal'
    if (rawStatus === 'using') statusKey = 'using'
    else if (rawStatus === 'completed') statusKey = 'completed'
    const meta = USAGE_STATUS_META[statusKey]

    const photos = []
    collectUsagePhotoIds(source).forEach((fileId) => {
      const url = resolve(fileId)
      if (!url) return
      photos.push({ fileId, url })
    })

    const range = datetime.formatTimeRange(source.start_time, source.end_time)
    return {
      docId: String(source._id || ''),
      reserveId: String(source.reserve_id || ''),
      deviceId: String(source.device_id || ''),
      studentName: getPersonName(source),
      statusKey,
      statusText: meta.text,
      tagClass: meta.tagClass,
      dateDisplay: range.dateDisplay,
      timeDisplay: range.timeDisplay,
      abnormalDisplay: source.abnormal_time ? datetime.formatMoment(source.abnormal_time) : '',
      endChecklist: buildEndChecklistView(source.end_checklist),
      photos,
      photoUrls: photos.map(item => item.url),
      photoCount: photos.length
    }
  }).filter(item => item.photoCount > 0)
}

/** 关键词搜索：编号、名称、型号、实验室、房间、简介都算命中 */
function filterDeviceViews(deviceViews, keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return deviceViews || []

  return (deviceViews || []).filter((item) => {
    const fields = [item.deviceId, item.name, item.model, item.labName, item.room, item.description]
    return fields.some(value => String(value || '').toLowerCase().indexOf(kw) > -1)
  })
}

/** 规格参数对象 → [{ key, value }]，给 WXML 渲染用（对象在 WXML 里没法直接遍历） */
function buildSpecList(specifications) {
  if (!specifications || typeof specifications !== 'object' || Array.isArray(specifications)) return []
  return Object.keys(specifications).map((key) => {
    const value = specifications[key]
    const text = value === null || value === undefined
      ? ''
      : (typeof value === 'object' ? JSON.stringify(value) : String(value))
    return { key: String(key).trim(), value: text.trim() }
  }).filter(item => item.key)
}

/** 规格参数文本（每行「参数名：参数值」）→ 对象，行的冒号支持中英文 */
function parseSpecText(text) {
  const result = {}
  String(text || '').split(/\r?\n/).forEach((line) => {
    const content = line.trim()
    if (!content) return
    const match = content.match(/^([^：:]+)[：:]([\s\S]*)$/)
    if (!match) return
    const key = match[1].trim()
    if (!key) return
    result[key] = match[2].trim()
  })
  return result
}

/** 规格参数对象 → 编辑框文本 */
function buildSpecText(specifications) {
  return buildSpecList(specifications).map(item => `${item.key}：${item.value}`).join('\n')
}

/** 富文本字段可能是字符串，也可能是老的 { sections: [...] } 结构 */
function buildRichText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object') {
    if (Array.isArray(value.sections)) return '已配置分步操作规程'
    if (typeof value.text === 'string') return value.text.trim()
    if (typeof value.content === 'string') return value.content.trim()
    // 结构未知的对象也不能让整块内容凭空消失
    return '已配置富文本内容'
  }
  return String(value).trim()
}

module.exports = {
  getDeviceStatusMeta,
  getDeviceModel,
  buildGroupKey,
  chunkArray,
  uniqueById,
  normalizeImageList,
  collectUsagePhotoIds,
  buildEndChecklistView,
  compareDeviceCode,
  buildDeviceViews,
  summarizeDevices,
  buildReserveViews,
  formatDurationText,
  buildUsageViews,
  buildPhotoRecordViews,
  filterDeviceViews,
  buildSpecList,
  parseSpecText,
  buildSpecText,
  buildRichText
}
