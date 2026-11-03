import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomFile, sha256 } from '../support/server'
import { launch, type Launched } from './app'

/* eslint-disable @typescript-eslint/no-explicit-any */
const seeders: any[] = []
let folder: string
let magnet: string
const files = { 'big.bin': randomFile(6 * 1024 * 1024), 'small.txt': randomFile(300_000) }

test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'mascot-seed-'))
  const content = join(folder, 'Pack')
  mkdirSync(content)
  for (const [name, body] of Object.entries(files)) writeFileSync(join(content, name), body)
  const { default: WebTorrent } = await import('webtorrent')
  const peers: string[] = []
  for (let i = 0; i < 2; i++) {
    const client = new WebTorrent({
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
      natUpnp: false,
      natPmp: false,
      webSeeds: false
    })
    seeders.push(client)
    const torrent: any = await new Promise((resolve) =>
      client.seed(content, { announce: [] }, resolve)
    )
    await new Promise<void>((resolve) =>
      client.address() ? resolve() : client.once('listening', resolve)
    )
    peers.push(`127.0.0.1:${client.address().port}`)
    magnet = torrent.magnetURI
  }
  magnet += peers.map((p) => `&x.pe=${p}`).join('')
})
test.afterAll(async () => {
  await Promise.all(seeders.map((c) => new Promise((r) => c.destroy(r))))
  rmSync(folder, { recursive: true, force: true })
})

let run: Launched
test.afterEach(async () => {
  await run?.close()
})

test('a magnet link: the file list comes first, only the chosen files download, over both networks', async () => {
  run = await launch()
  const info = await run.call('torrentInfo', { magnet })
  expect(info.name).toBe('Pack')
  expect(info.files.map((f) => f.name).sort()).toEqual(['big.bin', 'small.txt'])
  const big = info.files.findIndex((f) => f.name === 'big.bin')
  await run.call('add', { url: magnet, torrent: { source: { magnet }, info, files: [big] } })
  const [done] = await run.until((l) => l[0]?.status === 'done', 60_000)
  expect(done.kind).toBe('torrent')
  expect(sha256(readFileSync(join(done.path, 'big.bin')))).toBe(sha256(files['big.bin']))
  expect(
    existsSync(join(done.path, 'small.txt')) &&
      readFileSync(join(done.path, 'small.txt')).length === files['small.txt'].length
  ).toBe(false)
  const usage = await run.call('usage')
  const used = Object.values(usage)
    .flatMap((day) => Object.entries(day))
    .filter(([, b]) => b > 0)
    .map(([id]) => id)
  expect(new Set(used)).toEqual(new Set(['Ethernet', 'Wi-Fi']))
  // The same magnet again is a duplicate.
  expect(await run.call('findDuplicate', magnet)).toMatchObject({ kind: 'finished' })
})

test('adding a magnet through the window shows its files to choose from', async () => {
  run = await launch()
  const { page } = run
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByLabel('Link or magnet').fill(magnet)
  const list = dialog.getByRole('group', { name: 'Files' })
  await expect(list.getByRole('checkbox')).toHaveCount(2, { timeout: 30_000 })
  await list.getByRole('checkbox', { name: /small\.txt/ }).uncheck()
  await dialog.getByRole('button', { name: 'Add download' }).click()
  const [done] = await run.until((l) => l[0]?.status === 'done', 60_000)
  expect(sha256(readFileSync(join(done.path, 'big.bin')))).toBe(sha256(files['big.bin']))
})

test('a torrent’s files show in its row with their progress; ticking one more later fetches it', async () => {
  run = await launch()
  const { page } = run
  const info = await run.call('torrentInfo', { magnet })
  const big = info.files.findIndex((f) => f.name === 'big.bin')
  await run.call('add', { url: magnet, torrent: { source: { magnet }, info, files: [big] } })
  await run.until((l) => l[0]?.status === 'done', 60_000)
  const row = page.getByRole('article', { name: 'Pack' })
  await row.click()
  const list = row.getByRole('group', { name: 'Files' })
  await expect(list.getByRole('checkbox', { name: 'big.bin' })).toBeChecked()
  await expect(list.getByRole('checkbox', { name: 'small.txt' })).not.toBeChecked()
  await expect(list.locator('.tfile', { hasText: 'big.bin' })).toContainText('100%')
  await expect(list.locator('.tfile-head')).toContainText('Pack')
  // Tick the other file: the torrent goes back to fetch it, and finishes with both.
  await list.getByRole('checkbox', { name: 'small.txt' }).check()
  const [done] = await run.until(
    (l) =>
      l[0]?.status === 'done' && !!l[0].files?.every((f) => f.selected && f.received === f.length),
    60_000
  )
  expect(sha256(readFileSync(join(done.path, 'small.txt')))).toBe(sha256(files['small.txt']))
  await expect(list.locator('.tfile', { hasText: 'small.txt' })).toContainText('100%')
  // The last file can't be unticked.
  await list.getByRole('checkbox', { name: 'All files' }).uncheck()
  await expect
    .poll(async () => (await run.list())[0].files!.filter((f) => f.selected).length)
    .toBe(1)
})
