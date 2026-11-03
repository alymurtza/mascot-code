import { lookup } from 'node:dns/promises'
import { connect as plainConnect, isIP, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import type { Adapter } from '../../shared/network'
import { testMode } from './adapters'
import { connectOnDevice } from './bind'

export class NoRouteError extends Error {
  constructor(adapter: Adapter, host: string) {
    super(`${adapter.name} has no address that can reach ${host}`)
  }
}

/** The addresses `host` resolves to that `adapter` can reach (matching IP family), best first. */
export async function addressesFor(adapter: Adapter, host: string): Promise<string[]> {
  const found = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, order: 'verbatim' })
  return found.filter((a) => (a.family === 6 ? adapter.ipv6 : adapter.ipv4)).map((a) => a.address)
}

/** Every download connection that hasn't fully closed yet, so quitting can wait for them. */
const open = new Set<Socket>()

function track(socket: Socket): void {
  open.add(socket)
  socket.once('close', () => open.delete(socket))
}

/** Closes every connection and resolves once all of them have closed (or after `timeoutMs`),
 * so nothing is still arriving when the app exits. */
export function closeAllConnections(timeoutMs: number): Promise<void> {
  const closed = [...open].map(
    (socket) =>
      new Promise<void>((resolve) => {
        socket.once('close', () => resolve())
        socket.destroy()
      })
  )
  return Promise.race([
    Promise.all(closed).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ])
}

/** Test adapters are addresses on loopback, bound by address only. */
const testing = testMode

/**
 * A TCP connection to host:port that leaves through `adapter`, and TLS on top when `secure`.
 * Times out after `timeoutMs` if the connection (and handshake) haven't completed.
 */
export async function connectVia(
  adapter: Adapter,
  host: string,
  port: number,
  options: { secure: boolean; timeoutMs: number; signal?: AbortSignal }
): Promise<Socket | TLSSocket> {
  const addresses = await addressesFor(adapter, host)
  if (addresses.length === 0) throw new NoRouteError(adapter, host)
  let lastError: unknown
  for (const address of addresses) {
    try {
      return await connectOnce(adapter, host, address, port, options)
    } catch (error) {
      lastError = error
      if (options.signal?.aborted) throw error
    }
  }
  throw lastError
}

async function connectOnce(
  adapter: Adapter,
  host: string,
  address: string,
  port: number,
  options: { secure: boolean; timeoutMs: number; signal?: AbortSignal }
): Promise<Socket | TLSSocket> {
  const started = Date.now()
  const onDevice =
    adapter.device && !testing()
      ? await connectOnDevice(adapter.device, address, port, options.timeoutMs)
      : null
  if (options.signal?.aborted) {
    onDevice?.destroy()
    throw new Error('Aborted')
  }
  const remaining = Math.max(1000, options.timeoutMs - (Date.now() - started))
  return new Promise((resolve, reject) => {
    const localAddress = isIP(address) === 6 ? adapter.ipv6 : adapter.ipv4
    const socket = onDevice ?? plainConnect({ host: address, port, localAddress })
    track(socket)
    let settled = false
    const finish = (error: Error | null, result?: Socket | TLSSocket): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      socket.off('error', onError)
      if (error) {
        socket.destroy()
        reject(error)
      } else resolve(result!)
    }
    const onError = (error: Error): void => finish(error)
    const onAbort = (): void => finish(new Error('Aborted'))
    const timer = setTimeout(() => finish(new Error(`Timed out connecting to ${host}`)), remaining)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    socket.on('error', onError)
    const connected = (): void => {
      if (!options.secure) return finish(null, socket)
      const secure = tlsConnect({
        socket,
        servername: isIP(host) ? undefined : host,
        ALPNProtocols: ['http/1.1']
      })
      secure.once('error', onError)
      secure.once('secureConnect', () => {
        secure.off('error', onError)
        finish(null, secure)
      })
    }
    if (onDevice) connected()
    else socket.once('connect', connected)
  })
}
