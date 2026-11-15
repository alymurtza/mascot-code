/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomFile, sha256, startServer } from '../support/server'
import { launch, type Launched } from './app'

const LIMIT = 300_000 // bytes/s on Wi-Fi

/** Wi-Fi's speed, sampled once a second for a few seconds while the download runs. */
async function wifiSpeeds(run: Launched): Promise<{ wifi: number[]; eth: number[] }> {
  const wifi: number[] = []
  const eth: number[] = []
  await run.page.waitForTimeout(2500)
  for (let i = 0; i < 6; i++) {
    const s = await run.call('initial')
    wifi.push(s.networks.find((n) => n.name === 'Wi-Fi')?.speed ?? 0)
    eth.push(s.networks.find((n) => n.name === 'Ethernet')?.speed ?? 0)
    await run.page.waitForTimeout(1000)
  }
  return { wifi, eth }
}

let run: Launched
test.afterEach(async () => {
  await run?.close()
})

test('a network’s own speed limit holds for web downloads', async () => {
  const body = randomFile(40_000_000)
  const server = await startServer({ '/web.bin': { body, rate: 1_000_000 } })
  try {
    run = await launch()
    const wifiId = (await run.call('initial')).networks.find((n) => n.name === 'Wi-Fi')!.id
    await run.call('updateNetwork', wifiId, { speedLimit: LIMIT })
    await run.call('add', { url: server.url('/web.bin') })
    const { wifi, eth } = await wifiSpeeds(run)
    console.log(
      'web  wifi',
      wifi.map((v) => Math.round(v / 1000)),
      'eth',
      eth.map((v) => Math.round(v / 1000))
    )
    const moving = wifi.filter((v) => v > 0)
    // Over a few seconds it averages the limit; one second can run a little over.
    expect(moving.reduce((a, b) => a + b, 0) / moving.length).toBeLessThan(LIMIT * 1.15)
    for (const v of moving) expect(v).toBeLessThan(LIMIT * 1.5)
    expect(Math.max(...eth)).toBeGreaterThan(LIMIT * 2)
    const [done] = await run.until((l) => l[0]?.status === 'done', 120_000)
    expect(sha256(readFileSync(done.path))).toBe(sha256(body))
  } finally {
    await server.close()
  }
})

test('a network’s own speed limit holds for torrents too', async () => {
  test.setTimeout(180_000)
  const folder = mkdtempSync(join(tmpdir(), 'mascot-seed-'))
  const content = join(folder, 'Pack')
  mkdirSync(content)
  const body = randomFile(30_000_000)
  writeFileSync(join(content, 'big.bin'), body)
  const { default: WebTorrent } = await import('webtorrent')
  const seeders: any[] = []
  try {
    let magnet = ''
    const peers: string[] = []
    for (let i = 0; i < 4; i++) {
      const client: any = new WebTorrent({
        dht: false,
        tracker: false,
        lsd: false,
        utp: false,
        natUpnp: false,
        natPmp: false,
        webSeeds: false
      } as any)
      seeders.push(client)
      client.throttleUpload(1_000_000)
      const t: any = await new Promise((r) => client.seed(content, { announce: [] }, r))
      await new Promise<void>((r) => (client.address() ? r() : client.once('listening', r)))
      peers.push(`127.0.0.1:${client.address().port}`)
      magnet = t.magnetURI
    }
    magnet += peers.map((p) => `&x.pe=${p}`).join('')
    run = await launch()
    const wifiId = (await run.call('initial')).networks.find((n) => n.name === 'Wi-Fi')!.id
    await run.call('updateNetwork', wifiId, { speedLimit: LIMIT })
    const info = await run.call('torrentInfo', { magnet })
    await run.call('add', { url: magnet, torrent: { source: { magnet }, info } })
    const { wifi, eth } = await wifiSpeeds(run)
    console.log(
      'torr wifi',
      wifi.map((v) => Math.round(v / 1000)),
      'eth',
      eth.map((v) => Math.round(v / 1000))
    )
    expect(Math.max(...wifi)).toBeGreaterThan(0)
    const moving = wifi.filter((v) => v > 0)
    // Over a few seconds it averages the limit; one second can run a little over.
    expect(moving.reduce((a, b) => a + b, 0) / moving.length).toBeLessThan(LIMIT * 1.15)
    for (const v of moving) expect(v).toBeLessThan(LIMIT * 1.5)
    expect(Math.max(...eth)).toBeGreaterThan(LIMIT * 2)
    const [done] = await run.until((l) => l[0]?.status === 'done', 150_000)
    expect(sha256(readFileSync(join(done.path, 'big.bin')))).toBe(sha256(body))
  } finally {
    await Promise.all(seeders.map((c) => new Promise((r) => c.destroy(r))))
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a network’s speed limit covers all its downloads together: a torrent and a web download', async () => {
  test.setTimeout(180_000)
  const folder = mkdtempSync(join(tmpdir(), 'mascot-seed-'))
  const content = join(folder, 'Pack')
  mkdirSync(content)
  writeFileSync(join(content, 'big.bin'), randomFile(40_000_000))
  const webBody = randomFile(40_000_000)
  const server = await startServer({ '/web.bin': { body: webBody, rate: 1_000_000 } })
  const { default: WebTorrent } = await import('webtorrent')
  const seeders: any[] = []
  try {
    let magnet = ''
    const peers: string[] = []
    for (let i = 0; i < 4; i++) {
      const client: any = new WebTorrent({
        dht: false,
        tracker: false,
        lsd: false,
        utp: false,
        natUpnp: false,
        natPmp: false,
        webSeeds: false
      } as any)
      seeders.push(client)
      client.throttleUpload(1_000_000)
      const t: any = await new Promise((r) => client.seed(content, { announce: [] }, r))
      await new Promise<void>((r) => (client.address() ? r() : client.once('listening', r)))
      peers.push(`127.0.0.1:${client.address().port}`)
      magnet = t.magnetURI
    }
    magnet += peers.map((p) => `&x.pe=${p}`).join('')
    run = await launch()
    const wifiId = (await run.call('initial')).networks.find((n) => n.name === 'Wi-Fi')!.id
    await run.call('updateNetwork', wifiId, { speedLimit: LIMIT })
    const info = await run.call('torrentInfo', { magnet })
    await run.call('add', { url: magnet, torrent: { source: { magnet }, info } })
    await run.call('add', { url: server.url('/web.bin') })
    await run.page.waitForTimeout(2000)
    const wifi: number[] = []
    const parts: string[] = []
    for (let i = 0; i < 8; i++) {
      const s = await run.call('initial')
      wifi.push(s.networks.find((n) => n.name === 'Wi-Fi')?.speed ?? 0)
      parts.push(
        s.downloads
          .map((d) => `${d.kind}:${Math.round((d.networkSpeeds[wifiId] ?? 0) / 1000)}`)
          .join('+')
      )
      await run.page.waitForTimeout(1000)
    }
    console.log(
      'both wifi',
      wifi.map((v) => Math.round(v / 1000)),
      parts.join(' ')
    )
    // Both kinds used Wi-Fi, and together they kept to its limit.
    expect(parts.some((p) => /torrent:[1-9]/.test(p))).toBe(true)
    expect(parts.some((p) => /web:[1-9]/.test(p))).toBe(true)
    const moving = wifi.slice(2)
    expect(moving.reduce((a, b) => a + b, 0) / moving.length).toBeLessThan(LIMIT * 1.15)
  } finally {
    await Promise.all(seeders.map((c) => new Promise((r) => c.destroy(r))))
    rmSync(folder, { recursive: true, force: true })
    await server.close()
  }
})
