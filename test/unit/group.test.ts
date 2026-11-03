import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Download } from '../../src/shared/download'
import { commonName, groupNameFor, groupSection, groupsOf } from '../../src/shared/group'

test('a group is named after what its files start with, else their site, else a count', () => {
  assert.equal(
    groupNameFor(['https://a.com/show/episode-01.mkv', 'https://a.com/show/episode-02.mkv']),
    'episode'
  )
  assert.equal(
    groupNameFor(['https://a.com/Show.S01E01.mkv', 'https://b.org/Show.S01E02.mkv']),
    'Show.S01'
  )
  assert.equal(groupNameFor(['https://www.a.com/x.zip', 'https://a.com/readme.txt']), 'a.com')
  assert.equal(groupNameFor(['https://a.com/x.zip', 'magnet:?xt=urn:btih:abc']), '2 downloads')
})

const dl = (id: string, status: Download['status'], group?: string): Download =>
  ({
    id,
    status,
    createdAt: Number(id),
    group: group ? { id: group, name: group } : undefined
  }) as Download

test('a group shows in Downloading while any of it runs, then attention, queue, schedule, done', () => {
  assert.equal(groupSection([dl('1', 'done'), dl('2', 'running'), dl('3', 'failed')]), 'running')
  assert.equal(groupSection([dl('1', 'done'), dl('2', 'paused')]), 'running')
  assert.equal(groupSection([dl('1', 'done'), dl('2', 'failed'), dl('3', 'queued')]), 'attention')
  assert.equal(groupSection([dl('1', 'queued'), dl('2', 'scheduled')]), 'queued')
  assert.equal(groupSection([dl('1', 'done'), dl('2', 'done')]), 'done')
})

test('groups keep their downloads in the order they were added', () => {
  const groups = groupsOf([
    dl('3', 'queued', 'g'),
    dl('1', 'done', 'g'),
    dl('2', 'done', 'h'),
    dl('4', 'done')
  ])
  assert.deepEqual([...groups.keys()], ['g', 'h'])
  assert.deepEqual(
    groups.get('g')!.map((d) => d.id),
    ['1', '3']
  )
})

test('downloads already in the list are named from their file names', () => {
  assert.equal(commonName(['brand-logo.ai', 'brand-fonts.zip']), 'brand')
  assert.equal(commonName(['a.zip', 'b.zip']), '')
})
