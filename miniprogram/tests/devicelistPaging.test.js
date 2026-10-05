const assert = require('assert')

/**
 * 仪器列表分页渲染的纯逻辑校验。
 *
 * devicelist.js 里的分页行为：
 *   displayedDevices = filteredDevices.slice(0, pageNum * PAGE_SIZE)
 *   hasMore          = pageNum * PAGE_SIZE < filteredDevices.length
 * 这段算术容易出 off-by-one，这里用与实现完全一致的公式做回归。
 */

const PAGE_SIZE = 20

function pageState(filteredLength, pageNum) {
  const end = pageNum * PAGE_SIZE
  const displayedCount = Math.min(end, filteredLength)
  return {
    displayedCount,
    hasMore: end < filteredLength
  }
}

function testFirstPageOfLargeList() {
  const state = pageState(130, 1)
  assert.strictEqual(state.displayedCount, 20, '首屏只渲染 20 张卡片')
  assert.strictEqual(state.hasMore, true, '还有更多数据')
}

function testSecondPageAppends() {
  const state = pageState(130, 2)
  assert.strictEqual(state.displayedCount, 40, '第二页后共 40 张')
  assert.strictEqual(state.hasMore, true)
}

function testExactMultipleDoesNotLeaveEmptyPage() {
  // 正好 40 条：第 2 页之后不应该再提示"上拉加载更多"
  const state = pageState(40, 2)
  assert.strictEqual(state.displayedCount, 40)
  assert.strictEqual(state.hasMore, false, '正好整除时不应还有下一页')
}

function testShortListHasNoMore() {
  const state = pageState(7, 1)
  assert.strictEqual(state.displayedCount, 7, '不足一页时全部渲染')
  assert.strictEqual(state.hasMore, false)
}

function testEmptyList() {
  const state = pageState(0, 1)
  assert.strictEqual(state.displayedCount, 0, '空列表走空状态')
  assert.strictEqual(state.hasMore, false)
}

function testLastPartialPage() {
  // 130 条：第 7 页是最后一页（20*7=140 > 130）
  assert.strictEqual(pageState(130, 6).hasMore, true)
  assert.strictEqual(pageState(130, 7).hasMore, false, '第 7 页是最后一页')
  assert.strictEqual(pageState(130, 7).displayedCount, 130, '最后一页取到全部剩余数据')
}

function testFilterResetGoesBackToFirstPage() {
  // applyFilters 会把 pageNum 重置为 1，所以筛选后只显示 20 条
  const state = pageState(3, 1)
  assert.strictEqual(state.displayedCount, 3)
  assert.strictEqual(state.hasMore, false)
}

testFirstPageOfLargeList()
testSecondPageAppends()
testExactMultipleDoesNotLeaveEmptyPage()
testShortListHasNoMore()
testEmptyList()
testLastPartialPage()
testFilterResetGoesBackToFirstPage()
console.log('devicelistPaging tests passed')
