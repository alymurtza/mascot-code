import assert from 'node:assert/strict'
import { test } from 'node:test'
import { safeName } from '../../src/main/engine/names'

test('a very long name is cut to 200 bytes, keeping its extension and whole characters', () => {
  const long = 'a'.repeat(400) + '.mkv'
  const cut = safeName(long)
  assert.ok(Buffer.byteLength(cut) <= 200)
  assert.ok(cut.endsWith('.mkv'))
  // An emoji takes 4 bytes and two code units; none is cut in half.
  const emoji = 'x' + '😀'.repeat(100) + '.zip'
  const cutEmoji = safeName(emoji)
  assert.ok(Buffer.byteLength(cutEmoji) <= 200)
  assert.ok(cutEmoji.endsWith('.zip'))
  assert.doesNotMatch(
    cutEmoji,
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  )
  assert.equal(Buffer.from(cutEmoji).toString(), cutEmoji)
})
