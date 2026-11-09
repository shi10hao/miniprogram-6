/**
 * 生成管理端「仪器详情」页的静态预览：node preview/build-admin-device-detail.js
 *
 * 做法与 preview/build-preview.js 一致：读 app.wxss + 页面 wxss，把 rpx 1:1 换成 px，
 * 再套一份与 wxml 同构的静态结构，直接在 750px 宽视口里看真实排版。
 * 预览里的图片用渐变块占位（真机才去取云存储临时链接）。
 */

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const appCss = fs.readFileSync(path.join(root, 'miniprogram/app.wxss'), 'utf8')
const pageCss = fs.readFileSync(
  path.join(root, 'miniprogram/pages/admin/device-detail/admindevicedetail.wxss'),
  'utf8'
)

const toPx = css => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const baseCss = `
  html, body { margin: 0; padding: 0; background: #f4f6f8; }
  body { width: 750px; }
  view, scroll-view, block { display: block; }
  text { display: inline; }
  page { display: block; }
  .ph { background: linear-gradient(135deg, #d8eef0, #a9dbe0); }
`

function hero(summary, deviceName, labName, model) {
  return `
  <view class="hero">
    <view class="hero-deco"></view>
    <view class="hero-top">
      <view class="hero-eyebrow">
        <view class="hero-dot"></view>
        <text class="hero-eyebrow-text">仪器档案</text>
      </view>
      <view class="hero-chip chip-${summary.statusKey}">${summary.statusText}</view>
    </view>
    <view class="hero-title">${deviceName}</view>
    <view class="hero-sub">
      <text class="hero-sub-item">${labName}</text>
      <text class="hero-sub-dot">·</text>
      <text class="hero-sub-item">${model}</text>
    </view>
    <view class="hero-stats">
      <view class="hero-stat">
        <text class="hero-stat-num">${summary.total}</text>
        <text class="hero-stat-label">在册实例</text>
      </view>
      <view class="hero-stat-line"></view>
      <view class="hero-stat">
        <text class="hero-stat-num">${summary.available}</text>
        <text class="hero-stat-label">可借</text>
      </view>
      <view class="hero-stat-line"></view>
      <view class="hero-stat">
        <text class="hero-stat-num">${summary.using}</text>
        <text class="hero-stat-label">使用中</text>
      </view>
    </view>
  </view>`
}

function infoCard() {
  const specs = [
    ['型号', 'Agilent 1260 Infinity II'],
    ['检测器', '紫外-可见（VWD）'],
    ['进样量', '0.1 - 100 μL'],
    ['房间', 'A101 分析室']
  ]

  return `
      <view class="ds-card info-card">
        <view class="card-head">
          <view class="ds-section-title">仪器信息</view>
          <view class="head-action">编辑</view>
        </view>
        <view class="cover-wrap">
          <view class="cover ph"></view>
        </view>
        <view class="desc">用于小分子化合物的分离与定量分析，配自动进样器与柱温箱，适合常规纯度检测。</view>
        <view class="spec-block">
          <view class="block-label">规格参数</view>
          ${specs.map(([key, value]) => `
          <view class="spec-row">
            <text class="spec-key">${key}</text>
            <text class="spec-value">${value}</text>
          </view>`).join('')}
        </view>
        <view class="text-block">
          <view class="block-label">操作规程</view>
          <view class="block-text ds-clamp-2">1. 打开氮气与电源，等待自检通过；2. 排气泡并平衡色谱柱 30 分钟；3. 设置方法后进样；4. 结束后用甲醇冲洗管路，关机断电。</view>
        </view>
        <view class="text-block">
          <view class="block-label">注意事项</view>
          <view class="block-text block-text-warn ds-clamp-2">流动相必须现配现用并过滤；含盐流动相禁止长时间停留在柱内。</view>
        </view>
        <view class="video-row">
          <view class="video-icon">▶</view>
          <view class="video-body">
            <view class="video-title">操作视频</view>
            <view class="video-desc">点击全屏播放</view>
          </view>
          <view class="video-arrow">›</view>
        </view>
      </view>`
}

