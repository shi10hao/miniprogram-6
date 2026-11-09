// 一次性自检：盘点所有 wxss 里 input / textarea 的盒模型，
// 揪出「没给死高度、只靠上下 padding 撑开」的写法。
// 原生 input 自带基础库默认高度（约 1.4rem），配上 box-sizing: border-box +
// 上下 padding 会被吃掉，内容区只剩几条 rpx，真机上就是输入栏被压扁。
// 用法：node preview/check-input-height.js（在仓库根目录）
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'miniprogram')

// 容器类选择器不算输入框本体
const CONTAINER = /(-field$|-group$|-row$|-label$|-wrap$|-box$|-icon$|-tip$|-counter$|-placeholder$|-error$|-clear$)/

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'miniprogram_npm') return
      walk(abs, out)
      return
    }
    if (entry.name.endsWith('.wxss')) out.push(abs)
  })
  return out
}

// 极简 CSS 解析：只认顶层规则，够用；同一选择器多条规则按声明合并
function parseRules(css) {
  const rules = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) {
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
  }
  return rules
}

function decl(body, prop) {
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)')
  const m = body.match(re)
  return m ? m[1].trim() : ''
}

function px(value) {
  const m = String(value).match(/^(-?[\d.]+)rpx$/)
  return m ? Number(m[1]) : null
}

function paddingY(padding) {
  if (!padding) return 0
  const parts = padding.split(/\s+/).filter(Boolean)
  return px(parts[0]) || 0
}

const findings = []

walk(ROOT, []).forEach((file) => {
  const css = fs.readFileSync(file, 'utf8')
  const rules = parseRules(css)

  // 先把同一选择器的声明合并起来，避免「共用规则 + 单独补高度」被误判
  const merged = new Map()
  rules.forEach((rule) => {
    rule.selector
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /input|textarea/i.test(s))
      .filter((s) => !CONTAINER.test(s))
      .filter((s) => !/:/.test(s)) // 排除 :focus 之类
      .forEach((token) => {
        merged.set(token, (merged.get(token) || '') + ';' + rule.body)
      })
  })

  merged.forEach((body, token) => {
    const height = px(decl(body, 'height'))
    const minHeight = px(decl(body, 'min-height'))
    // height: 100% 这类相对高度由父容器兜着，算有高度
    const relative = !height && !minHeight && /^(100%|\d+%)$/.test(decl(body, 'height'))
    const padTop = decl(body, 'padding-top')
    const vpad = padTop ? px(padTop) || 0 : paddingY(decl(body, 'padding'))
    const fontSize = px(decl(body, 'font-size')) || 0
    const label = file.replace(ROOT + path.sep, '') + '  [' + token + ']'

    // 没有任何确定高度：原生 input 只能用自己的默认高度，再被上下 padding 一吃就塌
    if (height === null && minHeight === null && !relative) {
      findings.push({ level: 'WARN', label, why: '没有 height / min-height，上下 padding ' + vpad + 'rpx 会把原生默认高度吃光' })
      return
    }
    // 高度矮到装不下 padding + 文字，内容同样会被压扁
    const box = height !== null ? height : minHeight
    if (box !== null && vpad * 2 + fontSize > box) {
      findings.push({ level: 'WARN', label, why: '高度 ' + box + 'rpx 装不下上下 padding ' + vpad * 2 + 'rpx + 字号 ' + fontSize + 'rpx' })
      return
    }
    findings.push({ level: 'OK', label, why: 'height=' + (height === null ? '-' : height) + 'rpx min-height=' + (minHeight === null ? '-' : minHeight) + 'rpx paddingTop=' + vpad + 'rpx font=' + fontSize + 'rpx' })
  })
})

const warns = findings.filter((f) => f.level === 'WARN')
findings.sort((a, b) => a.label.localeCompare(b.label))
findings.forEach((f) => console.log((f.level === 'WARN' ? '!!! ' : '    ') + f.label + '  ' + f.why))
console.log('\n共 ' + findings.length + ' 个输入框类，可疑 ' + warns.length + ' 个')
if (warns.length) process.exitCode = 1
