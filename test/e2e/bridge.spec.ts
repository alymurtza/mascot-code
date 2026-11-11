import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { randomFile, startServer, type TestServer } from '../support/server'
import { launch, type Launched } from './app'
import { bridgePortsFree } from '../support/ports'

// The extension's API, inside its service worker (code run there by sw.evaluate).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

let server: TestServer
let run: Launched
test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
  await run?.close()
  await server.close()
})

const bridge = 'http://127.0.0.1:19400'

test.beforeAll(bridgePortsFree)

test('the browser extension hands a download over, with the page’s cookies; web pages are refused', async () => {
  server.files.set('/members/file.zip', { body: randomFile(500_000) })
  run = await launch({ env: { MASCOT_TEST_BRIDGE: '1' } })
  const ext = 'chrome-extension://abcdefghijklmnop'
  await expect
    .poll(() =>
      fetch(`${bridge}/hello`, { headers: { origin: ext } })
        .then((r) => r.status)
        .catch(() => 0)
    )
    .toBe(200)
  const hello = await (await fetch(`${bridge}/hello`, { headers: { origin: ext } })).json()
  expect(hello.app).toBe('mascot-downloader')
  const page = await fetch(`${bridge}/download`, {
    method: 'POST',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ url: server.url('/members/file.zip') })
  })
  expect(page.status).toBe(403)
  const form = await fetch(`${bridge}/download`, {
    method: 'POST',
    headers: { origin: ext, 'content-type': 'text/plain' },
    body: JSON.stringify({ url: server.url('/members/file.zip') })
  })
  expect(form.status).toBe(415)
  const ok = await fetch(`${bridge}/download`, {
    method: 'POST',
    headers: { origin: ext, 'content-type': 'application/json' },
    body: JSON.stringify({
      url: server.url('/members/file.zip'),
      cookies: 'session=abc',
      referrer: 'https://site.test/page'
    })
  })
  expect(ok.status).toBe(200)
  const dialog = run.page.getByRole('dialog', { name: 'Add download' })
  await expect(dialog.getByLabel('Link or magnet')).toHaveValue(server.url('/members/file.zip'))
  await expect(dialog.getByLabel('Save as')).toHaveValue('file.zip')
  await expect(dialog.getByText('488 KB')).toBeVisible()
  await dialog.getByRole('button', { name: 'Add download' }).click()
  await run.until((l) => l[0]?.status === 'done')
  const hits = server.hits.filter((h) => h.path === '/members/file.zip')
  expect(hits.length).toBeGreaterThan(0)
  expect(
    hits.every((h) => h.cookie === 'session=abc' && h.referer === 'https://site.test/page')
  ).toBe(true)
})

/** Mascot (with its native host registered) and Playwright's Chromium with the extension. */
async function withExtension(browserEnv: Record<string, string> = {}): Promise<{
  ctx: BrowserContext
  xdg: string
  profile: string
  env: Record<string, string>
}> {
  // The browsers' config folder, here a fresh one: Mascot registers its host in Chromium's.
  const xdg = mkdtempSync(join(tmpdir(), 'mascot-xdg-'))
  mkdirSync(join(xdg, 'chromium'), { recursive: true })
  const env = { MASCOT_TEST_BRIDGE: '1', MASCOT_TEST_NATIVE: '1', XDG_CONFIG_HOME: xdg }
  run = await launch({ env })
  const manifest = join(xdg, 'chromium', 'NativeMessagingHosts', 'com.mascot.downloader.json')
  await expect.poll(() => existsSync(manifest)).toBe(true)
  const origins = JSON.parse(readFileSync(manifest, 'utf8')).allowed_origins
  expect(origins).toContain('chrome-extension://jkjflpeecjefphglhhidnmmgklhkicja/')
  // The Chrome Web Store copy.
  expect(origins).toContain('chrome-extension://jdbajgaajkoafbdfgnldbfmloclfgnjg/')
  // Playwright's browser (Chrome for Testing) runs on a profile folder of its own, and looks for
  // hosts inside it.
  const profile = mkdtempSync(join(tmpdir(), 'mascot-chromium-'))
  mkdirSync(join(profile, 'NativeMessagingHosts'))
  copyFileSync(manifest, join(profile, 'NativeMessagingHosts', 'com.mascot.downloader.json'))
  const ext = join(__dirname, '../../extension/dist/chrome')
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    env: { ...process.env, XDG_CONFIG_HOME: xdg, ...browserEnv } as Record<string, string>
  })
  return { ctx, xdg, profile, env }
}