function devicesCard() {
  const devices = [
    { code: 'LC-01', tag: 'ds-tag-warning', text: '使用中', room: 'A101', user: '张三', maintenance: false },
    { code: 'LC-02', tag: 'ds-tag-success', text: '可用', room: 'A101', user: '', maintenance: false },
    { code: 'LC-03', tag: 'ds-tag-danger', text: '维修中', room: 'A102', user: '', maintenance: true },
    { code: 'LC-04', tag: 'ds-tag-success', text: '可用', room: 'A102', user: '', maintenance: false },
    { code: 'LC-05', tag: 'ds-tag-success', text: '可用', room: 'A102', user: '', maintenance: false }
  ]

  return `
      <view class="ds-card">
        <view class="card-head">
          <view class="ds-section-title">仪器实例</view>
          <view class="head-meta">
            <text class="head-count">5 台</text>
            <text class="head-arrow">›</text>
          </view>
        </view>
        <view class="device-list">
          ${devices.map(item => `
          <view class="device-item">
            <view class="device-main">
              <view class="device-head">
                <text class="device-code">${item.code}</text>
                <text class="ds-tag ${item.tag}">${item.text}</text>
              </view>
              <view class="device-meta">
                <text class="device-meta-item">${item.room}</text>
                <text class="device-meta-dot">·</text>
                <text class="device-meta-item">Agilent 1260</text>
              </view>
              ${item.user ? `<view class="device-user">使用人：${item.user}</view>` : ''}
            </view>
            <view class="device-actions">
              <view class="mini-btn">${item.maintenance ? '恢复可用' : '报修'}</view>
              <view class="mini-btn mini-btn-danger">删除</view>
            </view>
          </view>`).join('')}
        </view>
        <view class="expand-btn">展开全部 5 台</view>
        <view class="add-instance">
          <input class="add-input" placeholder="输入新设备编号" value="" />
          <view class="add-btn">添加</view>
        </view>
      </view>`
}

function usageCard() {
  return `
      <view class="ds-card">
        <view class="card-head">
          <view class="ds-section-title">当前使用</view>
          <view class="head-meta">
            <text class="head-count">1 条</text>
            <text class="head-arrow">›</text>
          </view>
        </view>
        <view class="record-list">
          <view class="record-item">
            <view class="record-head">
              <text class="record-title">张三</text>
              <text class="ds-tag ds-tag-warning">使用中</text>
            </view>
            <view class="record-time">
              <text class="record-date">2026-11-08</text>
              <text class="record-clock">09:00 - 10:30</text>
            </view>
            <view class="record-foot">
              <text class="record-duration">已使用 1 小时 5 分钟</text>
              <text class="record-device">LC-01</text>
            </view>
          </view>
        </view>
      </view>`
}

function photosCard() {
  const records = [
    { name: '李四', date: '2026-11-06', clock: '14:00 - 15:30', count: 4, abnormal: '' },
    { name: '王五', date: '2026-11-05', clock: '10:00 - 11:00', count: 3, abnormal: '2026-11-05 10:48' }
  ]

  return `
      <view class="ds-card">
        <view class="card-head">
          <view class="ds-section-title">使用记录</view>
          <view class="head-meta">
            <text class="head-count">2 条</text>
            <text class="head-arrow">›</text>
          </view>
        </view>
        ${records.map(item => `
        <view class="photo-record">
          <view class="photo-head">
            <text class="photo-title">${item.name}</text>
            <text class="photo-count">${item.count} 张</text>
          </view>
          <view class="photo-time">
            <text>${item.date}</text>
            <text class="photo-time-dot">·</text>
            <text>${item.clock}</text>
            ${item.abnormal ? `<text class="photo-abnormal">异常：${item.abnormal}</text>` : ''}
          </view>
          <view class="photo-grid">
            ${Array.from({ length: Math.min(item.count, 3) }).map(() => '<view class="photo-cell"><view class="photo-img ph"></view></view>').join('')}
          </view>
        </view>`).join('')}
      </view>`
}

function reservesCard() {
  const reserves = [
    { date: '2026-11-08', clock: '11:00 - 12:00', name: '赵六', device: 'LC-02', tag: 'ds-tag-warning', text: '待开始' },
    { date: '2026-11-09', clock: '14:00 - 15:30', name: '李四', device: 'LC-01', tag: 'ds-tag-primary', text: '即将到来' }
  ]

  return `
      <view class="ds-card">
        <view class="card-head">
          <view class="ds-section-title">即将到来的预约</view>
          <view class="head-meta">
            <text class="head-count">2 条</text>
            <text class="head-arrow">›</text>
          </view>
        </view>
        <view class="reserve-list">
          ${reserves.map(item => `
          <view class="reserve-item">
            <view class="reserve-left">
              <view class="reserve-date">${item.date}</view>
              <view class="reserve-clock">${item.clock}</view>
            </view>
            <view class="reserve-right">
              <view class="reserve-name">${item.name}</view>
              <view class="reserve-device">${item.device}</view>
            </view>
            <view class="reserve-tag ds-tag ${item.tag}">${item.text}</view>
          </view>`).join('')}
        </view>
      </view>`
}

