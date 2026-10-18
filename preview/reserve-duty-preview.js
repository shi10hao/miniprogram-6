// 生成 reserve-detail（预约详情）与 duty-list（卫生打卡记录）的静态预览页并截图
// 用法：node preview/reserve-duty-preview.js
// 把 wxss 里的 rpx 按 1:1 换成 px，在 750px 宽视口下渲染，和真机 750 设计稿一致。
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const toPx = css => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const appCss = toPx(read('miniprogram/app.wxss'))
const reserveCss = toPx(read('miniprogram/pages/reserve-detail/reserve-detail.wxss'))
const dutyCss = toPx(read('miniprogram/pages/admin/duty-list/duty-list.wxss'))

const baseCss = `
view { display: block; }
text { display: inline; }
page { display: block; }
body { margin: 0; background: #f4f6f8; }
input, textarea { display: block; font: inherit; border: 0; outline: 0; background: transparent; color: inherit; }
input::placeholder { color: #c4ccd6; font-size: 28px; }
.cap { padding: 28px 24px 16px; background: #fff; font-size: 24px; font-weight: 600; color: #5f6b7a; }
.panel { margin-bottom: 20px; }
.panel .body { margin-top: 0; }
.panel .hero { padding-bottom: 36px; }
`

const G1 = 'linear-gradient(135deg,#cfe9ec,#8fc9cf)'
const G2 = 'linear-gradient(135deg,#e6eef5,#b9c9d6)'
const G3 = 'linear-gradient(135deg,#f3e6d6,#d9c3a6)'
const ph = (cls, gradient) => `<image class="${cls}" style="background:${gradient}"></image>`

const html = (title, body, pageCss) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>${baseCss}</style><style>${appCss}</style><style>${pageCss}</style></head>
<body>${body}</body></html>`

// ==================== reserve-detail ====================

const reserveHero = (status, chip) => `
  <view class="hero">
    <view class="hero-top">
      <text class="hero-eyebrow">预约单详情</text>
      <text class="hero-chip ${status === 'abnormal' ? 'hero-chip-abnormal' : ''}">${chip}</text>
    </view>
    <text class="hero-title">高效液相色谱仪 Agilent 1260</text>
    <text class="hero-sub">2026-10-18 14:00 - 16:30</text>
  </view>`

const rows = list => list.map(([label, value, cls]) => `
      <view class="row">
        <text class="row-label">${label}</text>
        <text class="row-value ${cls || ''}">${value}</text>
      </view>`).join('')

const infoCard = `
      <view class="ds-card">
        <view class="card-head"><text class="ds-section-title">预约信息</text></view>
        ${rows([
    ['使用人员', '张若曦'],
    ['课题组', '第 3 组'],
    ['仪器编号', 'HPLC-01'],
    ['预约时间', '2026-10-18 14:00 - 16:30'],
    ['开始使用', '今天 14:05'],
    ['结束使用', '今天 16:20']
  ])}
      </view>`

const photoCard = (title, hint, gradient, count) => `
      <view class="ds-card">
        <view class="card-head">
          <text class="ds-section-title">${title}</text>
          ${hint ? `<text class="card-hint">${hint}</text>` : ''}
        </view>
        <view class="photo-grid">
          ${Array.from({ length: count }).map(() => ph('photo', gradient)).join('')}
        </view>
      </view>`

const endCard = `
      <view class="ds-card">
        <view class="card-head"><text class="ds-section-title">结束核验</text></view>
        ${rows([
    ['仪器关闭', '已关闭', 'is-yes'],
    ['电脑关闭', '已关闭', 'is-yes'],
    ['运行样品', '6 个'],
    ['多余预约', '否', 'is-yes'],
    ['补充预约', '不需要']
  ])}
        <view class="sub-photos">
          <view class="sub-photo"><text class="sub-photo-label">总的预约单</text>${ph('photo photo-sm', G3)}</view>
          <view class="sub-photo"><text class="sub-photo-label">仪器关闭</text>${ph('photo photo-sm', G2)}</view>
          <view class="sub-photo"><text class="sub-photo-label">实验室关门</text>${ph('photo photo-sm', G2)}</view>
        </view>
      </view>`

const abnormalCard = ({ resolved, isAdmin }) => `
      <view class="ds-card abnormal-card ${resolved ? 'is-resolved' : ''}">
        <view class="card-head">
          <text class="ds-section-title">异常反馈</text>
          <text class="ds-tag ${resolved ? 'ds-tag-muted' : 'ds-tag-danger'}">${resolved ? '已处理' : '待处理'}</text>
        </view>
        <view class="abnormal-title">进样针堵塞</view>
        <view class="abnormal-desc">进样时压力异常升高，已停止使用并联系管理员，未继续运行样品。</view>
        <view class="abnormal-meta">上报于 今天 15:12</view>
        <view class="photo-grid abnormal-photos">
          ${ph('photo', G2)}
          ${ph('photo', G3)}
        </view>
        ${resolved
    ? '<view class="abnormal-handled">已由 李老师 于 今天 16:40 处理</view>'
    : isAdmin
      ? '<view class="ds-btn ds-btn-block resolve-btn">标记为已处理</view>'
      : '<view class="abnormal-wait">已通知管理员，请等待处理</view>'}
      </view>`

const tip = (status, text) => `
      <view class="tip tip-${status}">
        <text class="tip-dot"></text>
        <text class="tip-text">${text}</text>
      </view>`

const normalBody = `<page>
  <view class="page">
    ${reserveHero('completed', '已完成')}
    <view class="body">
      ${tip('completed', '本次使用已完成，照片与核验信息可随时回看')}
      ${infoCard}
      ${photoCard('开始照片', '开始使用时的现场', G1, 1)}
      ${photoCard('使用照片', '2 张', G2, 2)}
      ${endCard}
      ${photoCard('系统预约单', '', G3, 1)}
      <view class="foot-hint">共 8 张照片，点击可查看大图</view>
    </view>
  </view>
