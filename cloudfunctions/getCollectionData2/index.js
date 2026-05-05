const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const {
    collectionName,
    whereCondition = {},
    pageSize = 100
  } = event

  if (!collectionName) {
    return { code: 400, message: 'collectionName required' }
  }

  let finalCondition = {}

  // ✅ 1️⃣ labCondition
  if (whereCondition.labCondition?.deny) {
    finalCondition = { _id: '__DENY__' }
  } else if (whereCondition.labCondition) {
    finalCondition = whereCondition.labCondition
  }

  // ✅ 2️⃣ deviceType
  if (whereCondition.deviceType) {
    finalCondition = _.and([
      finalCondition,
      { device_type: whereCondition.deviceType }
    ])
  }

  console.log('✅ 最终 whereCondition:', finalCondition)

  let skip = 0
  const all = []

  while (true) {
    const res = await db
      .collection(collectionName)
      .where(finalCondition)
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