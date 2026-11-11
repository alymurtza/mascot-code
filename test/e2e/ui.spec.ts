import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomFile, sha256, startServer, type TestServer } from '../support/server'
import { launch, type Launched } from './app'

let server: TestServer
let run: Launched
test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
  await server.close()
})
test.afterEach(async () => {
  await run?.close()
})

const nav = (page: Page, name: string): Promise<void> =>
  page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name }).click()

async function addThroughDialog(
  page: Page,
  url: string,
  options: { checksum?: string; queue?: boolean } = {}
): Promise<void> {
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByLabel('Link or magnet').fill(url)
  if (options.checksum) await dialog.getByLabel(/Checksum/).fill(options.checksum)
  if (options.queue) await dialog.getByRole('button', { name: /Add to queue/ }).click()
  await dialog.getByRole('button', { name: 'Add download' }).click()
  await expect(dialog).toBeHidden()
}

test('adding a download through the window: it finishes, checksum checked, rows start collapsed', async () => {
  const body = randomFile(3 * 1024 * 1024)
  server.files.set('/ui/one.iso', { body })
  run = await launch()
  const { page } = run
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByLabel('Link or magnet').fill(server.url('/ui/one.iso'))
  await expect(dialog.getByLabel('Save as')).toHaveValue('one.iso')
  await expect(dialog.getByText('3.0 MB')).toBeVisible()
  await dialog.getByLabel(/Checksum/).fill('abc')
  await expect(dialog.getByText('That doesn’t look like')).toBeVisible()
  await dialog.getByLabel(/Checksum/).fill(sha256(body))
  await expect(dialog.getByText('Detected SHA-256.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Add download' }).click()
  const finished = page.getByRole('region', { name: 'Finished' })
  await expect(finished.getByText('one.iso')).toBeVisible({ timeout: 20_000 })
  await expect(finished.getByText('Checksum matches')).toBeVisible()
  const row = page.getByRole('article', { name: 'one.iso' })
  await expect(row.getByRole('button', { name: 'Expand one.iso' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await row.getByRole('button', { name: 'Expand one.iso' }).click()
  await expect(row.getByRole('button', { name: 'Open' })).toBeVisible()
  await expect(row.getByText('SHA-256 matches')).toBeVisible()
})

test('the same link again: "Already downloading" and Show it; another link to the same file joins as a backup', async () => {
  const body = randomFile(16 * 1024 * 1024)
  server.files.set('/ui/dup.bin', { body, rate: 30_000, etag: '"same"' })
  server.files.set('/ui/elsewhere/dup.bin', { body, rate: 30_000, etag: '"same"' })
  run = await launch()
  const { page } = run
  await addThroughDialog(page, server.url('/ui/dup.bin'))
  await expect(page.getByRole('region', { name: 'Downloading' }).getByText('dup.bin')).toBeVisible()
  await addThroughDialog(page, server.url('/ui/dup.bin')).catch(() => {})
  const already = page.getByRole('dialog', { name: 'Already downloading' })
  await expect(already).toBeVisible()
  await already.getByRole('button', { name: 'Show it' }).click()
  const row = page.getByRole('article', { name: 'dup.bin' })
  await expect(row.getByRole('list', { name: 'Links for dup.bin' })).toBeVisible()
  await addThroughDialog(page, server.url('/ui/elsewhere/dup.bin'))
  await expect(
    page.getByRole('status').filter({ hasText: 'Added as a backup link to dup.bin' })
  ).toBeVisible()
  await expect(
    row.getByRole('list', { name: 'Links for dup.bin' }).getByRole('listitem')
  ).toHaveCount(2)
  expect((await run.list()).length).toBe(1)
})

test('only the name and size match: Mascot asks, and "Different file" downloads it separately', async () => {
  const body = randomFile(8 * 1024 * 1024)
  server.files.set('/ui/a/maybe.bin', { body, rate: 30_000 })
  server.files.set('/ui/b/maybe.bin', { body: randomFile(8 * 1024 * 1024), rate: 30_000 })
  run = await launch()
  const { page } = run
  await addThroughDialog(page, server.url('/ui/a/maybe.bin'))
  await addThroughDialog(page, server.url('/ui/b/maybe.bin')).catch(() => {})
  const ask = page.getByRole('dialog', { name: 'Is this the same file?' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: /Different file/ }).click()
  await expect
    .poll(async () => (await run.list()).map((d) => d.name).sort())
    .toEqual(['maybe (2).bin', 'maybe.bin'])
})

test('many links at once, sorted into folders by type', async () => {
  for (const name of ['m1.zip', 'm2.mp4', 'm3.pdf'])
    server.files.set(`/ui/many/${name}`, { body: randomFile(200_000) })
  run = await launch()
  const { page } = run
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByRole('button', { name: 'Many links' }).click()
  await dialog
    .getByLabel('Paste links, one per line')
    .fill(
      ['m1.zip', 'm2.mp4', 'm3.pdf'].map((n) => server.url(`/ui/many/${n}`)).join('\n') +
        '\nnot a link'
    )
  await expect(dialog.getByText('3 links found')).toBeVisible()
  await dialog.getByRole('button', { name: 'Add 3 downloads' }).click()
  const list = await run.until((l) => l.length === 3 && l.every((d) => d.status === 'done'))
  const folders = Object.fromEntries(list.map((d) => [d.name, d.folder.split(/[\\/]/).pop()]))
  expect(folders).toEqual({ 'm1.zip': 'Archives', 'm2.mp4': 'Videos', 'm3.pdf': 'Documents' })
})

test('searching filters every section', async () => {
  for (const name of ['alpha.bin', 'beta.bin'])
    server.files.set(`/ui/s/${name}`, { body: randomFile(100_000) })
  run = await launch()
  const { page } = run
  await run.call('add', { url: server.url('/ui/s/alpha.bin') })
  await run.call('add', { url: server.url('/ui/s/beta.bin') })
  await run.until((l) => l.every((d) => d.status === 'done'))
  await page.getByLabel('Search all downloads').fill('alp')
  const finished = page.getByRole('region', { name: 'Finished' })
  await expect(finished.getByText('1 of 2')).toBeVisible()
  await expect(finished.getByText('beta.bin')).toBeHidden()
  await page.getByLabel('Search all downloads').fill('zzz')
  await expect(page.getByText('No download matches “zzz”.')).toBeVisible()
})

test('networks: switch off, Backup, the last Always network, rename, remove and add back', async () => {
  run = await launch()
  const { page } = run
  await nav(page, 'Networks')
  const wifi = page.getByRole('article', { name: 'Wi-Fi' })
  await wifi
    .getByRole('group', { name: 'When to use Wi-Fi' })
    .getByRole('button', { name: 'Backup' })
    .click()
  await expect(
    page.getByRole('region', { name: 'Backup' }).getByRole('article', { name: 'Wi-Fi' })
  ).toBeVisible()
  const eth = page.getByRole('article', { name: 'Ethernet' })
  // Marked unavailable, but clicking it says why.
  await eth
    .getByRole('group', { name: 'When to use Ethernet' })
    .getByRole('button', { name: 'Backup' })
    .dispatchEvent('click')
  await expect(eth.getByText('Keep at least one network on Always')).toBeVisible()
  await eth.getByRole('button', { name: 'Expand Ethernet' }).click()
  await eth.getByRole('button', { name: 'Name, colour & icon' }).click()
  await eth.getByLabel('Name').fill('Office cable')
  await eth.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('article', { name: 'Office cable' })).toBeVisible()
  await expect(page.getByLabel('Networks in use').getByText('Office cable')).toBeVisible()
  const backupWifi = page.getByRole('article', { name: 'Wi-Fi' })
  await backupWifi.getByRole('switch', { name: 'Use Wi-Fi for downloads' }).click()
  await expect(
    page.getByRole('region', { name: 'Not used' }).getByRole('article', { name: 'Wi-Fi' })
  ).toBeVisible()
  await backupWifi.getByRole('button', { name: 'Expand Wi-Fi' }).click()
  await backupWifi.getByRole('button', { name: 'Remove from this page' }).click()
  await expect(page.getByRole('article', { name: 'Wi-Fi' })).toBeHidden()
  await page.getByRole('button', { name: /device removed from this page/ }).click()
  const devices = page.getByRole('dialog', { name: 'All devices' })
  await devices
    .getByRole('article', { name: 'Wi-Fi' })
    .getByRole('button', { name: 'Add to Networks' })
    .click()
  await devices.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('article', { name: 'Wi-Fi' })).toBeVisible()
})

test('an unplugged network leaves the Networks page; All devices shows it as not connected', async () => {
  run = await launch()
  const { page } = run
  await nav(page, 'Networks')
  await expect(page.getByRole('article', { name: 'Wi-Fi' })).toBeVisible()
  await run.call('testSetAdapters', 'Ethernet=127.0.0.2:ethernet')
  await expect(page.getByRole('article', { name: 'Wi-Fi' })).toBeHidden()
  await page.getByRole('button', { name: /All devices/ }).click()
  const wifi = page
    .getByRole('dialog', { name: 'All devices' })
    .getByRole('article', { name: 'Wi-Fi' })
  await expect(wifi.getByText('Not connected')).toBeVisible()
  await wifi.getByRole('button', { name: 'Forget' }).click()
  await expect(wifi).toBeHidden()
})

test('themes: Cream dark at first, light and dark tabs, and the secret special themes', async () => {
  run = await launch()
  const { page } = run
  const token = (name: string) => (): Promise<string> =>
    page.evaluate(
      (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      name
    )
  const accent = token('--accent')
  const bg = token('--bg')
  const isDark = (): Promise<boolean> =>
    page.evaluate(() => document.documentElement.classList.contains('dark'))
  // Nothing chosen (a first install): Cream dark, whatever the system's light or dark setting.
  expect((await run.call('initial')).settings.palette).toBeUndefined()
  await expect.poll(accent).toBe('#eedab9')
  expect(await bg()).toBe('#14100d')
  expect(await isDark()).toBe(true)
  await nav(page, 'Settings')
  const tabs = page.getByRole('tablist', { name: 'Themes' })
  await expect(tabs.getByRole('tab')).toHaveText([/Light/, /Dark/])
  await expect(page.getByText('Mode', { exact: true })).toHaveCount(0)
  await tabs.getByRole('tab', { name: /Light/ }).click()
  await expect(page.getByRole('group', { name: 'Light themes' }).getByRole('button')).toHaveCount(
    10
  )
  await page
    .getByRole('group', { name: 'Light themes' })
    .getByRole('button', { name: 'Mint' })
    .click()
  await expect.poll(bg).toBe('#f0f6f6')
  expect(await isDark()).toBe(false)
  await tabs.getByRole('tab', { name: /Dark/ }).click()
  await page
    .getByRole('group', { name: 'Dark themes' })
    .getByRole('button', { name: 'Mint' })
    .click()
  await expect.poll(isDark).toBe(true)
  await expect.poll(accent).toBe('#00ae80')
  expect((await run.call('initial')).settings.palette).toBe('mint-dark')
  // A theme saved by an earlier version, with the mode that was set then.
  await run.call('updateSettings', { palette: 'graphite', mode: 'light' } as never)
  expect((await run.call('initial')).settings.palette).toBe('mint-light')
  // Special themes are hidden and can't be chosen until the secret keys unlock them.
  await run.call('updateSettings', { palette: 'aurora' })
  expect((await run.call('initial')).settings.palette).toBeUndefined()
  await page.locator('main').click({ position: { x: 5, y: 5 } })
  const secret = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
  for (const k of [...secret, 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k)
  await expect(page.getByRole('status')).toContainText('Special themes unlocked')
  expect((await run.call('initial')).settings.palette).toBe('aurora')
  await expect.poll(isDark).toBe(true)
  await expect(page.locator('.backdrop-page canvas')).toHaveCount(1)
  await tabs.getByRole('tab', { name: /Special/ }).click()
  const specials = page.getByRole('group', { name: 'Special themes' }).getByRole('button')
  await expect(specials).toHaveCount(15)
  await specials.filter({ hasText: 'Koi pond' }).click()
  await expect.poll(isDark).toBe(false)
  expect((await run.call('initial')).settings.palette).toBe('koi')
  // The keys again hide them, and a special theme in use goes back to Cream.
  await page.locator('main').click({ position: { x: 5, y: 5 } })
  for (const k of [...secret, 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k)
  await expect(page.getByRole('status')).toContainText('Special themes hidden again')
  expect((await run.call('initial')).settings.palette).toBeUndefined()
  await expect(page.locator('.backdrop-page')).toHaveCount(0)
  await expect(tabs.getByRole('tab')).toHaveCount(2)
})

test('queue: what is downloading shows too; run at once, reorder, and Download first swaps one in', async () => {
  for (const n of [1, 2, 3])
    server.files.set(`/ui/q/q${n}.bin`, { body: randomFile(4 * 1024 * 1024), rate: 20_000 })
  run = await launch()
  const { page } = run
  await run.call('updateSettings', { runAtOnce: 1 })
  for (const n of [1, 2, 3])
    await run.call('add', { url: server.url(`/ui/q/q${n}.bin`), when: 'queue' })
  await nav(page, 'Queue & schedule')
  const downloading = page.getByRole('region', { name: 'Downloading' })
  const queued = page.getByRole('region', { name: 'Queued' })
  await expect(downloading.getByRole('article')).toHaveCount(1)
  await expect(downloading.getByRole('article', { name: 'q1.bin' })).toBeVisible()
  await expect(queued.getByRole('article')).toHaveCount(2)
  await queued.getByRole('button', { name: 'Move q3.bin up' }).click()
  await expect(queued.getByRole('article').first()).toHaveAttribute('aria-label', 'q3.bin')
  await page.getByRole('button', { name: 'More at once' }).click()
  const running = async (): Promise<string[]> =>
    (await run.list())
      .filter((d) => d.status === 'running')
      .map((d) => d.name)
      .sort()
  await expect.poll(running).toEqual(['q1.bin', 'q3.bin'])
  await expect(downloading.getByRole('article')).toHaveCount(2)
  // Download first: q2 starts now; the one furthest back (q3) waits again, next in line.
  await queued
    .getByRole('article', { name: 'q2.bin' })
    .getByRole('button', { name: 'Download first' })
    .click()
  await expect.poll(running).toEqual(['q1.bin', 'q2.bin'])
  await expect(queued.getByRole('article')).toHaveCount(1)
  await expect(queued.getByRole('article', { name: 'q3.bin' })).toContainText('Starts next')
  await expect(downloading.getByRole('article', { name: 'q2.bin' })).toContainText('First')
  expect((await run.list()).find((d) => d.name === 'q3.bin')!.received).toBeGreaterThan(0)
})

test('pause and resume from the row; Ctrl-click selects rows for one action', async () => {
  for (const n of [1, 2])
    server.files.set(`/ui/p/p${n}.bin`, { body: randomFile(8 * 1024 * 1024), rate: 20_000 })
  run = await launch()
  const { page } = run
  await run.call('add', { url: server.url('/ui/p/p1.bin') })
  await run.call('add', { url: server.url('/ui/p/p2.bin') })
  await page.getByRole('button', { name: 'Pause p1.bin' }).click()
  await expect(page.getByRole('button', { name: 'Resume p1.bin' })).toBeVisible()
  await page.getByRole('button', { name: 'Resume p1.bin' }).click()
  await expect(page.getByRole('button', { name: 'Pause p1.bin' })).toBeVisible()
  await page
    .getByRole('article', { name: 'p1.bin' })
    .locator('.row')
    .click({ modifiers: ['Control'] })
  await page
    .getByRole('article', { name: 'p2.bin' })
    .locator('.row')
    .click({ modifiers: ['Control'] })
  const selection = page.getByRole('region', { name: 'Selection' })
  await expect(selection).toContainText('2 selected')
  await selection.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect
    .poll(async () => (await run.list()).map((d) => d.status))
    .toEqual(['paused', 'paused'])
})

test('a virtual adapter starts removed, can be added to the Networks page and removed again', async () => {
  run = await launch({ adapters: 'Ethernet=127.0.0.2:ethernet,vEthernet (WSL)=127.0.0.3:virtual' })
  const { page } = run
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('button', { name: 'Networks' })
    .click()
  const vm = page.getByRole('article', { name: 'vEthernet (WSL)' })
  await expect(vm).toBeHidden()
  const dialog = page.getByRole('dialog', { name: 'All devices' })
  const inDialog = dialog.getByRole('article', { name: 'vEthernet (WSL)' })
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: /All devices/ }).click()
    await inDialog.getByRole('button', { name: 'Add to Networks' }).click()
    await expect(inDialog.getByRole('button', { name: 'Remove' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(vm).toBeVisible()
    await vm.click()
    await vm.getByRole('button', { name: 'Remove from this page' }).click()
    await expect(vm).toBeHidden()
  }
  // Only virtual adapters: they still start removed.
  await run.call('testSetAdapters', 'Hyper-V=127.0.0.4:virtual')
  await expect(page.getByRole('article', { name: 'Hyper-V' })).toBeHidden()
})

test('Ctrl+V outside a text field adds the copied link', async () => {
  run = await launch()
  const { page } = run
  await run.call('copyText', 'https://example.com/file.zip')
  await page.locator('main').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+v')
  await expect(page.getByRole('dialog', { name: 'Add download' })).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Add download' }).locator('textarea, input').first()
  ).toHaveValue(/example\.com\/file\.zip/)
})

test('the network row previews the icon, colour and name while editing', async () => {
  run = await launch({ adapters: 'Ethernet=127.0.0.2:ethernet' })
  const { page } = run
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('button', { name: 'Networks' })
    .click()
  const eth = page.getByRole('article', { name: 'Ethernet' })
  await eth.click()
  await eth.getByRole('button', { name: 'Name, colour & icon' }).click()
  const tile = eth.locator('.net-tile')
  const before = await tile.innerHTML()
  await eth.getByRole('button', { name: 'Satellite' }).click()
  await expect.poll(() => tile.innerHTML()).not.toBe(before)
  await eth.getByLabel('Name').fill('Office line')
  await expect(eth.locator('.row .name')).toContainText('Office line')
  await eth.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => tile.innerHTML()).toBe(before)
})

test('a finished download’s checksum can be added from its row and is checked', async () => {
  const body = randomFile(1024 * 1024)
  server.files.set('/ui/sum.bin', { body })
  run = await launch()
  const { page } = run
  await run.call('add', { url: server.url('/ui/sum.bin') })
  await run.until((l) => l[0].status === 'done')
  const row = page.getByRole('article', { name: 'sum.bin' })
  await expect(row).toContainText('Not verified')
  await row.click()
  await row.getByRole('button', { name: 'Add' }).click()
  await row.getByLabel('Checksum').fill('zz')
  await expect(row).toContainText('doesn’t look like')
  await row.getByLabel('Checksum').fill(sha256(body))
  await row.getByRole('button', { name: 'Check file' }).click()
  await expect(row).toContainText('Checksum matches')
})

test('adding a file that is already in the folder asks first; Download again keeps both', async () => {
  server.files.set('/ui/twice.zip', { body: randomFile(256 * 1024) })
  run = await launch()
  const { page } = run
  const url = server.url('/ui/twice.zip')
  const first = await run.call('add', { url })
  await run.until((l) => l[0].status === 'done')
  await run.call('act', [first.id], 'remove')
  await run.until((l) => l.length === 0)
  const add = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Add download' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add download' })
    await dialog.getByLabel('Link or magnet').fill(url)
    await expect(dialog.getByLabel('Save as')).toHaveValue('twice.zip')
    await dialog.getByRole('button', { name: 'Add download' }).click()
  }
  await add()
  const ask = page.getByRole('dialog', { name: 'This file is already there' })
  await expect(ask).toContainText('twice.zip')
  await expect(ask.locator('.sheet-foot button')).toHaveText([
    'Show in folder',
    'Skip',
    'Download again'
  ])
  await ask.getByRole('button', { name: 'Skip' }).click()
  await expect(ask).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Add download' })).toBeHidden()
  expect(await run.list()).toEqual([])
  await add()
  await ask.getByRole('button', { name: 'Download again' }).click()
  const [again] = await run.until((l) => l.length === 1 && l[0].status === 'done')
  expect(again.name).toBe('twice (2).zip')
})

