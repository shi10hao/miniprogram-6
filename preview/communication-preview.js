// 生成 communication / communicationDetail 的静态预览页并截图（仅供本地自检，不参与小程序构建）
// 用法：node preview/communication-preview.js
// 把 wxss 里的 rpx 按 1:1 换成 px，在 750px 宽视口下渲染，和真机 750 设计稿一致。
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const toPx = css => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const appCss = toPx(read('miniprogram/app.wxss'))
const listCss = toPx(read('miniprogram/pages/communication/communication.wxss'))
const detailCss = toPx(read('miniprogram/pages/communicationDetail/communicationDetail.wxss'))

const baseCss = `
view { display: block; }
text { display: inline; }
page { display: block; }
body { margin: 0; background: #f4f6f8; }
input { flex: 1; min-width: 0; height: 72px; padding: 0; border: 0; outline: 0; background: transparent; font: inherit; }
input::placeholder { color: #9aa4b2; font-size: 26px; }
/* 仅预览用：状态面板不需要再叠头部 */
.panel { margin-bottom: 20px; }
.panel .body { margin-top: 0; }
.cap { padding: 28px 24px 16px; background: #fff; font-size: 24px; font-weight: 600; color: #5f6b7a; }
`

const html = (title, pageCss, body) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>${baseCss}</style><style>${appCss}</style><style>${pageCss}</style></head>
<body>${body}</body></html>`

// ============ communication 列表页 ============
const deviceCard = name => `
          <view class="device-card">
            <view class="device-icon">🔬</view>
            <view class="device-main">
              <text class="device-name">${name}</text>
              <text class="device-desc">查看用过它的同学</text>
            </view>
            <text class="device-arrow">›</text>
          </view>`

const skeletonCards = count => Array.from({ length: count }).map(() => `
          <view class="ds-skeleton-card sk-card">
            <view class="ds-skeleton sk-icon"></view>
            <view class="sk-main">
              <view class="ds-skeleton sk-line-lg"></view>
              <view class="ds-skeleton sk-line-sm"></view>
            </view>
          </view>`).join('')

const hero = `
    <view class="hero">
      <view class="hero-eyebrow">实验室经验共享</view>
      <view class="hero-title">找到用过这台仪器的同学</view>
      <view class="hero-desc">少走弯路，直接向他们请教实操细节</view>
      <view class="hero-badge">仅统计已完成的使用记录</view>
    </view>`

const searchCard = `
    <view class="search-card">
      <view class="search-field">
        <text class="search-icon">🔍</text>
        <input class="search-input" value="色谱" />
        <view class="search-clear">✕</view>
      </view>
      <view class="ds-btn search-submit">搜索</view>
    </view>`

const listMain = `<page>
  <view class="page">
    ${hero}
    <view class="body">
      ${searchCard}

      <view class="section">
        <view class="sec-head">
          <text class="ds-section-title">我最近用过的仪器</text>
          <text class="sec-hint">共 2 台</text>
        </view>
        <view class="list">
          ${deviceCard('高效液相色谱仪')}
          ${deviceCard('紫外可见分光光度计')}
        </view>
      </view>

      <view class="section">
        <view class="sec-head">
          <text class="ds-section-title">搜索结果</text>
          <text class="sec-hint">共 2 台</text>
        </view>
        <view class="list">
          ${deviceCard('高效液相色谱仪 Agilent 1260')}
          ${deviceCard('离子色谱仪')}
        </view>
      </view>
    </view>
  </view>
