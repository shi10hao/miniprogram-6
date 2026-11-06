/**
 * 详情页「去预约」的落地逻辑
 *
 * 同款仪器往往有好几台实例：只有一台时直接进预约页；多台时先在详情页让用户挑一台，
 * 免得进了预约页还要在一堆卡片里找、再展开编号。纯逻辑（取编号 / 拼选项 / 拼 URL）
 * 与 wx.* 调用分开，前者可以在 node 里直接断言。
 */

const PAGE_URL = '/pages/reservation/reservation'
// wx.showActionSheet 的 itemList 上限就是 6 项，多出来的没法列
const SHEET_LIMIT = 6
// 没有编号的设备在列表里显示成这个占位值，不能拿去预约
const EMPTY_CODE = '未编号'

/**
 * 从同款状态分组里取出真正可用的编号
 * @param {Array} statusGroups lib/detailCore.js buildStatusGroups 的输出
 * @returns {Array<string>}
 */
function getAvailableCodes(statusGroups) {
  const groups = statusGroups || []
  const group = groups.find(item => item && item.key === 'available')
  const codes = (group && group.codes) || []
  return codes.filter(code => !!code && code !== EMPTY_CODE)
}

/**
 * 拼 ActionSheet 的选项文案：当前这台标「当前」，其余直接列编号
 * @param {Array<string>} codes
 * @param {string} currentDeviceId
 * @returns {Array<string>}
 */
function buildSheetItems(codes, currentDeviceId) {
  return (codes || [])
    .slice(0, SHEET_LIMIT)
    .map(code => (code === currentDeviceId ? code + ' · 当前' : code))
}

/**
 * 预约页地址：带编号时预约页会自动选中那一台
 * @param {string} deviceId
 * @returns {string}
 */
function buildUrl(deviceId) {
  const id = String(deviceId || '')
  return id ? PAGE_URL + '?deviceId=' + encodeURIComponent(id) : PAGE_URL
}

function openReservation(deviceId) {
  wx.navigateTo({ url: buildUrl(deviceId) })
}

/**
 * 入口：一台就直接进，多台先弹选择
 * @param {{codes: Array<string>, currentDeviceId: string}} params
 */
function enter(params) {
  const list = (params && params.codes) || []
  const currentDeviceId = (params && params.currentDeviceId) || ''

  if (list.length <= 1) {
    openReservation(list[0] || currentDeviceId)
    return
  }

  const items = buildSheetItems(list, currentDeviceId)
  const options = {
    itemList: items,
    success: (res) => {
      openReservation(list[res.tapIndex] || currentDeviceId)
    },
    fail: (err) => {
      // 用户点了取消不是异常，其余失败才记日志
      const message = (err && err.errMsg) || ''
      if (message.indexOf('cancel') !== -1) return
      console.error('[reserveFlow] 选择仪器实例失败', err)
    }
  }

  // 可用实例超过 6 台时说清"这里只列了一部分"，剩下的去预约页里换
  if (list.length > items.length) {
    const tips = '共 ' + list.length + ' 台可用，这里先列 ' + items.length + ' 台'
    options.alertText = tips
  }

  wx.showActionSheet(options)
}

module.exports = {
  getAvailableCodes,
  buildSheetItems,
  buildUrl,
  openReservation,
  enter
}
