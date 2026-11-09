// 一次性自检：用桩 wx 跑一遍每个页面的 onPullDownRefresh，确认不抛错、且都会收起刷新动画
// 用法：node preview/_pulldown-runtime-check.js（在仓库根目录）
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'miniprogram')
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))

const stopped = []
let currentPage = ''

// 云数据库链式查询桩：所有链式方法返回自身，终止方法返回空结果
function makeQuery() {
  const query = {
    where() { return query },
    orderBy() { return query },
    limit() { return query },
    skip() { return query },
    field() { return query },
    doc() { return query },
    aggregate() { return query },
    group() { return query },
    match() { return query },
    get: () => Promise.resolve({ data: [] }),
    count: () => Promise.resolve({ total: 0 }),
    add: () => Promise.resolve({ _id: 'stub_id' }),
    update: () => Promise.resolve({ stats: { updated: 1 } }),
    remove: () => Promise.resolve({ stats: { removed: 1 } }),
    watch: () => ({ on() {}, close() {} })
  }
  return query
}

const commandStub = new Proxy(function () {}, {
  get(_, key) {
    if (key === 'then') return undefined
    return commandStub
  },
  apply() {
    return commandStub
  }
})

const dbStub = {
  collection: () => makeQuery(),
  command: commandStub,
  serverDate: () => new Date(),
  RegExp: function RegExpStub() {},
  createCollection: () => Promise.resolve({}),
  startTransaction: () => Promise.resolve({})
}

const userInfo = { userId: 'u1', name: '张三', groupName: 'g1', major: 'm1', role: 'admin' }

global.wx = {
  getStorageSync(key) {
    if (key === 'userInfo' || key === 'adminInfo' || key === 'adminSession') return { ...userInfo }
    return ''
  },
  setStorageSync() {},
  removeStorageSync() {},
  stopPullDownRefresh() {
    stopped.push(currentPage)
  },
  startPullDownRefresh() {},
  showLoading() {},
  hideLoading() {},
  showToast() {},
  showModal() {},
  setNavigationBarTitle() {},
  navigateTo() {},
  navigateBack() {},
  switchTab() {},
  reLaunch() {},
  redirectTo() {},
  getSystemInfoSync() {
    return { windowWidth: 375, statusBarHeight: 20 }
  },
  createSelectorQuery() {
    const q = {
      select: () => q,
      selectAll: () => q,
      in: () => q,
      boundingClientRect: () => q,
      scrollOffset: () => q,
      exec: (cb) => {
        if (cb) cb([])
        return q
      }
    }
    return q
  },
  cloud: {
    database: () => dbStub,
    getTempFileURL: () => Promise.resolve({ fileList: [] }),
    callFunction: () => Promise.resolve({
      result: {
        code: 0,
        msg: 'ok',
        // getCollectionData 一类云函数返回的 data 是数组，这里用「带属性的空数组」两头兼容
        data: Object.assign([], {
          list: [],
          items: [],
          records: [],
          rows: [],
          total: 0,
          conflictMap: {},
          usingDeviceIds: [],
          device: null,
          reserve: null
        })
      }
    }),
    uploadFile: () => Promise.resolve({ fileID: 'cloud://stub' }),
    deleteFile: () => Promise.resolve({ fileList: [] })
  }
}

// 未知 wx API 一律当无副作用的空函数，避免桩缺方法把自检打断
global.wx = new Proxy(global.wx, {
  get(target, key) {
    if (key in target) return target[key]
    if (typeof key === 'string' && /^[a-zA-Z]/.test(key)) {
      target[key] = () => undefined
      return target[key]
    }
    return undefined
  }
})

global.getApp = () => ({ refreshMessageBadge() {}, globalData: {} })
global.getCurrentPages = () => [{}]

let captured = null
global.Page = (config) => {
  captured = config
}

const problems = []

async function runPage(pagePath) {
  captured = null
  currentPage = pagePath
  const abs = path.join(ROOT, pagePath + '.js')

  delete require.cache[require.resolve(abs)]
  require(abs)

  if (!captured) {
    problems.push(pagePath + ' 没有调用 Page()')
    return
  }

  const config = captured
  const instance = Object.create(config)
  instance.data = JSON.parse(JSON.stringify(config.data || {}))
  instance.route = pagePath
  instance.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach((key) => {
      if (key.indexOf('.') === -1) {
        this.data[key] = patch[key]
        return
      }
      const parts = key.split('.')
      let cursor = this.data
      for (let i = 0; i < parts.length - 1; i++) {
        cursor[parts[i]] = cursor[parts[i]] || {}
        cursor = cursor[parts[i]]
      }
      cursor[parts[parts.length - 1]] = patch[key]
    })
    if (cb) cb()
  }

  if (typeof config.onPullDownRefresh !== 'function') {
    problems.push(pagePath + ' 缺少 onPullDownRefresh')
    return
  }

  try {
    await config.onPullDownRefresh.call(instance)
  } catch (err) {
    problems.push(pagePath + ' onPullDownRefresh 抛错: ' + err.message)
    return
  }

  // 等一轮宏任务，让页面里的 promise 链收尾
  await new Promise((resolve) => setTimeout(resolve, 40))

  if (stopped[stopped.length - 1] !== pagePath) {
    problems.push(pagePath + ' 没有调用 wx.stopPullDownRefresh')
  }
}

;(async () => {
  for (const page of app.pages) {
    await runPage(page)
  }

  console.log('检查页面数：' + app.pages.length)
  if (problems.length) {
    console.log('问题：\n' + problems.join('\n'))
    process.exitCode = 1
    return
  }
  console.log('全部页面的 onPullDownRefresh 都能跑通并收起刷新动画')
})()
