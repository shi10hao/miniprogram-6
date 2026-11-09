// 生成「结束使用」弹窗的静态预览页，用于本地截图/量高度自检（不参与小程序构建）
// 用法：node preview/build-usage-end-form.js
//
// 左栏 = 修复前（.form-input 只有上下 padding、没有 height）
// 右栏 = 修复后（.form-input 写死 88rpx 高度、padding 只留左右）
//
// 真机上 input 是原生组件，没写 height 时用的是基础库默认高度（约 1.4rem）。
// 浏览器里的 <input> 默认高度是按字号自己算的，不会复现这个坑，
// 所以预览里显式补一条 `input { height: 1.4rem }` 当「基础库默认样式」的替身。
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const toPx = (css) => css.replace(/(-?\d*\.?\d+)rpx/g, '$1px')

const appCss = toPx(read('miniprogram/app.wxss'))
const pageCss = toPx(read('miniprogram/pages/usage/usage.wxss'))

// 把当前（修复后）的 .form-input 规则还原成修复前的写法
const fixedInputRule = /\.form-input \{\s*height: 88px;\s*padding: 0 var\(--ds-gap\);\s*\}/
if (!fixedInputRule.test(pageCss)) {
  console.error('没找到修复后的 .form-input 规则，预览页可能和实际样式脱节了')
  process.exit(1)
}
const beforeCss = pageCss.replace(fixedInputRule, '.form-input {\n  padding: 20px var(--ds-gap);\n}')

// 给一栏的样式加作用域前缀，两栏才能并排共存
function scope(css, prefix) {
  return css.replace(/(^|\})\s*([^{}@]+)\{/g, (all, brace, selector) => {
    const scoped = selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s === 'page' || s === ':root' ? s : prefix + ' ' + s))
      .join(', ')
    return brace + '\n' + scoped + ' {'
  })
}

const field = (label, control) => `
    <view class="form-block">
      <text class="form-label">${label}<text class="form-required">*</text></text>
      ${control}
    </view>`

const seg = (onText, offText) => `<view class="seg">
        <view class="seg-item is-on">${onText}</view>
        <view class="seg-item">${offText}</view>
      </view>`

const input = (value, placeholder, type) => `<input class="form-input"${type ? ' type="' + type + '"' : ''} value="${value}" placeholder="${placeholder}" placeholder-class="form-placeholder" />`

const sheet = `
  <view class="sheet">
    <view class="sheet-head">
      <text class="sheet-title">结束使用</text>
      <text class="sheet-close">✕</text>
    </view>
    <scroll-view class="sheet-scroll">
      <view class="sheet-tip">请如实填写现场情况，并上传照片留档，共 3 项必传。</view>
      ${field('仪器是否关闭', seg('已关闭', '未关闭'))}
      ${field('电脑是否关闭', seg('未关闭', '已关闭'))}
      ${field('下一个使用者', input('', '填写接手的同学姓名'))}
      ${field('运行样品总数', input('', '本次一共测试了几个样品', 'number'))}
      ${field('是否还有未测试的样品', seg('有', '没有'))}
      ${field('剩余样品数量', input('', '不能大于运行样品总数', 'number'))}
      <view class="form-block">
        <text class="form-label">总的预约单<text class="form-required">*</text></text>
        <view class="end-photo">
          <view class="end-photo-empty">
            <text class="photo-add-icon">+</text>
            <text class="end-photo-text">拍摄预约单</text>
          </view>
        </view>
      </view>
      <view class="sheet-bottom-space"></view>
    </scroll-view>
    <view class="sheet-foot">
      <view class="ds-btn ds-btn-ghost sheet-btn">取消</view>
      <view class="ds-btn sheet-btn">确认结束</view>
    </view>
  </view>`

const panel = (cls, title, note) => `
  <view class="panel ${cls}">
    <view class="panel-head">
      <text class="panel-title">${title}</text>
      <text class="panel-note">${note}</text>
    </view>
    ${sheet}
  </view>`

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>结束使用弹窗 · 输入框高度对照</title>
<style>
  /* 预览用的标签默认样式（小程序里 view/text 都是块级/行内） */
  view { display: block; }
  text { display: inline; }
  page { display: block; }
  body { margin: 0; background: #e9eef2; }
  /* 基础库给原生 input 的默认高度，真机上就是这个值 */
  input { height: 1.4rem; border: 0; margin: 0; padding: 0; font-family: inherit; }
</style>
<style>${appCss}</style>
<style>${scope(beforeCss, '.panel-before')}</style>
<style>${scope(pageCss, '.panel-after')}</style>
<style>
  /* 仅预览用：两栏并排、把贴底的 sheet 改成静态，一次截全 */
  .stage { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
  .panel { width: 750px; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(31, 39, 51, 0.12); }
  .panel-head { padding: 16px 24px; background: #1f2733; color: #fff; }
  .panel-title { display: block; font-size: 26px; font-weight: 600; }
  .panel-note { display: block; margin-top: 6px; font-size: 20px; color: #b9c4d0; }
  .panel .sheet { position: static; max-height: none; width: 750px; border-radius: 0; box-shadow: none; }
  .panel .sheet-scroll { height: auto; }
  .panel .sheet-foot { padding-bottom: 24px; }
  /* 仅预览用：虚线描出输入框边界，方便看内容区还剩多少 */
  .panel .form-input { outline: 1px dashed rgba(239, 68, 68, 0.6); }
</style>
</head>
<body>
<view class="stage">
  ${panel('panel-before', '修复前', '只给上下 padding，没写 height')}
  ${panel('panel-after', '修复后', 'height: 88rpx，padding 只留左右')}
</view>
</body>
</html>`

fs.writeFileSync(path.join(__dirname, 'usage-end-form.html'), html)
console.log('已生成 preview/usage-end-form.html')
