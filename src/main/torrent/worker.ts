/**
 * The torrent process: runs WebTorrent apart from the app, so its peer connections can be
 * spread over the chosen networks (see peerSockets.ts) without touching anything else.
 * Talks to the main process with the messages in shared/torrent.ts.
 */
import { rm } from 'node:fs/promises'
import type { FromWorker, ToWorker, TorrentInfo, TorrentSource } from '../../shared/torrent'
import { installPeerSockets, setNetworks, takeUsage } from './peerSockets'

installPeerSockets()

const port = process.parentPort
const send = (message: FromWorker): void => port.postMessage(message)
const testing = process.env['MASCOT_TEST_ADAPTERS'] !== undefined

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any
type Torrent = any

let client: Client | null = null
async function getClient(): Promise<Client> {
  if (client) return client
  const { default: WebTorrent } = await import('webtorrent')
  client = new WebTorrent({
    // uTP runs over UDP, which can't be steered onto a network the same way.
    utp: false,
    ...(testing ? { dht: false, tracker: false, lsd: false, natUpnp: false, natPmp: false } : {})
  })
  client.on('error', (error: Error) => console.error('[mascot torrents]', error.message))
  return client
}

const sourceOf = (source: TorrentSource): string | Buffer =>
  'magnet' in source ? source.magnet : Buffer.from(source.file, 'base64')

function describe(torrent: Torrent): TorrentInfo {
  return {
    name: torrent.name,
    infoHash: torrent.infoHash,
    size: torrent.length,
    files: torrent.files.map((f: any) => ({ name: f.name, path: f.path, length: f.length }))
  }
}

const running = new Map<string, { torrent: Torrent; timer: NodeJS.Timeout; files?: number[] }>()

/** Every piece of the file is on disk and checked. */
function fileVerified(torrent: Torrent, file: any): boolean {
  if (!torrent.bitfield) return false
  if (file.length === 0) return true
  for (let i = file._startPiece; i <= file._endPiece; i++)
    if (!torrent.bitfield.get(i)) return false
  return true
}

/** Selected files only: bytes verified on disk, and the total. */
function progressOf(
  torrent: Torrent,
  files?: number[]
): { received: number; size: number; done: boolean } {
  const chosen = torrent.files.filter((_: unknown, i: number) => !files || files.includes(i))
  const size = chosen.reduce((sum: number, f: any) => sum + f.length, 0)
  const received = chosen.reduce((sum: number, f: any) => sum + Math.min(f.length, f.downloaded), 0)
  return { received, size, done: chosen.every((f: any) => fileVerified(torrent, f)) }
}

function piecesOf(torrent: Torrent): { total: number; done: number; active: number } {
  const total = torrent.pieces?.length ?? 0
  let done = 0
  for (let i = 0; i < total; i++) if (torrent.bitfield?.get(i)) done++
  const active = torrent.wires.reduce((sum: number, w: any) => sum + (w.requests?.length ?? 0), 0)
  return { total, done, active: Math.min(active, total - done) }
}

async function start(
  id: string,
  source: TorrentSource,
  folder: string,
  files?: number[]
): Promise<void> {
  const c = await getClient()
  const existing = await c.get(sourceOf(source))
  if (existing) existing.destroy()
  const torrent = c.add(sourceOf(source), { path: folder, deselect: !!files })
  torrent.on('error', (error: Error) => {
    stop(id, false)
    send({ type: 'error', id, message: error.message })
  })
  const finish = (): void => {
    if (!running.has(id)) return
    stop(id, false)
    flushUsage()
    send({ type: 'done', id })
  }
  torrent.on('ready', () => {
    // The choice may have changed since starting.
    const chosen = running.get(id)?.files
    if (chosen) {
      torrent.files.forEach((f: any, i: number) => (chosen.includes(i) ? f.select() : f.deselect()))
    }
    if (progressOf(torrent, chosen).done) finish()
  })
  torrent.on('download', () => {
    if (torrent.ready && progressOf(torrent, running.get(id)?.files).done) finish()
  })
  torrent.on('done', finish)
  const timer = setInterval(() => {
    if (!torrent.ready) {
      return send({
        type: 'progress',
        id,
        progress: {
          received: 0,
          size: 0,
          speed: torrent.downloadSpeed,
          peers: torrent.numPeers,
          pieces: { total: 0, done: 0, active: 0 }
        }
      })
    }
    const chosen = running.get(id)?.files
    const p = progressOf(torrent, chosen)
    // Finished pieces don't always come with an event; look each time too.
    if (p.done) return finish()
    send({
      type: 'progress',
      id,
      progress: {
        received: p.received,
        size: p.size,
        speed: torrent.downloadSpeed,
        peers: torrent.numPeers,
        pieces: piecesOf(torrent),
        files: torrent.files.map((f: any) => Math.min(f.length, f.downloaded))
      }
    })
  }, 500)
  running.set(id, { torrent, timer, files })
}

/** Fetch only these files from now on (all when unset); what's on disk stays. */
function select(id: string, files?: number[]): void {
  const entry = running.get(id)
  if (!entry) return
  entry.files = files
  const torrent = entry.torrent
  if (!torrent.ready) return
  torrent.files.forEach((f: any, i: number) =>
    !files || files.includes(i) ? f.select() : f.deselect()
  )
}

function stop(id: string, reply = true): void {
  const entry = running.get(id)
  running.delete(id)
  if (entry) {
    clearInterval(entry.timer)
    entry.torrent.destroy({ destroyStore: false })
  }
  if (reply) send({ type: 'stopped', id })
}

async function info(req: number, source: TorrentSource, tmp: string): Promise<void> {
  const c = await getClient()
  const torrent = c.add(sourceOf(source), { path: tmp, deselect: true, skipVerify: true })
  const done = (message: FromWorker): void => {
    clearTimeout(timer)
    send(message)
    torrent.destroy(
      { destroyStore: true },
      () => void rm(tmp, { recursive: true, force: true }).catch(() => {})
    )
  }
  const timer = setTimeout(
    () => done({ type: 'info', req, error: 'No one sharing this torrent could be found' }),
    90_000
  )
  torrent.once('metadata', () => done({ type: 'info', req, info: describe(torrent) }))
  torrent.once('error', (error: Error) => done({ type: 'info', req, error: error.message }))
}

function flushUsage(): void {
  const bytes = takeUsage()
  if (Object.keys(bytes).length) send({ type: 'usage', bytes })
}
setInterval(flushUsage, 1000)

port.on('message', (event: { data: ToWorker }) => {
  const m = event.data
  if (m.type === 'networks') setNetworks(m.adapters, m.bindDevices)
  else if (m.type === 'limit')
    void getClient().then((c) => c.throttleDownload(m.rate > 0 ? m.rate : -1))
  else if (m.type === 'info')
    void info(m.req, m.source, m.tmp).catch((e) =>
      send({ type: 'info', req: m.req, error: String(e?.message ?? e) })
    )
  else if (m.type === 'start')
    void start(m.id, m.source, m.folder, m.files).catch((e) =>
      send({ type: 'error', id: m.id, message: String(e?.message ?? e) })
    )
  else if (m.type === 'stop') stop(m.id)
  else if (m.type === 'select') select(m.id, m.files)
})
