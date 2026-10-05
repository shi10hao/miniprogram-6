const assert = require('assert')

// 用内存对象模拟小程序的 storage / 云函数调用
const storage = {}
let callCount = 0
let shouldFail = false

global.wx = {
  getStorageSync: key => (key in storage ? storage[key] : ''),
  setStorageSync: (key, value) => {
    storage[key] = value
  },
  removeStorageSync: key => {
    delete storage[key]
  },
  cloud: {
    callFunction: options => {
      callCount++
      if (shouldFail) return Promise.reject(new Error('mock failure'))
      const fileList = (options.data && options.data.fileList) || []
      return Promise.resolve({
        result: fileList.map(fileID => ({
          fileID,
          tempFileURL: 'https://example.com/' + encodeURIComponent(fileID)
        }))
      })
    }
  }
}

const cloudFile = require('../utils/cloudFile.js')

function reset() {
  Object.keys(storage).forEach(key => {
    delete storage[key]
  })
  callCount = 0
  shouldFail = false
  // 模块内部还有一层内存缓存，测试之间必须一起清掉
  cloudFile._resetCacheForTests()
}

async function testNonCloudValuesAreIgnored() {
  reset()
  const map = await cloudFile.resolveTempUrls(['https://a.png', '', null, undefined, 'local.png'])
  assert.deepStrictEqual(map, {})
  assert.strictEqual(callCount, 0, '没有 cloud:// 时不应该调用云函数')
}

async function testCloudIdsAreResolved() {
  reset()
  const map = await cloudFile.resolveTempUrls(['cloud://env/a.png', 'cloud://env/b.png'])
  assert.strictEqual(callCount, 1)
  assert.strictEqual(map['cloud://env/a.png'], 'https://example.com/' + encodeURIComponent('cloud://env/a.png'))
  assert.strictEqual(map['cloud://env/b.png'], 'https://example.com/' + encodeURIComponent('cloud://env/b.png'))
}

async function testDuplicateIdsAreResolvedOnce() {
  reset()
  await cloudFile.resolveTempUrls(['cloud://env/a.png', 'cloud://env/a.png', 'cloud://env/a.png'])
  assert.strictEqual(callCount, 1, '重复的 fileID 应该去重')
}

async function testCachePreventsRepeatedRequests() {
  reset()
  await cloudFile.resolveTempUrls(['cloud://env/a.png'])
  assert.strictEqual(callCount, 1)
  // 第二次应该直接命中缓存
  await cloudFile.resolveTempUrls(['cloud://env/a.png'])
  assert.strictEqual(callCount, 1, '命中缓存时不应该再次调用云函数')
}

async function testFailureDoesNotThrow() {
  reset()
  shouldFail = true
  const map = await cloudFile.resolveTempUrls(['cloud://env/a.png'])
  assert.deepStrictEqual(map, {}, '云函数失败时应返回空映射而不是抛错')
}

function testResolveSingle() {
  const map = { 'cloud://env/a.png': 'https://example.com/a.png' }
  assert.strictEqual(cloudFile.resolveSingle('cloud://env/a.png', map), 'https://example.com/a.png')
  assert.strictEqual(cloudFile.resolveSingle('cloud://env/missing.png', map), '', '解析不到的 fileID 返回空串')
  assert.strictEqual(cloudFile.resolveSingle('https://example.com/b.png', map), 'https://example.com/b.png')
  assert.strictEqual(cloudFile.resolveSingle('', map), '')
  assert.strictEqual(cloudFile.resolveSingle(null, map), '')
}

async function testResolveListField() {
  reset()
  const list = [
    { device_id: '1', picture: 'cloud://env/a.png' },
    { device_id: '2', picture: 'https://example.com/b.png' },
    { device_id: '3', picture: '' }
  ]
  const resolved = await cloudFile.resolveListField(list, 'picture')
  assert.notStrictEqual(resolved, list)
  assert.strictEqual(resolved[0].picture, 'https://example.com/' + encodeURIComponent('cloud://env/a.png'))
  assert.strictEqual(resolved[1].picture, 'https://example.com/b.png', '非 cloud:// 的地址保持不变')
  assert.strictEqual(resolved[2].picture, '')
  // 原数组不应被修改
  assert.strictEqual(list[0].picture, 'cloud://env/a.png')
}

async function testResolveListFieldWithoutCloudIds() {
  reset()
  const list = [{ picture: 'https://example.com/b.png' }]
  const resolved = await cloudFile.resolveListField(list, 'picture')
  assert.strictEqual(resolved, list, '没有 cloud:// 时应原样返回同一个数组')
  assert.strictEqual(callCount, 0)
}

async function testIsCloudFileId() {
  assert.strictEqual(cloudFile.isCloudFileId('cloud://env/a.png'), true)
  assert.strictEqual(cloudFile.isCloudFileId('https://example.com/a.png'), false)
  assert.strictEqual(cloudFile.isCloudFileId(''), false)
  assert.strictEqual(cloudFile.isCloudFileId(null), false)
  assert.strictEqual(cloudFile.isCloudFileId(123), false)
}

async function run() {
  await testNonCloudValuesAreIgnored()
  await testCloudIdsAreResolved()
  await testDuplicateIdsAreResolvedOnce()
  await testCachePreventsRepeatedRequests()
  await testFailureDoesNotThrow()
  testResolveSingle()
  await testResolveListField()
  await testResolveListFieldWithoutCloudIds()
  await testIsCloudFileId()
  console.log('cloudFile tests passed')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
