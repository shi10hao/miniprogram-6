// 生成 reservation 页面的静态预览页（仅供本地截图自检，不参与小程序构建）
// 用法：node preview/build-preview.js
// 把 wxss 里的 rpx 按 1:1 换成 px，并在 750px 宽视口下渲染，和真机 750 设计稿一致。
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const toPx = css => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const appCss = toPx(read('miniprogram/app.wxss'))
const pageCss = toPx(read('miniprogram/pages/reservation/reservation.wxss'))

const devices = [
  {
    name: '高效液相色谱仪',
    model: 'Agilent 1260',
    lab: '公共实验室',
    labCls: 'primary',
    type: '大型仪器',
    typeCls: 'danger',
    room: 'A302',
    remain: 3
  },
  {
    name: '紫外可见分光光度计',
    model: 'UV-2600',
    lab: '课题组',
    labCls: 'warning',
    type: '小型仪器',
    typeCls: 'success',
    room: 'B107',
    remain: 0
  }
]

const chipGroups = [
  [
    ['HPLC-A01', 'available', false],
    ['HPLC-A02', 'available', true],
    ['HPLC-A03', 'reserved', false],
    ['HPLC-B01', 'using', false],
    ['HPLC-B02', 'maintenance', false]
  ]
]

const chipLabel = s => ({ available: '可用', reserved: '已预约', using: '使用中', maintenance: '维修中' }[s])

// 三种提交栏状态：已选好 / 还没选编号 / 提交中
const submitBar = (state, staticCls = '') => {
  const info = {
    ready: { name: '<text class="submit-device">紫外可见分光光度计</text><text class="submit-slot">HPLC-A02</text>' },
    disabled: { name: '<text class="submit-device">紫外可见分光光度计</text><text class="submit-tip">请选择仪器编号</text>' },
    submitting: { name: '<text class="submit-device">紫外可见分光光度计</text><text class="submit-slot">HPLC-A02</text>' }
  }[state]
  const btnCls = {
    ready: 'ds-btn submit-btn',
    disabled: 'ds-btn submit-btn disabled',
    submitting: 'ds-btn submit-btn submitting'
  }[state]
  const label = state === 'submitting' ? '提交中…' : '提交预约'
  return `<view class="submit-bar ${staticCls}">
  <view class="submit-bar-info">${info.name}</view>
  <button class="${btnCls}"><text>${label}</text></button>
</view>`
}

const deviceCard = (d, i) => `
  <view class="device-card ${i === 1 ? 'selected' : ''}">
    <view class="device-card-main">
      <view class="device-thumb"><view class="device-thumb-fallback"><text class="device-thumb-icon">🧪</text></view></view>
      <view class="device-info">
        <view class="device-name-row">
          <text class="device-name">${d.name}</text>
          <text class="device-model">${d.model}</text>
        </view>
        <view class="device-tags">
          <view class="rsv-tag rsv-tag--${d.labCls}">${d.lab}</view>
          <view class="rsv-tag rsv-tag--${d.typeCls}">${d.type}</view>
        </view>
        <view class="device-location-row">
          <text class="device-location-icon">📍</text>
          <text class="device-lab-name">${d.lab}</text>
          <text class="device-room-text">· ${d.room}</text>
        </view>
      </view>
      <view class="device-side">
        ${i === 1
          ? '<view class="selected-indicator"><text class="selected-icon">✓</text></view>'
          : `<view class="rsv-tag rsv-tag--${d.remain > 0 ? 'success' : 'muted'}">${d.remain > 0 ? `剩余 ${d.remain} 台` : '已约满'}</view>`}
      </view>
    </view>
    ${i === 1 ? `
    <view class="your-content">
      <text class="sub-label">选择仪器编号</text>
      <view class="all_devices_btns">
        ${chipGroups[0].map(([id, st, active]) => `
        <view class="rsv-chip status-${st} ${active ? 'active' : ''}">
          <view class="rsv-chip-no">${id}</view>
          <view class="rsv-chip-status">${chipLabel(st)}</view>
        </view>`).join('')}
      </view>
    </view>` : ''}
    ${i === 1 ? '' : '<view class="conflict-warning"><text class="warning-icon">⚠️</text><text class="warning-text">这段时间已有 2 个预约</text></view>'}
  </view>`

