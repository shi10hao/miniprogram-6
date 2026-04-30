const assert = require('assert')
const { createPanelData } = require('../pages/webview/3dscene/lib/devicePanelBinding')

function testNamedModelNodeDoesNotBorrowDbInfo() {
  const panel = createPanelData({
    hitObjectName: '3DGeom-5',
    dbInfo: {
      device_name: 'TOC-VCPH total organic carbon analyzer',
      lab_name: 'Public Lab 1',
      device_room: 'F301',
      description: 'Database description that belongs to another device'
    },
    dbDeviceId: 'PUBLIC_LAB1_LARGE_008',
    model: 'TOC-VCPH',
    status: 'available',
    statusText: 'available',
    detailUrl: '/pages/device/detail/devicedetail?deviceId=PUBLIC_LAB1_LARGE_008',
    configName: 'TOC-VCPH total organic carbon analyzer',
    fallbackDescription: 'No description',
    role: 'student',
    summarizeText: text => text
  })

  assert.strictEqual(panel.name, '3DGeom-5')
  assert.strictEqual(panel.deviceId, '')
  assert.strictEqual(panel.lab, '')
  assert.strictEqual(panel.model, '')
  assert.strictEqual(panel.status, '')
  assert.strictEqual(panel.statusText, '')
  assert.strictEqual(panel.description, 'No description')
  assert.strictEqual(panel.canViewDetail, false)
  assert.strictEqual(panel.canReserve, false)
}

function testDbInfoIsUsedWhenNoNamedModelNodeWasHit() {
  const panel = createPanelData({
    hitObjectName: '',
    dbInfo: {
      device_name: 'TOC-VCPH total organic carbon analyzer',
      lab_name: 'Public Lab 1',
      device_room: 'F301',
      description: 'Database description'
    },
    dbDeviceId: 'PUBLIC_LAB1_LARGE_008',
    model: 'TOC-VCPH',
    status: 'available',
    statusText: 'available',
    detailUrl: '/pages/device/detail/devicedetail?deviceId=PUBLIC_LAB1_LARGE_008',
    configName: 'Fallback config name',
    fallbackDescription: 'No description',
    role: 'student',
    summarizeText: text => text
  })

  assert.strictEqual(panel.name, 'TOC-VCPH total organic carbon analyzer')
  assert.strictEqual(panel.deviceId, 'PUBLIC_LAB1_LARGE_008')
  assert.strictEqual(panel.lab, 'Public Lab 1 F301')
  assert.strictEqual(panel.model, 'TOC-VCPH')
  assert.strictEqual(panel.description, 'Database description')
  assert.strictEqual(panel.canViewDetail, true)
  assert.strictEqual(panel.canReserve, true)
}

testNamedModelNodeDoesNotBorrowDbInfo()
testDbInfoIsUsedWhenNoNamedModelNodeWasHit()
console.log('devicePanelBinding tests passed')
