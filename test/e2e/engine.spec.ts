import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomFile, sha256, startServer, type TestServer } from '../support/server'
import { launch, type Launched } from './app'

let server: TestServer
let run: Launched
test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
  await server.close()
})
test.afterEach(async () => {
  await run?.close()
})

test('a download finishes over both networks, byte for byte, with its checksum checked', async () => {
  const body = randomFile(8 * 1024 * 1024)
  server.files.set('/one.bin', { body, rate: 4_000_000 })
  run = await launch()
  const d = await run.call('add', {
    url: server.url('/one.bin'),
    checksum: { algorithm: 'sha256', expected: sha256(body) }
  })
  const [done] = await run.until((l) => l[0]?.status === 'done')
  expect(done.checksum?.result).toBe('match')
  expect(sha256(readFileSync(join(run.downloads, 'one.bin')))).toBe(sha256(body))
  expect(existsSync(join(run.downloads, 'one.bin.mascot-part'))).toBe(false)
  const from = new Set(
    server.hits.filter((h) => h.path === '/one.bin' && h.range !== 'bytes=0-0').map((h) => h.from)
  )
  expect([...from].sort()).toEqual(['127.0.0.2', '127.0.0.3'])
  expect(d.name).toBe('one.bin')
})

test('pause keeps what it has; resume carries on from there', async () => {
  const body = randomFile(6 * 1024 * 1024)
  server.files.set('/pause.bin', { body, rate: 300_000 })
  run = await launch()
  const d = await run.call('add', { url: server.url('/pause.bin') })
  await run.until((l) => l[0].received > 1024 * 1024)
  await run.call('act', [d.id], 'pause')
  const [paused] = await run.until((l) => l[0].status === 'paused')
  const had = paused.received
  server.files.get('/pause.bin')!.rate = 0
  const before = server.hits.length
  await run.call('act', [d.id], 'resume')
  await run.until((l) => l[0].status === 'done')
  const fetched = server.hits
    .slice(before)
    .filter(
      (h) => h.path === '/pause.bin' && h.range?.startsWith('bytes=0-') && h.range !== 'bytes=0-0'
    )
  expect(fetched, 'the start was not fetched again').toHaveLength(0)
  expect(had).toBeGreaterThan(1024 * 1024)
  expect(sha256(readFileSync(join(run.downloads, 'pause.bin')))).toBe(sha256(body))
})

test('quitting and starting again resumes the download', async () => {
  const body = randomFile(6 * 1024 * 1024)
  server.files.set('/quit.bin', { body, rate: 300_000 })
  run = await launch()
  await run.call('add', { url: server.url('/quit.bin') })
  await run.until((l) => l[0].received > 1024 * 1024)
  const userData = run.userData
  await run.app.close()
  server.files.get('/quit.bin')!.rate = 0
  run = await launch({ userData })
  const [done] = await run.until((l) => l[0].status === 'done')
  expect(sha256(readFileSync(done.path))).toBe(sha256(body))
})

test('the queue runs as many at once as set, in order', async () => {
  for (const n of [1, 2, 3])
    server.files.set(`/q${n}.bin`, { body: randomFile(1024 * 1024), rate: 500_000 })
  run = await launch()
  await run.call('updateSettings', { runAtOnce: 1 })
  for (const n of [1, 2, 3]) await run.call('add', { url: server.url(`/q${n}.bin`), when: 'queue' })
  const list = await run.until((l) => l.some((d) => d.status === 'running'))
  expect(list.filter((d) => d.status === 'running').map((d) => d.name)).toEqual(['q1.bin'])
  await run.until((l) => l.every((d) => d.status === 'done'), 40_000)
})

