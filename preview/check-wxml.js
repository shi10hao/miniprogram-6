const fs = require('fs')
const src = fs.readFileSync('miniprogram/pages/reservation/reservation.wxml', 'utf8')
const noComment = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
const stack = []
const errors = []
const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g
let m
let line = 1, last = 0
const lineOf = idx => src.slice(0, idx).split('\n').length
while ((m = re.exec(noComment))) {
  const [full, closing, name, attrs, selfClose] = m
  if (closing) {
    const top = stack.pop()
    if (!top || top.name !== name) errors.push(`第 ${lineOf(m.index)} 行：</${name}> 与 <${top ? top.name : '空'}> 不匹配`)
  } else if (!selfClose) {
    stack.push({ name, line: lineOf(m.index) })
  }
}
stack.forEach(s => errors.push(`第 ${s.line} 行：<${s.name}> 未闭合`))
console.log(errors.length ? errors.join('\n') : 'wxml 标签配对：通过')
