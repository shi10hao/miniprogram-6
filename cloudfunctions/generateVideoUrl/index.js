const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async (event) => {
  try {
    const { fileID } = event
    
    if (!fileID) {
      return {
        success: false,
        error: '缺少文件ID'
      }
    }

    // 获取临时文件URL
    const result = await cloud.getTempFileURL({
      fileList: [fileID]
    })
    
    return {
      success: true,
      tempFileURL: result.fileList[0].tempFileURL,
      status: result.fileList[0].status
    }
  } catch (error) {
    console.error('云函数错误:', error)
    return {
      success: false,
      error: error.message
    }
  }
}