test('a link already downloading, the same file from another link, and a maybe', async () => {
  const body = randomFile(24 * 1024 * 1024)
  server.files.set('/dup.bin', { body, rate: 100_000, etag: '"v1"' })
  server.files.set('/mirror/dup.bin', { body, rate: 100_000, etag: '"v1"' })
  server.files.set('/other/dup.bin', { body, rate: 200_000 })
  run = await launch()
  const d = await run.call('add', { url: server.url('/dup.bin') })
  const same = await run.call('findDuplicate', server.url('/dup.bin'))
  expect(same).toMatchObject({ kind: 'same-link', id: d.id })
  const info = await run.call('checkLink', server.url('/mirror/dup.bin'))
  expect(await run.call('findDuplicate', info.url, info)).toMatchObject({
    kind: 'same-file',
    id: d.id
  })
  const maybe = await run.call('checkLink', server.url('/other/dup.bin'))
  expect(await run.call('findDuplicate', maybe.url, maybe)).toMatchObject({
    kind: 'maybe',
    id: d.id
  })
  // Joining as a backup link: both links get used.
  await run.call('addMirror', d.id, info.url)
  await run.until(() =>
    server.hits.some((h) => h.path === '/mirror/dup.bin' && h.range && h.range !== 'bytes=0-0')
  )
  for (const f of server.files.values()) f.rate = 0
  await run.until((l) => l[0].status === 'done')
  expect(await run.call('findDuplicate', server.url('/dup.bin'))).toMatchObject({
    kind: 'finished'
  })
})

test('a backup link with a different version is refused', async () => {
  server.files.set('/ver.bin', {
    body: randomFile(1024 * 1024),
    rate: 100_000,
    etag: '"a"',
    lastModified: 'Mon, 01 Jan 2029 00:00:00 GMT'
  })
  server.files.set('/ver2.bin', {
    body: randomFile(1024 * 1024),
    etag: '"b"',
    lastModified: 'Tue, 02 Jan 2029 00:00:00 GMT'
  })
  run = await launch()
  const d = await run.call('add', { url: server.url('/ver.bin') })
  await expect(run.call('addMirror', d.id, server.url('/ver2.bin'))).rejects.toThrow(
    /different version/
  )
  const [after] = await run.list()
  expect(after.sources.find((s) => s.url.endsWith('/ver2.bin'))?.dropped).toMatch(
    /different version/
  )
})

test('a network unplugged mid-download: the other carries on; back again, it rejoins', async () => {
  const body = randomFile(8 * 1024 * 1024)
  server.files.set('/plug.bin', { body, rate: 400_000 })
  run = await launch()
  await run.call('add', { url: server.url('/plug.bin') })
  await run.until((l) => l[0].received > 512 * 1024)
  await run.call('testSetAdapters', 'Ethernet=127.0.0.2:ethernet')
  const mark = server.hits.length
  await new Promise((r) => setTimeout(r, 1500))
  const during = new Set(
    server.hits
      .slice(mark)
      .filter((h) => h.path === '/plug.bin')
      .map((h) => h.from)
  )
  expect([...during]).toEqual(['127.0.0.2'])
  await run.call('testSetAdapters', 'Ethernet=127.0.0.2:ethernet,Wi-Fi=127.0.0.3:wifi')
  const back = server.hits.length
  await run.until(() => server.hits.slice(back).some((h) => h.from === '127.0.0.3'))
  server.files.get('/plug.bin')!.rate = 0
  const [done] = await run.until((l) => l[0].status === 'done')
  expect(sha256(readFileSync(done.path))).toBe(sha256(body))
})

test('a network switched off is not used; a backup covers when no Always network is left', async () => {
  server.files.set('/roles.bin', { body: randomFile(8 * 1024 * 1024), rate: 300_000 })
  run = await launch()
  await run.call('updateNetwork', 'Wi-Fi', { role: 'backup' })
  await expect(run.call('updateNetwork', 'Ethernet', { role: 'backup' })).rejects.toThrow(
    /at least one network on Always/
  )
  await run.call('add', { url: server.url('/roles.bin') })
  await run.until((l) => l[0].received > 256 * 1024)
  const mark = server.hits.length
  await new Promise((r) => setTimeout(r, 1000))
  expect(new Set(server.hits.slice(mark).map((h) => h.from))).toEqual(new Set(['127.0.0.2']))
  await run.call('updateNetwork', 'Ethernet', { off: true })
  const networks = (await run.call('initial')).networks
  expect(networks.find((n) => n.id === 'Wi-Fi')?.status).toBe('covering')
  const covered = server.hits.length
  await run.until(() => server.hits.slice(covered).some((h) => h.from === '127.0.0.3'))
})

