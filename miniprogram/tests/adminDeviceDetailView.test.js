/**
 * 管理端仪器详情页的纯逻辑测试。
 * 运行：cd miniprogram && node tests/adminDeviceDetailView.test.js
 */

const assert = require('assert')
const view = require('../pages/admin/device-detail/lib/deviceDetailView')

function testStatusMeta() {
  assert.strictEqual(view.getDeviceStatusMeta('available').text, '可用')
  assert.strictEqual(view.getDeviceStatusMeta('maintenance').tagClass, 'ds-tag-danger')
  // 库里出现没见过的值也不能让页面渲染出空的徽标
  assert.strictEqual(view.getDeviceStatusMeta('weird').key, 'unknown')
}

function testDeviceModel() {
  assert.strictEqual(view.getDeviceModel({ specifications: { 型号: '1260' } }), '1260')
  assert.strictEqual(view.getDeviceModel({ specifications: { 鍨嬪彿: 'A1' } }), 'A1')
  assert.strictEqual(view.getDeviceModel({ specifications: { model: 'M3' } }), 'M3')
  assert.strictEqual(view.getDeviceModel({ model: 'TOP' }), 'TOP')
  assert.strictEqual(view.getDeviceModel({}), '')
}

function testGroupKey() {
  const base = {
    device_name: '液相色谱仪',
    lab_name: '分析室',
    device_room: 'A101',
    device_type: '分析仪器',
    specifications: { 型号: '1260' }
  }
  assert.strictEqual(view.buildGroupKey(base), '液相色谱仪||分析室||A101||分析仪器||1260')
  // 改名之后分组键必须变，否则保存完按旧键重新查询会一台都查不到
  const renamed = Object.assign({}, base, { device_name: '液相色谱仪（新）' })
  assert.notStrictEqual(view.buildGroupKey(renamed), view.buildGroupKey(base))
}

function testCompareDeviceCode() {
  const list = ['DEV-1001', 'DEV-999', 'DEV-2']
  const sorted = list.slice().sort(view.compareDeviceCode)
  assert.deepStrictEqual(sorted, ['DEV-2', 'DEV-999', 'DEV-1001'])
}

function testBuildDeviceViews() {
  const devices = [
    { _id: 'd1', device_id: 'DEV-2', device_name: '液相色谱仪', status: 'maintenance', device_room: 'A101' },
    { _id: 'd2', device_id: 'DEV-1', device_name: '液相色谱仪', status: 'available' }
  ]
  const usages = [
    { _id: 'u1', device_id: 'DEV-2', status: 'using', student_name: '张三', start_time: '2026-11-08 09:00:00' }
  ]
  const views = view.buildDeviceViews(devices, usages)
  assert.strictEqual(views.length, 2)
  assert.strictEqual(views[0].deviceId, 'DEV-1')

  const using = views.filter(item => item.deviceId === 'DEV-2')[0]
  // 正在使用的设备不该显示「维修中」
  assert.strictEqual(using.statusKey, 'using')
  assert.strictEqual(using.isUsing, true)
  assert.strictEqual(using.usingUser, '张三')
  assert.strictEqual(using.tagClass, 'ds-tag-warning')

  const idle = views.filter(item => item.deviceId === 'DEV-1')[0]
  assert.strictEqual(idle.statusKey, 'available')
  assert.strictEqual(idle.isUsing, false)
}

function testSummarizeDevices() {
  const empty = view.summarizeDevices([])
  assert.strictEqual(empty.total, 0)
  assert.strictEqual(empty.statusText, '暂无实例')

  const mixed = view.summarizeDevices([
    { statusKey: 'using' },
    { statusKey: 'available' },
    { statusKey: 'maintenance' }
  ])
  assert.strictEqual(mixed.total, 3)
  assert.strictEqual(mixed.using, 1)
  assert.strictEqual(mixed.available, 1)
  assert.strictEqual(mixed.maintenance, 1)
  assert.strictEqual(mixed.statusText, '1 台使用中')

  const allBroken = view.summarizeDevices([{ statusKey: 'maintenance' }])
  assert.strictEqual(allBroken.statusText, '全部维修中')
}

function testBuildReserveViews() {
  const now = new Date(2026, 10, 8, 9, 30, 0).getTime()
  const reserves = [
    {
      _id: 'r2',
      device_id: 'DEV-2',
      student_name: '李四',
      start_time: '2026-11-09 14:00:00',
      end_time: '2026-11-09 15:30:00'
    },
    {
      _id: 'r1',
      device_id: 'DEV-1',
      student_name: '张三',
      start_time: '2026-11-08 09:00:00',
      end_time: '2026-11-08 10:30:00'
    }
  ]
  const views = view.buildReserveViews(reserves, now)
  assert.strictEqual(views.length, 2)
  // 已经过了开始时间的排前面，方便管理员优先处理
  assert.strictEqual(views[0].docId, 'r1')
  assert.strictEqual(views[0].statusKey, 'overdue')
  assert.strictEqual(views[0].dateDisplay, '2026-11-08')
  assert.strictEqual(views[0].timeDisplay, '09:00 - 10:30')
  assert.strictEqual(views[1].statusKey, 'upcoming')
  assert.strictEqual(views[1].timeDisplay, '14:00 - 15:30')
  assert.strictEqual(views[1].tagClass, 'ds-tag-primary')
}

function testBuildUsageViews() {
  const now = new Date(2026, 10, 8, 10, 5, 0).getTime()
  const usages = [
    {
      _id: 'u1',
      device_id: 'DEV-1',
      student_name: '张三',
      status: 'using',
      start_time: '2026-11-08 09:00:00'
    }
  ]
  const views = view.buildUsageViews(usages, now)
  assert.strictEqual(views[0].statusText, '使用中')
  assert.strictEqual(views[0].durationLabel, '已使用 1 小时 5 分钟')
  assert.strictEqual(views[0].dateDisplay, '2026-11-08')
}

