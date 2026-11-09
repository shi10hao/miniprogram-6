/**
 * 云函数订阅消息配置的静态校验（不依赖 wx.* / 云环境，可直接 node 跑）
 * 运行：cd miniprogram && node tests/subscribeMessageConfig.test.js
 *
 * 盯的是两类「代码没错、配置错了，线上静默不生效」的坑：
 *   1. 调了 cloud.openapi.subscribeMessage.send，却没在 config.json 里声明
 *      permissions.openapi —— 云调用会直接失败；
 *   2. 定时触发器的 cron 字段数不是 7 —— 微信云开发要求「秒 分 时 日 月 星期 年」，
 *      少一段的配置不会按时触发，整个定时提醒形同不存在。
 *
 * 这两条都是改配置就能修好的问题，但没有任何编译器会报错，所以用测试兜住。
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const cloudfunctionsDir = path.join(__dirname, '..', '..', 'cloudfunctions')
const SEND_API = 'subscribeMessage.send'
const TIMER_FIELD_COUNT = 7

function listFunctionDirs() {
  return fs.readdirSync(cloudfunctionsDir, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => item.name)
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    return ''
  }
}

function readConfig(fnName) {
  const configPath = path.join(cloudfunctionsDir, fnName, 'config.json')
  const raw = readFileSafe(configPath)
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    assert.fail(`${fnName}/config.json 不是合法 JSON：${err.message}`)
    return null
  }
}

const fnNames = listFunctionDirs()
assert.ok(fnNames.length > 0, 'cloudfunctions 目录下应至少有一个云函数')

// ---- 1. 云调用权限：调了 subscribeMessage.send 就必须声明 ----
const senders = fnNames.filter((name) => {
  const source = readFileSafe(path.join(cloudfunctionsDir, name, 'index.js'))
  return source.indexOf(SEND_API) !== -1
})
assert.ok(senders.length > 0, '应该至少有一个云函数调用订阅消息发送接口')

senders.forEach((name) => {
  const config = readConfig(name)
  assert.ok(config, `${name} 缺少 config.json`)
  const openapi = (config.permissions && config.permissions.openapi) || []
  assert.ok(
    openapi.indexOf(SEND_API) !== -1,
    `${name} 调用了 ${SEND_API}，但 config.json 的 permissions.openapi 没声明它`
  )
})

// ---- 2. 定时触发器：cron 必须是 7 段 ----
fnNames.forEach((name) => {
  const config = readConfig(name)
  if (!config || !Array.isArray(config.triggers)) return
  config.triggers.forEach((trigger) => {
    if (!trigger || trigger.type !== 'timer') return
    const fields = String(trigger.config || '').trim().split(/\s+/).filter(Boolean)
    assert.strictEqual(
      fields.length,
      TIMER_FIELD_COUNT,
      `${name} 的定时触发器「${trigger.name}」cron 只有 ${fields.length} 段，`
      + `微信云开发要求 7 段（秒 分 时 日 月 星期 年）：${trigger.config}`
    )
  })
})

// ---- 3. 使用提醒只保留一份实现，避免两个定时器互相压制 ----
const usageReminderTriggers = fnNames.filter((name) => {
  const config = readConfig(name)
  if (!config || !Array.isArray(config.triggers)) return false
  return config.triggers.some(trigger => trigger && trigger.type === 'timer')
    && readFileSafe(path.join(cloudfunctionsDir, name, 'index.js')).indexOf('device_usage') !== -1
    && readFileSafe(path.join(cloudfunctionsDir, name, 'index.js')).indexOf('usage_photo_remind') !== -1
})
assert.ok(
  usageReminderTriggers.length <= 1,
  `使用中照片提醒只应有一个定时函数，现在有：${usageReminderTriggers.join('、')}`
)

console.log(`订阅消息配置检查通过：${senders.length} 个发送函数、定时触发器字段数均为 ${TIMER_FIELD_COUNT}`)
