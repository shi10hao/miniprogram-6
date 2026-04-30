const assert = require('assert')
const fs = require('fs')

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const pages = [].concat(app.pages || [])

for (const subPackage of app.subPackages || []) {
  const root = String(subPackage.root || '').replace(/\/$/, '')
  for (const page of subPackage.pages || []) {
    pages.push(root + '/' + page)
  }
}

const missing = []
for (const page of pages) {
  for (const ext of ['.js', '.wxml', '.wxss', '.json']) {
    const filePath = page + ext
    if (!fs.existsSync(filePath)) {
      missing.push(filePath)
    }
  }
}

assert.deepStrictEqual(missing, [])
console.log('page file completeness tests passed')
