import type { IncomingMessage } from 'node:http'
import type { LinkInfo } from '../../shared/download'
import type { Adapter } from '../../shared/network'
import { Connection } from '../net/http'
import { DownloadError, httpError } from './errors'
import { nameFromDisposition, nameFromUrl, safeName } from './names'

const MAX_REDIRECTS = 10
export const ANSWER_TIMEOUT_MS = Number(process.env['MASCOT_TEST_ANSWER_TIMEOUT_MS'] ?? 20_000)

/** Sends a request and follows redirects. Resolves with the final response (body unread) and
 * the URL it came from. */
export async function follow(
  connection: Connection,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<{ res: IncomingMessage; url: string }> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = new URL(current)
    if (target.protocol !== 'http:' && target.protocol !== 'https:')
      throw new DownloadError('Only web links (http and https) can be downloaded', 'fatal')
    const res = await connection.request(target, { headers, signal, timeoutMs: ANSWER_TIMEOUT_MS })
    const location = res.headers.location
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume()
      current = new URL(location, target).toString()
      continue
    }
    return { res, url: current }
  }
  throw new DownloadError('The link redirects too many times', 'source')
}

/** Whether an ETag is a strong one (not W/"..."). */
export const strongEtag = (etag: string | undefined): string | undefined =>
  etag && !/^W\//i.test(etag) ? etag.replace(/^"|"$/g, '') : undefined

/** Looks at a link over `adapter`: its size, name, and whether it can be fetched in parts. */
export async function checkLink(
  adapter: Adapter,
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal
): Promise<LinkInfo> {
  const connection = new Connection(() => adapter)
  try {
    const { res, url: finalUrl } = await follow(
      connection,
      url,
      { ...headers, range: 'bytes=0-0' },
      signal
    )
    res.destroy()
    const status = res.statusCode ?? 0
    if (status !== 200 && status !== 206)
      throw httpError(status, res.headers['retry-after'] as string | undefined)
    let size: number | undefined
    let ranged = false
    if (status === 206) {
      const total = /\/(\d+)\s*$/.exec(String(res.headers['content-range'] ?? ''))
      if (total) {
        size = Number(total[1])
        ranged = true
      }
    } else if (res.headers['content-length'] !== undefined) {
      size = Number(res.headers['content-length'])
    }
    const contentType =
      String(res.headers['content-type'] ?? '')
        .split(';')[0]
        .trim() || undefined
    const name = safeName(
      nameFromDisposition(res.headers['content-disposition']) ??
        nameFromUrl(finalUrl) ??
        nameFromUrl(url) ??
        new URL(url).hostname
    )
    return {
      url,
      finalUrl,
      name,
      size,
      ranged,
      etag: (res.headers.etag as string | undefined) ?? undefined,
      lastModified: (res.headers['last-modified'] as string | undefined) ?? undefined,
      contentType
    }
  } finally {
    connection.reset()
  }
}
