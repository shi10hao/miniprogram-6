// 云函数 sendNoticeSubMsg：发布公告后，给「还有订阅额度」的学生下发一次性订阅消息
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const USERS = 'users'

// 必须和 miniprogram/pages/index/index.js 的 NOTICE_TMPL_ID 一致
const NOTICE_TMPL_ID = '9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg'
// 公告列表页的真实路径（app.json 里注册的就是这个）；page 不能以 / 开头
const NOTICE_PAGE = 'pages/notice/list/noticelist'
// 正式版用户点通知才跳得到正式版；开发/体验版联调时可传 developer / trial
const DEFAULT_MINIPROGRAM_STATE = 'formal'
// 用户拒绝接收或额度已耗尽，继续推送只会继续报错，直接把额度归零
const ERR_NO_QUOTA = 43101
// 微信 thing 类型限制 20 个字符
const THING_MAX = 20

// 云函数运行时区不保证是东八区，固定按上海时区输出，避免时间差 8 小时
const CHINA_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

/**
 * 截断到 thing 类型允许的长度
 * @param {string} str 原始文本
 * @param {number} len 最大字符数
 * @returns {string}
 */
function cutStr(str, len = THING_MAX) {
  if (!str) return ''
  const text = String(str).replace(/\s+/g, ' ').trim()
  if (text.length <= len) return text
  return `${text.slice(0, len - 1)}…`
}

/**
 * 转成微信 time 类型要求的 "2026年11月6日 14:30"
 * 入参可能是 publish_date 的 ISO 串（UTC）、Date 或毫秒时间戳
 * @param {string|number|Date} input 时间
 * @returns {string} 解析失败返回空串
 */
function formatTime(input) {
  if (!input) return ''
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return ''

  const parts = CHINA_TIME_FORMAT.formatToParts(date)
  const pick = (type) => {
    const hit = parts.find(item => item.type === type)
    return hit ? hit.value : ''
  }
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  const hour = pick('hour')
  const minute = pick('minute')
  if (!year || !month || !day) return ''
  return `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`
}

/**
 * 扣掉一条额度（发送成功才扣）
 * @param {string} userId users 文档 _id
 * @returns {Promise<void>}
 */
async function consumeQuota(userId) {
  try {
    await db.collection(USERS).doc(userId).update({
      data: {
        'subMsg.count': _.inc(-1),
        'subMsg.lastSendTime': Date.now()
      }
    })
  } catch (err) {
    // 扣减失败不影响本次推送，下次发送会靠 43101 自愈
    console.error('[sendNoticeSubMsg] 扣减订阅次数失败', userId, err)
  }
}

/**
 * 额度已失效，归零避免下次再撞
 * @param {string} userId users 文档 _id
 * @returns {Promise<void>}
 */
async function clearQuota(userId) {
  try {
    await db.collection(USERS).doc(userId).update({
      data: { 'subMsg.count': 0 }
    })
  } catch (err) {
    console.error('[sendNoticeSubMsg] 清零订阅次数失败', userId, err)
  }
}

/**
 * 给单个用户发一条公告通知
 * @param {Object} user { _id, _openid }
 * @param {Object} messageData 模板数据
 * @param {Object} options { page, miniprogramState }
 * @returns {Promise<{openid:string, ok:boolean, errCode?:number}>}
 */
async function sendOne(user, messageData, options) {
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: user._openid,
      templateId: NOTICE_TMPL_ID,
      page: options.page,
      data: messageData,
      miniprogramState: options.miniprogramState,
      lang: 'zh_CN'
    })
    await consumeQuota(user._id)
    return { openid: user._openid, ok: true }
  } catch (err) {
    const errCode = err && err.errCode
    if (errCode === ERR_NO_QUOTA) {
      await clearQuota(user._id)
    }
    console.error('[sendNoticeSubMsg] 发送失败', user._openid, errCode, err && err.errMsg)
    return { openid: user._openid, ok: false, errCode }
  }
}

/**
 * 按 batchSize 把有额度的学生全部拉出来
 * 必须先全部查完再开始扣减：扣减会让文档不再满足 subMsg.count > 0，
 * 边查边扣会让 skip 分页错位、漏掉用户
 * @param {number} batchSize 每批条数
 * @returns {Promise<Array<Object>>}
 */
async function listStudentsWithQuota(batchSize) {
  const where = {
    role: 'student',
    'subMsg.count': _.gt(0)
  }
  const countRes = await db.collection(USERS).where(where).count()
  const total = countRes.total || 0
  const batchTimes = Math.ceil(total / batchSize)
  const tasks = []

  for (let i = 0; i < batchTimes; i++) {
    tasks.push(
      db.collection(USERS)
        .where(where)
        .skip(i * batchSize)
        .limit(batchSize)
        .field({ _openid: true, _id: true })
        .get()
    )
  }

  const results = await Promise.all(tasks)
  return results.reduce((acc, cur) => acc.concat(cur.data), [])
}

/**
 * 发布公告后推送订阅消息
 * @param {Object} event { title, content, publishDate, page?, miniprogramState? }
 * @returns {Promise<{code:number,msg:string,data?:Object}>}
 */
exports.main = async (event = {}) => {
  const {
    title = '',
    content = '',
    publishDate = '',
    page = NOTICE_PAGE,
    miniprogramState = DEFAULT_MINIPROGRAM_STATE,
    batchSize = 100,
    concurrency = 5
  } = event

  if (!title) {
    return { code: -1, msg: '缺少公告标题' }
  }

  // 这两个值来自调用方，为 0 会让分页/批量循环原地打转，必须夹到安全区间
  const safeBatchSize = Math.min(Math.max(Math.floor(Number(batchSize)) || 100, 1), 1000)
  const safeConcurrency = Math.min(Math.max(Math.floor(Number(concurrency)) || 5, 1), 20)

  const timeText = formatTime(publishDate || new Date()) || formatTime(new Date())
  const messageData = {
    thing30: { value: cutStr(title) },
    time3: { value: timeText },
    thing2: { value: cutStr(content) }
  }

  try {
    const users = await listStudentsWithQuota(safeBatchSize)
    if (!users.length) {
      return { code: 0, msg: 'ok', data: { total: 0, sent: 0, failed: 0, results: [] } }
    }

    const sendResults = []
    for (let i = 0; i < users.length; i += safeConcurrency) {
      const batch = users.slice(i, i + safeConcurrency)
      const batchResults = await Promise.all(
        batch.map(user => sendOne(user, messageData, { page, miniprogramState }))
      )
      sendResults.push(...batchResults)
    }

    const sent = sendResults.filter(item => item.ok).length
    return {
      code: 0,
      msg: 'ok',
      data: {
        total: users.length,
        sent,
        failed: users.length - sent,
        results: sendResults
      }
    }
  } catch (err) {
    console.error('[sendNoticeSubMsg] 推送异常', err)
    return { code: -99, msg: '服务器异常' }
  }
}
