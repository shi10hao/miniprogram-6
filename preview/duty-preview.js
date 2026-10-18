// 生成 duty-upload（安全员打卡）的静态预览页并截图（仅供本地自检，不参与小程序构建）
// 用法：node preview/duty-preview.js
// 把 wxss 里的 rpx 按 1:1 换成 px，在 750px 宽视口下渲染，和真机 750 设计稿一致。
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const toPx = css => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const appCss = toPx(read('miniprogram/app.wxss'))
const pageCss = toPx(read('miniprogram/pages/duty-upload/duty-upload.wxss'))

const baseCss = `
view { display: block; }
text { display: inline; }
page { display: block; }
body { margin: 0; background: #f4f6f8; }
input, textarea { display: block; font: inherit; border: 0; outline: 0; background: transparent; color: inherit; }
textarea { resize: none; }
input::placeholder, textarea::placeholder { color: #c4ccd6; font-size: 28px; }
/* 仅预览用：状态面板不需要再叠头部 */
.panel { margin-bottom: 20px; }
.panel .body { margin-top: 0; }
.panel .hero { padding-bottom: 36px; }
.cap { padding: 28px 24px 16px; background: #fff; font-size: 24px; font-weight: 600; color: #5f6b7a; }
`

const html = (title, body) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>${baseCss}</style><style>${appCss}</style><style>${pageCss}</style></head>
<body>${body}</body></html>`

// 缩略图用渐变代替真实照片，只关心排版
const photo = (index, gradient) => `
          <view class="photo-item">
            <image class="photo-img" style="background:${gradient}"></image>
            <view class="photo-remove">✕</view>
          </view>`

const photoAdd = `
          <view class="photo-add">
            <text class="photo-add-plus">＋</text>
            <text class="photo-add-text">添加照片</text>
          </view>`

const hero = `
    <view class="hero">
      <text class="hero-eyebrow">安全员打卡</text>
      <text class="hero-title">记录本次值日情况</text>
      <text class="hero-desc">上传现场照片并补充说明，管理员可在后台查看</text>
      <view class="hero-badge">
        <text class="hero-badge-dot"></text>
        <text>带 * 的为必填项</text>
      </view>
    </view>`

const field = ({ label, value, placeholder, error, last, required = true }) => `
      <view class="field ${last ? 'field-last' : ''}">
        <text class="field-label">${label}<text class="field-required">${required ? '*' : ''}</text></text>
        <input class="field-input ${error ? 'is-error' : ''}" value="${value || ''}" placeholder="${placeholder || ''}" />
        ${error ? `<text class="field-error">${error}</text>` : ''}
      </view>`

const photoSection = ({ count, error }) => `
    <view class="ds-card">
      <view class="ds-section-head">
        <text class="ds-section-title">现场照片</text>
        <text class="sec-hint">${count}/3</text>
      </view>
      <view class="photo-grid">
        ${Array.from({ length: count }).map((_, i) => photo(i, i === 0
          ? 'linear-gradient(135deg,#cfe9ec,#8fc9cf)'
          : 'linear-gradient(135deg,#e6eef5,#b9c9d6)')).join('')}
        ${count < 3 ? photoAdd : ''}
      </view>
      ${error ? `<text class="field-error">${error}</text>` : ''}
      <text class="photo-tip">最多 3 张，建议拍到台面、设备与废物存放区</text>
    </view>`

const remarkSection = ({ value, count }) => `
    <view class="ds-card">
      <view class="ds-section-head">
        <text class="ds-section-title">情况说明</text>
        <text class="sec-hint">选填</text>
      </view>
      <view class="remark-box">
        <textarea class="remark-input" placeholder="例如：台面已清洁，废液已按规定回收">${value || ''}</textarea>
        <text class="remark-count">${count}/200</text>
      </view>
    </view>`

const submitSection = ({ submitting }) => `
    <view class="ds-btn ds-btn-block submit-btn ${submitting ? 'is-disabled' : ''}">${submitting ? '提交中...' : '提交打卡'}</view>
    <text class="submit-tip">提交后管理员可在「卫生打卡记录」中查看</text>`

// ---------- 正常态：已填满 ----------
const filledBody = `<page>
  <view class="page">
    ${hero}
    <view class="body">
      <view class="ds-card">
        <view class="ds-section-head"><text class="ds-section-title">基本信息</text></view>
        ${field({ label: '实验室名称', value: '化学楼 A301', placeholder: '如：化学楼 A301' })}
        ${field({ label: '值日人员姓名', value: '张若曦', placeholder: '请输入姓名' })}
        ${field({ label: '手机号', value: '13800138001', placeholder: '用于管理员联系你', last: true })}
      </view>

      ${photoSection({ count: 2 })}
      ${remarkSection({ value: '台面已清洁，废液已按规定回收，通风橱正常。', count: 24 })}
      ${submitSection({ submitting: false })}
    </view>
  </view>
