// ========== 已停用（2026-11） ==========
// 这套「每 2 小时」的提醒和 sendUsageReminder 的「每 3 小时」提醒是同一件事的两份实现：
// 两者都查 device_usage.status='using'、都写 messages、都用模板 A，
// 而 timedUsageRemind 判「上次提醒」读的正是 sendUsageReminder 写的那条消息，
// 两个定时器同时跑会互相压制间隔，还会重复推送站内消息（它用 add 每次新建，不幂等）。
//
// 现在统一由 sendUsageReminder 负责：有分页、有幂等 docId、按 3 小时周期算、
// 失败不更新 last_reminder_time。本函数的定时触发器已在 config.json 里移除，
// main 直接返回，避免被手动调用后重复下发。
//
// 原实现保留在 git 历史里（1.0.6.6tree 分支之前的版本），需要对照时用 git show 查。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  console.log('[timedUsageRemind] 已停用，使用提醒统一由 sendUsageReminder 负责')
  return { success: true, deprecated: true, movedTo: 'sendUsageReminder' }
}