const page = (bodyCls, content) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>reservation 预览</title>
<style>
view { display: block; }
text { display: inline; }
page { display: block; }
body { margin: 0; }
</style>
<style>${appCss}</style>
<style>${pageCss}</style>
<style>
/* 仅预览用：给标签加描边，方便肉眼确认文字在框内是否居中 */
body.debug .rsv-tag { outline: 1px dashed rgba(255, 0, 0, 0.55); }
body.debug .rsv-chip { outline: 1px dashed rgba(255, 0, 0, 0.55); }
/* 仅预览用：把吸底栏改成静态，方便一次截到三种状态 */
body.states .submit-bar { position: static; }
body.states .submit-bar + .submit-bar { border-top: none; }
/* 预览页的 .ds-page 有 min-height:100vh，会把三根静态提交栏顶到折叠线以下 */
body.states .ds-page { min-height: 0; }
</style>
</head>
<body class="${bodyCls}">
${content}
</body>
</html>`

// 1) 正常整页截图
const mainHtml = page('debug', `
<page class="ds-page has-sticky-bar">
  <view class="ds-card">
    <view class="ds-section-head">
      <text class="ds-section-title">选择仪器</text>
      <text class="device-count">共 2 种</text>
    </view>
    <view class="device-list">
      <view class="device-scroll">
        ${devices.map(deviceCard).join('')}
      </view>
    </view>
  </view>
</page>
${submitBar('ready')}`)

// 2) 提交栏三种状态对照
const statesHtml = page('states', `
<page class="ds-page">
  <view class="ds-card">
    <view class="ds-section-head">
      <text class="ds-section-title">提交栏状态</text>
    </view>
    <view class="instructions" style="padding: 0 24px 12px; color: #5f6b7a; font-size: 24px; line-height: 1.6">
      <view>1. 选好编号：主按钮可点</view>
      <view>2. 未选编号：浅底描边，仍可点，点了 toast 提示</view>
      <view>3. 提交中：主色半透明 + 文案变「提交中…」</view>
    </view>
  </view>
</page>
${submitBar('ready')}
${submitBar('disabled')}
${submitBar('submitting')}`)

// 3) 无调试描边的同一页，供像素级墨迹测量用（描边会污染边界判断）
const plainHtml = mainHtml.replace('<body class="debug">', '<body>')

fs.writeFileSync(path.join(__dirname, 'reservation-preview.html'), mainHtml)
fs.writeFileSync(path.join(__dirname, 'submit-states.html'), statesHtml)
fs.writeFileSync(path.join(__dirname, 'nodebug.html'), plainHtml)
console.log('已生成 preview/reservation-preview.html、preview/submit-states.html、preview/nodebug.html')

// 4) 静态检查：标签/编号的文案必须和标签写在同一行。
//    小程序里标签内容里的换行缩进会被保留，标签内会多出一行空行——真机比预览高一行，
//    这正是上次「自检好看、真机翻车」的根因，所以这里直接扫 wxml 兜住。
const wxmlLines = read('miniprogram/pages/reservation/reservation.wxml').split(/\r?\n/)
const problems = []
wxmlLines.forEach((line, i) => {
  const hit = line.match(/class="(rsv-tag[\w-]*|rsv-chip-no|rsv-chip-status)"/)
  if (hit && !line.includes('</view>')) {
    problems.push(`  第 ${i + 1} 行：${hit[1]} 的文案没有和标签写在同一行`)
  }
})
if (problems.length) {
  console.warn('⚠️  文案换行会让标签内多出一行空行（真机比预览高一行）：\n' + problems.join('\n'))
} else {
  console.log('标签文案排版检查：通过')
}