// Needs Playwright's Chromium (npx playwright install chromium).
test('the extension reaches Mascot through its native host; downloads wait while it’s closed and go over when it opens (Chromium)', async () => {
  test.setTimeout(90_000)
  // One app at a time on the extension's port.
  await run?.close()
  const { ctx, xdg, profile, env } = await withExtension()
  try {
    let [sw] = ctx.serviceWorkers()
    if (!sw) sw = await ctx.waitForEvent('serviceworker')
    // The ID fixed by the extension's key, which the host allows.
    expect(sw.url().split('/')[2]).toBe('jkjflpeecjefphglhhidnmmgklhkicja')
    const viaHost = await sw.evaluate(() =>
      chrome.runtime.sendNativeMessage('com.mascot.downloader', { type: 'hello' })
    )
    expect(viaHost).toMatchObject({ running: true })
    const popup = await ctx.newPage()
    const openPopup = (): Promise<unknown> =>
      popup.goto('chrome-extension://jkjflpeecjefphglhhidnmmgklhkicja/popup.html')
    await openPopup()
    await expect(popup.getByText('Connected')).toBeVisible()
    await expect(popup.getByRole('button', { name: 'Wait for it' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    // Mascot closes; a download started in the browser waits for it.
    const userData = run.userData
    await run.app.close()
    server.files.set('/ext/wait.bin', { body: randomFile(300_000) })
    const url = server.url('/ext/wait.bin')
    await sw.evaluate((u) => chrome.downloads.download({ url: u }), url)
    const waiting = (): Promise<number> =>
      sw.evaluate(async () => ((await chrome.storage.local.get('waiting')).waiting ?? []).length)
    await expect.poll(waiting, { timeout: 20_000 }).toBe(1)
    await openPopup()
    await expect(popup.getByText('Waiting for Mascot')).toBeVisible()
    await expect(popup.getByText('wait.bin')).toBeVisible()
    // The browser didn't keep it.
    const inBrowser = await sw.evaluate(async () => (await chrome.downloads.search({})).length)
    expect(inBrowser).toBe(0)
    // Mascot opens again: the waiting download goes over (it opens in Add download).
    run = await launch({ userData, env })
    await openPopup()
    await expect(popup.getByText('Connected')).toBeVisible({ timeout: 20_000 })
    await expect.poll(waiting).toBe(0)
    await expect(
      run.page.getByRole('dialog', { name: 'Add download' }).getByLabel('Link or magnet')
    ).toHaveValue(url)
  } finally {
    await ctx.close()
    rmSync(xdg, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
  }
})

test('a download a page starts by itself goes to Mascot, even a quick one while Mascot is slow to answer (Chromium)', async () => {
  test.setTimeout(90_000)
  await run?.close()
  // Mascot's host answers 3 s late (a slow computer): the download could finish meanwhile.
  const { ctx, xdg, profile } = await withExtension({ MASCOT_TEST_HOST_DELAY_MS: '3000' })
  try {
    let [sw] = ctx.serviceWorkers()
    if (!sw) sw = await ctx.waitForEvent('serviceworker')
    // Small and fast: the browser could finish it before Mascot was asked.
    server.files.set('/ext/auto.zip', {
      body: randomFile(200_000),
      disposition: 'attachment; filename="auto.zip"'
    })
    const url = server.url('/ext/auto.zip')
    const page = await ctx.newPage()
    await page.setContent(`<a id="go" href="${url}">get</a>`)
    // The page starts the download by itself (it may close as it does).
    await page.evaluate(() => document.getElementById('go')!.click()).catch(() => {})
    await expect(
      run.page.getByRole('dialog', { name: 'Add download' }).getByLabel('Link or magnet')
    ).toHaveValue(url, {
      timeout: 20_000
    })
    // The browser let it go rather than keeping a copy.
    const kept = await sw.evaluate(
      async () =>
        (await chrome.downloads.search({})).filter((d: { state: string }) => d.state === 'complete')
          .length
    )
    expect(kept).toBe(0)
  } finally {
    await ctx.close()
    rmSync(xdg, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
  }
})

test('every file goes to Mascot unless “Leave small files to the browser” is on', async () => {
  await run?.close()
  run = await launch({ env: { MASCOT_TEST_BRIDGE: '1' } })
  const ext = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
  const minBytes = async (): Promise<number> =>
    (await (await fetch(`${bridge}/hello`, { headers: { origin: ext } })).json()).minBytes
  await expect.poll(minBytes).toBe(0)
  const { page } = run
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('button', { name: 'Settings' })
    .click()
  const card = page.locator('.card', { hasText: 'Browser extension' })
  await expect(card.getByLabel('Minimum size in MB')).toHaveCount(0)
  await card.getByRole('switch', { name: 'Leave small files to the browser' }).click()
  await expect.poll(minBytes).toBe(5 * 1024 * 1024)
  await card.getByLabel('Minimum size in MB').fill('20')
  await card.getByLabel('Minimum size in MB').blur()
  await expect.poll(minBytes).toBe(20 * 1024 * 1024)
  await card.getByRole('switch', { name: 'Leave small files to the browser' }).click()
  await expect.poll(minBytes).toBe(0)
})

test('right-click "Download with Mascot" on a magnet link opens it in Mascot (Chromium)', async () => {
  test.setTimeout(90_000)
  await run?.close()
  const { ctx, xdg, profile } = await withExtension()
  try {
    let [sw] = ctx.serviceWorkers()
    if (!sw) sw = await ctx.waitForEvent('serviceworker')
    const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Big+Buck+Bunny'
    // What the menu runs (a test can't click the browser's own menu).
    const sent = await sw.evaluate(
      (m) =>
        (
          globalThis as unknown as { sendLink: (u: string, p: string) => Promise<boolean> }
        ).sendLink(m, 'https://example.org/torrents'),
      magnet
    )
    expect(sent).toBe(true)
    await expect(
      run.page.getByRole('dialog', { name: 'Add download' }).getByLabel('Link or magnet')
    ).toHaveValue(magnet, { timeout: 20_000 })
    // Mascot closed: it waits, named from the magnet; sent twice, it waits once.
    await run.app.close()
    for (let i = 0; i < 2; i++)
      await sw.evaluate(
        (m) =>
          (
            globalThis as unknown as { sendLink: (u: string, p: string) => Promise<boolean> }
          ).sendLink(m, 'https://example.org/torrents'),
        magnet
      )
    await sw.evaluate(
      (m) =>
        (
          globalThis as unknown as { sendLink: (u: string, p: string) => Promise<boolean> }
        ).sendLink(m, 'https://example.org/torrents'),
      magnet
    )
    const waiting = await sw.evaluate(async () =>
      ((await chrome.storage.local.get('waiting')).waiting ?? []).map(
        (w: { name: string }) => w.name
      )
    )
    expect(waiting).toEqual(['Big Buck Bunny'])
  } finally {
    await ctx.close()
    rmSync(xdg, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
  }
})

test('several downloads from the browser while the window is open: they wait their turn; hidden, they wait in a panel that lasts when Mascot closes', async () => {
  test.setTimeout(120_000)
  await run?.close()
  const names = ['one.zip', 'two.zip', 'three.zip', 'four.zip']
  for (const n of names) server.files.set(`/many/${n}`, { body: randomFile(200_000) })
  run = await launch({ env: { MASCOT_TEST_BRIDGE: '1' } })
  const ext = 'chrome-extension://abcdefghijklmnop'
  await expect
    .poll(() =>
      fetch(`${bridge}/hello`, { headers: { origin: ext } })
        .then((r) => r.status)
        .catch(() => 0)
    )
    .toBe(200)
  const send = (n: string): Promise<Response> =>
    fetch(`${bridge}/download`, {
      method: 'POST',
      headers: { origin: ext, 'content-type': 'application/json' },
      body: JSON.stringify({ url: server.url(`/many/${n}`), cookies: `file=${n}` })
    })
  for (const n of names) expect((await send(n)).status).toBe(200)
  // The same link again (clicked twice): it waits once.
  expect((await send('three.zip')).status).toBe(200)
  let page = run.page
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  const field = dialog.getByLabel('Link or magnet')
  // The first opens; the others wait.
  await expect(field).toHaveValue(server.url('/many/one.zip'))
  await expect(dialog.getByRole('region', { name: 'Waiting downloads' })).toContainText(
    '3 more downloads from your browser are waiting.'
  )
  // Cancel: the next one opens.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(field).toHaveValue(server.url('/many/two.zip'))
  // A click outside hides the window; nothing is lost: all three wait in the panel.
  await page.mouse.click(5, 300)
  await expect(dialog).toBeHidden()
  const panel = page.getByRole('region', { name: 'Waiting to be added' })
  await expect(panel).toContainText('3 waiting to be added')
  await expect(panel.getByRole('button', { name: 'Open three.zip' })).toHaveCount(1)
  // The one open was sent again too: still just once.
  expect((await send('two.zip')).status).toBe(200)
  await expect(panel).toContainText('3 waiting to be added')
  for (const n of ['two.zip', 'three.zip', 'four.zip'])
    await expect(panel.getByRole('button', { name: `Open ${n}` })).toBeVisible()
  // Open one from the panel; hide it again.
  await panel.getByRole('button', { name: 'Open three.zip' }).click()
  await expect(field).toHaveValue(server.url('/many/three.zip'))
  await page.mouse.click(5, 300)
  await expect(panel).toContainText('3 waiting to be added')
  // Remove one.
  await panel.getByRole('button', { name: 'Remove four.zip' }).click()
  await expect(panel).toContainText('2 waiting to be added')
  // Another from the browser now joins the panel, without opening the window over the app.
  server.files.set('/many/five.zip', { body: randomFile(200_000) })
  expect((await send('five.zip')).status).toBe(200)
  await expect(panel).toContainText('3 waiting to be added')
  await expect(dialog).toBeHidden()
  await panel.getByRole('button', { name: 'Remove five.zip' }).click()
  await expect(panel).toContainText('2 waiting to be added')
  // Mascot closes and opens again: they're still waiting.
  const userData = run.userData
  await run.app.close()
  run = await launch({ userData, env: { MASCOT_TEST_BRIDGE: '1' } })
  page = run.page
  const again = page.getByRole('region', { name: 'Waiting to be added' })
  await expect(again).toContainText('2 waiting to be added')
  // Add all: both, together, each with its own cookie.
  await again.getByRole('button', { name: 'Add all 2' }).click()
  await expect(again).toBeHidden()
  const list = await run.until((l) => l.length === 2 && l.every((d) => d.status === 'done'))
  expect(list.map((d) => d.name).sort()).toEqual(['three.zip', 'two.zip'])
  expect(new Set(list.map((d) => d.group?.id)).size).toBe(1)
  for (const n of ['two.zip', 'three.zip']) {
    const hits = server.hits.filter((h) => h.path === `/many/${n}`)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.cookie === `file=${n}`)).toBe(true)
  }
})

test('Settings knows whether the extension is added: from the browser’s own folders, even with the browser closed, and notices when it is removed', async () => {
  test.setTimeout(90_000)
  await run?.close()
  // A browser's data folder with one profile.
  const browser = mkdtempSync(join(tmpdir(), 'mascot-browser-'))
  const profile = join(browser, 'Default')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'Preferences'), JSON.stringify({ extensions: { settings: {} } }))
  const env = { MASCOT_TEST_BRIDGE: '1', MASCOT_TEST_BROWSER_DATA: browser }
  run = await launch({ env })
  const settingsCard = async (): Promise<ReturnType<typeof run.page.locator>> => {
    await run.page
      .getByRole('navigation', { name: 'Pages' })
      .getByRole('button', { name: 'Settings' })
      .click()
    return run.page.locator('.card', { hasText: 'Browser extension' })
  }
  try {
    let card = await settingsCard()
    await expect(card).toContainText('Not connected')
    await expect(card.getByRole('button', { name: 'Add to browser' })).toBeVisible()
    // Installed from the store (its folder appears), and it makes contact.
    const store = join(profile, 'Extensions', 'jdbajgaajkoafbdfgnldbfmloclfgnjg')
    mkdirSync(store, { recursive: true })
    const ext = 'chrome-extension://jdbajgaajkoafbdfgnldbfmloclfgnjg'
    await expect
      .poll(() =>
        fetch(`${bridge}/hello`, { headers: { origin: ext } })
          .then((r) => r.status)
          .catch(() => 0)
      )
      .toBe(200)
    await expect(card.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 })
    // Mascot restarts with the browser closed, some time later: still added.
    const userData = run.userData
    await run.app.close()
    run = await launch({ userData, env })
    await run.call('updateSettings', { extensionSeenAt: Date.now() - 2 * 3600_000 })
    card = await settingsCard()
    await expect(card).toContainText('Added to your browser. Last connected 2 hours ago.')
    await expect(card.getByRole('button', { name: 'Add to browser' })).toBeHidden()
    // Removed from the browser while Mascot is open: it notices.
    rmSync(store, { recursive: true, force: true })
    await expect(card).toContainText('Not added to your browser.', { timeout: 15_000 })
    await expect(card.getByRole('button', { name: 'Add to browser' })).toBeVisible()
    // Loaded by hand (listed in the preferences, no folder): added.
    writeFileSync(
      join(profile, 'Preferences'),
      JSON.stringify({ extensions: { settings: { jkjflpeecjefphglhhidnmmgklhkicja: {} } } })
    )
    await expect(card).toContainText('Added to your browser.', { timeout: 15_000 })
  } finally {
    rmSync(browser, { recursive: true, force: true })
  }
})
