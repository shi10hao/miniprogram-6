// getBatchTempUrl：把一批云存储 fileID 换成 https 临时链接
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// getTempFileURL 单次能传的文件数有上限（50 个），超过就会整批失败，
// 所以这里自己分批，任何一批出错只影响那一批，其余照常返回
const CHUNK_SIZE = 50
// 防御性上限：一次最多处理 500 个文件，避免调用方塞进来几千个导致超时
const MAX_FILES = 500

exports.main = async (event) => {
  const { fileList } = event
  const fileIds = (Array.isArray(fileList) ? fileList : []).filter(Boolean).slice(0, MAX_FILES)
  if (!fileIds.length) return []

  const chunks = []
  for (let i = 0; i < fileIds.length; i += CHUNK_SIZE) {
    chunks.push(fileIds.slice(i, i + CHUNK_SIZE))
  }

  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await cloud.getTempFileURL({ fileList: chunk })
      return res.fileList || []
    } catch (err) {
      console.error('[getBatchTempUrl] 换取临时链接失败', err)
      return []
    }
  }))

  return results.reduce((all, list) => all.concat(list), [])
}
