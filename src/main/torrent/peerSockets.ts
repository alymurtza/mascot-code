import net, { isIPv6, type Socket } from 'node:net'
import { Duplex } from 'node:stream'
import type { Adapter } from '../../shared/network'
import { connectOnDevice } from '../net/bind'
import { Limiter } from '../engine/throttle'

/**
 * Outgoing peer connections spread over the networks downloads may use. WebTorrent opens each
 * peer connection with net.connect; in the torrent process that function is replaced by one
 * that picks the network with the fewest connections and leaves through it.
 */

let adapters: Adapter[] = []
let bindDevices = false
const original = net.connect.bind(net) as typeof net.connect
/** Open connections and how many bytes each had read at the last report. */
const open = new Map<Paced, { adapter: string; reported: number }>()

/** A peer connection on one network: it leaves through that network's device (Linux, macOS) or
 * from its address, connects in the background, and paces what it reads to the network's speed
 * limit. Behaves like the socket WebTorrent expects: 'connect', 'error', 'close', data. */
class Paced extends Duplex {
  private socket: Socket | null = null
  private waiting: (() => void) | null = null
  /** A chunk is waiting for the speed limit: nothing else is read until it's through. */
  private held = false
  private endAfterHeld = false
  bytesRead = 0

  constructor(
    connecting: Promise<Socket>,
    private readonly adapter: string,
    readonly remoteAddress: string,
    readonly remotePort: number
  ) {
    super()
    connecting.then(
      (socket) => {
        if (this.destroyed) return socket.destroy()
        this.socket = socket
        socket.on('data', (chunk: Buffer) => this.arrived(socket, chunk))
        socket.on('end', () => {
          if (this.held) this.endAfterHeld = true
          else this.push(null)
        })
        socket.on('error', (error) => this.destroy(error))
        socket.on('close', () => this.destroy())
        this.emit('connect')
        this.waiting?.()
      },
      (error: Error) => this.destroy(error)
    )
  }

  private arrived(socket: Socket, chunk: Buffer): void {
    this.bytesRead += chunk.length
    const limiter = limiters.get(this.adapter)
    if (!limiter || !(limiter.rate > 0)) {
      if (!this.push(chunk)) socket.pause()
      return
    }
    // Over the network's speed limit: stop reading until its turn comes.
    socket.pause()
    this.held = true
    void limiter.take(chunk.length).then(() => {
      this.held = false
      if (this.destroyed) return
      const more = this.push(chunk)
      if (this.endAfterHeld) this.push(null)
      else if (more) socket.resume()
    })
  }

  _read(): void {
    if (!this.held) this.socket?.resume()
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    if (!this.socket) {
      this.waiting = () => this._write(chunk, _encoding, done)
      return
    }
    this.socket.write(chunk, done)
  }

  _final(done: () => void): void {
    this.socket?.end()
    done()
  }

  _destroy(error: Error | null, done: (error: Error | null) => void): void {
    this.socket?.destroy()
    done(error)
  }

  setTimeout(): this {
    return this
  }
  setNoDelay(): this {
    return this
  }
  setKeepAlive(): this {
    return this
  }
}

/** Each network's own speed limit (bytes/s), shared by every torrent connection on it. */
const limiters = new Map<string, Limiter>()

export function setNetworkLimits(rates: Record<string, number>): void {
  for (const [id, limiter] of limiters) if (!(id in rates)) limiter.setRate(0)
  for (const [id, rate] of Object.entries(rates)) {
    const limiter = limiters.get(id)
    if (limiter) limiter.setRate(rate)
    else limiters.set(id, new Limiter(rate))
  }
}

function connectPlain(host: string, port: number, localAddress?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = original({ host, port, localAddress })
    s.once('connect', () => resolve(s))
    s.once('error', reject)
  })
}

function pick(remote: string): Adapter | undefined {
  const v6 = isIPv6(remote)
  const usable = adapters.filter((a) => (v6 ? a.ipv6 : a.ipv4))
  if (usable.length === 0) return undefined
  const counts = new Map(usable.map((a) => [a.id, 0]))
  for (const { adapter } of open.values())
    if (counts.has(adapter)) counts.set(adapter, counts.get(adapter)! + 1)
  return usable.reduce((best, a) => (counts.get(a.id)! < counts.get(best.id)! ? a : best))
}

function track(conn: Paced, adapter: string): void {
  open.set(conn, { adapter, reported: 0 })
  conn.once('close', () => {
    report(conn)
    open.delete(conn)
  })
}

/** Bytes per network since the last call, including connections closed in between. */
const pending: Record<string, number> = {}
function report(conn: Paced): void {
  const entry = open.get(conn)
  if (!entry) return
  const read = conn.bytesRead
  if (read > entry.reported) {
    pending[entry.adapter] = (pending[entry.adapter] ?? 0) + read - entry.reported
    entry.reported = read
  }
}

export function takeUsage(): Record<string, number> {
  for (const conn of open.keys()) report(conn)
  const out = { ...pending }
  for (const key of Object.keys(pending)) delete pending[key]
  return out
}

/** The networks to use; connections on networks no longer allowed are closed. */
export function setNetworks(next: Adapter[], devices: boolean): void {
  adapters = next
  bindDevices = devices
  const allowed = new Set(next.map((a) => a.id))
  for (const [conn, { adapter }] of open) if (!allowed.has(adapter)) conn.destroy()
}

export function installPeerSockets(): void {
  ;(net as { connect: unknown }).connect = (...args: unknown[]): Socket | Paced => {
    const opts = (typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] }) as {
      host: string
      port: number
    }
    const adapter = pick(opts.host)
    if (!adapter) {
      // No network may be used: fail the connection.
      const s = new net.Socket()
      queueMicrotask(() => s.destroy(new Error('No network can be used right now')))
      return s
    }
    const local = isIPv6(opts.host) ? adapter.ipv6 : adapter.ipv4
    const connecting =
      bindDevices && adapter.device
        ? connectOnDevice(adapter.device, opts.host, opts.port, 10_000).then(
            (s) => s ?? connectPlain(opts.host, opts.port, local)
          )
        : connectPlain(opts.host, opts.port, local)
    const conn = new Paced(connecting, adapter.id, opts.host, opts.port)
    track(conn, adapter.id)
    return conn
  }
}
