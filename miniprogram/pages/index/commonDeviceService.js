/**
 * 首页「常用仪器」的数据源
 *
 * 优先调云函数 getCommonDevices：它在服务端聚合「我的使用流水 + 预约」，
 * 算出真正最近/最常用的仪器；云函数没部署或调用失败时，退化成
 * 「小程序端统计最近 RECENT_SCAN 条记录 + 可预约仪器补位」，页面不留白。
 */

const commonDeviceModel = require('./commonDeviceModel.js')
const cloudFile = require('../../utils/cloudFile.js')

const db = wx.cloud.database()
const _ = db.command

const CLOUD_FN_NAME = 'getCommonDevices'
const DEVICE_LIMIT = 100
const AVAILABLE_LIMIT = 20
const USAGE_STATUS = ['using', 'completed', 'abnormal']

/** 列表只用到这几个字段，少传能明显减小响应体 */
function deviceField() {
  return {
    device_id: true,
    device_name: true,
    picture: true,
    lab_name: true,
    device_room: true,
    specifications: true
  }
}

/** 可见性：公开仪器 + 本课题组仪器 */
function buildVisibility(groupName) {
  if (groupName) {
    return _.or([{ lab_type: 'public' }, { lab_name: groupName }])
  }
  return { lab_type: 'public' }
}

async function loadFromCloud(params) {
  const res = await wx.cloud.callFunction({
    name: CLOUD_FN_NAME,
    data: {
      userInfo: { userId: params.userId, groupName: params.groupName },
      limit: params.limit
    }
  })
  const result = (res && res.result) || {}
  if (result.code !== 0) {
    throw new Error(result.msg || 'getCommonDevices 返回异常')
  }
  return (result.data && result.data.list) || []
}

/**
 * 最近的使用流水 / 预约（小程序端单次 get 上限 20 条）
 * 单条查询失败不拖垮整个兜底：缺索引时报错就当没有记录，页面照样出补位卡片
 */
async function loadRecentRecords(params) {
  const usageTask = params.userId
    ? db.collection('device_usage')
      .where({ user_id: params.userId, status: _.in(USAGE_STATUS) })
      .field({ device_id: true, device_name: true, start_time: true })
      .orderBy('start_time', 'desc')
      .limit(commonDeviceModel.RECENT_SCAN)
      .get()
      .catch((err) => {
        console.error('[commonDeviceService] 取使用记录失败', err)
        return { data: [] }
      })
    : Promise.resolve({ data: [] })

  const reserveTask = params.userId
    ? db.collection('reserves')
      .where({
        user_id: params.userId,
        status: _.in(commonDeviceModel.USABLE_RESERVE_STATUS)
      })
      .field({ device_id: true, device_name: true, status: true, start_time: true })
      .orderBy('start_time', 'desc')
      .limit(commonDeviceModel.RECENT_SCAN)
      .get()
      .catch((err) => {
        console.error('[commonDeviceService] 取预约记录失败', err)
        return { data: [] }
      })
    : Promise.resolve({ data: [] })

  const results = await Promise.all([usageTask, reserveTask])
  return commonDeviceModel.buildStats(
    results[0].data || [],
    results[1].data || []
  )
}

/** 可预约仪器（补位用），排除已经用过的那几台 */
function loadAvailableDevices(groupName, excludeIds) {
  const conditions = [{ status: 'available' }, buildVisibility(groupName)]
  if (excludeIds.length) conditions.push({ device_id: _.nin(excludeIds) })

  return db.collection('devices')
    .where(_.and(conditions))
    .field(deviceField())
    .orderBy('device_id', 'asc')
    .limit(AVAILABLE_LIMIT)
    .get()
    .then((res) => res.data || [])
    .catch((err) => {
      console.error('[commonDeviceService] 取可预约仪器失败', err)
      return []
    })
}

/** 用过的仪器详情（可能已下架/维护中，所以不按 status 过滤） */
function loadUsedDevices(ids, groupName) {
  if (!ids.length) return Promise.resolve([])
  return db.collection('devices')
    .where(_.and([{ device_id: _.in(ids) }, buildVisibility(groupName)]))
    .field(deviceField())
    .limit(DEVICE_LIMIT)
    .get()
    .then((res) => res.data || [])
    .catch((err) => {
      console.error('[commonDeviceService] 取使用过的仪器失败', err)
      return []
    })
}

/** 本地兜底（云函数未部署时） */
async function loadFromLocal(params) {
  const stats = await loadRecentRecords(params)
  const ids = commonDeviceModel.collectDeviceIds(stats, commonDeviceModel.RECENT_SCAN)
  const lists = await Promise.all([
    loadAvailableDevices(params.groupName, ids),
    loadUsedDevices(ids, params.groupName)
  ])

  return commonDeviceModel.buildLocalList(
    stats,
    commonDeviceModel.buildDeviceMap(lists[1]),
    lists[0],
    params.limit
  )
}

/** picture 是 cloud:// fileID，必须换成临时链接，否则渲染层 500 */
async function resolvePictures(cards) {
  if (!cards || !cards.length) return []
  try {
    return await cloudFile.resolveListField(cards, 'picture')
  } catch (err) {
    console.error('[commonDeviceService] 解析仪器图片失败', err)
    return cards
  }
}

/**
 * 取首页常用仪器卡片
 * @param {Object} options { userId, groupName, limit }
 * @returns {Promise<Array<Object>>} 已换成 https 临时链接的卡片数组
 */
async function loadCommonDevices(options) {
  const opts = options || {}
  const params = {
    userId: String(opts.userId || '').trim(),
    groupName: String(opts.groupName || '').trim(),
    limit: commonDeviceModel.normalizeLimit(opts.limit)
  }

  let entries = []
  try {
    entries = await loadFromCloud(params)
  } catch (err) {
    console.error('[commonDeviceService] 云函数取常用仪器失败，改用本地统计', err)
    entries = await loadFromLocal(params)
  }

  // 云函数返回的是「每台仪器一条」的原始 entry，合并同型号/截断都在这里统一做
  const list = commonDeviceModel.buildListFromEntries(entries, params.limit)
  return resolvePictures(commonDeviceModel.buildCards(list, Date.now()))
}

module.exports = {
  loadCommonDevices
}
