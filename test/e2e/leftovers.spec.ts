/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomFile, sha256, startServer, type TestServer } from '../support/server'
import { launch, type Launched } from './app'

const body = randomFile(24_000_000)
let server: TestServer
test.beforeAll(async () => {
  server = await startServer({
    '/game.iso': { body, rate: 600_000 },
    '/report.pdf': { body: randomFile(300_000) }
  })
})
test.afterAll(async () => {
  await server.close()
})

let run: Launched
test.afterEach(async () => {
  await run?.close()
})

/** Starts game.iso, lets part of it arrive, pauses, then loses the list (as a power cut did). */
async function partlyThenListLost(): Promise<{ userData: string; had: number }> {
  run = await launch()
  const d = await run.call('add', { url: server.url('/game.iso') })
  await run.until((l) => l[0]?.received > 6_000_000)
  await run.page.waitForTimeout(2500)
  await run.call('act', [d.id], 'pause')
  const [paused] = await run.until((l) => l[0]?.status === 'paused')
  await run.app.evaluate(({ app }) => app.quit())
  await new Promise<void>((r) =>
    run.app.process().exitCode !== null ? r() : void run.app.process().once('exit', () => r())
  )
  for (const f of ['downloads.json', 'downloads.json.bak'])
    rmSync(join(run.userData, f), { force: true })
  return { userData: run.userData, had: paused.received }
}

test('a download lost from the list carries on from what it left in the folder', async () => {
  const { userData, had } = await partlyThenListLost()
  run = await launch({ userData })
  expect(await run.list()).toEqual([])
  const url = server.url('/game.iso')
  const info = await run.call('checkLink', url)
  const match = await run.call('findDuplicate', url, info, {})
  expect(match).toMatchObject({
    kind: 'partial',
    name: 'game.iso',
    resumable: true,
    size: body.length
  })
  // What's recorded is what had reached the disk: never more than it had.
  expect(match!.received).toBeGreaterThan(0)
  expect(match!.received).toBeLessThanOrEqual(had)
  const d = await run.call('add', { url, info, existing: 'continue' })
  expect(d.name).toBe('game.iso')
  expect(d.received).toBe(match!.received)
  const [done] = await run.until((l) => l[0]?.status === 'done', 60_000)
  expect(sha256(readFileSync(done.path))).toBe(sha256(body))
  expect(readdirSync(run.downloads)).toEqual(['game.iso'])
})

test('a part file without its note can only be started over, and is replaced', async () => {
  const { userData } = await partlyThenListLost()
  rmSync(join(userData, 'Downloads', 'game.iso.mascot-part.json'))
  run = await launch({ userData })
  const url = server.url('/game.iso')
  const info = await run.call('checkLink', url)
  const match = await run.call('findDuplicate', url, info, {})
  expect(match).toMatchObject({ kind: 'partial', resumable: false })
  const d = await run.call('add', { url, info, existing: 'replace' })
  expect(d.received).toBe(0)
  const [done] = await run.until((l) => l[0]?.status === 'done', 60_000)
  expect(done.name).toBe('game.iso')
  expect(sha256(readFileSync(done.path))).toBe(sha256(body))
})

