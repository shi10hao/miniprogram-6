const assert = require('assert')
const fs = require('fs')

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))

assert.notStrictEqual(app.debug, true, 'app.json debug should be disabled before delivery')
assert.ok(!app.permission || !app.permission['scope.userInfo'], 'app.json should not include invalid scope.userInfo permission')

console.log('app config tests passed')
