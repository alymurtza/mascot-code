import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { Source } from '../../src/shared/download'
import type { Adapter } from '../../src/shared/network'
import { checkLink } from '../../src/main/engine/probe'
import { PacketTable } from '../../src/main/engine/packets'
import { Limiter } from '../../src/main/engine/throttle'
import { WebTransfer, type TransferHost } from '../../src/main/engine/webTransfer'
import { randomFile, sha256, startServer, type FileSpec, type TestServer } from '../support/server'

process.env['MASCOT_TEST_ADAPTERS'] = ''
const A: Adapter = { id: 'A', name: 'A', kind: 'ethernet', ipv4: '127.0.0.2' }
const B: Adapter = { id: 'B', name: 'B', kind: 'wifi', ipv4: '127.0.0.3' }

let dir: string
let server: TestServer
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mascot-transfer-'))
  server = await startServer()
})
after(async () => {
  await server.close()
  rmSync(dir, { recursive: true, force: true })
})

function host(
  networks: () => Adapter[],
  extra: Partial<TransferHost> = {}
): TransferHost & { bytes: Record<string, number> } {
  const bytes: Record<string, number> = {}
  return {
    bytes,
    networks,
    limiters: () => [],
    received: (id, n) => (bytes[id] = (bytes[id] ?? 0) + n),
    networkHealth: () => {},
    sourceDropped: () => {},
    ...extra
  }
}

let n = 0
async function fetchFile(
  path: string,
  options: {
    networks?: Adapter[]
    sources?: Source[]
    filled?: number[]
    perNetwork?: 'auto' | number
    host?: TransferHost
    partPath?: string
    faults?: () => void
  } = {}
): Promise<{ data: Buffer; transfer: WebTransfer; host: ReturnType<typeof host>; result: string }> {
  const info = await checkLink(A, server.url(path))
  options.faults?.()
  const partPath = options.partPath ?? join(dir, `f${++n}`)
  const h = host(() => options.networks ?? [A, B])
  const transfer = new WebTransfer(
    {
      partPath,
      size: info.size,
      ranged: info.ranged,
      packetSize: info.size ? PacketTable.packetSizeFor(info.size) : 0,
      filled: options.filled,
      sources: options.sources ?? [{ url: server.url(path) }],
      headers: {},
      perNetwork: options.perNetwork ?? 'auto'
    },
    options.host ?? h
  )
  const result = await transfer.run()
  return { data: readFileSync(partPath), transfer, host: h, result }
}

test('a link is checked: size, name, ranges, validators, redirects', async () => {
  const body = randomFile(1000)
  server.files.set('/a/file.bin', {
    body,
    etag: '"abc"',
    lastModified: 'Tue, 01 Jan 2030 00:00:00 GMT'
  })
  server.files.set('/go', { body, redirectTo: server.url('/a/file.bin') })
  server.files.set('/named', {
    body,
    ranges: false,
    disposition: 'attachment; filename="Report 2030.pdf"'
  })
  const info = await checkLink(A, server.url('/go'))
  assert.equal(info.size, 1000)
  assert.equal(info.ranged, true)
  assert.equal(info.name, 'file.bin')
  assert.equal(info.etag, '"abc"')
  assert.equal(info.finalUrl, server.url('/a/file.bin'))
  const named = await checkLink(A, server.url('/named'))
  assert.equal(named.name, 'Report 2030.pdf')
  assert.equal(named.ranged, false)
  assert.equal(named.size, 1000)
})

test('a file comes down over both networks in packets, byte for byte', async () => {
  const body = randomFile(12 * 1024 * 1024 + 777)
  server.files.set('/big', { body, rate: 3_000_000 })
  const { data, host: h, result } = await fetchFile('/big')
  assert.equal(result, 'done')
  assert.equal(sha256(data), sha256(body))
  assert.ok(h.bytes['A'] > 0 && h.bytes['B'] > 0, `both networks used: ${JSON.stringify(h.bytes)}`)
  const from = new Set(server.hits.filter((x) => x.path === '/big').map((x) => x.from))
  assert.deepEqual([...from].sort(), ['127.0.0.2', '127.0.0.3'])
})

test('cut connections and server errors are recovered from', async () => {
  const body = randomFile(6 * 1024 * 1024)
  const spec: FileSpec = { body }
  server.files.set('/flaky', spec)
  const { data } = await fetchFile('/flaky', {
    perNetwork: 4,
    faults: () => {
      spec.cutAfter = { bytes: 100_000, times: 6 }
      spec.failWith = { status: 500, times: 4 }
    }
  })
  assert.equal(sha256(data), sha256(body))
})

