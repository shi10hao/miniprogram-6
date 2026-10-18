// getDeviceUsageList：查询「我最近用过的仪器」与「按名称搜索仪器」
// mode = 'recent'：按 user_id 取已完成的使用记录，去重后返回最近 3 台仪器
// mode = 'search'：按仪器名称模糊匹配，去重后最多返回 20 台仪器
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const RAW_PAGE_SIZE = 100 // 云数据库单次 get 最多 100 条
const RECENT_LIMIT = 3 // 最近使用仪器数量
const RECENT_MAX_SCAN = 500 // recent 模式最多扫描的原始流水条数
const SEARCH_LIMIT = 20 // 搜索结果上限
const SEARCH_MAX_SCAN = 300 // search 模式最多扫描的原始流水条数
const MAX_KEYWORD_LENGTH = 30

/**
 * 转义正则元字符
 * 用户输入的 ( ) * . 等字符不转义会让查询报错或匹配全表
 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 取一页原始使用流水（按开始时间倒序）
 * offset 为已扫描条数，云数据库 skip 只接受数字，不能用 _id 当游标
 */
async function fetchUsagePage(where, offset) {
  let query = db.collection('device_usage')
    .where(where)
    .orderBy('start_time', 'desc')
    .limit(RAW_PAGE_SIZE)

  if (offset > 0) {
    query = query.skip(offset)
  }

  const res = await query.get()
  return res.data || []
}

/**
 * 按仪器名称去重收集仪器列表
 * 直到凑满 limit 或扫完 maxScan 条原始流水
 */
async function collectDevices(where, { limit, maxScan }) {
  const nameMap = new Map()
  let scanned = 0

  while (scanned < maxScan && nameMap.size < limit) {
    const rows = await fetchUsagePage(where, scanned)
    if (rows.length === 0) break

    for (const row of rows) {
      scanned += 1
      const name = String(row.device_name || '').trim()
      if (!name || nameMap.has(name)) continue

      nameMap.set(name, {
        deviceId: row.device_id || '',
        deviceName: name
      })

      if (nameMap.size >= limit) break
    }

    if (rows.length < RAW_PAGE_SIZE) break
  }

  return Array.from(nameMap.values())
}

exports.main = async (event, context) => {
  const { mode } = event

  try {
    if (mode === 'recent') {
      const userId = String(event.userId || '').trim()
      if (!userId) {
        return { code: -1, msg: '缺少userId', data: [] }
      }

      const list = await collectDevices(
        { user_id: userId, status: 'completed' },
        { limit: RECENT_LIMIT, maxScan: RECENT_MAX_SCAN }
      )

      return { code: 0, msg: 'ok', data: list }
    }

    if (mode === 'search') {
      const keyword = String(event.keyword || '').trim().slice(0, MAX_KEYWORD_LENGTH)
      if (!keyword) {
        return { code: 0, msg: 'ok', data: [] }
      }

      const nameReg = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })

      const list = await collectDevices(
        { status: 'completed', device_name: nameReg },
        { limit: SEARCH_LIMIT, maxScan: SEARCH_MAX_SCAN }
      )

      return { code: 0, msg: 'ok', data: list }
    }

    return { code: -1, msg: '非法mode参数', data: [] }
  } catch (err) {
    console.error('[getDeviceUsageList] 查询失败', err)
    return { code: -99, msg: '服务器异常', data: [] }
  }
}
