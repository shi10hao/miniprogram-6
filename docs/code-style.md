# 代码规范

> 适用范围：`miniprogram/` 与 `cloudfunctions/` 下的所有 JS / WXML / WXSS。
>
> 这份文档是唯一标准。`CLAUDE.md` 里的「代码规范」一节只是入口，与本文冲突时以本文为准。
> 基线：微信小程序官方示例风格 + JavaScript Standard Style 的排版取舍（无分号、单引号、2 空格、简写方法）。
> 规则总量控制在 50 条以内 —— 规则太多就没人会真的遵守。

---

## 0. 三条硬底线

1. **新写或改动的方法一律用简写**：`backToStudentAuth() {}`，不写 `backToStudentAuth: function () {}`。
2. **碰过的文件顺手规范化**：只规范化你动过的那部分，不整文件重排别人的代码。
3. **云函数返回 `{ code, msg, data }`**；前端一律 `await wx.cloud.callFunction(...)` 配 `try / catch / finally`。

---

## 1. 排版

- 缩进 **2 个空格**，不用 Tab。
- 字符串用**单引号**；字符串里本身有单引号时才用双引号（`"it's"`）。
- **不加分号**。
- 行尾不留空格，文件末尾留一个空行。
- 单行不超过 120 字符；超了就把对象字段或参数换行，一行一个。
- 对象/数组：短就一行 `{ a: 1 }`，长就换行，**末尾不加逗号**。
- 运算符两侧留空格；逗号后留空格、前不留；冒号后留空格、前不留。
- `if / for / while` 后面留空格：`if (a) {`。

## 2. 函数

- 页面、组件、模块里挂的方法**一律用简写**：

  ```js
  Page({
    data: {
      loading: false
    },

    onLoad(options) { },

    // ✅ 要的就是这种
    backToStudentAuth() {
      wx.reLaunch({
        url: '/pages/auth/auth'
      })
    }
  })
  ```

- 明确禁止的写法：

  ```js
  // ❌ function 表达式
  backToStudentAuth: function () { }

  // ❌ 箭头函数挂在 Page / Component 上（拿不到 this，也不符合生命周期签名）
  backToStudentAuth: () => { }
  ```

- 生命周期按官方签名写全参数，即使暂时不用：`onLoad(options)`、`onShow()`、`onUnload()`。
- 回调里要拿页面实例，**用箭头函数**；存量里的 `const that = this` 保留，但新代码不再这么写。
- 单个函数不超过 60 行；超了说明它在干好几件事，拆开。
- 提前 return（守卫写法），不要多层嵌套 `if`：

  ```js
  // ✅
  if (!this.data.canSubmit) return this.showError('请填写完整信息')

  // ❌
  if (this.data.canSubmit) {
    if (xxx) { ... }
  }
  ```

- 没有分支的 `if` 也加大括号，不写 `if (a) return` 以外的单行语句。
- 异步方法写成 `async doLogin() { }`，不要 `doLogin() { return new Promise(...) }`。

## 3. 变量与命名

- `const` 优先，需要重新赋值才用 `let`；**禁止 `var`**。
- 一次声明一个变量，不写 `let a = 1, b = 2`。
- 变量、函数：`camelCase`；模块级常量：`UPPER_SNAKE_CASE`（放在文件顶部）。
- 布尔值用 `is / has / can / should` 开头：`isLoading`、`hasVideo`、`canSubmit`。
- 事件处理函数用 `on` 开头：`onStudentIdInput(e)`、`onVideoError(e)`。
- 页面跳转用 `go / open / navigateTo` 开头：`goChangePwd()`、`openRegisterModal()`。
- 数据加工用 `build / format / parse / normalize` 开头：`buildDeviceList()`、`formatTime()`。
- 取数据用 `load / fetch` 开头：`loadVideoSource()`、`fetchMessages()`。
- 云函数入参与数据库字段用 **snake_case**（`user_id`、`group_name`），与数据库保持一致；前端渲染用的派生字段再用 camelCase。

## 4. 文件内组织顺序

页面 JS 固定按这个顺序，分组之间用分隔注释（参考 `miniprogram/pages/auth/auth.js`）：

```js
// 1. require / 模块级常量
const registerTempleID = 'xxx'

Page({
  // 2. data
  data: { },

  // 3. 生命周期
  onLoad() { },
  onShow() { },

  // ==================== 输入监听 ====================
  onStudentIdInput(e) { },

  // ==================== 业务动作 ====================
  doLogin() { },

  // ==================== 其他 ====================
  showError(msg) { }
})
```

- 纯逻辑、可脱离 `wx.*` 测试的部分抽成同级 `xxxModel.js` 并 `module.exports`（参考 `miniprogram/pages/message/detail/detailModel.js`、`miniprogram/utils/cloudFile.js`），测试脚本直接 `require` 它。
- 单个 JS 文件超过 500 行，考虑拆模块。

## 5. 注释

- 注释、界面文案**一律中文**。
- 每个方法至少一句说明；参数超过 2 个或语义不直观时写 JSDoc：

  ```js
  /**
   * 把一批 fileID 换成临时链接
   * @param {Array<string>} fileIds
   * @returns {Promise<Object>} { [fileID]: tempURL }
   */
  async resolveTempUrls(fileIds) { }
  ```

