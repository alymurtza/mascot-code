import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** How a file on the test server behaves. */
export interface FileSpec {
  body: Buffer
  ranges?: boolean
  etag?: string
  lastModified?: string
  /** Bytes/s per connection (0: as fast as possible). */
  rate?: number
  /** Answer this status instead, for the next N requests (or always: Infinity). */
  failWith?: { status: number; times: number; retryAfter?: string }
  /** Cut the connection after this many bytes, for the next N requests. */
  cutAfter?: { bytes: number; times: number }
  /** A name in Content-Disposition. */
  disposition?: string
  /** Redirect here first. */
  redirectTo?: string
  /** Hold the response for this long before answering. */
  delayMs?: number
}

export interface Hit {
  path: string
  from: string
  range?: string
  cookie?: string
  referer?: string
}

export interface TestServer {
  url(path: string): string
  files: Map<string, FileSpec>
  hits: Hit[]
  close(): Promise<void>
  server: Server
}

export const randomFile = (bytes: number): Buffer => randomBytes(bytes)
export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

async function send(res: ServerResponse, data: Buffer, rate: number, cut?: number): Promise<void> {
  const limit = cut ?? data.length
  const chunk = rate > 0 ? Math.max(1024, Math.floor(rate / 20)) : 64 * 1024
  for (let at = 0; at < limit; at += chunk) {
    const piece = data.subarray(at, Math.min(limit, at + chunk))
    if (!res.write(piece)) await new Promise((r) => res.once('drain', r))
    if (rate > 0) await new Promise((r) => setTimeout(r, (piece.length / rate) * 1000))
    if (res.destroyed) return
  }
  if (cut !== undefined) res.socket?.destroy()
  else res.end()
}

export async function startServer(files: Record<string, FileSpec> = {}): Promise<TestServer> {
  const map = new Map(Object.entries(files))
  const hits: Hit[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      hits.push({
        path,
        from: req.socket.remoteAddress ?? '',
        range: req.headers.range,
        cookie: req.headers.cookie,
        referer: req.headers.referer
      })
      const spec = map.get(path)
      if (!spec) {
        res.statusCode = 404
        return res.end()
      }
      if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs))
      if (spec.redirectTo) {
        res.writeHead(302, { location: spec.redirectTo })
        return res.end()
      }
      if (spec.failWith && spec.failWith.times > 0) {
        spec.failWith.times--
        res.writeHead(
          spec.failWith.status,
          spec.failWith.retryAfter ? { 'retry-after': spec.failWith.retryAfter } : {}
        )
        return res.end()
      }
      const headers: Record<string, string> = { 'content-type': 'application/octet-stream' }
      if (spec.etag) headers['etag'] = spec.etag
      if (spec.lastModified) headers['last-modified'] = spec.lastModified
      if (spec.disposition) headers['content-disposition'] = spec.disposition
      if (spec.ranges !== false) headers['accept-ranges'] = 'bytes'
      let cut: number | undefined
      if (spec.cutAfter && spec.cutAfter.times > 0) {
        spec.cutAfter.times--
        cut = spec.cutAfter.bytes
      }
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
      if (range && spec.ranges !== false) {
        const start = Number(range[1])
        const end = Math.min(
          spec.body.length - 1,
          range[2] ? Number(range[2]) : spec.body.length - 1
        )
        if (start >= spec.body.length) {
          res.writeHead(416, { 'content-range': `bytes */${spec.body.length}` })
          return res.end()
        }
        res.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${spec.body.length}`,
          'content-length': String(end - start + 1)
        })
        const part = spec.body.subarray(start, end + 1)
        return send(
          res,
          part,
          spec.rate ?? 0,
          cut !== undefined ? Math.min(cut, part.length - 1) : undefined
        )
      }
      res.writeHead(200, { ...headers, 'content-length': String(spec.body.length) })
      return send(res, spec.body, spec.rate ?? 0, cut)
    })()
  })
  server.keepAliveTimeout = 30_000
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    files: map,
    hits,
    server,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections()
        server.close(() => r())
      })
  }
}