test('a backup link with a different file is dropped and the download carries on', async () => {
  const body = randomFile(4 * 1024 * 1024)
  server.files.set('/main', { body, rate: 4_000_000 })
  server.files.set('/other', { body: randomFile(3 * 1024 * 1024) })
  server.files.set('/mirror', { body, rate: 4_000_000 })
  const sources: Source[] = [
    { url: server.url('/main') },
    { url: server.url('/other') },
    { url: server.url('/mirror') }
  ]
  const { data } = await fetchFile('/main', { sources })
  assert.equal(sha256(data), sha256(body))
  assert.match(sources[1].dropped ?? '', /different file/)
  assert.equal(sources[0].dropped, undefined)
  assert.ok(
    server.hits.some((x) => x.path === '/mirror' && x.range),
    'the good backup link was used'
  )
})

test('a server without ranges is fetched in one go', async () => {
  const body = randomFile(2 * 1024 * 1024)
  const spec: FileSpec = { body, ranges: false }
  server.files.set('/plain', spec)
  const { data, transfer } = await fetchFile('/plain', {
    faults: () => (spec.cutAfter = { bytes: 50_000, times: 1 })
  })
  assert.equal(transfer.table, null)
  assert.equal(sha256(data), sha256(body))
})

test('a download resumes from what is on disk', async () => {
  const body = randomFile(3 * 1024 * 1024)
  server.files.set('/resume', { body })
  const size = PacketTable.packetSizeFor(body.length)
  const table = new PacketTable(body.length, size)
  const partPath = join(dir, 'resume.part')
  // First packet whole, second half there, rest missing.
  const disk = Buffer.alloc(body.length)
  body.copy(disk, 0, 0, size + 1000)
  writeFileSync(partPath, disk)
  const filled = Array.from(table.filled)
  filled[0] = size
  filled[1] = 1000
  const before = server.hits.length
  const { data } = await fetchFile('/resume', { filled, partPath, networks: [A] })
  assert.equal(sha256(data), sha256(body))
  const ranges = server.hits
    .slice(before)
    .map((x) => x.range)
    .filter(Boolean)
  assert.ok(
    ranges.includes(`bytes=${size + 1000}-${2 * size - 1}`),
    `resumed mid-packet: ${ranges.join(' ')}`
  )
  assert.ok(
    !ranges.some((r) => r!.startsWith('bytes=0-') && r !== 'bytes=0-0'),
    'first packet not fetched again'
  )
})

test('a busy server slows the network down instead of failing', async () => {
  const body = randomFile(2 * 1024 * 1024)
  const spec: FileSpec = { body }
  server.files.set('/busy', spec)
  const { data } = await fetchFile('/busy', {
    networks: [A],
    faults: () => (spec.failWith = { status: 429, times: 3, retryAfter: '0' })
  })
  assert.equal(sha256(data), sha256(body))
})

test('a link that is gone fails with a clear reason', async () => {
  const body = randomFile(1024 * 1024)
  server.files.set('/gone', { body })
  const info = await checkLink(A, server.url('/gone'))
  server.files.delete('/gone')
  const transfer = new WebTransfer(
    {
      partPath: join(dir, 'gone'),
      size: info.size,
      ranged: true,
      packetSize: PacketTable.packetSizeFor(info.size!),
      sources: [{ url: server.url('/gone') }],
      headers: {},
      perNetwork: 2
    },
    host(() => [A])
  )
  await assert.rejects(transfer.run(), /isn’t on the server any more/)
})

test('a speed limit holds the download to its rate', async () => {
  const body = randomFile(1024 * 1024)
  server.files.set('/limited', { body })
  const limiter = new Limiter(1024 * 1024)
  const started = Date.now()
  const { data } = await fetchFile('/limited', {
    networks: [A],
    host: host(() => [A], { limiters: () => [limiter] })
  })
  const seconds = (Date.now() - started) / 1000
  assert.equal(sha256(data), sha256(body))
  assert.ok(seconds > 0.6, `took ${seconds}s at 1 MB/s`)
})

test('a download into a folder that does not exist yet creates it', async () => {
  const body = randomFile(300_000)
  server.files.set('/newfolder', { body })
  const { data } = await fetchFile('/newfolder', {
    partPath: join(dir, 'made', 'here', 'file.part')
  })
  assert.equal(sha256(data), sha256(body))
})
