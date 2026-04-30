const assert = require('assert')
const { createDeleteMessageHandler } = require('../cloudfunctions/deleteMessage/deleteMessageCore')

function createFakeDb(message, removeResult) {
  const calls = []
  return {
    calls,
    collection(name) {
      calls.push(['collection', name])
      assert.strictEqual(name, 'messages')
      return {
        doc(id) {
          calls.push(['doc', id])
          return {
            async get() {
              calls.push(['get'])
              return { data: message }
            },
            async remove() {
              calls.push(['remove'])
              return removeResult || { stats: { removed: 1 } }
            }
          }
        }
      }
    }
  }
}

async function testDeletesOwnedMessage() {
  const db = createFakeDb({ _id: 'msg-1', user_id: 'student-1' })
  const handler = createDeleteMessageHandler({ db })

  const result = await handler({ messageId: 'msg-1', userId: 'student-1' })

  assert.deepStrictEqual(result, { success: true, removed: 1 })
  assert.deepStrictEqual(db.calls, [
    ['collection', 'messages'],
    ['doc', 'msg-1'],
    ['get'],
    ['remove']
  ])
}

async function testRejectsOtherUsersMessage() {
  const db = createFakeDb({ _id: 'msg-1', user_id: 'student-2' })
  const handler = createDeleteMessageHandler({ db })

  const result = await handler({ messageId: 'msg-1', userId: 'student-1' })

  assert.strictEqual(result.success, false)
  assert.strictEqual(result.code, 'NO_PERMISSION')
  assert.deepStrictEqual(db.calls, [
    ['collection', 'messages'],
    ['doc', 'msg-1'],
    ['get']
  ])
}

async function run() {
  await testDeletesOwnedMessage()
  await testRejectsOtherUsersMessage()
  console.log('deleteMessageCore tests passed')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