</page>`

// 列表页各状态
const listStates = `<page>
  <view class="panel">
    <view class="cap">1. 未登录：引导登录，搜索仍可用</view>
    ${hero}
    <view class="body">
      ${searchCard.replace('value="色谱"', 'placeholder="输入仪器名称，如 紫外分光光度计"')}
      <view class="ds-card guide-card">
        <view class="guide-icon">💬</view>
        <view class="guide-title">登录后查看你的使用记录</view>
        <view class="guide-desc">登录可一键回到最近用过的仪器；不登录也能用上方搜索直接找同学</view>
        <view class="ds-btn ds-btn-block guide-btn">去登录</view>
      </view>
    </view>
  </view>

  <view class="panel">
    <view class="cap">2. 最近仪器为空</view>
    <view class="body">
      <view class="section" style="margin-top: 0">
        <view class="sec-head"><text class="ds-section-title">我最近用过的仪器</text></view>
        <view class="ds-card state-card">
          <text class="state-icon">🧾</text>
          <text class="state-title">还没有已完成的使用记录</text>
          <text class="state-desc">用上方搜索找仪器，同样能看到用过它的同学</text>
        </view>
      </view>
    </view>
  </view>

  <view class="panel">
    <view class="cap">3. 加载中：骨架屏</view>
    <view class="body">
      <view class="section" style="margin-top: 0">
        <view class="sec-head"><text class="ds-section-title">我最近用过的仪器</text></view>
        <view class="list">${skeletonCards(2)}</view>
      </view>
    </view>
  </view>

  <view class="panel">
    <view class="cap">4. 加载失败：整卡可点重试</view>
    <view class="body">
      <view class="section" style="margin-top: 0">
        <view class="sec-head"><text class="ds-section-title">我最近用过的仪器</text></view>
        <view class="ds-card state-card">
          <text class="state-icon">⚠️</text>
          <text class="state-title">最近仪器加载失败</text>
          <text class="state-desc">点击此处重试</text>
        </view>
      </view>
    </view>
  </view>

  <view class="panel">
    <view class="cap">5. 搜索无结果</view>
    <view class="body">
      <view class="section" style="margin-top: 0">
        <view class="sec-head"><text class="ds-section-title">搜索结果</text></view>
        <view class="ds-empty">
          <text class="ds-empty-icon">🔍</text>
          <text class="ds-empty-title">没有找到「分光」</text>
          <text class="ds-empty-desc">换个关键词，或只输入仪器名称的一部分试试</text>
        </view>
      </view>
    </view>
  </view>
</page>`

// ============ communicationDetail 详情页 ============
const userCard = (u, i) => `
        <view class="user-card">
          <view class="user-head">
            <view class="avatar">${u.name.slice(0, 1)}</view>
            <view class="user-main">
              <view class="user-name-row">
                <text class="user-name">${u.name}</text>
                ${u.group ? `<text class="ds-tag ds-tag-primary">${u.group}</text>` : ''}
              </view>
              <text class="user-sub">最近使用：${u.time}</text>
            </view>
          </view>
          <view class="user-meta">
            <view class="meta-row">
              <text class="meta-label">学号</text>
              <text class="meta-val">${u.sid}</text>
            </view>
            <view class="meta-row">
              <text class="meta-label">手机号</text>
              <text class="meta-val">${u.phone}</text>
              <view class="call-btn">拨号</view>
            </view>
          </view>
        </view>`

const users = [
  { name: '张若曦', group: '第3组', time: '今天 14:20', sid: '2021010305', phone: '13800138001' },
  { name: '李承宇', group: '第1组', time: '昨天 09:05', sid: '2021020411', phone: '13900139002' },
  { name: '王雨桐', group: '', time: '3月8日', sid: '2020030218', phone: '13700137003' },
  { name: '陈嘉树', group: '第4组', time: '2025年12月19日', sid: '2019020422', phone: '13600136004' }
]

const detailHero = (name) => `
    <view class="hero">
      <view class="hero-eyebrow">历史使用者</view>
      <view class="hero-title">${name}</view>
      <view class="hero-desc">按最近使用时间排序，可直接联系他们请教</view>
    </view>`

const detailMain = `<page>
  <view class="page">
    ${detailHero('高效液相色谱仪')}
    <view class="body">
      <view class="notice">
        <text class="notice-dot"></text>
        <text class="notice-text">仅展示已完成的使用记录</text>
      </view>
      <view class="sec-head">
        <text class="ds-section-title">使用过它的同学</text>
        <text class="sec-hint">已加载 4 位</text>
      </view>
      <view class="list">
        ${users.map(userCard).join('')}
        <view class="more-area">
          <view class="ds-btn ds-btn-ghost load-more">加载更多</view>
        </view>
      </view>
    </view>
  </view>
