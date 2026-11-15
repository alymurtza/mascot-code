import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Launched } from './app'

const GB = 1024 ** 3
const dayKey = (daysAgo: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let run: Launched
test.afterEach(async () => {
  await run?.close()
})

test('the data used chart: one column per day, every bar standing on the baseline, in order', async () => {
  // Days like the owner's: some heavy, some light, two networks.
  const usage = {
    days: {
      [dayKey(4)]: { 'Wi-Fi': 0.19 * GB },
      [dayKey(3)]: { 'Wi-Fi': 19.8 * GB },
      [dayKey(2)]: { 'Wi-Fi': 1.31 * GB },
      [dayKey(1)]: { 'Wi-Fi': 7.62 * GB, Ethernet: 0.02 * GB },
      [dayKey(0)]: { 'Wi-Fi': 18.16 * GB, Ethernet: 1.33 * GB }
    },
    limits: {}
  }
  const userData = mkdtempSync(join(tmpdir(), 'mascot-e2e-'))
  writeFileSync(join(userData, 'usage.json'), JSON.stringify(usage))
  run = await launch({ userData })
  const { page } = run
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('button', { name: 'Networks' })
    .click()
  const chart = page.getByRole('img', { name: /Data used by network/ })
  await chart.scrollIntoViewIfNeeded()
  if (process.env['MASCOT_SHOT']) await page.screenshot({ path: process.env['MASCOT_SHOT'] })
  for (const span of ['Days', 'Weeks', 'Months']) {
    await page
      .getByRole('region', { name: 'Data used' })
      .getByRole('button', { name: span })
      .click()
    const box = (await chart.boundingBox())!
    const bars = await chart.locator('.ubar').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, top: r.top, bottom: r.bottom, title: el.getAttribute('title') ?? '' }
      })
    )
    expect(bars).toHaveLength(span === 'Days' ? 14 : 12)
    for (const bar of bars) {
      // Full height of the chart, so every bar starts at 0.
      expect(Math.abs(bar.bottom - (box.y + box.height))).toBeLessThan(1.5)
      expect(Math.abs(bar.top - box.y)).toBeLessThan(1.5)
    }
    // Left to right in time, on one row.
    for (let i = 1; i < bars.length; i++) expect(bars[i].x).toBeGreaterThan(bars[i - 1].x)
  }
  await page
    .getByRole('region', { name: 'Data used' })
    .getByRole('button', { name: 'Days' })
    .click()
  const titles = await chart
    .locator('.ubar')
    .evaluateAll((els) => els.map((el) => el.getAttribute('title')))
  expect(titles[13]).toMatch(new RegExp(`^${new Date().getDate()}: 19\\.`))
  expect(titles[10]).toMatch(/: 19\.80? GB/)
  // Today's date is under its bar.
  await expect(page.locator('.ulab span').last()).toHaveText(String(new Date().getDate()))
})