test('a failed download is marked and shown on the tray; finished ones are announced', async () => {
  server.files.set('/fails.bin', { body: randomFile(1024 * 1024), rate: 100_000 })
  run = await launch({ env: { MASCOT_TEST_GIVE_UP_MS: '1500' } })
  const d = await run.call('add', { url: server.url('/fails.bin') })
  await run.until((l) => l[0].status === 'running')
  await expect.poll(async () => (await run.call('testTray')).badge).toBe('downloading')
  server.files.delete('/fails.bin')
  await run.call('act', [d.id], 'pause')
  await run.call('act', [d.id], 'resume')
  const [failed] = await run.until((l) => l[0].status === 'failed')
  expect(failed.message).toMatch(/404|isn’t on the server/)
  await expect.poll(async () => (await run.call('testTray')).failed).toBe(true)
  await expect.poll(async () => (await run.call('testTray')).badge).toBe('failed')
})

test('closing the window keeps the app running in the tray', async () => {
  run = await launch()
  await run.call('testCloseWindow')
  await expect.poll(() => run.call('testWindowVisible')).toBe(false)
  expect(await run.call('ping')).toBe('pong')
  await run.call('updateSettings', { closeAction: 'quit' })
  const closed = run.app.waitForEvent('close')
  await run.call('testCloseWindow').catch(() => {})
  await closed
})

test('lowering run at once sends the ones furthest back to wait, keeping what they have', async () => {
  for (const n of [1, 2, 3])
    server.files.set(`/rao/r${n}.bin`, { body: randomFile(4 * 1024 * 1024), rate: 30_000 })
  run = await launch()
  await run.call('updateSettings', { runAtOnce: 3 })
  for (const n of [1, 2, 3])
    await run.call('add', { url: server.url(`/rao/r${n}.bin`), when: 'queue' })
  await run.until((l) => l.filter((d) => d.status === 'running' && d.received > 0).length === 3)
  await run.call('updateSettings', { runAtOnce: 1 })
  const list = await run.until(
    (l) =>
      l.filter((d) => d.status === 'running').length === 1 &&
      l.filter((d) => d.status === 'queued').length === 2
  )
  expect(list.find((d) => d.status === 'running')!.name).toBe('r1.bin')
  for (const d of list.filter((d) => d.status === 'queued')) expect(d.received).toBeGreaterThan(0)
  // Raising it again starts them, carrying on from what they had.
  await run.call('updateSettings', { runAtOnce: 3 })
  await run.until((l) => l.filter((d) => d.status === 'running').length === 3)
})

test('a checksum added during the download, or after it finished, is checked', async () => {
  const body = randomFile(2 * 1024 * 1024)
  server.files.set('/sum/late.bin', { body, rate: 400_000 })
  run = await launch()
  const d = await run.call('add', { url: server.url('/sum/late.bin') })
  await run.until((l) => l[0].status === 'running')
  await run.call('setChecksum', d.id, sha256(body).toUpperCase())
  let [done] = await run.until((l) => l[0].status === 'done')
  expect(done.checksum).toMatchObject({ algorithm: 'sha256', result: 'match' })
  // After it finished: a wrong one doesn't match; the right one does; it can be removed.
  await run.call('setChecksum', d.id, 'a'.repeat(40))
  ;[done] = await run.until((l) => l[0].checksum?.result === 'mismatch')
  expect(done.checksum!.algorithm).toBe('sha1')
  await run.call('setChecksum', d.id, sha256(body))
  await run.until((l) => l[0].checksum?.result === 'match')
  await run.call('setChecksum', d.id, '')
  await run.until((l) => l[0].checksum === undefined)
  await expect(run.call('setChecksum', d.id, 'not a checksum')).rejects.toThrow(/doesn’t look like/)
})

