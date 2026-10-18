// 生成合并后「消息/公告详情」的静态预览并整页截图（仅供本地自检，不参与小程序构建）
// 用法：node preview/message-detail-preview.js
// 与 build-preview.js 一致：wxss 的 rpx 按 1:1 换成 px，在 750px 宽视口渲染
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const toPx = css => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const appCss = toPx(read('miniprogram/app.wxss'))
const pageCss = toPx(read('miniprogram/pages/message/detail/messagedetail.wxss'))

const noticeText = `各位老师、同学：

本周六（5 月 11 日）上午 8:00-12:00 对 A302 实验室进行设备检修，期间暂停预约。
请提前安排实验时间，谢谢配合。`

const messageText = `您预约的高效液相色谱仪（HPLC-A02）将于明天 09:00 开始使用，请提前 10 分钟到达 A302 实验室，并携带学生证。`

const noticeScreen = `
<page class="ds-page">
  <view class="ds-card detail-card">
    <text class="detail-title">关于 A302 实验室设备检修的通知</text>
    <view class="detail-meta">
      <text class="detail-time">2024-05-06 07:08</text>
      <text class="ds-tag ds-tag-muted">管理员公告</text>
    </view>
    <view class="detail-content">
      <text class="detail-content-text">${noticeText}</text>
    </view>
    <view class="doc-btn">
      <text class="doc-btn-icon">📄</text>
      <view class="doc-btn-body">
        <text class="doc-btn-text">打开协作文档</text>
        <text class="doc-btn-desc">在腾讯文档中查看完整内容</text>
      </view>
      <text class="doc-btn-arrow">›</text>
    </view>
  </view>
</page>`

const messageScreen = `
<page class="ds-page">
  <view class="ds-card detail-card">
    <text class="detail-title">预约提醒</text>
    <view class="detail-meta">
      <text class="detail-time">2024-05-06 07:08</text>
      <text class="ds-tag ds-tag-primary">预约提醒</text>
    </view>
    <view class="detail-content">
      <text class="detail-content-text">${messageText}</text>
    </view>
  </view>
</page>`

const emptyScreen = `
<page class="ds-page">
  <view class="ds-empty detail-empty">
    <text class="ds-empty-icon">📭</text>
    <text class="ds-empty-title">公告不存在</text>
    <text class="ds-empty-desc">该公告可能已被删除或无法访问</text>
  </view>
</page>`

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>消息/公告详情 合并预览</title>
<style>
view { display: block; }
text { display: inline; }
page { display: block; }
body { margin: 0; }
</style>
<style>${appCss}</style>
<style>${pageCss}</style>
<style>
/* 仅预览用：叠三屏做对照，去掉每屏的 100vh 撑高 */
.preview-label { padding: 14px 24px 10px; font: 600 15px/1.4 -apple-system, "Microsoft YaHei", sans-serif; color: #5f6b7a; background: #fff; border-top: 1px solid #e4e9ee; }
.preview-screen { width: 750px; }
.preview-screen .ds-page { min-height: 0; padding-bottom: 40px; }
</style>
</head>
<body>
<div class="preview-label">① 公告详情（含腾讯文档链接 → 协作文档入口）</div>
<div class="preview-screen">${noticeScreen}</div>
<div class="preview-label">② 消息详情（无文档链接，不显示入口）</div>
<div class="preview-screen">${messageScreen}</div>
<div class="preview-label">③ 空状态</div>
<div class="preview-screen">${emptyScreen}</div>
</body>
</html>`

const htmlPath = path.join(__dirname, 'message-detail-preview.html')
const pngPath = path.join(__dirname, 'message-detail-preview.png')
fs.writeFileSync(htmlPath, html)
console.log('已生成 preview/message-detail-preview.html')

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 9337
const profile = path.join(__dirname, '.chrome-profile-msgdetail')

async function capture () {
  fs.rmSync(profile, { recursive: true, force: true })
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--window-size=750,1200', 'about:blank'
  ], { stdio: 'ignore' })

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  let targets = null
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      targets = await res.json()
      if (targets.some(t => t.type === 'page')) break
    } catch (e) {}
    await sleep(250)
  }
  if (!targets) throw new Error('chrome 未启动')

  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  await new Promise(r => { ws.onopen = r })
  const send = (method, params = {}) => new Promise(resolve => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 750, height: 1200, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: 'file:///' + htmlPath.replace(/\\/g, '/') })
  await sleep(1000)

  const metrics = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })',
    returnByValue: true
  })
  const { w, h } = JSON.parse(metrics.result.result.value)
  await send('Emulation.setDeviceMetricsOverride', { width: 750, height: h, deviceScaleFactor: 2, mobile: true })
  await sleep(300)

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  fs.writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'))
  console.log(`已截图 preview/message-detail-preview.png（${w}x${h}，@2x）`)

  ws.close()
  child.kill()
  fs.rmSync(profile, { recursive: true, force: true })
}

capture().catch(err => {
  console.error(err)
  process.exit(1)
})
