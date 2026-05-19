const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { templateId, thing1, thing2 } = event

  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser: OPENID,
      template_id: templateId,
      page: 'pages/index/index',
      data: {
        thing1: thing1,
        thing2: thing2
      }
    })
    return { success: true, res }
  } catch (err) {
    return { success: false, err: err.toString() }
  }
}