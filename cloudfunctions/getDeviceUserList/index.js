// getDeviceUserList：按仪器名称分页查询用过它的同学（按最近使用时间去重）
// 游标 cursor 是「已扫描的原始流水条数」，不是 _id：云数据库 skip 只接受数字偏移
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const RAW_PAGE_SIZE = 100 // 云数据库单次 get 最多 100 条
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 20
const MAX_SCAN_ROWS = 500 // 单次请求最多扫描的原始流水条数，控制云函数耗时
const MAX_EXCLUDE_IDS = 500

/**
 * 夹取每页条数，防止前端传入异常值
 */
function clampPageSize(value) {
  const size = Number(value)
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(size), MAX_PAGE_SIZE)
}

/**
 * 把使用流水整理成前端要用的使用者卡片
 */
function buildUserCard(row) {
  return {
    userId: row.user_id,
    student_id: row.user_id,
    student_name: row.student_name || '',
    group_name: row.group_name || '',
    phone: row.phone || '',
    start_time: row.start_time || ''
  }
}

exports.main = async (event, context) => {
  const deviceName = String(event.deviceName || '').trim()
  const pageSize = clampPageSize(event.pageSize)
  const startOffset = Math.max(0, Math.floor(Number(event.cursor)) || 0)
  // 前端回传已拿到的人，服务端跳过，避免同一个人跨页重复出现
  const excludeList = Array.isArray(event.excludeUserIds) ? event.excludeUserIds.slice(0, MAX_EXCLUDE_IDS) : []
  const excludeMap = new Set(excludeList.map(String))

  if (!deviceName) {
    return { code: -1, msg: '缺少仪器名称', data: [], nextCursor: null, finished: true }
  }

  try {
    const userMap = new Map()
    let scanned = 0
    let reachedEnd = false

    while (userMap.size < pageSize && scanned < MAX_SCAN_ROWS) {
      let query = db.collection('device_usage')
        .where({ device_name: deviceName, status: 'completed' })
        .orderBy('start_time', 'desc')
        .limit(RAW_PAGE_SIZE)

      if (startOffset + scanned > 0) {
        query = query.skip(startOffset + scanned)
      }

      const res = await query.get()
      const rows = res.data || []
      if (rows.length === 0) {
        reachedEnd = true
        break
      }

      for (const row of rows) {
        scanned += 1
        const userId = String(row.user_id || '').trim()
        if (!userId || excludeMap.has(userId) || userMap.has(userId)) continue

        userMap.set(userId, buildUserCard(row))
        if (userMap.size >= pageSize) break
      }

      // 本页没取满才可能还有下一页；取满时游标精确停在已扫描位置，尾部用户不会被跳过
      if (rows.length < RAW_PAGE_SIZE) {
        reachedEnd = true
        break
      }
    }

    const data = Array.from(userMap.values())

    return {
      code: 0,
      msg: 'ok',
      data,
      nextCursor: reachedEnd ? null : startOffset + scanned,
      finished: reachedEnd
    }
  } catch (err) {
    console.error('[getDeviceUserList] 查询失败', err)
    return { code: -99, msg: '服务器异常', data: [], nextCursor: null, finished: true }
  }
}
