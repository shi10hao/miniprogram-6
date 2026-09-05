const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 根据仪器名称分页获取不重复使用者
 * @param {string} deviceName
 * @param {string|null} cursor 上一轮返回的游标
 * @param {number} pageSize 每批取多少个不重复user，这里10
 * @returns {data,nextCursor,finished}
 */
exports.main = async (event)=>{
  const { deviceName, cursor = null, pageSize = 10 } = event
  try{
    const MAX_RAW_ROUND = 5; //底层原始流水最多扫描5*100=500条硬保护
    const distinctUserMap = new Map()
    let currentCursor = cursor
    let rawRoundCount = 0
    let finalNextCursor = null
    let rawReachEnd = false

    while(true){
      //已经收集够一批不重复用户，退出循环返回
      if(distinctUserMap.size >= pageSize) break
      //原始流水读取达到上限，终止
      if(rawRoundCount >= MAX_RAW_ROUND) { rawReachEnd = true; break }

      let q = db.collection("device_usage")
        .where({
          device_name: deviceName,
          status:"completed"
        })
        .orderBy("start_time","desc")
        .limit(100)
      if(currentCursor){
        q = q.skip(currentCursor)
      }
      const res = await q.get()
      rawRoundCount +=1

      if(res.data.length === 0){
        rawReachEnd = true
        break
      }

      for(const row of res.data){
        const uid = row.user_id
        if(!distinctUserMap.has(uid)){
          distinctUserMap.set(uid, {
            userId: uid,
            student_name: row.student_name,
            student_id: row.user_id,
            group_name: row.group_name,
            phone: row.phone,
            start_time: row.start_time
          })
          //凑够本批数量，停止解析本页剩余数据
          if(distinctUserMap.size >= pageSize){
            break
          }
        }
      }

      //本页原始记录读完，设置下一轮游标
      if(res.data.length < 100){
        rawReachEnd = true
        break
      }else{
        currentCursor = res.data[res.data.length -1]._id
        finalNextCursor = currentCursor
      }
    }

    const batchList = Array.from(distinctUserMap.values()).slice(0,pageSize)
    return {
      code:0,
      data: batchList,
      nextCursor: rawReachEnd ? null : finalNextCursor,
      finished: rawReachEnd
    }

  }catch(err){
    console.error("[getDeviceUserList]",err)
    return { code:-99, data:[], nextCursor:null, finished:true }
  }
}