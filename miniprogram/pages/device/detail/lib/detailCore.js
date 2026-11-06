/**
 * 仪器详情页的纯逻辑：不碰 wx.*、不碰数据库，可以直接在 node 里断言。
 * 页面只负责取数和 setData，所有判断与拼装都在这里，改坏了能被测试兜住。
 */

// 同款仪器的三种状态，数组顺序即页面展示顺序
const STATUS_GROUPS = [
  { key: 'available', label: '可用' },
  { key: 'using', label: '使用中' },
  { key: 'maintenance', label: '维修中' }
]

// 从页面参数里取仪器编号，做一次 decode，防止编号里带特殊字符
function parseDeviceId(options) {
  const raw = String((options && options.deviceId) || '').trim()
  if (!raw) return ''
  try {
    return decodeURIComponent(raw).trim()
  } catch (err) {
    return raw
  }
}

// 型号优先取 specifications.型号，其次 specifications.model，最后顶层 model
function getDeviceModel(device) {
  if (!device) return ''
  const specs = device.specifications
  if (specs && typeof specs === 'object') {
    const model = specs['型号'] || specs.model || ''
    if (String(model).trim()) return String(model).trim()
  }
  return String(device.model || '').trim()
}

// 编号排序：先比数字尾号再比字符串，避免 1001 排在 999 前面
function compareCode(a, b) {
  const numA = parseInt(String(a).replace(/\D/g, ''), 10) || 0
  const numB = parseInt(String(b).replace(/\D/g, ''), 10) || 0
  if (numA !== numB) return numA - numB
  return String(a).localeCompare(String(b))
}

/**
 * 同款仪器按「使用中 / 维修中 / 可用」分组。
 * 使用中优先于维修中：一台设备既在 usage 里又被标了 maintenance 时，按在用算。
 * @param {Array<Object>} devices 同款设备
 * @param {Array<string>} usingIds 正在使用的 device_id
 * @returns {Array<{key: string, label: string, count: number, codes: string[]}>}
 */
function buildStatusGroups(devices, usingIds) {
  const list = devices || []
  const usingMap = {}
  const usedIds = usingIds || []
  usedIds.forEach((id) => {
    usingMap[id] = true
  })

  const buckets = {
    available: [],
    using: [],
    maintenance: []
  }
  list.forEach((item) => {
    const code = String(item.device_id || '').trim() || '未编号'
    if (usingMap[item.device_id]) {
      buckets.using.push(code)
    } else if (item.status === 'maintenance') {
      buckets.maintenance.push(code)
    } else {
      buckets.available.push(code)
    }
  })

  return STATUS_GROUPS.map((group) => {
    const codes = buckets[group.key].slice().sort(compareCode)
    return {
      key: group.key,
      label: group.label,
      count: codes.length,
      codes
    }
  })
}

/**
 * 由三组数量得出顶部状态徽标。
 * 原来只有「使用中 / 可用」两态，全都维修中时也会显示「可用」。
 * @param {Array<Object>} statusGroups
 * @returns {{statusKey: string, statusText: string}}
 */
function buildStatusSummary(statusGroups) {
  const groups = statusGroups || []
  const countOf = (key) => {
    const target = groups.find(group => group.key === key)
    return target ? target.count : 0
  }
  if (countOf('available') > 0) {
    return { statusKey: 'available', statusText: '有可用仪器' }
  }
  if (countOf('using') > 0) {
    return { statusKey: 'using', statusText: '全部使用中' }
  }
  if (countOf('maintenance') > 0) {
    return { statusKey: 'maintenance', statusText: '全部维修中' }
  }
  return { statusKey: 'none', statusText: '暂无可用' }
}

/**
 * 吸底预约栏：左侧提示语 + 按钮能不能点。
 * @param {Array<Object>} statusGroups
 * @returns {{availableCount: number, canReserve: boolean, barText: string}}
 */
function buildBarState(statusGroups) {
  const groups = statusGroups || []
  const available = groups.find(group => group.key === 'available')
  const availableCount = available ? available.count : 0
  return {
    availableCount,
    canReserve: availableCount > 0,
    // 这里只能说"空闲"（当前没人在用）：能不能约还取决于预约时段的冲突，
    // 时段口径由预约页决定，详情页不该替它下结论
    barText: availableCount > 0 ? availableCount + ' 台空闲' : '当前没有空闲仪器'
  }
}

/**
 * 把操作规程 / 注意事项的原始值转成子页面能吃的参数。
 * 纯文本走 plain；只有带 sections 数组的旧数据才能走 structured ——
 * 子页面 procedure.js 只认 JSON.parse(content).sections，其他对象结构会白屏。
 * @param {*} raw
 * @returns {{content: string, type: 'plain'|'structured'}}
 */
function formatGuide(raw) {
  if (typeof raw === 'string') {
    return { content: raw, type: 'plain' }
  }
  // 空值不能走到 JSON.stringify：那会得到字符串 'null'，子页面就会显示 "null"
  if (!raw) {
    return { content: '', type: 'plain' }
  }
  if (Array.isArray(raw.sections)) {
    return { content: JSON.stringify(raw), type: 'structured' }
  }
  const fallback = raw.text || raw.content || JSON.stringify(raw) || ''
  return { content: String(fallback), type: 'plain' }
}

/**
 * 判断资料字段是不是真有内容。
 * 空对象 {} 和空数组 [] 在 JS 里都是真值，直接用 !! 判断会把入口点亮，
 * 点进去 formatGuide 兜底成 JSON.stringify，子页面就显示一个 "{}"。
 * @param {*} raw
 * @returns {boolean}
 */
function hasGuideContent(raw) {
  if (typeof raw === 'string') return !!raw.trim()
  if (!raw) return false
  if (Array.isArray(raw)) return raw.length > 0
  if (Array.isArray(raw.sections)) return raw.sections.length > 0
  // 老数据把正文塞在 text / content 里，只有这两个字段才算有内容
  const text = raw.text || raw.content
  return typeof text === 'string' ? !!text.trim() : !!text
}

module.exports = {
  STATUS_GROUPS,
  parseDeviceId,
  getDeviceModel,
  compareCode,
  buildStatusGroups,
  buildStatusSummary,
  buildBarState,
  formatGuide,
  hasGuideContent
}
