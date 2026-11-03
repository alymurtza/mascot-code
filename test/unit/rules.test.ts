import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeRule, matchRule, renameWith, typeOf } from '../../src/shared/rules'
import type { Rule } from '../../src/shared/settings'

const rule = (r: Partial<Rule>): Rule => ({ id: 'x', match: 'type', value: '', folder: '/f', ...r })

test('file types come from the extension, any case', () => {
  assert.equal(typeOf('movie.MKV'), 'Videos')
  assert.equal(typeOf('setup.exe'), 'Programs')
  assert.equal(typeOf('disk.iso'), 'Disk images')
  assert.equal(typeOf('notes'), undefined)
  assert.equal(typeOf('.hidden'), undefined)
})

test('a type rule matches files of that type', () => {
  const rules = [rule({ match: 'type', value: 'Videos', folder: '/v' })]
  assert.equal(matchRule(rules, 'clip.mp4', 'https://a.com/clip.mp4')?.folder, '/v')
  assert.equal(matchRule(rules, 'song.mp3', 'https://a.com/song.mp3'), undefined)
  // Two-word types too.
  assert.ok(matchRule([rule({ value: 'Disk images' })], 'win.iso', 'https://a.com/win.iso'))
})

test('an extension rule takes a list, with or without dots, any case', () => {
  const rules = [rule({ match: 'extension', value: '.ZIP, rar  7z' })]
  for (const name of ['a.zip', 'b.RAR', 'c.7z'])
    assert.ok(matchRule(rules, name, 'https://x.com/'), name)
  assert.equal(matchRule(rules, 'd.tar', 'https://x.com/'), undefined)
  // A name without an extension never matches an extension rule.
  assert.equal(matchRule(rules, 'zip', 'https://x.com/'), undefined)
})

test('a site rule matches the site and its subdomains, whatever was pasted', () => {
  const rules = [rule({ match: 'site', value: 'https://Example.com/downloads' })]
  assert.ok(matchRule(rules, 'a.bin', 'https://example.com/a.bin'))
  assert.ok(matchRule(rules, 'a.bin', 'https://cdn.example.com/a.bin'))
  assert.equal(matchRule(rules, 'a.bin', 'https://notexample.com/a.bin'), undefined)
  assert.equal(matchRule(rules, 'a.bin', 'https://example.com.evil.net/a.bin'), undefined)
  assert.equal(matchRule(rules, 'a.bin', 'not a link'), undefined)
})

test('the first matching rule wins; empty rules never match', () => {
  const rules = [
    rule({ id: '1', match: 'site', value: '' }),
    rule({ id: '2', match: 'extension', value: 'iso', folder: '/first' }),
    rule({ id: '3', match: 'type', value: 'Disk images', folder: '/second' })
  ]
  assert.equal(matchRule(rules, 'x.iso', 'https://a.com/x.iso')?.folder, '/first')
})

test('rename patterns fill in name, extension, date and site', () => {
  const now = new Date('2026-10-27T12:00:00Z')
  const url = 'https://cdn.example.com/files/report.pdf'
  assert.equal(renameWith('{name}-{date}.{ext}', 'report.pdf', url, now), 'report-2026-10-27.pdf')
  assert.equal(
    renameWith('{site} {name}.{ext}', 'report.pdf', url, now),
    'cdn.example.com report.pdf'
  )
  // No pattern, or one that comes out empty: the file's own name.
  assert.equal(renameWith(undefined, 'report.pdf', url, now), 'report.pdf')
  assert.equal(renameWith('   ', 'report.pdf', url, now), 'report.pdf')
  assert.equal(renameWith('{nothing}', 'report.pdf', url, now), '{nothing}')
})

test('a rename pattern on a file with no extension leaves no stray dot', () => {
  const now = new Date('2026-10-27T12:00:00Z')
  assert.equal(
    renameWith('{name}-{date}.{ext}', 'README', 'https://a.com/README', now),
    'README-2026-10-27'
  )
})

test('rules read as plain sentences', () => {
  assert.equal(describeRule(rule({ match: 'type', value: 'Videos' })), 'File is a video')
  assert.equal(describeRule(rule({ match: 'type', value: 'Archives' })), 'File is an archive')
  assert.equal(
    describeRule(rule({ match: 'extension', value: 'iso, .img' })),
    'File ends in .iso, .img'
  )
  assert.equal(
    describeRule(rule({ match: 'site', value: 'example.com' })),
    'Link is from example.com'
  )
})

test('torrents (magnet links and .torrent files) are of the Torrents type, whatever their name', () => {
  const rules = [rule({ match: 'type', value: 'Torrents', folder: '/t' })]
  assert.equal(matchRule(rules, 'Big Buck Bunny', 'magnet:?xt=urn:btih:abc')?.folder, '/t')
  assert.equal(
    matchRule(rules, 'movie.mkv', 'https://a.org/x.torrent', { torrent: true })?.folder,
    '/t'
  )
  assert.equal(matchRule(rules, 'movie.mkv', 'https://a.org/movie.mkv'), undefined)
  // A site rule for a magnet: the page it came from.
  const site = [rule({ match: 'site', value: 'example.org', folder: '/s' })]
  assert.equal(
    matchRule(site, 'x', 'magnet:?xt=urn:btih:abc', { page: 'https://www.example.org/list' })
      ?.folder,
    '/s'
  )
})

test('name rules: text the name contains, any case, or a pattern with * as a wildcard', () => {
  const contains = [rule({ match: 'name', value: 'S01E', folder: '/show' })]
  assert.equal(matchRule(contains, 'Show.s01e03.mkv', 'https://a.org/x')?.folder, '/show')
  assert.equal(matchRule(contains, 'Show.S02E03.mkv', 'https://a.org/x'), undefined)
  const pattern = [rule({ match: 'name', value: 'report-*.pdf', folder: '/r' })]
  assert.equal(matchRule(pattern, 'Report-2026.PDF', 'https://a.org/x')?.folder, '/r')
  assert.equal(matchRule(pattern, 'old-report-2026.pdf', 'https://a.org/x'), undefined)
  assert.equal(matchRule(pattern, 'report-2026.pdf.zip', 'https://a.org/x'), undefined)
  // Brackets and dots in the pattern are plain text.
  const odd = [rule({ match: 'name', value: '[1080p]*', folder: '/hd' })]
  assert.equal(matchRule(odd, '[1080p] film.mkv', 'https://a.org/x')?.folder, '/hd')
  assert.equal(describeRule(contains[0]), 'Name contains “S01E”')
  assert.equal(describeRule(pattern[0]), 'Name is like report-*.pdf')
})
