const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  // 开启事务（确保多表操作原子性）
  const transaction = await db.startTransaction()
  try {
    // 1. 插入设备表数据
    const devicesData = [
      {
        device_id: "D001",
        device_name: "便携式气象站", // 生态学设备：监测温湿度、风速等
        device_type: "气象监测设备",
        picture: "pic_meteor.jpg",   // 假设的图片存储路径
        device_room: "实验楼A301",
        status: "available",   // 初始状态：可用
        update_time: db.serverDate() // 服务器当前时间
      },
      {
        device_id: "D002",
        device_name: "土壤养分速测仪", // 环境科学设备：分析土壤氮磷钾等养分
        device_type: "土壤分析设备",
        picture: "pic_soil.jpg",
        device_room: "实验楼B205",
        status: "available",
        update_time: db.serverDate()
      }
    ]
    await Promise.all(devicesData.map(device => 
      transaction.collection('Devices').add({ data: device })
    ))

    // 2. 插入借用记录 
    const borrowRecords = [
      {
        record_id: "R001",
        device_id: "D001",
        stu_id: "X42214037",  // 关联学生“张三”的stu_id
        borrow_time: new Date("2025-09-05T10:00:00"),
        expected_return_time: new Date("2025-09-12T10:00:00"),
        actual_return_time: null  // 未归还时为null
      },
      {
        record_id: "R002",
        device_id: "D002",
        stu_id: "X42214038",  // 假设另一个学生“李四”的stu_id
        borrow_time: new Date("2025-09-05T14:00:00"),
        expected_return_time: new Date("2025-09-15T14:00:00"),
        actual_return_time: null
      }
    ]
    await Promise.all(borrowRecords.map(record => 
      transaction.collection('borrow_record').add({ data: record })
    ))

    // 3. 插入设备状态历史
    const historyRecords = [
      {
        history_id: "H001",
        device_id: "D001",
        old_status: "available",  // 原状态
        latest_status: "borrowed", // 新状态
        change_time: new Date("2025-09-05T10:00:00"),
        change_by: "X42214037",  // 操作人（学生ID）
        reason: "学生借用"
      },
      {
        history_id: "H002",
        device_id: "D002",
        old_status: "available",
        latest_status: "borrowed",
        change_time: new Date("2025-09-05T14:00:00"),
        change_by: "X42214038",
        reason: "学生借用"
      }
    ]
    await Promise.all(historyRecords.map(history => 
      transaction.collection('device_history').add({ data: history })
    ))

    //4. 更新设备状态为“borrowed” 
    await Promise.all(borrowRecords.map(record => 
      transaction.collection('Devices').doc(record.device_id).update({
        data: {
          status: "borrowed",
          update_time: db.serverDate()
        }
      })
    ))

    // 提交事务
    await transaction.commit()
    return { success: true, message: "数据插入与状态更新成功" }
  } catch (err) {
    await transaction.rollback()
    return { success: false, message: "操作失败", error: err }
  }
}