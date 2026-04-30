function normalizeText(value) {
  return String(value || '').trim()
}

function hasNamedModelNode(hitObjectName) {
  return !!normalizeText(hitObjectName)
}

function formatLabText(dbInfo, fallbackLabText) {
  if (!dbInfo) return fallbackLabText || ''

  var labName = normalizeText(dbInfo.lab_name)
  var room = normalizeText(dbInfo.device_room)
  var text = normalizeText(labName + (room ? ' ' + room : ''))
  return text || fallbackLabText || ''
}

function createPanelData(options) {
  var input = options || {}
  var hitObjectName = normalizeText(input.hitObjectName)
  var useModelNode = hasNamedModelNode(hitObjectName)
  var dbInfo = input.dbInfo || null
  var summarizeText = typeof input.summarizeText === 'function'
    ? input.summarizeText
    : function(text) { return normalizeText(text) }

  if (useModelNode) {
    return {
      name: hitObjectName,
      deviceId: '',
      lab: '',
      model: '',
      description: summarizeText(input.fallbackDescription || ''),
      status: '',
      statusText: '',
      canViewDetail: false,
      canReserve: false
    }
  }

  var description = (dbInfo && dbInfo.description) || input.configDescription || ''

  return {
    name: (dbInfo && dbInfo.device_name) || input.configName || input.mapName || input.unknownName || '',
    deviceId: input.dbDeviceId || '',
    lab: formatLabText(dbInfo, input.fallbackLabText || ''),
    model: input.model || '',
    description: summarizeText(description),
    status: input.status || '',
    statusText: input.statusText || '',
    canViewDetail: !!input.detailUrl && !!dbInfo,
    canReserve: input.role === 'student' && input.status === 'available' && !!dbInfo
  }
}

module.exports = {
  createPanelData,
  hasNamedModelNode
}
