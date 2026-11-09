# 实验室仪器预约系统（微信小程序 + 云开发）

小程序前端在 `miniprogram/`，云函数在 `cloudfunctions/`。没有构建步骤，代码由微信开发者工具直接编译；云函数只能在开发者工具里右键「上传并部署」。

## 目录

- `miniprogram/pages/`：页面（四件套 `.js/.wxml/.wxss/.json`），公共逻辑抽成不依赖 `wx.*` 的纯模块，放在各页面的 `lib/` 或独立 `*Model.js` 里
- `miniprogram/utils/`：`cloudFile.js`（cloud:// 转 https 临时链接）、`datetime.js`（时间解析与格式化）
- `miniprogram/tests/`：独立 node 脚本测试，只用 `assert`
- `cloudfunctions/`：一个云函数一个目录，统一返回 `{ code, msg, data }`
- `docs/`：代码规范 `code-style.md`、数据库索引 `database-indexes.md`

## 常用命令

```bash
npm install          # 只在需要跑 lint 时安装（eslint + @stylistic）
npm run lint         # 提交前必须通过
npm run lint:fix     # 自动修复缩进、箭头函数括号等格式问题

cd miniprogram && node tests/devicelistPaging.test.js            # 单个测试
cd miniprogram && for f in tests/*.test.js; do node "$f"; done   # 全部测试
```

测试脚本用相对当前目录的路径读 `app.json`，**必须在 `miniprogram/` 下运行**。`tests/deleteMessageCore.test.js` 长期失败（require 指向仓库根 `cloudfunctions/`），与业务改动无关。

## 约定

- 代码规范唯一标准是 `docs/code-style.md`，工程约定见 `CLAUDE.md`
- 项目配置以根目录 `project.config.json` 为准（appid `wx3f96c57bc726c368`）
- 三维实验室视图已下线，`devicedetail` / `admin` 里保留了入口占位（点击提示「正在升级」），恢复时接回 scene3d
