// eslint.config.js —— 规范见 docs/code-style.md
// 只开三类规则：① 能自动修的排版；② 明确禁止的写法；③ 明显的错。
// 故意不做严格类型/复杂度检查，避免在小程序项目里刷出一屏红字。
const js = require('@eslint/js')
const stylistic = require('@stylistic/eslint-plugin')

// 微信小程序 + 云函数运行时提供的全局变量
const globals = {
  wx: 'readonly',
  App: 'readonly',
  Page: 'readonly',
  Component: 'readonly',
  Behavior: 'readonly',
  getApp: 'readonly',
  getCurrentPages: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly'
}

module.exports = [
  {
    // 第三方副本与依赖不进 lint
    ignores: [
      'node_modules/**',
      'miniprogram/node_modules/**',
      'miniprogram/miniprogram_npm/**',
      'cloudfunctions/*/node_modules/**',
      // 云函数里打包进来的 npm 依赖副本
      '**/miniprogram_npm/**',
      // 本地截图/预览工具脚本
      'preview/**',
      '**/*.min.js'
    ]
  },
  js.configs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: false,
    commaDangle: 'never',
    braceStyle: '1tbs',
    arrowParens: false,
    quoteProps: 'as-needed'
  }),
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals
    },
    rules: {
      // —— 规范重点：方法一律简写 ——
      'object-shorthand': ['error', 'methods'],
      'no-var': 'error',
      'prefer-const': 'error',

      // —— 存量代码太杂，非自动修复类先降为警告 ——
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      eqeqeq: ['warn', 'smart'],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],

      // preset 自带、但纯属主观的规则，不纳入本仓规范
      '@stylistic/max-statements-per-line': 'off'
    }
  }
]
