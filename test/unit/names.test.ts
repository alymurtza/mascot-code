import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { safeName, uniquePath } from '../../src/main/engine/names'

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

test('a second copy gets its number before the whole extension, even a two-part one', () => {
  const folder = mkdtempSync(join(tmpdir(), 'mascot-names-'))
  try {
    for (const name of ['linux-6.18.tar.xz', 'photo.jpg', 'notes', 'backup.tar.gz', '.env'])
      writeFileSync(join(folder, name), '')
    assert.equal(uniquePath(folder, 'linux-6.18.tar.xz'), join(folder, 'linux-6.18 (2).tar.xz'))
    assert.equal(uniquePath(folder, 'backup.tar.gz'), join(folder, 'backup (2).tar.gz'))
    assert.equal(uniquePath(folder, 'photo.jpg'), join(folder, 'photo (2).jpg'))
    assert.equal(uniquePath(folder, 'notes'), join(folder, 'notes (2)'))
    assert.equal(uniquePath(folder, '.env'), join(folder, '.env (2)'))
    assert.equal(uniquePath(folder, 'new.tar.xz'), join(folder, 'new.tar.xz'))
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
