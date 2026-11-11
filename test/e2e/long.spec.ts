import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomFile, startServer, type TestServer } from '../support/server'
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

/** Nothing makes the page, or a window over it, scroll sideways. */
async function noSideways(page: Page): Promise<void> {
  const wide = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('html, body, main, .page, .sheet, .dl'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.tagName}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`)
  )
  expect(wide).toEqual([])
}

const SHOTS = process.env['MASCOT_SHOTS']

test('very long links, names, folders and group names: downloads finish and nothing spills out of the window', async () => {
  test.setTimeout(120_000)
  const longName = 'A-very-long-file-name-'.repeat(14) + 'end.zip' // ~315 characters
  const longPath =
    '/long/' + 'segment-of-a-long-path/'.repeat(10) + 'file-name-in-the-link-'.repeat(8) + '.bin'
  const query = '?token=' + 'x'.repeat(4000)
  server.files.set('/named', {
    body: randomFile(300_000),
    disposition: `attachment; filename="${longName}"`
  })
  server.files.set(longPath, { body: randomFile(300_000) })
  server.files.set(longPath.replace('.bin', '-other.bin'), { body: randomFile(300_000) })
  run = await launch()
  const { page, app } = run
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800))
  // A save folder nested deep.
  const deep = join(
    run.userData,
    'Downloads',
    ...Array.from({ length: 30 }, (_, i) => `folder-level-${i}-with-a-long-name`)
  )
  mkdirSync(deep, { recursive: true })
  await run.call('updateSettings', { folder: deep })
  const group = { id: 'g', name: 'A group with a very long name '.repeat(7).trim() }
  await run.call('add', { url: server.url('/named'), group } as never)
  await run.call('add', { url: server.url(longPath + query), group } as never)
  await run.call('add', { url: server.url(longPath + query) + '&single=1' })
  let list = await run.until((l) => l.length === 3 && l.every((d) => d.status === 'done'))
  // One waiting for later: its open row shows its long link.
  const later = await run.call('add', {
    url: server.url(longPath + query) + '&later=1',
    when: { at: Date.now() + 3600_000 }
  })
  for (const d of list) {
    expect(Buffer.byteLength(d.name)).toBeLessThanOrEqual(200)
    expect(existsSync(d.path)).toBe(true)
  }
  expect(list.find((d) => d.url.endsWith('/named'))!.name.endsWith('.zip')).toBe(true)

  // The page: the group open, a download open with its link and folder.
  await page.getByRole('button', { name: /^Expand A group/ }).click()
  const single = list.find((d) => d.url.includes('single=1'))!
  await page.getByRole('button', { name: `Expand ${single.name}` }).click()
  await page.getByRole('button', { name: `Expand ${later.name}` }).click()
  await expect(page.getByRole('list', { name: `Links for ${later.name}` })).toBeVisible()
  // A long group name leaves room for its badge.
  const badge = page.getByRole('article', { name: /group\)$/ }).getByText('2 files')
  await badge.scrollIntoViewIfNeeded()
  await expect(badge).toBeInViewport({ ratio: 1 })
  list = await run.list()
  if (SHOTS) await page.screenshot({ path: SHOTS + '/long-downloads.png', fullPage: false })
  if (SHOTS) {
    await page.locator('article.group').screenshot({ path: SHOTS + '/long-group.png' })
    await page
      .getByRole('article', { name: single.name })
      .last()
      .screenshot({ path: SHOTS + '/long-single.png' })
    await page
      .getByRole('article', { name: later.name })
      .screenshot({ path: SHOTS + '/long-later.png' })
  }
  await noSideways(page)

  // Add download with a very long link.
  await page.getByRole('button', { name: 'Add download' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add download' })
  await dialog.getByLabel('Link or magnet').fill(server.url(longPath + query) + '&again=1')
  await expect(dialog.getByLabel('Save as')).toHaveValue(/file-name-in-the-link/)
  if (SHOTS) await page.screenshot({ path: SHOTS + '/long-add.png' })
  await noSideways(page)
  await dialog.getByRole('button', { name: 'Many links' }).click()
  await dialog
    .getByLabel('Paste links, one per line')
    .fill(
      [
        server.url(longPath.replace('.bin', '-other.bin') + query),
        'https://does-not-exist.invalid/' + 'z'.repeat(3000)
      ].join('\n')
    )
  await dialog.getByRole('button', { name: 'Add 2 downloads' }).click()
  const panel = page.getByRole('region', { name: 'Adding links' })
  await expect(panel).toContainText('couldn’t be added', { timeout: 30_000 })
  await expect(panel).toContainText('The server’s name couldn’t be found')
  if (SHOTS) await page.screenshot({ path: SHOTS + '/long-failed.png' })
  await noSideways(page)
  await panel.getByRole('button', { name: 'Close' }).click()

  // Delete asks with the long names in view.
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page
    .getByRole('region', { name: 'Selection' })
    .getByRole('button', { name: 'Select all' })
    .click()
  await page
    .getByRole('region', { name: 'Selection' })
    .getByRole('button', { name: 'Add to group…' })
    .click()
  if (SHOTS) await page.screenshot({ path: SHOTS + '/long-group-sheet.png' })
  await noSideways(page)
})
