// 量「结束使用」预览页里两栏输入框的真实盒模型，并截图
// 用法：node preview/measure-usage-end-form.js（在仓库根目录，需先跑 build-usage-end-form.js）
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const target = path.join(__dirname, 'usage-end-form.html')
const png = path.join(__dirname, 'usage-end-form.png')
const port = 9334
const profile = path.join(__dirname, '.chrome-profile-measure')

const expr = `(() => {
  const rows = []
  const box = (el) => { const b = el.getBoundingClientRect(); return { y: +b.top.toFixed(2), h: +b.height.toFixed(2) } }
  const panels = [['panel-before', '修复前'], ['panel-after', '修复后']]
  panels.forEach(([cls, name]) => {
    const panel = document.querySelector('.' + cls)
    panel.querySelectorAll('.form-input').forEach((el, i) => {
      const cs = getComputedStyle(el)
      const b = box(el)
      // 内容区高度 = 盒高 - 上下 padding - 上下 border
      const inner = b.h - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) -
        parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
      rows.push(name + ' 输入框' + (i + 1) + ' 盒高=' + b.h + 'px 上/下padding=' + cs.paddingTop + '/' + cs.paddingBottom +
        ' 内容区=' + inner.toFixed(2) + 'px 字号=' + cs.fontSize)
    })
    const seg = panel.querySelector('.seg-item')
    rows.push(name + ' 对照：seg-item 盒高=' + box(seg).h + 'px')
  })
  return rows.join('\\n')
})()`

async function main() {
  fs.rmSync(profile, { recursive: true, force: true })
  const child = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
    '--allow-file-access-from-files',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--window-size=1600,2200', 'about:blank'
  ], { stdio: 'ignore' })

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let targets = null
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      targets = await res.json()
      if (targets.some((t) => t.type === 'page')) break
    } catch (e) {}
    await sleep(250)
  }
  if (!targets) throw new Error('chrome 未启动')
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  await new Promise((r) => { ws.onopen = r })
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'file:///' + target.replace(/\\/g, '/') })
  await sleep(1500)

  const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log(out.result.result.value)

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  fs.writeFileSync(png, Buffer.from(shot.result.data, 'base64'))
  console.log('\n截图：' + png)

  ws.close()
  child.kill()
}

main().catch((e) => { console.error(e); process.exit(1) })