test('busy changes (run at once, Download first) never start a download twice; finished ones stay finished', async () => {
  test.setTimeout(120_000)
  const bodies = Array.from({ length: 8 }, (_, i) => randomFile((1 + (i % 3)) * 1024 * 1024))
  bodies.forEach((b, i) => server.files.set(`/fin/f${i}.bin`, { body: b, rate: 250_000 }))
  run = await launch()
  await run.call('updateSettings', { runAtOnce: 3 })
  const ids: string[] = []
  for (let i = 0; i < 8; i++) {
    const d = await run.call('add', {
      url: server.url(`/fin/f${i}.bin`),
      when: 'queue',
      ...(i % 2 ? { checksum: { algorithm: 'sha256', expected: sha256(bodies[i]) } } : {})
    })
    ids.push(d.id)
  }
  const log: string[] = []
  const seen = new Map<string, string>()
  const watch = setInterval(async () => {
    const l = await run.list().catch(() => [])
    for (const d of l) {
      if (seen.get(d.id) !== d.status)
        log.push(`${d.name}: ${seen.get(d.id) ?? '-'} -> ${d.status} ${d.message ?? ''}`)
      seen.set(d.id, d.status)
    }
  }, 50)
  for (let k = 0; k < 6; k++) {
    await new Promise((r) => setTimeout(r, 1500))
    await run.call('updateSettings', { runAtOnce: k % 2 ? 3 : 1 })
    const l = await run.list()
    const q = l.find((d) => d.status === 'queued')
    if (q) await run.call('act', [q.id], 'first')
  }
  await run.call('updateSettings', { runAtOnce: 3 })
  await run.until((l) => l.every((d) => d.status === 'done' || d.status === 'failed'), 90_000)
  await new Promise((r) => setTimeout(r, 4000))
  clearInterval(watch)
  const l = await run.list()
  expect(l.map((d) => d.status)).toEqual(Array(8).fill('done'))
  expect(log.filter((line) => /-> failed|ENOENT/.test(line))).toEqual([])
  for (const d of l) {
    expect(d.message).toBeUndefined()
    expect(d.name).not.toMatch(/\(\d+\)/)
    if (d.checksum) expect(d.checksum.result).toBe('match')
  }
})

test('closed just as a download finished: on the next start it is done, not downloaded again', async () => {
  const body = randomFile(1024 * 1024)
  server.files.set('/quitfin/done.bin', { body })
  run = await launch()
  await run.call('add', {
    url: server.url('/quitfin/done.bin'),
    checksum: { algorithm: 'sha256', expected: sha256(body) }
  })
  const [d] = await run.until((l) => l[0].status === 'done')
  const userData = run.userData
  await run.app.close()
  // As if the app closed after the file was moved into place but before it was marked done.
  const file = join(userData, 'downloads.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  saved[0].d.status = 'verifying'
  saved[0].d.checksum.result = undefined
  writeFileSync(file, JSON.stringify(saved))
  const hits = server.hits.length
  run = await launch({ userData })
  const [again] = await run.until(
    (l) => l[0].status === 'done' && l[0].checksum?.result === 'match'
  )
  expect(again.path).toBe(d.path)
  expect(server.hits.length).toBe(hits)
  expect(readdirSync(join(userData, 'Downloads'))).toEqual(['done.bin'])
})

test('a link whose file is already in the folder (but not in the list) is flagged first', async () => {
  server.files.set('/ondisk/here.bin', { body: randomFile(256 * 1024) })
  run = await launch()
  const url = server.url('/ondisk/here.bin')
  const d = await run.call('add', { url })
  await run.until((l) => l[0].status === 'done')
  await run.call('act', [d.id], 'remove')
  await run.until((l) => l.length === 0)
  const match = await run.call('findDuplicate', url, await run.call('checkLink', url))
  expect(match).toMatchObject({ kind: 'on-disk', name: 'here.bin', path: d.path })
})
