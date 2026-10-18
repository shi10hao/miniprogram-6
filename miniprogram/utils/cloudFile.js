/**
 * 云存储 fileID → 临时访问链接 的统一处理工具
 *
 * 背景：<image src="{{cloud://...}}"> 在渲染层会被当成普通网络地址请求，
 * 出现 "[渲染层网络层错误] Failed to load local image resource /pages/xxx/cloud://..."
 * 并返回 500。必须先用 getBatchTempUrl 换成 https 临时链接。
 *
 * 该模块做两件事：
 *   1. 并发批量换取临时链接（比逐个调用快得多）；
 *   2. 内存 + 本地缓存，避免每次进页面都重新请求同一批图片。
 */

const STORAGE_KEY = 'dsh_cloud_temp_url_cache_v1'
// 官方临时链接有效期约 2 小时，这里保守取 5 分钟，既省请求又不会用到过期链接
const TTL = 5 * 60 * 1000
const CHUNK_SIZE = 50

let memoryCache = null

function now() {
  return Date.now()
}

function getCache() {
  if (memoryCache) return memoryCache
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    memoryCache = raw && typeof raw === 'object' ? raw : {}
  } catch (err) {
    memoryCache = {}
  }
  return memoryCache
}

function persistCache() {
  try {
    wx.setStorageSync(STORAGE_KEY, memoryCache || {})
  } catch (err) {
    // 缓存写入失败不影响主流程
  }
}

function isCloudFileId(value) {
  return typeof value === 'string' && value.trim().indexOf('cloud://') === 0
}

function chunkArray(list, size) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

/**
 * 把一批 fileID 换成临时链接
 * @param {Array<string>} fileIds
 * @returns {Promise<Object>} { [fileID]: tempURL }
 */
async function resolveTempUrls(fileIds) {
  const unique = Array.from(new Set((fileIds || []).filter(isCloudFileId)))
  if (!unique.length) return {}

  const cache = getCache()
  const result = {}
  const miss = []

  unique.forEach((id) => {
    const hit = cache[id]
    if (hit && hit.url && (now() - hit.ts) < TTL) {
      result[id] = hit.url
    } else {
      miss.push(id)
    }
  })

  if (!miss.length) return result

  const chunks = chunkArray(miss, CHUNK_SIZE)
  const tasks = chunks.map((chunk) => {
    return wx.cloud.callFunction({
      name: 'getBatchTempUrl',
      data: { fileList: chunk }
    }).then((res) => {
      return (res && res.result) || []
    }).catch((err) => {
      console.error('[cloudFile] 获取临时链接失败:', err)
      return []
    })
  })

  const lists = await Promise.all(tasks)
  lists.forEach((list) => {
    ;(list || []).forEach((item) => {
      if (item && item.fileID && item.tempFileURL) {
        result[item.fileID] = item.tempFileURL
        cache[item.fileID] = { url: item.tempFileURL, ts: now() }
      }
    })
  })

  persistCache()
  return result
}

/**
 * 解析单个地址：cloud:// 换临时链接，其他（网络图/本地图）原样返回
 */
function resolveSingle(value, map) {
  if (!isCloudFileId(value)) return value || ''
  return (map && map[value]) || ''
}

/**
 * 给一个「每项都带图片字段」的数组批量换链接，返回新数组（不改原对象）。
 *
 * @param {Array<Object>} list 数据列表
 * @param {string} field 存 fileID 的字段名，默认 'picture'
 * @param {string} urlField 写入临时链接的字段名，默认与 field 相同（原地覆盖）
 * @returns {Promise<Array<Object>>} 换好链接的新列表；没有任何 cloud:// 时原样返回
 */
async function resolveListField(list, field = 'picture', urlField = null) {
  const target = urlField || field
  const items = Array.isArray(list) ? list : []
  const rawIds = items
    .map(item => (item ? item[field] : ''))
    .filter(isCloudFileId)

  if (!rawIds.length) return items

  const map = await resolveTempUrls(rawIds)
  return items.map((item) => {
    if (!item || !isCloudFileId(item[field])) return item
    const url = resolveSingle(item[field], map)
    if (!url) return item
    const next = Object.assign({}, item)
    next[target] = url
    return next
  })
}

module.exports = {
  isCloudFileId,
  resolveTempUrls,
  resolveSingle,
  resolveListField,
  // 仅供单元测试使用：清空内存与本地缓存
  _resetCacheForTests() {
    memoryCache = null
    try {
      wx.removeStorageSync(STORAGE_KEY)
    } catch (err) {
      // ignore
    }
  }
}
