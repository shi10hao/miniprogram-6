const cloud = require('wx-server-sdk')
const { createDeleteMessageHandler } = require('./deleteMessageCore')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const deleteMessage = createDeleteMessageHandler({
  db,
  getOpenId: function() {
    const wxContext = cloud.getWXContext ? cloud.getWXContext() : {}
    return wxContext.OPENID || ''
  }
})

exports.main = async event => deleteMessage(event)
