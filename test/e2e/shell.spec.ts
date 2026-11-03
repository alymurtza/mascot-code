import { expect, test } from '@playwright/test'
import { launch } from './app'

test('the app opens with its title bar and answers calls', async () => {
  const run = await launch()
  try {
    await expect(run.page.getByRole('group', { name: 'Window' })).toBeVisible()
    expect(await run.page.evaluate(() => window.mascot.invoke('ping'))).toBe('pong')
  } finally {
    await run.close()
  }
})
