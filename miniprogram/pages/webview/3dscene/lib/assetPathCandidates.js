function createAssetPathCandidates(assetPath) {
  var normalizedPath = String(assetPath || '').trim()
  if (!normalizedPath) {
    return []
  }

  if (normalizedPath.charAt(0) !== '/') {
    return [normalizedPath]
  }

  return [
    normalizedPath.slice(1),
    normalizedPath
  ]
}

module.exports = {
  createAssetPathCandidates
}