</page>`

const detailSkeleton = `
      <view class="list">
        ${Array.from({ length: 3 }).map(() => `
        <view class="ds-skeleton-card sk-card">
          <view class="ds-skeleton sk-avatar"></view>
          <view class="sk-main">
            <view class="ds-skeleton sk-line-lg"></view>
            <view class="ds-skeleton sk-line-sm"></view>
            <view class="ds-skeleton sk-line-sm"></view>
          </view>
        </view>`).join('')}
      </view>`

const detailStates = `<page>
  <view class="panel">
    <view class="cap">1. 加载中：骨架屏</view>
    ${detailHero('高效液相色谱仪')}
    <view class="body">
      <view class="notice"><text class="notice-dot"></text><text class="notice-text">仅展示已完成的使用记录</text></view>
      ${detailSkeleton}
    </view>
  </view>

  <view class="panel">
    <view class="cap">2. 加载失败：可重试</view>
    <view class="body">
      <view class="notice"><text class="notice-dot"></text><text class="notice-text">仅展示已完成的使用记录</text></view>
      <view class="state-card">
        <text class="state-icon">⚠️</text>
        <text class="state-title">使用者信息加载失败</text>
        <view class="ds-btn ds-btn-ghost retry-btn">重新加载</view>
      </view>
    </view>
  </view>

  <view class="panel">
    <view class="cap">3. 没有使用者</view>
    <view class="body">
      <view class="notice"><text class="notice-dot"></text><text class="notice-text">仅展示已完成的使用记录</text></view>
      <view class="ds-empty">
        <text class="ds-empty-icon">🧑‍🔬</text>
        <text class="ds-empty-title">还没有人用过这台仪器</text>
        <text class="ds-empty-desc">等有同学完成使用后，这里会出现他们的联系方式</text>
      </view>
    </view>
  </view>

  <view class="panel">
    <view class="cap">4. 已全部加载</view>
    <view class="body">
      <view class="sec-head"><text class="ds-section-title">使用过它的同学</text><text class="sec-hint">已加载 2 位</text></view>
      <view class="list">
        ${users.slice(0, 2).map(userCard).join('')}
        <view class="more-area"><text class="no-more">已显示全部使用者</text></view>
      </view>
    </view>
  </view>
</page>`

const files = [
  ['communication-preview.html', '经验交流 · 正常态', listCss, listMain, 'communication-preview.png'],
  ['communication-states.html', '经验交流 · 各种状态', listCss, listStates, 'communication-states.png'],
  ['communicationDetail-preview.html', '经验交流 · 使用者', detailCss, detailMain, 'communicationDetail-preview.png'],
  ['communicationDetail-states.html', '经验交流 · 使用者状态', detailCss, detailStates, 'communicationDetail-states.png']
]

for (const [file, title, css, body] of files) {
  fs.writeFileSync(path.join(__dirname, file), html(title, css, body))
}
console.log('已生成预览页：' + files.map(f => f[0]).join('、'))

// ============ 截图 ============
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 9339
const profile = path.join(__dirname, '.chrome-profile-comm')
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
  await send('Emulation.setDeviceMetricsOverride', { width: 750, height: 1200, deviceScaleFactor: 1, mobile: false })

  for (const [file, , , , png] of files) {
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
  // 清掉临时 profile，避免几百个 Chrome 缓存文件留在仓库里
  await sleep(600)
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch (e) {}
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