</page>`

// ---------- 各种状态 ----------
const emptyBody = `<page>
  <view class="panel">
    <view class="cap">1. 空表单（未填）</view>
    <view class="body">
      <view class="ds-card">
        <view class="ds-section-head"><text class="ds-section-title">基本信息</text></view>
        ${field({ label: '实验室名称', placeholder: '如：化学楼 A301' })}
        ${field({ label: '值日人员姓名', placeholder: '请输入姓名' })}
        ${field({ label: '手机号', placeholder: '用于管理员联系你', last: true })}
      </view>
      ${photoSection({ count: 0 })}
      ${remarkSection({ count: 0 })}
      ${submitSection({ submitting: false })}
    </view>
  </view>

  <view class="panel">
    <view class="cap">2. 校验失败（字段内联报错）</view>
    <view class="body">
      <view class="ds-card">
        <view class="ds-section-head"><text class="ds-section-title">基本信息</text></view>
        ${field({ label: '实验室名称', value: '化学楼 A301', error: '' })}
        ${field({ label: '值日人员姓名', placeholder: '请输入姓名', error: '请填写值日人员姓名' })}
        ${field({ label: '手机号', value: '1380013', placeholder: '用于管理员联系你', error: '请填写正确的 11 位手机号', last: true })}
      </view>
      ${photoSection({ count: 0, error: '请至少上传 1 张现场照片' })}
    </view>
  </view>

  <view class="panel">
    <view class="cap">3. 满 3 张（添加按钮消失）</view>
    <view class="body">
      ${photoSection({ count: 3 })}
      ${remarkSection({ value: '已检查完毕。', count: 6 })}
    </view>
  </view>

  <view class="panel">
    <view class="cap">4. 提交中</view>
    <view class="body">
      ${submitSection({ submitting: true })}
    </view>
  </view>
</page>`

const files = [
  ['duty-upload-preview.html', '安全员打卡 · 已填', filledBody, 'duty-upload-preview.png'],
  ['duty-upload-states.html', '安全员打卡 · 各种状态', emptyBody, 'duty-upload-states.png']
]

for (const [file, title, body] of files) {
  fs.writeFileSync(path.join(__dirname, file), html(title, body))
}
console.log('已生成预览页：' + files.map(f => f[0]).join('、'))

// ============ 截图 ============
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 9341
const profile = path.join(__dirname, '.chrome-profile-duty')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  fs.rmSync(profile, { recursive: true, force: true })
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--window-size=750,1200', 'about:blank'
  ], { stdio: 'ignore' })

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
  const target = targets.find(t => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
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

  for (const [file, , , png] of files) {
    const url = 'file:///' + path.join(__dirname, file).replace(/\\/g, '/')
    // 每次先把视口重置成固定高度：.page 有 min-height:100vh，会沿用上一次截图留下的超大视口
    await send('Emulation.setDeviceMetricsOverride', { width: 750, height: 1200, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url })
    await sleep(700)
    const heightRes = await send('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true })
    const height = heightRes.result.result.value
    await send('Emulation.setDeviceMetricsOverride', { width: 750, height, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 750, height, scale: 1 }
    })
    fs.writeFileSync(path.join(__dirname, png), Buffer.from(shot.result.data, 'base64'))
    console.log(`已截图 ${png} 750x${height}`)
  }

  ws.close()
  child.kill()
  await sleep(600)
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch (e) {}
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
