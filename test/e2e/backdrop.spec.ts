import { expect, test } from '@playwright/test'
import { launch, type Launched } from './app'

let run: Launched
test.afterEach(async () => run?.close())

/** The backdrop canvas, as an image now and a moment later. */
async function frames(run: Launched): Promise<[string, string]> {
  return run.page.evaluate(async () => {
    const c = document.querySelector('.backdrop-page canvas') as HTMLCanvasElement
    const a = c.toDataURL()
    await new Promise((r) => setTimeout(r, 1200))
    return [a, c.toDataURL()]
  })
}

test('a special theme’s background moves, and stays still when animation is off', async () => {
  // Shown, as the window is for people (a hidden window pauses it).
  run = await launch({ env: { MASCOT_TEST_HIDE_WINDOW: '' } })
  await run.call('updateSettings', { specialThemes: true, palette: 'meteor' })
  await expect(run.page.locator('.backdrop-page canvas')).toHaveCount(1)
  const [a, b] = await frames(run)
  expect(a).not.toBe(b)
  await run.call('updateSettings', { animateBackdrop: false })
  await expect(run.page.locator('.backdrop-page.still')).toHaveCount(1)
  await run.page.waitForTimeout(500)
  const [c, d] = await frames(run)
  expect(c).toBe(d)
})
