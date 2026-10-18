// 列出预览页里溢出 750px 视口的元素：node preview/cdp-overflow.js [html] [viewportWidth]
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const target = path.resolve(__dirname, '..', process.argv[2] || 'preview/message-detail-preview.html')
const viewport = Number(process.argv[3] || 750)
const port = 9338
const profile = path.join(__dirname, '.chrome-profile-overflow')

const expr = `(() => {
  const out = []
  const vw = ${viewport}
  const all = document.querySelectorAll('*')
  for (const el of all) {
    const b = el.getBoundingClientRect()
    if (b.width > vw + 0.5 || b.right > vw + 0.5 || b.left < -0.5) {
      const id = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')
      out.push(id + ' left=' + b.left.toFixed(1) + ' right=' + b.right.toFixed(1) + ' w=' + b.width.toFixed(1) + ' h=' + b.height.toFixed(1))
    }
  }
  out.unshift('doc scrollW=' + document.documentElement.scrollWidth + ' scrollH=' + document.documentElement.scrollHeight + ' bodyW=' + document.body.scrollWidth)
  return out.join('\\n')
})()`

async function main () {
  fs.rmSync(profile, { recursive: true, force: true })
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--window-size=' + viewport + ',1200', 'about:blank'
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
  await send('Page.navigate', { url: 'file:///' + target.replace(/\\/g, '/') })
  await sleep(1000)
  const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log(out.result.result.value)
  ws.close()
  child.kill()
  fs.rmSync(profile, { recursive: true, force: true })
}

main().catch(e => { console.error(e); process.exit(1) })
