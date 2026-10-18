// 生成 appointment（预约与使用记录）的静态预览页并截图
// 用法：node preview/appointment-preview.js
// 把 wxss 里的 rpx 按 1:1 换成 px，在 750px 宽视口下渲染，和真机 750 设计稿一致。
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const toPx = css => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const appCss = toPx(read('miniprogram/app.wxss'))
const pageCss = toPx(read('miniprogram/pages/appointment/appointment.wxss'))

const baseCss = `
view { display: block; }
text { display: inline; }
page { display: block; }
body { margin: 0; background: #f5f5f5; font-family: system-ui, -apple-system, "PingFang SC", sans-serif; }
.cap { padding: 24px 20px 12px; background: #fff; font-size: 24px; font-weight: 600; color: #5f6b7a; }
.panel { margin-bottom: 16px; }
`

const html = (title, body) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>${baseCss}</style><style>${appCss}</style><style>${pageCss}</style></head>
<body>${body}</body></html>`

const RESERVATION_FILTERS = ['全部', '待开始', '已过期', '已生效', '已取消']
const USAGE_FILTERS = ['全部', '已完成', '异常']

const tabs = active => `
  <view class="tabs">
    <view class="tab ${active === 'reservation' ? 'tab-active' : ''}">预约记录</view>
    <view class="tab ${active === 'usage' ? 'tab-active' : ''}">使用记录</view>
  </view>`

const filterTabs = (tabsList, activeIndex) => `
  <view class="filter-tabs">
    ${tabsList.map((label, i) => `<view class="filter-tab ${i === activeIndex ? 'filter-active' : ''}">${label}</view>`).join('')}
  </view>`

const reservationItem = ({ name, status, class: cls, hint, deviceId, date, period, created, canCancel, busy }) => `
    <view class="history-item">
      <view class="item-header">
        <text class="device-name">${name}</text>
        <text class="status ${cls}">${status}</text>
      </view>
      ${hint ? `<view class="item-tip">${hint}</view>` : ''}
      <view class="item-content">
        <view class="item-row"><text class="item-label">仪器编号：</text><text class="item-value">${deviceId}</text></view>
        <view class="item-row"><text class="item-label">预约日期：</text><text class="item-value">${date}</text></view>
        <view class="item-row"><text class="item-label">预约时段：</text><text class="item-value">${period}</text></view>
        <view class="item-row"><text class="item-label">提交时间：</text><text class="item-value">${created}</text></view>
        ${canCancel ? `<view class="item-actions"><view class="cancel-btn ${busy ? 'is-busy' : ''}">${busy ? '取消中...' : '取消预约'}</view></view>` : ''}
      </view>
    </view>`

const usageItem = ({ name, status, class: cls, deviceId, date, period, photos }) => `
    <view class="history-item">
      <view class="item-header">
        <text class="device-name">${name}</text>
        <text class="status ${cls}">${status}</text>
      </view>
      <view class="item-content">
        <view class="item-row"><text class="item-label">仪器编号：</text><text class="item-value">${deviceId}</text></view>
        <view class="item-row"><text class="item-label">使用日期：</text><text class="item-value">${date}</text></view>
        <view class="item-row"><text class="item-label">使用时段：</text><text class="item-value">${period}</text></view>
        ${photos ? `<view class="item-row"><text class="item-label">使用照片：</text><text class="item-value">${photos}张</text></view>` : ''}
      </view>
    </view>`

const reservations = [
  {
    name: '高效液相色谱仪',
    status: '待开始',
    class: 'upcoming',
    canCancel: true,
    deviceId: 'HPLC-01',
    date: '2026-10-19',
    period: '09:00 - 11:00',
    created: '2026-10-18 09:12:40'
  },
  {
    name: '紫外可见分光光度计',
    status: '已到时段',
    class: 'ready',
    hint: '预约时段内，可去实验室开始使用',
    canCancel: true,
    deviceId: 'UV-02',
    date: '2026-10-18',
    period: '17:00 - 18:30',
    created: '2026-10-18 08:30:11'
  },
  {
    name: '台式高速离心机',
    status: '已过期',
    class: 'expired',
    hint: '预约时段已过，且未开始使用',
    deviceId: 'CEN-03',
    date: '2026-10-17',
    period: '14:00 - 15:00',
    created: '2026-10-16 20:05:02'
  },
  {
    name: '电子分析天平',
    status: '使用中',
    class: 'using',
    hint: '',
    deviceId: 'BAL-05',
    date: '2026-10-18',
    period: '16:00 - 18:00',
    created: '2026-10-18 15:40:33'
  },
  {
    name: 'pH 计',
    status: '异常',
    class: 'abnormal',
    deviceId: 'PH-07',
    date: '2026-10-15',
    period: '10:00 - 11:00',
    created: '2026-10-14 16:22:10'
  },
  {
    name: '超净工作台',
    status: '已取消',
    class: 'cancelled',
    hint: '这次预约已取消，时段已释放',
    deviceId: 'CLN-01',
    date: '2026-10-12',
    period: '13:00 - 14:00',
    created: '2026-10-11 19:01:55'
  }
]

const usages = [
  {
    name: '高效液相色谱仪',
    status: '已完成',
    class: 'completed',
    deviceId: 'HPLC-01',
    date: '2026-10-18',
    period: '14:00 - 16:30',
    photos: 3
  },
  {
    name: '电子分析天平',
    status: '使用中',
    class: 'using',
    deviceId: 'BAL-05',
    date: '2026-10-18',
    period: '16:00 - --:--',
    photos: 0
  },
  {
    name: 'pH 计',
    status: '异常',
    class: 'abnormal',
    deviceId: 'PH-07',
    date: '2026-10-15',
    period: '10:00 - 10:40',
    photos: 2
  }
]

const mainBody = `<page><view class="container">
  ${tabs('reservation')}
  ${filterTabs(RESERVATION_FILTERS, 0)}
  <view class="history-list">
    ${reservations.map(reservationItem).join('')}
    <view class="load-more"><text>加载更多</text></view>
  </view>
