# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目形态

微信小程序 + 云开发。前端在 `miniprogram/`（页面在 `pages/`，公共工具在 `utils/`），云函数在 `cloudfunctions/`（一个函数一个目录，各自带 `package.json`，依赖 `wx-server-sdk`）。没有构建步骤、没有 CI，代码由微信开发者工具编译。

## 代码规范

改动任何 JS / WXML / WXSS 前先读 `@docs/code-style.md`，**那是唯一标准**（本节的条目只是摘要，冲突时以该文档为准）。三条硬底线：

- 新写或改动的方法一律用简写 `backToStudentAuth() {}`，禁止 `xxx: function () {}` 与箭头函数挂 `Page`；无分号、单引号、2 空格、禁止 `var`。
- 碰过的文件顺手规范化（只动自己改过的那部分，别整文件重排）。
- 云函数返回 `{ code, msg, data }`；前端 `await wx.cloud.callFunction(...)` 配 `try / catch / finally`。

提交前跑 `npm run lint`（自动修复用 `npm run lint:fix`），错误清零。

## 跑测试

- 测试是独立 node 脚本（只用 `assert`，无框架、无 `npm test`），**必须在 `miniprogram/` 目录下运行**——脚本用相对当前目录的路径读 `app.json` 等文件：
  `cd miniprogram && node tests/devicelistPaging.test.js`
- 两个测试长期失败且与业务改动无关，不要当成回归、也不要顺手去修：`tests/deleteMessageCore.test.js`（require 路径指向仓库根的 `cloudfunctions/`）、`tests/pageFiles.test.js`（缺 `pages/auth/login/login.wxss` 与 `.json`）。
- 新增页面要同时注册进 `miniprogram/app.json` 并补齐 `.js/.wxml/.wxss/.json` 四件套，`tests/pageFiles.test.js` 校验的正是这个。
- 可测逻辑抽成不依赖 `wx.*` 的纯模块（参考 `pages/webview/3dscene/lib/`），测试直接 `require` 它。

## 样式

- 页面样式一律复用 `miniprogram/app.wxss` 里的 `--ds-*` 变量与 `ds-*` 类（`ds-card`、`ds-btn`、`ds-tag`、`ds-empty`、`ds-skeleton` 等），不要新造色值、不要引入 UI 库。主色 `#62BCC4`。
- 尺寸用 rpx，按 750 宽设计稿；界面文案与代码注释用中文。

## 云开发

- 环境 id 写死在 `miniprogram/app.js`：`CLOUD_ENV = 'cloud1-d2g3kx3un05924a95'`。
- 云函数固定用 `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })` 和 `exports.main = async (event, context) => {}`；前端通过 `wx.cloud.callFunction({ name })` 调用。
- 云函数只能在微信开发者工具里右键「上传并部署」，仓库没有部署 CLI；根目录 `uploadCloudFunction.sh` 是未展开占位符的模板，不要执行。
- `<image src="{{cloud://...}}">` 不可用，必须先用 `miniprogram/utils/cloudFile.js` 换成 https 临时链接（模块内有 5 分钟缓存）。

## 配置

- 项目配置以**根目录** `project.config.json` 为准（appid `wx3f96c57bc726c368`）。`miniprogram/project.config.json` 与 `miniprogram/project.private.config.json` 是别的项目留下的旧副本（appid `wxce5e14a214fab8b4`），不要照着它们改项目设置。
- 数据库索引只能在云开发控制台手动创建，需要哪些索引见 `@docs/database-indexes.md`。
