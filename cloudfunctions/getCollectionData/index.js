const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const {
    collectionName,
    pageSize = 100,
    startSkip = 0
  } = event

  if (!collectionName) {
    return { code: 400, message: 'collectionName required' }
  }

  let whereCondition = {}
  console.log("event",event)
  // ✅ 权限 + 筛选条件拼装
  if (event.labCondition && event.labCondition.deny) {
    whereCondition = { _id: '__DENY__' }
    console.log("0")
  } else {
    if (event.labCondition) {
      whereCondition = event.labCondition
      console.log("1")
    }

    if (event.deviceType) {
      console.log("2")
      whereCondition = _.and([
        whereCondition,
        { device_type: event.deviceType }
      ])
    }
  }

  console.log('最终 whereCondition:', whereCondition)

  let skip = startSkip
  const all = []

  while (true) {
    const res = await db
      .collection(collectionName)
      .where(whereCondition)
      .skip(skip)
      .limit(pageSize)
      .get()

    all.push(...res.data)

    if (res.data.length < pageSize) break
    skip += pageSize
  }

  return {
    code: 0,
    data: all
  }
}