function editCard() {
  return `
      <view class="ds-card info-card">
        <view class="card-head">
          <view class="ds-section-title">仪器信息</view>
          <view class="head-action">取消</view>
        </view>
        <view class="edit-field">
          <view class="edit-label">仪器名称</view>
          <input class="edit-input" value="高效液相色谱仪" />
        </view>
        <view class="edit-field">
          <view class="edit-label">封面图片</view>
          <view class="edit-cover">
            <view class="edit-cover-img ph"></view>
            <view class="edit-cover-mask">点击更换</view>
          </view>
        </view>
        <view class="edit-field">
          <view class="edit-label">操作视频</view>
          <view class="edit-video">
            <view class="edit-video-text ds-ellipsis">已上传，点击可更换</view>
            <view class="edit-video-action">选择</view>
          </view>
        </view>
        <view class="edit-field">
          <view class="edit-label">仪器简介</view>
          <textarea class="edit-textarea">用于小分子化合物的分离与定量分析，配自动进样器与柱温箱。</textarea>
        </view>
        <view class="edit-field">
          <view class="edit-label">操作规程</view>
          <textarea class="edit-textarea">1. 打开氮气与电源，等待自检通过；2. 排气泡并平衡色谱柱 30 分钟；3. 设置方法后进样。</textarea>
        </view>
        <view class="edit-field">
          <view class="edit-label">注意事项</view>
          <textarea class="edit-textarea">流动相必须现配现用并过滤；含盐流动相禁止长时间停留在柱内。</textarea>
        </view>
        <view class="edit-field">
          <view class="edit-label">规格参数</view>
          <textarea class="edit-textarea">型号：Agilent 1260
检测器：紫外-可见（VWD）</textarea>
          <view class="edit-hint">保存时会按「键：值」解析成规格表</view>
        </view>
        <view class="save-bar">
          <view class="ds-btn ds-btn-block">保存修改</view>
        </view>
        <view class="save-tip">保存会同步更新同款仪器的全部 5 台实例</view>
      </view>`
}

function page(inner) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>仪器详情（管理端）预览</title>
<style>${baseCss}</style>
<style>${toPx(appCss)}</style>
<style>${toPx(pageCss)}</style>
</head>
<body>
<view class="page">
${inner}
</view>
</body>
</html>`
}

const summary = { total: 5, available: 3, using: 1, maintenance: 1, statusKey: 'using', statusText: '1 台使用中' }

const displayInner = [
  hero(summary, '高效液相色谱仪', '分析检测中心 · 有机分析室', 'Agilent 1260'),
  `<view class="body">
    <view class="filter-bar">
      <view class="filter-text ds-ellipsis">已按关键词「色谱」筛选</view>
      <view class="filter-action">查看全部</view>
    </view>
    ${infoCard()}
    ${devicesCard()}
    ${usageCard()}
    ${photosCard()}
    ${reservesCard()}
    <view class="foot-note">数据来自云开发数据库，返回本页会自动刷新</view>
  </view>`
].join('\n')

const editInner = [
  hero(summary, '高效液相色谱仪', '分析检测中心 · 有机分析室', 'Agilent 1260'),
  `<view class="body">
    ${editCard()}
    ${devicesCard()}
  </view>`
].join('\n')

const emptyInner = [
  hero({ total: 0, available: 0, using: 0, statusKey: 'none', statusText: '暂无实例' }, '高效液相色谱仪', '未设置实验室', '未设置型号'),
  `<view class="body">
    <view class="ds-card ds-empty">
      <view class="ds-empty-icon">🔍</view>
      <view class="ds-empty-title">设备不存在或无权限查看</view>
      <view class="ds-empty-desc">该仪器可能已被删除，或不在你的管理范围内</view>
    </view>
  </view>`
].join('\n')

const outputs = [
  ['admin-device-detail-preview.html', displayInner],
  ['admin-device-detail-states.html', editInner],
  ['admin-device-detail-empty-states.html', emptyInner]
]

outputs.forEach(([name, inner]) => {
  const target = path.join(__dirname, name)
  fs.writeFileSync(target, page(inner), 'utf8')
  console.log('已生成', target)
})