function testBuildPhotoRecordViews() {
  const urlMap = {
    'cloud://a': 'https://a',
    'cloud://b': 'https://b',
    'cloud://c': 'https://c',
    'cloud://d': 'https://d'
  }
  const resolve = id => urlMap[id] || ''

  const usages = [
    { _id: 'u1', device_id: 'DEV-1', device_name: '仪器', start_photo: 'cloud://a', usage_images: ['cloud://b', 'cloud://b', ''] },
    // 老数据只有 end_photos，旧实现会先占名额再被丢掉
    { _id: 'u2', device_id: 'DEV-1', end_photos: { duty: 'cloud://c' } },
    // 一张图都拿不到，必须整条丢掉，不能占名额
    { _id: 'u3', device_id: 'DEV-1', start_photo: 'cloud://missing' },
    { _id: 'u4', device_id: 'DEV-1' }
  ]

  const views = view.buildPhotoRecordViews(usages, resolve)
  assert.strictEqual(views.length, 2)
  assert.strictEqual(views[0].docId, 'u1')
  assert.strictEqual(views[0].photoCount, 2)
  assert.deepStrictEqual(views[0].photoUrls, ['https://a', 'https://b'])
  assert.strictEqual(views[1].docId, 'u2')
  assert.deepStrictEqual(views[1].photoUrls, ['https://c'])
}

function testCollectUsagePhotoIds() {
  const usage = {
    start_photo: 'cloud://a',
    usage_images: 'cloud://b,cloud://a',
    end_checklist: { total_page: 'cloud://c', supplement_page: 'cloud://d' },
    end_photos: { duty: 'cloud://e', device_off: 'cloud://f' }
  }
  const ids = view.collectUsagePhotoIds(usage)
  // 顺序稳定、去重：老字段也要认，否则「有照片却显示没有」
  assert.deepStrictEqual(ids, ['cloud://a', 'cloud://b', 'cloud://c', 'cloud://d', 'cloud://e', 'cloud://f'])
  assert.deepStrictEqual(view.collectUsagePhotoIds({}), [])
}

function testEndChecklist() {
  assert.strictEqual(view.buildEndChecklistView(null), null)
  const checklist = view.buildEndChecklistView({
    instrument_off: true,
    sample_count: '12',
    more_sample: true,
    more_sample_count: '3',
    total_page: 'cloud://page'
  })
  assert.strictEqual(checklist.sampleCount, 12)
  assert.strictEqual(checklist.moreSampleCount, 3)
  assert.strictEqual(checklist.instrumentOff, true)
  assert.strictEqual(checklist.computerOff, false)
  assert.strictEqual(checklist.totalPageId, 'cloud://page')

  // 缺字段时必须是数字 0，不能是 undefined（否则界面渲染「undefined 个」）
  const empty = view.buildEndChecklistView({})
  assert.strictEqual(empty.sampleCount, 0)
  assert.strictEqual(empty.moreSampleCount, 0)
}

function testSpecText() {
  const specs = { 型号: 'Agilent 1260', 检测器: '紫外', 备注: '含自动进样器：已校准' }
  const text = view.buildSpecText(specs)
  assert.deepStrictEqual(view.parseSpecText(text), specs)

  const list = view.buildSpecList(specs)
  assert.strictEqual(list[0].key, '型号')
  assert.strictEqual(list[0].value, 'Agilent 1260')

  // 半角冒号也认，空行忽略
  assert.deepStrictEqual(view.parseSpecText('型号: X1\n\n  房间：B202  '), { 型号: 'X1', 房间: 'B202' })
}

function testFilterDeviceViews() {
  const views = view.buildDeviceViews([
    { _id: 'd1', device_id: 'DEV-1', device_name: '液相色谱仪', device_room: 'A101' },
    { _id: 'd2', device_id: 'DEV-2', device_name: '气相色谱仪', device_room: 'B202', specifications: { 型号: 'GC-2010' } }
  ], [])

  assert.strictEqual(view.filterDeviceViews(views, 'a101').length, 1)
  assert.strictEqual(view.filterDeviceViews(views, 'GC').length, 1)
  assert.strictEqual(view.filterDeviceViews(views, '色谱').length, 2)
  assert.strictEqual(view.filterDeviceViews(views, '不存在的关键词').length, 0)
  assert.strictEqual(view.filterDeviceViews(views, '').length, 2)
}

function testRichText() {
  assert.strictEqual(view.buildRichText('  先开机  '), '先开机')
  assert.strictEqual(view.buildRichText({ sections: [{ title: 'a' }] }), '已配置分步操作规程')
  assert.strictEqual(view.buildRichText(null), '')
}

function testChunkAndUnique() {
  assert.deepStrictEqual(view.chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepStrictEqual(view.uniqueById([{ _id: 'a' }, { _id: 'a' }, { _id: 'b' }, {}]), [{ _id: 'a' }, { _id: 'b' }])
}

testStatusMeta()
testDeviceModel()
testGroupKey()
testCompareDeviceCode()
testBuildDeviceViews()
testSummarizeDevices()
testBuildReserveViews()
testBuildUsageViews()
testBuildPhotoRecordViews()
testCollectUsagePhotoIds()
testEndChecklist()
testSpecText()
testFilterDeviceViews()
testRichText()
testChunkAndUnique()

console.log('adminDeviceDetailView tests passed')