</page>`

const stateCard = (icon, title, desc, extra) => `
      <view class="ds-card state-card">
        <text class="state-icon">${icon}</text>
        <text class="state-title">${title}</text>
        <text class="state-desc">${desc}</text>
        ${extra || ''}
      </view>`

const reserveStatesBody = `<page>
  <view class="panel">
    <view class="cap">1. 异常待处理 · 学生视角（无操作按钮）</view>
    <view class="body">
      ${tip('abnormal', '本次使用已上报异常，等待管理员处理')}
      ${abnormalCard({ resolved: false, isAdmin: false })}
      ${infoCard}
    </view>
  </view>

  <view class="panel">
    <view class="cap">2. 异常待处理 · 管理员视角（可操作）</view>
    <view class="body">
      ${tip('abnormal', '本次使用已上报异常，等待管理员处理')}
      ${abnormalCard({ resolved: false, isAdmin: true })}
    </view>
  </view>

  <view class="panel">
    <view class="cap">3. 异常已处理（记录保留 + 处理人）</view>
    <view class="body">
      ${tip('completed', '本次使用已完成，照片与核验信息可随时回看')}
      ${abnormalCard({ resolved: true, isAdmin: true })}
    </view>
  </view>

  <view class="panel">
    <view class="cap">4. 无权查看</view>
    <view class="body">
      ${stateCard('🔒', '无权查看该预约', '这条预约不属于当前账号，如需查看请联系实验室管理员', '<view class="ds-btn ds-btn-block state-btn">返回</view>')}
    </view>
  </view>

  <view class="panel">
    <view class="cap">5. 加载失败</view>
    <view class="body">
      ${stateCard('⚠️', '预约详情加载失败，请下拉刷新重试', '点击此处重试')}
    </view>
  </view>

  <view class="panel">
    <view class="cap">6. 骨架屏</view>
    <view class="body">
      ${[0, 1, 2].map(() => `<view class="ds-card sk-card">
        <view class="ds-skeleton sk-line sk-line-lg"></view>
        <view class="ds-skeleton sk-line"></view>
        <view class="ds-skeleton sk-line sk-line-sm"></view>
      </view>`).join('')}
    </view>
  </view>
