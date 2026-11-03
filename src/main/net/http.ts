import { Agent as HttpAgent, request as httpRequest, type IncomingMessage } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import type { ClientRequestArgs } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Adapter } from '../../shared/network'
import { connectVia } from './connect'

const CONNECT_TIMEOUT_MS = Number(process.env['MASCOT_TEST_CONNECT_TIMEOUT_MS'] ?? 10_000)

type Done = (error: Error | null, socket: Duplex) => void

/** An agent whose connections leave through one adapter, kept alive for reuse. One per
 * connection slot: `maxSockets: 1`, so a slot always talks over the same socket. */
class ViaAgentHttp extends HttpAgent {
  constructor(private readonly adapter: () => Adapter | undefined) {
    super({ keepAlive: true, maxSockets: 1 })
  }
  createConnection(options: ClientRequestArgs, done?: Done): undefined {
    if (!done) throw new Error('A callback is required')
    open(this.adapter, options, false, done)
    return undefined
  }
}

class ViaAgentHttps extends HttpsAgent {
  constructor(private readonly adapter: () => Adapter | undefined) {
    super({ keepAlive: true, maxSockets: 1 })
  }
  createConnection(options: ClientRequestArgs, done?: Done): undefined {
    if (!done) throw new Error('A callback is required')
    open(this.adapter, options, true, done)
    return undefined
  }
}

function open(
  adapter: () => Adapter | undefined,
  options: ClientRequestArgs,
  secure: boolean,
  done: Done
): void {
  const current = adapter()
  if (!current) return done(new Error('The network is not connected'), undefined as never)
  connectVia(
    current,
    options.hostname ?? options.host ?? 'localhost',
    Number(options.port ?? (secure ? 443 : 80)),
    {
      secure,
      timeoutMs: CONNECT_TIMEOUT_MS
    }
  ).then(
    (socket) => done(null, socket),
    (error: Error) => done(error, undefined as never)
  )
}

/** One connection slot over one adapter: requests reuse its kept-alive socket. */
export class Connection {
  private readonly http: ViaAgentHttp
  private readonly https: ViaAgentHttps

  /** `adapter` is looked up at each new socket, so a network that came back with a new address
   * is reached at that one. */
  constructor(adapter: () => Adapter | undefined) {
    this.http = new ViaAgentHttp(adapter)
    this.https = new ViaAgentHttps(adapter)
  }

  /** Sends a GET (or HEAD) and resolves once the response headers are in. */
  request(
    url: URL,
    options: {
      method?: 'GET' | 'HEAD'
      headers?: Record<string, string>
      signal?: AbortSignal
      timeoutMs: number
    }
  ): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const secure = url.protocol === 'https:'
      const init = {
        method: options.method ?? 'GET',
        headers: { 'user-agent': 'Mascot', accept: '*/*', ...options.headers },
        signal: options.signal
      }
      const req = secure
        ? httpsRequest(url, { ...init, agent: this.https })
        : httpRequest(url, { ...init, agent: this.http })
      const timer = setTimeout(
        () => req.destroy(new Error(`No answer from ${url.host}`)),
        options.timeoutMs
      )
      req.once('response', (res) => {
        clearTimeout(timer)
        resolve(res)
      })
      req.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      req.end()
    })
  }

  /** Drops its sockets: the next request opens a new one. */
  reset(): void {
    this.http.destroy()
    this.https.destroy()
  }
}