</view></page>`

const statesBody = `<page>
  <view class="panel">
    <view class="cap">1. 待开始筛选（已过期的不会混进来）</view>
    ${filterTabs(RESERVATION_FILTERS, 1)}
    <view class="history-list">
      ${reservations.slice(0, 2).map(reservationItem).join('')}
    </view>
  </view>

  <view class="panel">
    <view class="cap">2. 已过期筛选</view>
    ${filterTabs(RESERVATION_FILTERS, 2)}
    <view class="history-list">
      ${reservations.slice(2, 3).map(reservationItem).join('')}
    </view>
  </view>

  <view class="panel">
    <view class="cap">3. 空态 / 未登录</view>
    ${filterTabs(RESERVATION_FILTERS, 3)}
    <view class="history-list">
      <view class="empty"><text>暂无已生效的预约</text></view>
    </view>
    <view class="empty"><text>登录后可查看你的预约与使用记录</text></view>
  </view>

  <view class="panel">
    <view class="cap">3.1 取消中（按钮置灰防连点）</view>
    <view class="history-list">
      ${reservationItem({
        name: '高效液相色谱仪',
        status: '待开始',
        class: 'upcoming',
        canCancel: true,
        busy: true,
        deviceId: 'HPLC-01',
        date: '2026-10-19',
        period: '09:00 - 11:00',
        created: '2026-10-18 09:12:40'
      })}
    </view>
  </view>

  <view class="panel">
    <view class="cap">4. 使用记录</view>
    ${tabs('usage')}
    ${filterTabs(USAGE_FILTERS, 0)}
    <view class="history-list">
      ${usages.map(usageItem).join('')}
    </view>
  </view>
</page>`

const files = [
  ['appointment-preview.html', '我的预约', mainBody, 'appointment-preview.png'],
  ['appointment-states.html', '我的预约 · 各种状态', statesBody, 'appointment-states.png']
]

for (const [file, title, body] of files) {
  fs.writeFileSync(path.join(__dirname, file), html(title, body))
}
console.log('已生成预览页：' + files.map(f => f[0]).join('、'))

// ============ 截图 ============
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 9345
const profile = path.join(__dirname, '.chrome-profile-appointment')
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
    await send('Emulation.setDeviceMetricsOverride', { width: 750, height: 1200, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url })
    await sleep(600)
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
