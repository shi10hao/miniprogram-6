const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

// 找到collectionName中符合whereCondition和labCondition和deviceType并有sortField决定是否排序的一个函数，输出为{code: 0, data: all}，all对象，元素为集合中的所有符合的值
exports.main = async (event) => {
  const {
    collectionName,
    whereCondition = {}, // ✅ 修复：接收前端查询条件
    pageSize = 100,
    startSkip = 0,
    labCondition,
    deviceType,
    sortField = ''   // 新增：排序字段，默认空=不排序
  } = event

  if (!collectionName) {
    return { code: 400, message: 'collectionName required' }
  }

  let finalWhere = {}

  // ✅ 权限拦截
  if (labCondition && labCondition.deny) {
    finalWhere = { _id: '__DENY__' }
  } else {
    const conditions = []

    // 1. 权限条件
    if (labCondition) {
      conditions.push(labCondition)
    }

    // 2. 前端传来的查询条件 ✅ 修复
    if (whereCondition && Object.keys(whereCondition).length > 0) {
      conditions.push(whereCondition)
    }

    // 3. 设备类型
    if (deviceType) {
      conditions.push({ device_type: deviceType })
    }

    // 所有条件 AND 合并 ✅ 修复
    if (conditions.length > 0) {
      finalWhere = _.and(conditions)
    }
  }
  let baseQuery = db.collection(collectionName).where(finalWhere)
  if (sortField) {
    baseQuery = baseQuery.orderBy(sortField, 'desc')
  }
  let skip = startSkip
  const all = []
  const MAX_LIMIT = 1000 // ✅ 修复：加上限，防止死循环

  while (true) {
    const res = await baseQuery   // 改用 baseQuery
    .skip(skip)
    .limit(pageSize)
    .get()


    all.push(...res.data)

    // ✅ 修复：退出条件（不足一页 或 达到最大限制）
    if (res.data.length < pageSize || all.length >= MAX_LIMIT) {
      break
    }

    skip += pageSize
  }

  return {
    code: 0,
    data: all
  }
}