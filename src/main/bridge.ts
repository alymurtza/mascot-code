import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * The browser extension's way in: a small web server on this computer only (127.0.0.1), on the
 * first free port of a fixed few. Only browser extensions are answered: a web page can't hand
 * the app anything, because requests from pages carry their own site as Origin.
 */
export const BRIDGE_PORTS = [19400, 19401, 19402]

export interface BridgeDownload {
  url: string
  referrer?: string
  cookies?: string
  filename?: string
  size?: number
}

export interface BridgeHost {
  version: string
  minBytes(): number
  take(download: BridgeDownload): void
  /** Brings the window forward, on a page if asked ('settings'). */
  show(page?: string): void
}

const EXTENSION_ORIGIN =
  /^(chrome-extension|moz-extension|safari-web-extension|extension):\/\/[\w.-]+$/i
const MAX_BODY = 64 * 1024

let lastSeen = 0
/** When the extension last checked in (for Settings). */
export const extensionLastSeen = (): number => lastSeen
let onSeen: ((at: number) => void) | null = null
/** Called each time the extension makes contact (to remember it across restarts). */
export function whenExtensionSeen(fn: (at: number) => void): void {
  onSeen = fn
}
function seen(): void {
  lastSeen = Date.now()
  onSeen?.(lastSeen)
}

function reply(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {})
  })
  res.end(JSON.stringify(body))
}

function handle(host: BridgeHost, req: IncomingMessage, res: ServerResponse): void {
  // Pages always say which site they're on; extensions say they're an extension or say nothing.
  const origin = req.headers.origin
  if (origin !== undefined && !EXTENSION_ORIGIN.test(origin))
    return reply(res, 403, { error: 'Only the Mascot browser extension can use this' })
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      vary: 'Origin'
    })
    res.end()
    return
  }
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (req.method === 'GET' && path === '/hello') {
    seen()
    return reply(
      res,
      200,
      { app: 'mascot-downloader', version: host.version, minBytes: host.minBytes() },
      origin
    )
  }
  if (req.method === 'POST' && path === '/download') {
    if (!/^application\/json/i.test(req.headers['content-type'] ?? ''))
      return reply(res, 415, { error: 'JSON only' }, origin)
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > MAX_BODY) req.destroy()
    })
    req.on('end', () => {
      try {
        const d = JSON.parse(body) as BridgeDownload
        if (typeof d.url !== 'string' || !/^(https?:\/\/|magnet:\?)/i.test(d.url))
          throw new Error('Not a link')
        seen()
        host.take({
          url: d.url,
          referrer:
            typeof d.referrer === 'string' && /^https?:/i.test(d.referrer) ? d.referrer : undefined,
          cookies: typeof d.cookies === 'string' ? d.cookies.slice(0, 16_000) : undefined,
          filename: typeof d.filename === 'string' ? d.filename.slice(0, 300) : undefined,
          size: typeof d.size === 'number' && d.size > 0 ? d.size : undefined
        })
        reply(res, 200, { ok: true }, origin)
      } catch {
        reply(res, 400, { error: 'That isn’t a download' }, origin)
      }
    })
    return
  }
  if (req.method === 'POST' && path === '/show') {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 1024) req.destroy()
    })
    req.on('end', () => {
      let page: string | undefined
      try {
        const p = (JSON.parse(body || '{}') as { page?: unknown }).page
        if (p === 'settings' || p === 'downloads') page = p
      } catch {
        // Just show the window.
      }
      seen()
      host.show(page)
      reply(res, 200, { ok: true }, origin)
    })
    return
  }
  reply(res, 404, { error: 'Not found' }, origin)
}

/** Starts listening on the first free port; resolves with it (or null if none was free). */
export async function startBridge(
  host: BridgeHost
): Promise<{ port: number; server: Server } | null> {
  for (const port of BRIDGE_PORTS) {
    const server = createServer((req, res) => handle(host, req, res))
    const ok = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => resolve(true))
    })
    if (ok) return { port, server }
  }
  return null
}
