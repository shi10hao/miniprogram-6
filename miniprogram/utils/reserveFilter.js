/**
 * 预约列表筛选条件的唯一来源
 *
 * 为什么要有这个文件：「我的预约」页的筛选、「我的」页概览数字、旧版「应用」页的
 * 概览数字原来各写一套，结果走样成「数字 69 条待开始、点进去只有 1 条」。
 * 现在条件只在这里拼，谁要筛选就调谁，数字和列表天然一致。
 *
 * 字段约定（见 pages/reservation/reservation.js 的创建逻辑）：
 * - status：pending / approved / rejected / cancelled
 * - usage_status：not_started / active / completed / abnormal，老数据可能没有这个字段
 * - start_time / end_time：'YYYY-MM-DD HH:mm'，同格式字符串可直接比较先后
 */

const datetime = require('./datetime.js')

/** 还没开始使用：老数据没有 usage_status，按空串一并收进来 */
const NOT_STARTED_STATES = ['not_started', '']

/** 已经进入使用流程的状态 */
const STARTED_STATES = ['active', 'completed', 'abnormal']

/** 当前时间，格式与 reserves.end_time 一致，可直接做字符串比较 */
function formatNowText(date) {
  const now = date || new Date()
  return `${datetime.formatDateKey(now)} ${datetime.pad2(now.getHours())}:${datetime.pad2(now.getMinutes())}`
}

/**
 * 生成预约列表的查询条件
 * @param {Object} command db.command
 * @param {Object} options { userId, filter, nowText }
 *   filter 取值：all / upcoming / expired / effective / cancelled
 *   nowText 不传时取当前时间
 * @returns {Object} 可直接传给 db.collection('reserves').where()
 */
function buildReservationWhere(command, options) {
  const params = options || {}
  const filter = params.filter || 'all'
  const base = { user_id: params.userId }
  const nowText = params.nowText || formatNowText()

  switch (filter) {
    case 'upcoming':
      // 已通过、还没开始使用、且时段还没结束
      return Object.assign({}, base, {
        status: 'approved',
        usage_status: command.in(NOT_STARTED_STATES),
        end_time: command.gte(nowText)
      })
    case 'expired':
      // 已通过、还没开始使用、但时段已经过去（没去用，也没有任何使用记录）
      return Object.assign({}, base, {
        status: 'approved',
        usage_status: command.in(NOT_STARTED_STATES),
        end_time: command.lt(nowText)
      })
    case 'effective':
      // 已通过 且 已进入使用/已完成/异常
      return Object.assign({}, base, {
        status: 'approved',
        usage_status: command.in(STARTED_STATES)
      })
    case 'cancelled':
      // 待审核 / 已拒绝 / 已取消，都不算待开始
      return Object.assign({}, base, {
        status: command.in(['cancelled', 'rejected', 'pending'])
      })
    default:
      return base
  }
}

module.exports = {
  NOT_STARTED_STATES,
  STARTED_STATES,
  formatNowText,
  buildReservationWhere
}
