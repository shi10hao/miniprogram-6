# 订阅消息链路一览（谁在什么时候收到什么）

> 这份文档回答三个问题：**哪条业务会发订阅消息**、**靠什么触发（前端订阅 / 定时器）**、
> **配额记在哪个字段上**。改通知相关代码前先看这里，避免出现「数字和列表对不上」那类问题。
>
> 模板常量（三处必须一致，改模板要同步改）：
>
> - **A** `rgRmn33I28JIm4REBjzpin2dV474fmrLRxYFTpSJbuk` —— 预约即将开始 / 使用中拍照提醒
> - **B** `9Lr3yHaJzl8LyzC5qbNGFYgu5ILBFc3XSowjJRv1-eg` —— 注册审核结果 / 管理员新申请 / 公告发布
> - **C** `rEryURnzJ73glhEiqTmrGi3sNio16MDmUcMrIc0LPiY` —— 仪器异常告警

## 一、链路总表

| # | 场景 | 触发方式 | 前端入口 | 云函数 | 收件人 | 模板 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 学生提交注册 → 提醒管理员 | 提交后立即 | `pages/auth/auth.js` 请求订阅 + 写入 `user_apply` | `notifyAdminNewApply` | `role=admin` | B |
| 2 | 审核结果 → 学生 | 管理员点通过/拒绝 | `pages/admin/apply-review` | `reviewUserApply` | 申请人 | B |
| 3 | 公告发布 → 学生 | 管理员发布 | `pages/admin/admin.js` → `sendNoticeSubMsg` | `sendNoticeSubMsg` | `role=student` 且 `subMsg.count>0` | B |
| 4 | 预约开始前 30 分钟 → 学生 | 定时器（每 5 分钟） | — | `sendReserveStartRemind` | 预约人 | A |
| 5 | 使用满 3 小时 → 学生 | 定时器（每 30 分钟扫一次） | — | `sendUsageReminder` | 使用中的人 | A |
| 6 | 仪器异常反馈 → 管理员 | 用户提交反馈成功后 | `pages/usage/usage.js` | `sendAbnormalNotification` | `role IN (teacher, admin)` | C |

## 二、配额怎么记

微信的一次性订阅额度是 **按「人 + 模板」计的单一池子**，一个模板只能存一条，用掉就清零。
所以项目里有两套记账，必须和真实额度对得上：

| 记账位置 | 谁 +1 | 谁 -1 | 说明 |
| --- | --- | --- | --- |
| `users.subMsg.count`（模板 B） | `addSubMsgCount`（首页订阅条，只认白名单模板） | `sendNoticeSubMsg`（发公告成功）、`reviewUserApply`（发审核结果成功） | 模板 B 三业务共用一条额度，谁先到谁用掉 |
| `admin_sub_msg.<slot>.count`（模板 B/C） | `addAdminSubMsgCount` | `notifyAdminNewApply`（apply 槽）、`sendAbnormalNotification`（abnormal 槽） | `_id` 就是管理员 openid |

要点：

- **发成功才扣**，`43101`（用户拒收 / 额度用尽）时把该槽清零并记 `lastErrCode`，下次不再盲发。
- 同一模板被多业务共用时，**每条业务用完都要扣**，否则前端「可收 N 条」会虚高。
  模板 B 的审核结果就属于这种情况（2026-11 补上扣减）。
- 模板 A 也是两条业务共用（预约提醒 + 拍照提醒），历史遗留问题尚未拆分：
  用户在哪一侧订阅，额度都可能被另一侧先用掉。

## 三、定时器

| 云函数 | cron | 实际行为 |
| --- | --- | --- |
| `sendReserveStartRemind` | `0 */5 * * * * *` | 每 5 分钟扫一次，窗口 `[now-5min, now+35min)`，命中即发并写 `start_reminder_sent` |
| `sendUsageReminder` | `0 */30 * * * * *` | 每 30 分钟扫一次，按 `last_reminder_time` 每 3 小时提示一次 |
| `timedUsageRemind` | — | **已停用**：定时触发器已移除，`main` 直接返回 |

> 微信云开发的 Cron 有 **七个必需字段**（秒 分 时 日 月 星期 年）。
> 少一段的配置写上去不会报错，但不会按时触发 —— 历史上两个 30 分钟提醒就因为
> 只写了 6 段而从未跑过。`miniprogram/tests/subscribeMessageConfig.test.js` 会守住这条。

## 四、已知缺口（有意为之或待补）

1. 预约被拒、预约被取消、使用正常结束 —— 都不发订阅消息（只在站内消息/页面状态里体现）。
2. 设备报修（`pages/admin/admindevicedetail` 的「报修」按钮）只改 `devices.status`，不发通知。
3. `reviewUserApply` 在 `users` 已存在时提前 return，学生收不到「已通过」。
4. 模板 A 的双语义未拆分（见上）。
5. 使用页的「照片提醒」文案写死「3 小时」，修改周期常量时记得同步文案。