- 注释讲**为什么**，不复述代码（`// 保守取 5 分钟，既省请求又不会用到过期链接` 是好注释）。
- 复杂分支、魔数、平台限制必须留注释说明来源。
- 不写 `// TODO` 之外的占位注释；`// TODO` 要带上要做什么。

## 6. 异步与错误处理

- 统一 `async / await` + `try / catch / finally`，新代码不写 `success / fail` 嵌套回调：

  ```js
  async doLogin() {
    this.setData({ isVerifying: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'loginUser', data: { ... } })
      if (res.result.code !== 0) return this.showError(res.result.msg)
      // 成功逻辑
    } catch (err) {
      console.error('[auth] 登录异常', err)
      this.showError('登录失败，请稍后重试')
    } finally {
      this.setData({ isVerifying: false })
    }
  }
  ```

- `wx.showLoading` / `wx.hideLoading` 必须成对，收尾放在 `finally` 里。
- 技术错误用 `console.error('[模块名] 说明', err)`，前缀便于过滤；**面向用户的提示走 `wx.showToast({ icon: 'none' })`**，不把原始 err 抛给用户。
- `catch` 里不允许空着（至少要 `console.error`），除非注释写明「失败不影响主流程」。
- 互不依赖的请求用 `Promise.all` 并发，不要串行 `await`。

## 7. 微信 API 约定

- 云函数调用：`wx.cloud.callFunction({ name, data })`，`name` 用字符串字面量，`data` 字段与云函数解构保持一致。
- 环境 id 只出现在 `miniprogram/app.js` 的 `CLOUD_ENV`，其他文件不硬编码。
- 跳转用**绝对路径**：`/pages/auth/auth`；tabBar 页面只能 `wx.switchTab`。
- 本地存储的 key 定义成模块顶部常量（`const STORAGE_KEY = 'dsh_xxx_v1'`），不要散落字符串；结构变更时改版本号。
- `cloud://` 地址一律先经 `miniprogram/utils/cloudFile.js` 换成 https 临时链接，禁止直接绑到 `<image src>`。
- `setData` 只传变化的字段（用 `'a.b'` 路径写法），不要整对象回写；不要 `setData` 大数组的副本。

## 8. 云函数

固定骨架（`cloudfunctions/<name>/index.js`）：

```js
// cloudfunctions/getDevices/index.js
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/**
 * 按分组查询可用设备
 * @param {Object} event { groupName?: string }
 * @returns {Promise<{code:number,msg:string,data?:any}>}
 */
exports.main = async (event, context) => {
  try {
    // 业务
    return { code: 0, msg: 'ok', data: list }
  } catch (err) {
    console.error('[getDevices] 查询失败', err)
    return { code: -99, msg: '服务器异常' }
  }
}
```

- 首行注释写函数名，方便在开发者工具里认文件。
- 返回值统一 `{ code, msg, data }`：`0` 成功，`-1` 参数问题，`-2` 未登录/无权限，`-99` 服务器异常。
- 永远不要返回 `password`、`phone` 等敏感字段。
- 入参先解构再校验，不要直接用 `event.xxx.yyy` 链式取值。
- 一个目录一个函数；`package.json` 只声明真正用到的依赖。
- 部署只能在微信开发者工具里右键上传，仓库没有部署 CLI。

## 9. WXML / WXSS

- 样式一律复用 `miniprogram/app.wxss` 的 `--ds-*` 变量与 `ds-*` 类（`ds-card`、`ds-btn`、`ds-tag`、`ds-empty`、`ds-skeleton`、`ds-cell` …），**不新造色值、不引入 UI 库**；主色 `#62BCC4`。
- 尺寸用 `rpx`，按 750 宽设计稿；1px 边框可用 `1rpx` 或 `0.5px`。
- 类名 kebab-case（`device-card`、`usage-panel`），不写行内 `style`（动态计算的除外）。
- `wx:for` **必须**带 `wx:key`；列表项用 `data-*` 传参，不在 WXML 里拼字符串索引。
- WXML 里只做简单判断和拼接，复杂的放 JS 里算好再绑。
- 事件用 `bindtap`；只有确实要阻止冒泡才用 `catchtap`。
- 图片必须有 `mode`，云存储图片先走 `cloudFile.js`。
- 界面文案中文；状态类文案统一（如「加载中…」「暂无数据」）。

## 10. 自检

```bash
npm run lint        # 只检查
npm run lint:fix    # 自动修复排版类问题
```

- 提交前至少跑一次 `npm run lint`，**错误必须清零**，警告允许存在但不要新增。
- 自动修复覆盖不到的部分（命名、拆函数、注释）靠人眼和本文档。
- 测试是独立 node 脚本，必须在 `miniprogram/` 目录下跑：`cd miniprogram && node tests/xxx.test.js`。
- `tests/deleteMessageCore.test.js`、`tests/pageFiles.test.js` 两个长期失败，与业务改动无关，不要当回归。

## 11. 存量迁移

- **A 档（必须）**：新文件、新函数一律合规。
- **B 档（推荐）**：改到哪个文件，就把那个文件的方法简写化、`var` 清掉，提交时和功能改动分开（`chore: 规范化 xxx.js`）。
- **C 档（已完成）**：全仓跑过一次 `eslint --fix`，只做纯机械修复，逻辑零变化，改动前的状态打了 git tag `pre-code-style`。

## 附：文档没覆盖的情况

跟随同文件已有写法；如果同文件两种写法都有，选本文档的写法，并顺手把同文件统一掉。
