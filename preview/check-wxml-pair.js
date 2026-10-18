// 静态检查 wxml：
// 1) 标签是否配对（微信编译失败最常见的低级错误）
// 2) wx:elif / wx:else 是否紧跟在 wx:if / wx:elif 之后
// 用法：node preview/check-wxml-pair.js [文件...]
//       不带参数时默认检查我改过的这几个页面
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const defaults = [
  'miniprogram/pages/communication/communication.wxml',
  'miniprogram/pages/communicationDetail/communicationDetail.wxml',
  'miniprogram/pages/duty-upload/duty-upload.wxml'
]
const files = process.argv.length > 2 ? process.argv.slice(2) : defaults

const SELF_CLOSING = new Set(['input', 'image', 'icon', 'progress', 'switch', 'slider', 'import', 'include', 'wxs'])

let failed = false

for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  const problems = []
  // 同一父节点下是否已经出现过 wx:if / wx:elif，用来校验 wx:else 的位置
  const openChainAtDepth = new Map()

  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  let match
  while ((match = tagRe.exec(text)) !== null) {
    const [, closing, name, attrs, selfClose] = match
    const depth = stack.length

    if (closing) {
      const open = stack.pop()
      if (!open || open.name !== name) {
        problems.push(`第 ${lineOf(text, match.index)} 行：</${name}> 与 <${open ? open.name : '?'}> 不匹配`)
        if (open) stack.push(open)
      }
      continue
    }

    const hasIf = /\swx:if=/.test(attrs)
    const hasElif = /\swx:elif=/.test(attrs)
    const hasElse = /\swx:else(\s|=|$)/.test(attrs)

    if (hasElif || hasElse) {
      if (!openChainAtDepth.get(depth)) {
        problems.push(`第 ${lineOf(text, match.index)} 行：<${name}> 用了 wx:${hasElif ? 'elif' : 'else'} 但前面没有 wx:if/wx:elif 兄弟节点`)
      }
    }
    if (hasIf || hasElif) {
      openChainAtDepth.set(depth, true)
    } else if (!hasElse) {
      openChainAtDepth.delete(depth)
    }

    // 自闭合标签与显式自闭合写法都不入栈
    if (selfClose || SELF_CLOSING.has(name)) continue

    stack.push({ name, line: lineOf(text, match.index) })
  }

  if (stack.length) {
    problems.push(`未闭合标签：${stack.map(t => `<${t.name}>@${t.line}`).join('、')}`)
  }

  if (problems.length) {
    failed = true
    console.error(`✗ ${rel}`)
    problems.forEach(p => console.error('   ' + p))
  } else {
    console.log(`✓ ${rel} 标签配对与 wx:if 分支都正常`)
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

process.exit(failed ? 1 : 0)
