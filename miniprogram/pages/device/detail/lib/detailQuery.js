/**
 * 仪器详情页的取数封装：可见性条件、翻页取全、使用中查询。
 * 从页面里拆出来，一是页面 JS 能留在 500 行规范内，二是这几个查询的口径
 * （可见性规则、20 条上限、分片大小）集中在一处，改的时候不会漏。
 */

// 小程序端单次 get() 最多返回 20 条，超出会被静默截断（不报错）
const QUERY_LIMIT = 20
// _.in() 一次塞多少个 id 的保守上限
const IN_CHUNK = 50
// 翻页时每轮最多并发几个请求，云调用并发打满会被限流
const PARALLEL_LIMIT = 5

function getDb() {
  return wx.cloud.database()
}

function getUserGroupName() {
  const userInfo = wx.getStorageSync('userInfo') || {}
  return String(userInfo.groupName || '').trim()
}

// 可见性：公共实验室 + 本课题组，与仪器列表页保持同一套规则
function getVisibleCondition(groupName) {
  const _ = getDb().command
  if (groupName) {
    return _.or([
      { lab_type: 'public' },
      { lab_name: groupName }
    ])
  }
  return { lab_type: 'public' }
}

function buildVisibleQuery(extraCondition) {
  const _ = getDb().command
  return _.and([
    extraCondition,
    getVisibleCondition(getUserGroupName())
  ])
}

/**
 * 分批把符合条件的记录取全。
 * skip 分页必须带固定排序：不加 orderBy 时数据库不保证顺序稳定，
 * 两次请求之间返回顺序一变就会重复或漏掉记录。
 * @param {string} collectionName
 * @param {Object} condition
 * @returns {Promise<Array<Object>>}
 */
async function fetchAllDocs(collectionName, condition) {
  const collection = getDb().collection(collectionName)
  const query = () => collection.where(condition).orderBy('_id', 'asc')
  const first = await query().limit(QUERY_LIMIT).get()
  const list = first.data || []
  if (list.length < QUERY_LIMIT) return list

  const countRes = await collection.where(condition).count()
  const total = countRes.total || list.length

  for (let start = QUERY_LIMIT; start < total; start += QUERY_LIMIT * PARALLEL_LIMIT) {
    const end = Math.min(start + QUERY_LIMIT * PARALLEL_LIMIT, total)
    const tasks = []
    for (let skip = start; skip < end; skip += QUERY_LIMIT) {
      tasks.push(query().skip(skip).limit(QUERY_LIMIT).get())
    }
    const batch = await Promise.all(tasks)
    batch.forEach((res) => {
      const data = res.data || []
      data.forEach((item) => {
        list.push(item)
      })
    })
  }
  return list
}

/**
 * 查这批设备里哪些正在被使用。
 * 分片之间串行：同款上百台时如果所有分片并发，再叠加分片内部的并发，
 * 一瞬间会有几十个云调用在飞，容易被限流。
 * @param {Array<string>} deviceIds
 * @returns {Promise<Array<string>>}
 */
async function getUsingDeviceIds(deviceIds) {
  const ids = (deviceIds || []).filter(Boolean)
  if (!ids.length) return []

  const _ = getDb().command
  const used = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    const list = await fetchAllDocs('device_usage', {
      device_id: _.in(chunk),
      status: 'using'
    })
    list.forEach((item) => {
      if (item.device_id) used.push(item.device_id)
    })
  }
  return used
}

module.exports = {
  QUERY_LIMIT,
  IN_CHUNK,
  PARALLEL_LIMIT,
  getUserGroupName,
  getVisibleCondition,
  buildVisibleQuery,
  fetchAllDocs,
  getUsingDeviceIds
}
