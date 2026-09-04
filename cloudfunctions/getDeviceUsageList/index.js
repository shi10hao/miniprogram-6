// 云函数 getDeviceUsageList/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 变更说明：
 * 去重维度改为 device_name(仪器名称)，不再使用device_id；
 * 同一仪器名称、不同device_id视为同一仪器；取时间最新的deviceId对外输出；
 * recent模式收集到3个不同仪器名称就提前退出查询，控制性能；
 * 不新增集合，不改数据库结构；前端出入参完全兼容无需改动。
 */

/**
 * 获取用户最近已完成仪器，收集 targetCount 个不同仪器名称即提前退出
 * @param {string} userId
 * @param {number} targetCount 需要多少种不同仪器名称，业务为3
 * @returns {Array<{deviceId:string,deviceName:string}>}
 */
async function getUserDistinctDevice(userId, targetCount = 3) {
  const nameMap = new Map() // key:device_name value:{deviceId,deviceName}
  let cursor = null
  const MAX_LOOP = 10 // 安全保护，最多10轮，10*100=10000条硬上限，防止死循环

  for (let i = 0; i < MAX_LOOP; i++) {
    let query = db.collection('device_usage')
      .where({
        user_id: userId,
        status: "completed"
      })
      .orderBy("start_time", "desc")
      .limit(100)
    if (cursor) {
      query = query.skip(cursor)
    }
    const res = await query.get()
    if (res.data.length === 0) break

    for (const row of res.data) {
      // 按仪器名称去重：只有该名称尚未存入map，才存入（因为按时间倒序，第一条就是最新实例）
      if (!nameMap.has(row.device_name)) {
        nameMap.set(row.device_name, {
          deviceId: row.device_id,
          deviceName: row.device_name
        })
        // 凑够目标数量不同仪器名称，直接返回，不再查询数据库
        if (nameMap.size >= targetCount) {
          return Array.from(nameMap.values())
        }
      }
    }

    if (res.data.length < 100) break
    cursor = res.data[res.data.length - 1]._id
  }
  return Array.from(nameMap.values())
}


/**
 * 搜索仪器：按device_name去重；最多读取MAX_SEARCH_ROUND*100条最近流水
 */
async function searchDistinctDevice(keyword) {
  const nameMap = new Map()
  let cursor = null
  const MAX_SEARCH_ROUND = 3 // 最多读取3*100=300条最近完成记录，控制性能
  const reg = db.RegExp({ regexp: keyword, options: 'i' })

  for (let i = 0; i < MAX_SEARCH_ROUND; i++) {
    let query = db.collection('device_usage')
      .where({
        status: "completed",
        device_name: reg
      })
      .orderBy("start_time", "desc")
      .limit(100)
    if (cursor) query = query.skip(cursor)
    const res = await query.get()
    console.log("res.data:",res.data)
    console.log("1")
    if (res.data.length === 0) break
    console.log("2")
    for (const row of res.data) {
      if (!nameMap.has(row.device_name)) {
        nameMap.set(row.device_name, {
          deviceId: row.device_id,
          deviceName: row.device_name
        })
      }
    }

    if (res.data.length < 100) break
    cursor = res.data[res.data.length - 1]._id
  }
  return Array.from(nameMap.values())
}


exports.main = async (event, context) => {
  const { mode, userId, keyword } = event
  console.log("mode, userId, keyword:",mode, userId, keyword)
  try {
    if (mode === "recent") {
      if (!userId) return { code: -1, msg: "缺少userId", data: [] }
      const list = await getUserDistinctDevice(userId, 3)
      return { code: 0, data: list }
    } else if (mode === "search") {
      const kw = (keyword || "").trim()
      if (!kw) return { code: 0, data: [] }
      console.log("kw为不为空,kw:",kw)
      const list = await searchDistinctDevice(kw)
      return { code: 0, data: list }
    } else {
      return { code: -1, msg: "非法mode参数", data: [] }
    }
  } catch (err) {
    console.error("[getDeviceUsageList]异常", err)
    return { code: -99, msg: "服务器异常", data: [] }
  }
}