</page>`

// ==================== duty-list ====================

const dutyHero = count => `
  <view class="hero">
    <view class="hero-top">
      <text class="hero-eyebrow">安全员打卡</text>
      <text class="hero-chip">共 ${count} 条</text>
    </view>
    <text class="hero-title">卫生打卡记录</text>
    <text class="hero-sub">每日实验台面、设备与废物处理情况</text>
  </view>`

const filterCard = (keyword, activeKey, matched) => `
    <view class="filter-card">
      <view class="search-field">
        <text class="search-icon">🔍</text>
        <input class="search-input" value="${keyword}" placeholder="搜索姓名 / 实验室 / 手机号" />
        ${keyword ? '<view class="search-clear">✕</view>' : ''}
      </view>
      <view class="chip-row">
        ${[['all', '全部'], ['today', '今天'], ['week', '近 7 天']].map(([key, label]) => `<view class="chip ${key === activeKey ? 'chip-active' : ''}">${label}</view>`).join('')}
        <text class="chip-count">${matched} 条</text>
      </view>
    </view>`

const dutyRecord = ({ name, avatar, time, lab, room, phone, remark, photos }) => `
      <view class="ds-card record-card">
        <view class="record-head">
          <view class="avatar">${avatar}</view>
          <view class="record-head-main">
            <view class="record-title">
              <text class="record-name">${name}</text>
              ${room ? `<text class="ds-tag ds-tag-muted">${room}</text>` : ''}
            </view>
            <text class="record-time">${time}</text>
          </view>
        </view>
        <view class="record-lab">
          <text class="lab-label">实验室</text>
          <text class="lab-value">${lab}</text>
        </view>
        <view class="record-row">
          <text class="row-label">手机号</text>
          <view class="row-value-group">
            <text class="row-value">${phone}</text>
            <view class="call-btn">拨号</view>
          </view>
        </view>
        ${remark ? `<view class="record-remark">${remark}</view>` : ''}
        <view class="photo-grid">
          ${Array.from({ length: photos }).map((_, i) => ph('photo', i === 0 ? G1 : G2)).join('')}
        </view>
      </view>`

const records = [
  {
    name: '张若曦',
    avatar: '张',
    time: '今天 08:12',
    lab: '化学楼 A301',
    room: 'A301',
    phone: '13800138001',
    remark: '台面已清洁，废液已按规定回收，通风橱运行正常。',
    photos: 3
  },
  {
    name: '李承宇',
    avatar: '李',
    time: '昨天 08:40',
    lab: '分析测试中心 B204',
    room: 'B204',
    phone: '13900139002',
    remark: '',
    photos: 2
  },
  {
    name: '王雨桐',
    avatar: '王',
    time: '3月8日 09:05',
    lab: '材料楼 C102',
    room: '',
    phone: '13700137003',
    remark: '发现一台离心机报错，已贴停用标识并上报。',
    photos: 1
  }
]

const dutyBody = `<page>
  <view class="page">
    ${dutyHero(28)}
    <view class="body">
      ${filterCard('', 'all', 28)}
      ${records.map(dutyRecord).join('')}
      <view class="ds-btn ds-btn-ghost load-more">加载更多</view>
      <view class="no-more">已显示全部 28 条记录</view>
    </view>
  </view>
</page>`

const dutyStatesBody = `<page>
  <view class="panel">
    <view class="cap">1. 搜索命中</view>
    <view class="body">
      ${filterCard('色谱', 'week', 2)}
      ${records.slice(0, 2).map(dutyRecord).join('')}
      <view class="no-more">已显示全部 2 条记录</view>
    </view>
  </view>

  <view class="panel">
    <view class="cap">2. 无权限（筛选区一并隐藏）</view>
    <view class="body">
      ${stateCard('🔒', '无权查看打卡记录', '这份记录包含全站同学的姓名与联系方式，仅教师和管理员可见', '<view class="ds-btn ds-btn-block state-btn">返回</view>')}
    </view>
  </view>

  <view class="panel">
    <view class="cap">3. 空态</view>
    <view class="body">
      ${filterCard('', 'all', 0)}
      ${stateCard('📋', '还没有打卡记录', '安全员提交打卡后会出现在这里')}
    </view>
  </view>

  <view class="panel">
    <view class="cap">4. 搜索无结果</view>
    <view class="body">
      ${filterCard('离心机', 'today', 0)}
      ${stateCard('🔍', '没有匹配的打卡记录', '换个关键词或时间范围试试')}
    </view>
  </view>

  <view class="panel">
    <view class="cap">5. 骨架屏</view>
    <view class="body">
      ${[0, 1, 2].map(() => `<view class="ds-card sk-card">
        <view class="sk-head">
          <view class="ds-skeleton sk-avatar"></view>
          <view class="sk-head-text">
            <view class="ds-skeleton sk-line sk-line-lg"></view>
            <view class="ds-skeleton sk-line sk-line-sm"></view>
          </view>
        </view>
        <view class="ds-skeleton sk-photos"></view>
      </view>`).join('')}
    </view>
  </view>
</page>`

const files = [
  ['reserve-detail-preview.html', '预约详情', normalBody, reserveCss, 'reserve-detail-preview.png'],
  ['reserve-detail-states.html', '预约详情 · 各种状态', reserveStatesBody, reserveCss, 'reserve-detail-states.png'],
  ['duty-list-preview.html', '卫生打卡记录', dutyBody, dutyCss, 'duty-list-preview.png'],
  ['duty-list-states.html', '卫生打卡记录 · 各种状态', dutyStatesBody, dutyCss, 'duty-list-states.png']
]

for (const [file, title, body, css] of files) {
  fs.writeFileSync(path.join(__dirname, file), html(title, body, css))
}
console.log('已生成预览页：' + files.map(f => f[0]).join('、'))

// ============ 截图 ============
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 9343
const profile = path.join(__dirname, '.chrome-profile-reserve')
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

  for (const [file, , , , png] of files) {
    const url = 'file:///' + path.join(__dirname, file).replace(/\\/g, '/')
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