test('a torrent lost from the list carries on in its own folder', async () => {
  const seedDir = mkdtempSync(join(tmpdir(), 'mascot-seed-'))
  const content = join(seedDir, 'Pack')
  mkdirSync(content)
  const files = { 'a.bin': randomFile(3_000_000), 'b.bin': randomFile(2_000_000) }
  for (const [n, b] of Object.entries(files)) writeFileSync(join(content, n), b)
  const { default: WebTorrent } = await import('webtorrent')
  const client: any = new WebTorrent({
    dht: false,
    tracker: false,
    lsd: false,
    utp: false,
    natUpnp: false,
    natPmp: false,
    webSeeds: false
  } as any)
  try {
    const t: any = await new Promise((r) => client.seed(content, { announce: [] }, r))
    await new Promise<void>((r) => (client.address() ? r() : client.once('listening', r)))
    const magnet = t.magnetURI + '&x.pe=127.0.0.1:' + client.address().port
    run = await launch()
    // What's left from before: one file complete, the other not there.
    mkdirSync(join(run.downloads, 'Pack'))
    writeFileSync(join(run.downloads, 'Pack', 'a.bin'), files['a.bin'])
    const info: any = await run.call('torrentInfo', { magnet })
    const match = await run.call('findDuplicate', magnet, undefined, {
      name: info.name,
      torrent: true
    })
    expect(match).toMatchObject({ kind: 'partial', name: 'Pack', resumable: true })
    await run.call('add', {
      url: magnet,
      torrent: { source: { magnet }, info },
      existing: 'continue'
    })
    const [done] = await run.until((l) => l[0]?.status === 'done', 60_000)
    expect(done.path).toBe(join(run.downloads, 'Pack'))
    expect(readdirSync(run.downloads)).toEqual(['Pack'])
    for (const [n, b] of Object.entries(files))
      expect(sha256(readFileSync(join(run.downloads, 'Pack', n)))).toBe(sha256(b))
  } finally {
    await new Promise((r) => client.destroy(r))
    rmSync(seedDir, { recursive: true, force: true })
  }
})

test('renaming a download: paused, while it runs, and once finished', async () => {
  run = await launch()
  const d = await run.call('add', { url: server.url('/game.iso') })
  await run.until((l) => l[0]?.received > 3_000_000)
  // While it runs: it lets go of its file, renames it and carries on.
  await run.call('rename', d.id, 'Game disc.iso')
  expect(existsSync(join(run.downloads, 'Game disc.iso.mascot-part'))).toBe(true)
  expect(existsSync(join(run.downloads, 'game.iso.mascot-part'))).toBe(false)
  await run.until((l) => l[0]?.status === 'running' && l[0].received > 8_000_000)
  await run.call('act', [d.id], 'pause')
  await run.until((l) => l[0]?.status === 'paused')
  await expect(run.call('rename', d.id, '')).rejects.toThrow(/Give it a name/)
  await run.call('rename', d.id, 'Game disc 1.iso')
  await run.call('act', [d.id], 'resume')
  const [done] = await run.until((l) => l[0]?.status === 'done', 60_000)
  expect(done.name).toBe('Game disc 1.iso')
  expect(sha256(readFileSync(done.path))).toBe(sha256(body))
  await run.call('rename', d.id, 'Final.iso')
  expect(readdirSync(run.downloads)).toEqual(['Final.iso'])
  expect(sha256(readFileSync(join(run.downloads, 'Final.iso')))).toBe(sha256(body))
})

test('in the window: the name can be changed when adding, and leftovers are offered to carry on', async () => {
  const { userData } = await partlyThenListLost()
  run = await launch({ userData })
  const { page } = run
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByLabel('Link or magnet').fill(server.url('/game.iso'))
  await expect(dialog.getByLabel('Save as')).toHaveValue('game.iso')
  await dialog.getByRole('button', { name: 'Add download' }).click()
  const question = page.getByRole('dialog', { name: 'Part of this is already here' })
  await expect(question).toBeVisible()
  await expect(question).toContainText('game.iso is partly downloaded')
  await question.getByRole('button', { name: 'Continue' }).click()
  const [d] = await run.until((l) => l.length === 1)
  expect(d.name).toBe('game.iso')
  expect(d.received).toBeGreaterThan(0)

  // A name of your own when adding.
  await page.getByRole('button', { name: 'Add download' }).first().click()
  await dialog.getByLabel('Link or magnet').fill(server.url('/report.pdf'))
  await expect(dialog.getByLabel('Save as')).toHaveValue('report.pdf')
  await dialog.getByLabel('Save as').fill('Annual report 2026.pdf')
  await dialog.getByRole('button', { name: 'Add download' }).click()
  const list = await run.until((l) => l.length === 2)
  expect(list.map((x) => x.name)).toContain('Annual report 2026.pdf')
})
