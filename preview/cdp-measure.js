// 通过 CDP 测量预览页盒模型：node preview/cdp-measure.js preview/reservation-preview.html
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const target = path.resolve(__dirname, '..', process.argv[2] || 'preview/reservation-preview.html')
const port = 9333
const profile = path.join(__dirname, '.chrome-profile')

const expr = `(() => {
  const rows = []
  const box = el => { const b = el.getBoundingClientRect(); return { x: +b.left.toFixed(2), y: +b.top.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) } }
  const push = (label, el) => {
    if (!el) return rows.push(label + ': missing')
    const cs = getComputedStyle(el)
    const b = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()]
    let textInfo = ''
    if (rects.length) {
      const t = rects[0]
      const centerOffset = (t.top + t.height / 2) - (b.top + b.height / 2)
      textInfo = ' textH=' + t.height.toFixed(2) + ' glyphCenterOffset=' + centerOffset.toFixed(2)
    }
    rows.push(label + ' ' + JSON.stringify(box(el)) + ' pad=' + cs.paddingTop + '/' + cs.paddingBottom +
      ' font=' + cs.fontSize + ' lh=' + cs.lineHeight + ' display=' + cs.display + textInfo)
  }
  document.querySelectorAll('.device-tags .rsv-tag').forEach((el, i) => push('tag' + i, el))
  document.querySelectorAll('.rsv-chip').forEach((el, i) => push('chip' + i, el))
  push('deviceNo', document.querySelector('.rsv-chip .rsv-chip-no'))
  push('statusTag', document.querySelector('.rsv-chip .rsv-chip-status'))
  push('remainTag', document.querySelector('.device-side .rsv-tag'))
  push('tagsRow', document.querySelector('.device-tags'))
  push('btnsRow', document.querySelector('.all_devices_btns'))
  push('submitBtn', document.querySelector('.submit-btn'))
  return rows.join('\\n')
})()`

async function main () {
  fs.rmSync(profile, { recursive: true, force: true })
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--window-size=750,1100', 'about:blank'
  ], { stdio: 'ignore' })

  const sleep = ms => new Promise(r => setTimeout(r, ms))
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
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  await new Promise(r => { ws.onopen = r })
  const send = (method, params = {}) => new Promise(resolve => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Page.enable')
  const url = 'file:///' + target.replace(/\\/g, '/')
  await send('Page.navigate', { url })
  await sleep(1200)
  const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log(out.result.result.value)
  ws.close()
  child.kill()
}

main().catch(e => { console.error(e); process.exit(1) })