test('many links: all checked first (trying again when a server stumbles); duplicates can be skipped for the rest; ones that fail stay to try again', async () => {
  const names = ['a.bin', 'b.bin', 'c.bin', 'd.bin', 'e.bin', 'f.bin']
  for (const n of names) server.files.set(`/ui/six/${n}`, { body: randomFile(200_000) })
  // b and c stumble once; f never answers well.
  server.files.get('/ui/six/b.bin')!.failWith = { status: 503, times: 1 }
  server.files.get('/ui/six/c.bin')!.failWith = { status: 503, times: 1 }
  server.files.get('/ui/six/f.bin')!.failWith = { status: 503, times: Infinity }
  run = await launch()
  const { page } = run
  // a and d are already downloaded.
  for (const n of ['a.bin', 'd.bin']) await run.call('add', { url: server.url(`/ui/six/${n}`) })
  await run.until((l) => l.length === 2 && l.every((d) => d.status === 'done'))
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByRole('button', { name: 'Many links' }).click()
  await dialog
    .getByLabel('Paste links, one per line')
    .fill(names.map((n) => server.url(`/ui/six/${n}`)).join('\n'))
  await dialog.getByRole('button', { name: 'Add 6 downloads' }).click()
  // The window closes at once; a panel in the corner carries on.
  await expect(dialog).toBeHidden()
  const panel = page.getByRole('region', { name: 'Adding links' })
  const ask = panel.getByRole('group', { name: 'You already downloaded this' })
  await expect(ask).toContainText('a.bin', { timeout: 20_000 })
  // The others don't wait for the answer: b, c and e are added meanwhile, and d waits its turn.
  await run.until((l) => l.length === 5)
  await expect(ask).toContainText('1 more waiting')
  await ask.getByLabel('Do the same for the rest').check()
  await ask.getByRole('button', { name: 'Skip' }).click()
  // d is skipped without asking again; b, c and e are added; f stays in the panel.
  await expect(panel).toContainText('This link couldn’t be added', { timeout: 30_000 })
  await expect(panel.getByRole('listitem').filter({ hasText: 'f.bin' })).toContainText(
    /503|server/i
  )
  const list = await run.until((l) => l.length === 5 && l.every((d) => d.status === 'done'))
  expect(list.map((d) => d.name).sort()).toEqual(['a.bin', 'b.bin', 'c.bin', 'd.bin', 'e.bin'])
  // The failed link can be copied.
  await panel.getByRole('button', { name: 'Copy failed link' }).click()
  await expect
    .poll(() => run.app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(server.url('/ui/six/f.bin'))
  // Fixed on the server: Retry adds it, to the same group as the others added with it.
  server.files.get('/ui/six/f.bin')!.failWith = undefined
  await panel.getByRole('button', { name: 'Retry' }).click()
  const all = await run.until((l) => l.length === 6)
  // Nothing failed now: the panel goes by itself.
  await expect(panel).toBeHidden({ timeout: 10_000 })
  const groupOf = (n: string): string | undefined => all.find((d) => d.name === n)?.group?.id
  expect(groupOf('f.bin')).toBeDefined()
  expect(groupOf('f.bin')).toBe(groupOf('b.bin'))
  expect(groupOf('e.bin')).toBe(groupOf('b.bin'))
})

test('rules: made in Settings, they choose the folder and name for one link and for many; order and delete count', async () => {
  for (const name of ['disk.iso', 'clip.mp4', 'other.bin', 'disk2.iso'])
    server.files.set(`/ui/rules/${name}`, { body: randomFile(100_000) })
  run = await launch()
  const { page } = run
  const videos = join(run.userData, 'Clips')
  await nav(page, 'Settings')
  const card = page.locator('.card', { hasText: 'Folder & name rules' })
  await expect(card).toContainText('No rules.')
  // A rule made in the window: .iso files renamed.
  await card.getByRole('button', { name: 'Add rule' }).click()
  await card.getByRole('button', { name: 'File ends in' }).click()
  await card.getByLabel('Extensions').fill('.ISO')
  await card.getByLabel('Rename pattern').fill('{name}-copy.{ext}')
  await card.getByRole('button', { name: 'Save rule' }).click()
  await expect(card).toContainText('File ends in .ISO')
  await expect(card).toContainText('rename to “{name}-copy.{ext}”')
  // Another, for videos, to its own folder.
  const rules = (await run.call('initial')).settings.rules
  await run.call('updateSettings', {
    rules: [...rules, { id: 'v', match: 'type', value: 'Videos', folder: videos }]
  })
  await expect(card).toContainText('File is a video')
  // One link: the rule is shown, and used.
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByLabel('Link or magnet').fill(server.url('/ui/rules/disk.iso'))
  await expect(dialog.getByText('Set by your rule “File ends in .ISO')).toBeVisible()
  await dialog.getByRole('button', { name: 'Add download' }).click()
  await run.until((l) => l.some((d) => d.name === 'disk-copy.iso' && d.status === 'done'))
  // Many links: each by its own rule; no rule, the usual folder.
  await page.getByRole('button', { name: 'Add download' }).first().click()
  await dialog.getByRole('button', { name: 'Many links' }).click()
  await dialog
    .getByLabel('Paste links, one per line')
    .fill(['clip.mp4', 'other.bin'].map((n) => server.url(`/ui/rules/${n}`)).join('\n'))
  await dialog.getByRole('button', { name: 'Add 2 downloads' }).click()
  const list = await run.until((l) => l.length === 3 && l.every((d) => d.status === 'done'))
  const where = Object.fromEntries(list.map((d) => [d.name, d.folder]))
  expect(where['clip.mp4']).toBe(videos)
  expect(where['other.bin']).toBe(join(run.userData, 'Downloads'))
  expect(existsSync(join(videos, 'clip.mp4'))).toBe(true)
  // Deleted: .iso files keep their own name again.
  await card
    .locator('.rule', { hasText: 'File ends in .ISO' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(card).not.toContainText('File ends in .ISO')
  await run.call('add', {
    url: server.url('/ui/rules/disk2.iso'),
    info: await run.call('checkLink', server.url('/ui/rules/disk2.iso'))
  })
  await run.until((l) => l.some((d) => d.name === 'disk2.iso'))
})

test('Settings shows this version and the update choices', async () => {
  run = await launch()
  const { page } = run
  await nav(page, 'Settings')
  const card = page.locator('.card', { hasText: 'Updates' })
  await expect(card).toContainText(`Mascot ${(await run.call('initial')).version}`)
  // Tests run the app from source: updates only work in the installed app.
  await expect(card.locator('.update-line')).toHaveText('Updates work in the installed app.')
  await expect(card.getByRole('button', { name: 'Check for updates' })).toBeDisabled()
  await expect(card.getByRole('button', { name: 'Open-source licences' })).toBeVisible()
  const auto = card.getByRole('switch', { name: 'Download updates by itself' })
  await expect(auto).toHaveAttribute('aria-checked', 'true')
  await auto.click()
  await expect.poll(async () => (await run.call('initial')).settings.autoUpdate).toBe(false)
})

test('Mascot offers the browser extension once; Settings offers it while it isn’t connected', async () => {
  run = await launch({ env: { MASCOT_TEST_OFFER_EXTENSION: '1' } })
  const { page } = run
  const banner = page.getByRole('region', { name: 'Browser extension' })
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Not now' }).click()
  await expect(banner).toBeHidden()
  expect((await run.call('initial')).settings.extensionOffered).toBe(true)
  await nav(page, 'Settings')
  await expect(page.getByRole('button', { name: 'Add to browser' })).toBeVisible()
  // Not offered again after a restart.
  const userData = run.userData
  await run.app.close()
  run = await launch({ userData, env: { MASCOT_TEST_OFFER_EXTENSION: '1' } })
  await expect(run.page.getByRole('heading', { name: 'Downloads' })).toBeVisible()
  await expect(run.page.getByRole('region', { name: 'Browser extension' })).toBeHidden()
})

test('many links go in as one group with progress shown; the group pauses, resumes and deletes as one', async () => {
  const names = ['project-a.zip', 'project-b.zip', 'project-c.zip']
  for (const name of names)
    server.files.set(`/ui/grp/${name}`, {
      body: randomFile(400_000),
      rate: 40_000,
      delayMs: name === 'project-c.zip' ? 5000 : 0
    })
  run = await launch()
  const { page } = run
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByRole('button', { name: 'Many links' }).click()
  await dialog
    .getByLabel('Paste links, one per line')
    .fill(names.map((n) => server.url(`/ui/grp/${n}`)).join('\n'))
  await expect(dialog.getByRole('switch', { name: 'Add as one group' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  const groupName = dialog.getByLabel('Group name')
  await expect(groupName).toHaveAttribute('placeholder', 'project')
  await groupName.fill('Project files')
  await dialog.getByRole('button', { name: 'Add 3 downloads' }).click()
  await expect(dialog).toBeHidden()
  // Progress shows in the panel; it shrinks to a pill and opens again.
  const panel = page.getByRole('region', { name: 'Adding links' })
  await expect(panel.getByRole('status')).toContainText(/Checking links: \d of 3/)
  await panel.getByRole('button', { name: 'Minimise' }).click()
  const pill = page.getByRole('button', { name: 'Show links being added' })
  await expect(pill).toContainText(/Adding links \d of 3/)
  await pill.click()
  await expect(panel).toBeVisible()
  const list = await run.until((l) => l.length === 3)
  expect(new Set(list.map((d) => d.group?.id)).size).toBe(1)
  expect(list[0].group?.name).toBe('Project files')

  const group = page.getByRole('article', { name: 'Project files (group)' })
  await expect(group).toContainText('3 files')
  // Pause and resume the whole group with one click.
  await run.until((l) => l.some((d) => d.status === 'running'))
  await group.getByRole('button', { name: 'Pause Project files' }).click()
  await run.until((l) => l.every((d) => d.status === 'paused' || d.status === 'done'))
  await group.getByRole('button', { name: 'Resume Project files' }).click()
  await run.until((l) => l.some((d) => d.status === 'running' || d.status === 'queued'))
  // Its downloads open inside it.
  await group.getByRole('button', { name: 'Expand Project files' }).click()
  for (const n of names) await expect(group.getByRole('article', { name: n })).toBeVisible()
  // Delete the group: everything in it goes.
  await group.getByRole('button', { name: 'Delete group…' }).click()
  const ask = page.getByRole('dialog', { name: 'Delete 3 downloads?' })
  await ask.getByRole('button', { name: 'Delete' }).click()
  await run.until((l) => l.length === 0)
})

test('Select: several downloads go in a group, pause together, come out of it, and delete together', async () => {
  for (const name of ['s1.bin', 's2.bin', 's3.bin'])
    server.files.set(`/ui/sel/${name}`, { body: randomFile(2_000_000), rate: 10_000 })
  run = await launch()
  const { page } = run
  await run.call('updateSettings', { runAtOnce: 3 })
  for (const name of ['s1.bin', 's2.bin', 's3.bin'])
    await run.call('add', { url: server.url(`/ui/sel/${name}`) })
  await run.until((l) => l.length === 3 && l.every((d) => d.status === 'running'))
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Select s1.bin' }).check()
  await page.getByRole('checkbox', { name: 'Select s2.bin' }).check()
  const bar = page.getByRole('region', { name: 'Selection' })
  await expect(bar).toContainText('2 selected')
  await bar.getByRole('button', { name: 'Add to group…' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add 2 downloads to a group' })
  await sheet.getByLabel('Group name').fill('Docs')
  await sheet.getByRole('button', { name: 'Add to group' }).click()
  const group = page.getByRole('article', { name: 'Docs (group)' })
  await expect(group).toContainText('2 files')
  // Pause the selection (the group's box selects all of it).
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await group.getByRole('checkbox', { name: 'Select Docs' }).check()
  await expect(bar).toContainText('2 selected')
  await bar.getByRole('button', { name: 'Pause', exact: true }).click()
  await run.until((l) =>
    l.filter((d) => d.group).every((d) => d.status === 'paused' || d.status === 'done')
  )
  await bar.getByRole('button', { name: 'Start', exact: true }).click()
  await run.until((l) => l.filter((d) => d.group).some((d) => d.status !== 'paused'))
  await bar.getByRole('button', { name: 'Take out of group' }).click()
  await run.until((l) => l.every((d) => !d.group))
  // Delete everything selected at once.
  await bar.getByRole('button', { name: 'Select all' }).click()
  await expect(bar).toContainText('3 selected')
  await bar.getByRole('button', { name: 'Delete…' }).click()
  // Unfinished: they stop and what they downloaded goes.
  await page
    .getByRole('dialog', { name: 'Delete 3 downloads?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await run.until((l) => l.length === 0)
})

test('Run at once takes any number, typed or with − and +, and can be turned off', async () => {
  for (let i = 1; i <= 5; i++)
    server.files.set(`/ui/ra/${i}.bin`, { body: randomFile(400_000), rate: 20_000 })
  run = await launch()
  const { page } = run
  await nav(page, 'Queue & schedule')
  const box = page.getByLabel('Run at once', { exact: true })
  await box.fill('100')
  await box.press('Enter')
  await expect.poll(async () => (await run.call('initial')).settings.runAtOnce).toBe(100)
  await box.fill('1')
  await box.press('Enter')
  await page.getByRole('button', { name: 'More at once' }).click()
  await expect(box).toHaveValue('2')
  await page.getByRole('button', { name: 'Fewer at once' }).click()
  await expect(box).toHaveValue('1')
  for (let i = 1; i <= 5; i++)
    await run.call('add', { url: server.url(`/ui/ra/${i}.bin`), when: 'queue' })
  await run.until((l) => l.filter((d) => d.status === 'running').length === 1)
  // No limit: everything starts.
  await page.getByRole('switch', { name: 'No limit' }).click()
  await expect(box).toBeHidden()
  await run.until((l) => l.filter((d) => d.status === 'running').length === 5)
})

test('Retry all retries every failed download at once', async () => {
  const names = ['r1.bin', 'r2.bin']
  const bodies = names.map(() => randomFile(1024 * 1024))
  names.forEach((n, i) => server.files.set(`/ui/r/${n}`, { body: bodies[i], rate: 100_000 }))
  run = await launch({ env: { MASCOT_TEST_GIVE_UP_MS: '1500' } })
  const { page } = run
  const ids: string[] = []
  for (const n of names) ids.push((await run.call('add', { url: server.url(`/ui/r/${n}`) })).id)
  await run.until((l) => l.every((d) => d.status === 'running'))
  for (const n of names) server.files.delete(`/ui/r/${n}`)
  await run.call('act', ids, 'pause')
  await run.call('act', ids, 'resume')
  await run.until((l) => l.every((d) => d.status === 'failed'))
  // Back on the server: one click retries both.
  names.forEach((n, i) => server.files.set(`/ui/r/${n}`, { body: bodies[i] }))
  await page
    .getByRole('region', { name: 'Needs attention' })
    .getByRole('button', { name: 'Retry all' })
    .click()
  await run.until((l) => l.every((d) => d.status === 'done'))
})

test('Retry shows it is retrying, and says so when the download fails again', async () => {
  const body = randomFile(1024 * 1024)
  server.files.set('/ui/again.bin', { body, rate: 100_000 })
  run = await launch({ env: { MASCOT_TEST_GIVE_UP_MS: '1500' } })
  const { page } = run
  const d = await run.call('add', { url: server.url('/ui/again.bin') })
  await run.until((l) => l[0].status === 'running')
  server.files.delete('/ui/again.bin')
  await run.call('act', [d.id], 'pause')
  await run.call('act', [d.id], 'resume')
  await run.until((l) => l[0].status === 'failed')
  const row = page.getByRole('article', { name: 'again.bin' })
  // Still missing on the server: Retry shows it's trying, then that it failed again.
  await row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Retrying…' })).toBeVisible()
  await expect(page.locator('.toast')).toContainText('again.bin failed again', {
    timeout: 20_000
  })
  await expect(row.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
  // Back on the server: Retry gets it.
  server.files.set('/ui/again.bin', { body })
  await row.getByRole('button', { name: 'Retry', exact: true }).click()
  await run.until((l) => l[0].status === 'done')
})

for (const [found, says] of [
  ['current', /You have the latest version \(\d+\.\d+\.\d+\)\./],
  ['available', 'Mascot 9.9.9 is available.'],
  ['error', 'Couldn’t check for updates. Check your internet connection and try again.']
] as const) {
  test(`Check for updates shows it's checking, then says what it found (${found})`, async () => {
    run = await launch({ env: { MASCOT_TEST_UPDATES: found } })
    const { page } = run
    await nav(page, 'Settings')
    const card = page.locator('.card', { hasText: 'Updates' })
    await card.getByRole('button', { name: 'Check for updates' }).click()
    await expect(card.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    await expect(page.locator('.toast')).toHaveText(says)
    if (found === 'current') await expect(card.locator('.update-line')).toContainText('Checked at')
    if (found === 'available')
      await expect(card.getByRole('button', { name: 'Download update' })).toBeVisible()
    else await expect(card.getByRole('button', { name: 'Check for updates' })).toBeEnabled()
  })
}

test('rules: a Torrents rule chooses the folder for a magnet link; a name rule is made in Settings', async () => {
  server.files.set('/ui/nr/Show.S01E02.mkv', { body: randomFile(100_000) })
  // Browse… in the rule picks this folder.
  const shows = mkdtempSync(join(tmpdir(), 'mascot-shows-'))
  run = await launch({ env: { MASCOT_TEST_CHOOSE_FOLDER: shows } })
  const { page } = run
  const torrents = join(run.userData, 'My torrents')
  await run.call('updateSettings', {
    rules: [{ id: 't', match: 'type', value: 'Torrents', folder: torrents }]
  })
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog
    .getByLabel('Link or magnet')
    .fill('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Some+Show')
  await expect(dialog.getByText('Set by your rule “File is a torrent')).toBeVisible()
  await expect(dialog.getByLabel('Save to')).toHaveValue(/My torrents$/)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  // A rule on the name, made in Settings.
  await nav(page, 'Settings')
  const card = page.locator('.card', { hasText: 'Folder & name rules' })
  await card.getByRole('button', { name: 'Add rule' }).click()
  await card.getByRole('button', { name: 'Name contains' }).click()
  await card.getByLabel('Name', { exact: true }).fill('S01E')
  await card.getByRole('button', { name: 'Browse…' }).click()
  await expect(card.getByLabel('Folder', { exact: true })).toHaveValue(shows)
  await card.getByRole('button', { name: 'Save rule' }).click()
  await expect(card).toContainText('Name contains “S01E”')
  await page.getByRole('button', { name: 'Add download' }).first().click()
  await dialog.getByLabel('Link or magnet').fill(server.url('/ui/nr/Show.S01E02.mkv'))
  await expect(dialog.getByText('Set by your rule “Name contains “S01E”')).toBeVisible()
  await dialog.getByRole('button', { name: 'Add download' }).click()
  const [d] = await run.until((l) => l.length === 1 && l[0].status === 'done')
  expect(d.folder).toBe(shows)
  rmSync(shows, { recursive: true, force: true })
})

test('someone who chose Copper (an earlier theme) gets Cream, light or dark as they had it', async () => {
  run = await launch()
  const userData = run.userData
  await run.app.close()
  const file = join(userData, 'settings.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...saved, palette: 'copper-dark' }))
  run = await launch({ userData })
  expect((await run.call('initial')).settings.palette).toBe('cream-dark')
})
