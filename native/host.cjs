// Mascot's native messaging host: the browser extension's way to the app that no browser setting
// (Brave Shields, Chrome's local network rules) can block. The browser starts it for each
// message; it answers and exits. It runs as plain Node (Mascot started with
// ELECTRON_RUN_AS_NODE=1) and talks to the app over its local bridge.
//
// Usage (written by the app into its launcher): host.cjs <config.json> [browser's arguments]
'use strict'
const http = require('node:http')
const { spawn } = require('node:child_process')
const fs = require('node:fs')

const PORTS = [19400, 19401, 19402]
const configPath = process.argv[2]
let config = {}
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
} catch {
  // Without the launch command, Mascot can't be started from here; the rest still works.
}

/** One request to the app's bridge; resolves with its JSON, or null if nothing answered. */
function call(port, method, path, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        timeout: 1500,
        headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {}
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(text) })
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end(data)
  })
}

/** Where the app is, or null when it isn't running. */
async function findApp() {
  for (const port of PORTS) {
    const r = await call(port, 'GET', '/hello')
    if (r && r.status === 200 && r.body && r.body.app === 'mascot-downloader')
      return { port, version: r.body.version, minBytes: r.body.minBytes || 0 }
  }
  return null
}

/** Starts Mascot and waits (up to `ms`) until it answers. */
async function startApp(ms) {
  const launch = config.launch
  if (!launch || !launch.command) return null
  const env = { ...process.env, ...(launch.env || {}) }
  // The app itself, not Node.
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(launch.command, launch.args || [], {
    detached: true,
    stdio: 'ignore',
    env,
    windowsHide: false
  })
  child.on('error', () => {})
  child.unref()
  const end = Date.now() + ms
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 400))
    const app = await findApp()
    if (app) return app
  }
  return null
}

async function handle(message) {
  // Tests: answer late, as a slow computer does when the host has to start up.
  const late = Number(process.env.MASCOT_TEST_HOST_DELAY_MS || 0)
  if (late) await new Promise((r) => setTimeout(r, late))
  const type = message && message.type
  if (type === 'hello') {
    const app = await findApp()
    return app
      ? { running: true, version: app.version, minBytes: app.minBytes }
      : { running: false }
  }
  if (type === 'download') {
    const app = await findApp()
    if (!app) return { ok: false, running: false }
    const r = await call(app.port, 'POST', '/download', message.download)
    return { ok: !!r && r.status === 200, running: true }
  }
  if (type === 'open') {
    // Started if closed; either way brought forward (on the page asked for).
    const app = (await findApp()) || (await startApp(25_000))
    if (!app) return { running: false }
    await call(app.port, 'POST', '/show', { page: message.page })
    return { running: true, version: app.version, minBytes: app.minBytes }
  }
  return { error: 'Unknown message' }
}

// The browser's framing: a 32-bit length (native byte order: little-endian everywhere Mascot
// runs), then that much UTF-8 JSON, both ways.
function send(reply) {
  const body = Buffer.from(JSON.stringify(reply))
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  process.stdout.write(Buffer.concat([head, body]), () => process.exit(0))
}

let input = Buffer.alloc(0)
let done = false
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  if (done || input.length < 4) return
  const size = input.readUInt32LE(0)
  if (input.length < 4 + size) return
  done = true
  let message
  try {
    message = JSON.parse(input.subarray(4, 4 + size).toString('utf8'))
  } catch {
    return send({ error: 'Not JSON' })
  }
  handle(message).then(send, (error) => send({ error: String(error && error.message) }))
})
process.stdin.on('end', () => {
  if (!done) process.exit(0)
})
