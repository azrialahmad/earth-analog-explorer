import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replaceOnce } from './replace-once.mjs'

test('replaceOnce supports string and regex anchors and rejects missing or duplicate matches', () => {
  assert.equal(replaceOnce('before middle after', /middle/, 'center', 'middle anchor'), 'before center after')
  assert.equal(replaceOnce('one two', 'one', 'ONE', 'one anchor'), 'ONE two')
  assert.throws(() => replaceOnce('nothing', /middle/, 'center', 'middle anchor'), /expected one middle anchor, found 0/)
  assert.throws(() => replaceOnce('middle middle', /middle/, 'center', 'middle anchor'), /expected one middle anchor, found 2/)
})
