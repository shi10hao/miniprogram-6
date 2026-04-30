const assert = require('assert')
const { createAssetPathCandidates } = require('../pages/webview/3dscene/lib/assetPathCandidates')

function testLeadingSlashPathUsesRelativePathFirst() {
  const candidates = createAssetPathCandidates('/pages/webview/3dscene/assets/models/Centrifuge.glb')

  assert.deepStrictEqual(candidates, [
    'pages/webview/3dscene/assets/models/Centrifuge.glb',
    '/pages/webview/3dscene/assets/models/Centrifuge.glb'
  ])
}

function testRelativePathIsNotDuplicated() {
  const candidates = createAssetPathCandidates('pages/webview/3dscene/assets/models/Centrifuge.glb')

  assert.deepStrictEqual(candidates, [
    'pages/webview/3dscene/assets/models/Centrifuge.glb'
  ])
}

testLeadingSlashPathUsesRelativePathFirst()
testRelativePathIsNotDuplicated()
console.log('assetPathCandidates tests passed')
