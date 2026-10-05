# 数据库索引建议（云开发控制台手动创建）

> 微信云开发的数据库索引**没有代码配置文件**，只能在
> 「云开发控制台 → 数据库 → 选择集合 → 索引管理」里手动添加。
> 本文档列出当前代码里最需要索引的查询，按优先级排列。

没有索引时，上述查询会全表扫描。数据量到几百条以后，
`count()` 和带 `orderBy` 的分页查询会明显变慢，是云函数
`timeout` 的主要原因之一。

---

## 一、必建（直接影响预约流程）

### 1. `reserves` —— 时间段冲突检测

来源：`cloudfunctions/getAvailableDevices`、`miniprogram/pages/reservation/reservation.js`

```js
where({
  device_id: _.in([...]),
  reserve_date: '<日期>',
  start_time: _.lte(...), end_time: _.gt(...)
})
```

建议索引（复合）：

| 字段顺序 | 说明 |
| --- | --- |
| `device_id` ↑ | 等值/IN |
| `reserve_date` ↑ | 等值 |
| `start_time` ↑ | 范围 |
| `end_time` ↑ | 范围 |

### 2. `device_usage` —— 查询"使用中"设备

来源：`cloudfunctions/getAvailableDevices`

```js
where({ device_id: _.in([...]), status: 'using' })
```

建议索引：

| 字段顺序 | 说明 |
| --- | --- |
| `status` ↑ | 等值（基数低，放前面过滤） |
| `device_id` ↑ | IN |

### 3. `device_usage` —— 用户使用记录

来源：`miniprogram/pages/usage/usage.js`、`appointment.js`

```js
where({ user_id, status: _.in(['completed','abnormal']) }).orderBy('start_time', 'desc')
where({ user_id, status: 'using' })
```

建议索引：

| 字段顺序 | 说明 |
| --- | --- |
| `user_id` ↑ | 等值 |
| `status` ↑ | 等值 / IN |
| `start_time` ↓ | 排序 |

---

## 二、建议建（列表与红点）

### 4. `devices` —— 可见性与状态筛选

来源：`cloudfunctions/getDevices`、`getAvailableDevices`

```js
where({ status: 'available', lab_type: 'public' })
where({ status: 'available', lab_name: '<课题组>' })
```

建议索引：

| 字段顺序 | 说明 |
| --- | --- |
| `status` ↑ | 等值 |
| `lab_type` ↑ | 等值 |
| `lab_name` ↑ | 等值 |

### 5. `messages` —— 未读消息红点

来源：`miniprogram/app.js` 的 `refreshMessageBadge`

```js
where({ user_id, is_read: _.neq(true) }).count()
```

建议索引：

| 字段顺序 | 说明 |
| --- | --- |
| `user_id` ↑ | 等值 |
| `is_read` ↑ | 不等（`neq` 无法走索引，但 user_id 能先收窄范围） |

### 6. `notice` —— 首页最新公告

来源：`miniprogram/pages/index/index.js`

```js
orderBy('publish_date', 'desc').limit(3)
```

建议索引：`publish_date` ↓（单字段即可，用于排序）

---

## 三、创建方式

1. 打开微信开发者工具 → 云开发 → 数据库
2. 选中对应集合 → 索引管理 → 添加索引
3. 按上表顺序填写字段名与排序方向
4. 勾选"唯一"与否：以上**都不要**勾选唯一（均非唯一索引）

> 创建索引时数据库会短暂锁定该集合，建议在无人使用时操作。
