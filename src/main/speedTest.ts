import type { Adapter } from '../shared/network'
import { Connection } from './net/http'
import { follow } from './engine/probe'

/** Public speed-test files: big enough that a test never reaches the end. */
const SERVERS = process.env['MASCOT_TEST_SPEED_URLS']?.split(',') ?? [
  'https://hel1-speed.hetzner.com/10GB.bin',
  'https://fsn1-speed.hetzner.com/10GB.bin',
  'https://ash-speed.hetzner.com/10GB.bin',
  'https://sin-speed.hetzner.com/10GB.bin',
  'https://proof.ovh.net/files/10Gb.dat'
]
const WARM_UP_MS = Number(process.env['MASCOT_TEST_SPEED_WARMUP_MS'] ?? 1500)
const MEASURE_MS = Number(process.env['MASCOT_TEST_SPEED_MS'] ?? 8000)
const SERVERS_USED = 2
const CONNECTIONS_EACH = 2

export interface SpeedResult {
  /** Bytes/s. */
  speed: number
  /** Milliseconds to the nearest server. */
  ping: number
}

/** Time for the server to answer a one-byte request; best of two. */
async function ping(adapter: Adapter, url: string, signal: AbortSignal): Promise<number> {
  const connection = new Connection(() => adapter)
  let best = Infinity
  try {
    for (let i = 0; i < 2; i++) {
      const started = performance.now()
      const { res } = await follow(connection, url, { range: 'bytes=0-0' }, signal)
      res.resume()
      if (res.statusCode !== 206 && res.statusCode !== 200)
        throw new Error(`Answered ${res.statusCode}`)
      // The first includes connecting; the second is the round trip alone.
      best = Math.min(best, performance.now() - started)
    }
  } finally {
    connection.reset()
  }
  return best
}

/** Reads from `url` until `signal` aborts, counting bytes once the warm-up is over. A busy
 * server is asked again after a second. */
async function pull(
  adapter: Adapter,
  url: string,
  signal: AbortSignal,
  count: (n: number) => void
): Promise<void> {
  const connection = new Connection(() => adapter)
  try {
    while (!signal.aborted) {
      try {
        const { res } = await follow(connection, url, {}, signal)
        if (res.statusCode === 429 || res.statusCode === 503) {
          res.resume()
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume()
          return
        }
        for await (const chunk of res as AsyncIterable<Buffer>) {
          count(chunk.length)
          if (signal.aborted) break
        }
      } catch {
        if (signal.aborted) return
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  } finally {
    connection.reset()
  }
}

/** Measures what one network can download: the nearest servers, several connections each. */
export async function speedTest(adapter: Adapter): Promise<SpeedResult> {
  const stop = new AbortController()
  const pinged = await Promise.all(
    SERVERS.map((url) =>
      ping(adapter, url, AbortSignal.timeout(5000)).then(
        (ms) => ({ url, ms }),
        () => ({ url, ms: Infinity })
      )
    )
  )
  const nearest = pinged.filter((p) => Number.isFinite(p.ms)).sort((a, b) => a.ms - b.ms)
  if (nearest.length === 0)
    throw new Error('No speed-test server could be reached over this network')
  let bytes = 0
  let counting = false
  const pulls = nearest
    .slice(0, SERVERS_USED)
    .flatMap((p) =>
      Array.from({ length: CONNECTIONS_EACH }, () =>
        pull(adapter, p.url, stop.signal, (n) => counting && (bytes += n))
      )
    )
  await new Promise((r) => setTimeout(r, WARM_UP_MS))
  counting = true
  const started = performance.now()
  await new Promise((r) => setTimeout(r, MEASURE_MS))
  const seconds = (performance.now() - started) / 1000
  counting = false
  stop.abort()
  await Promise.allSettled(pulls)
  return { speed: bytes / seconds, ping: Math.round(nearest[0].ms) }
}
