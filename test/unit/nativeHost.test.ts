import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const HOST = join(__dirname, '../../native/host.cjs')
const dir = mkdtempSync(join(tmpdir(), 'mascot-native-'))
after(() => rmSync(dir, { recursive: true, force: true }))

// A stand-in for Mascot: answers on the bridge's first port, writes what it was sent.
const fake = join(dir, 'fake-app.cjs')
const received = join(dir, 'received.json')
writeFileSync(
  fake,
  `const http = require('node:http'); const fs = require('node:fs')
  const got = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url === '/hello') return res.end(JSON.stringify({ app: 'mascot-downloader', version: '9.9.9', minBytes: 1024 }))
      if (req.url === '/download' || req.url === '/show') {
        got.push({ path: req.url, body: JSON.parse(body || '{}') })
        fs.writeFileSync(${JSON.stringify(received)}, JSON.stringify(got))
        return res.end('{"ok":true}')
      }
      if (req.url === '/quit') { res.end('{}'); return process.exit(0) }
      res.statusCode = 404; res.end('{}')
    })
  })
  server.listen(19400, '127.0.0.1')
  setTimeout(() => process.exit(0), 20000)`
)
const config = join(dir, 'config.json')
writeFileSync(config, JSON.stringify({ launch: { command: process.execPath, args: [fake] } }))

/** One message through the host, as a browser sends it. */
function ask(message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST, config, 'chrome-extension://abc/'])
    const chunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.on('error', reject)
    child.on('exit', () => {
      const out = Buffer.concat(chunks)
      if (out.length < 4) return reject(new Error('No reply'))
      resolve(JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString('utf8')))
    })
    const body = Buffer.from(JSON.stringify(message))
    const head = Buffer.alloc(4)
    head.writeUInt32LE(body.length, 0)
    child.stdin.write(Buffer.concat([head, body]))
  })
}

test('the native host: says when Mascot is closed, starts it, and hands downloads over', async (t) => {
  t.after(async () => {
    await fetch('http://127.0.0.1:19400/quit').catch(() => {})
  })
  assert.deepEqual(await ask({ type: 'hello' }), { running: false })
  // A download while it's closed isn't lost silently: the reply says so.
  assert.deepEqual(await ask({ type: 'download', download: { url: 'https://a.example/x.zip' } }), {
    ok: false,
    running: false
  })
  // Open: Mascot starts, and the reply comes once it answers.
  assert.deepEqual(await ask({ type: 'open' }), {
    running: true,
    version: '9.9.9',
    minBytes: 1024
  })
  assert.deepEqual(await ask({ type: 'hello' }), {
    running: true,
    version: '9.9.9',
    minBytes: 1024
  })
  const download = { url: 'https://a.example/big.iso', filename: 'big.iso', size: 5_000_000 }
  assert.deepEqual(await ask({ type: 'download', download }), { ok: true, running: true })
  // Open with Mascot already running: it's brought forward on the page asked for.
  assert.equal((await ask({ type: 'open', page: 'settings' })).running, true)
  assert.ok(existsSync(received))
  assert.deepEqual(JSON.parse(readFileSync(received, 'utf8')), [
    { path: '/show', body: {} },
    { path: '/download', body: download },
    { path: '/show', body: { page: 'settings' } }
  ])
  assert.deepEqual(await ask({ type: 'nonsense' }), { error: 'Unknown message' })
})
