// 全局 window.enablePullDownRefresh 为 true，页面若没实现 onPullDownRefresh，
// 下拉后要等超时才收回。这里把「每个页面都要有下拉刷新」固化成测试。
const assert = require('assert')
const fs = require('fs')

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const pages = [].concat(app.pages || [])

const problems = []

for (const page of pages) {
  const jsPath = page + '.js'

  if (!fs.existsSync(jsPath)) {
    problems.push(jsPath + ' 缺少页面 JS')
    continue
  }

  const source = fs.readFileSync(jsPath, 'utf8')

  if (!/onPullDownRefresh\s*\(/.test(source)) {
    problems.push(page + '.js 未实现 onPullDownRefresh')
  }
  if (!/stopPullDownRefresh\s*\(/.test(source)) {
    problems.push(page + '.js 未调用 wx.stopPullDownRefresh')
  }

  const jsonPath = page + '.json'
  if (fs.existsSync(jsonPath)) {
    const config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    if (config.enablePullDownRefresh === false) {
      problems.push(jsonPath + ' 关闭了 enablePullDownRefresh')
    }
  }
}

assert.deepStrictEqual(problems, [])
console.log('pull down refresh tests passed')
