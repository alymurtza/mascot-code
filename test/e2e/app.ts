import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Api } from '../../src/shared/api'
import type { Download } from '../../src/shared/download'

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
  downloads: string
  call<K extends keyof Api>(
    method: K,
    ...args: Parameters<Api[K]>
  ): Promise<Awaited<ReturnType<Api[K]>>>
  list(): Promise<Download[]>
  /** Waits until `check` passes for the download list. */
  until(check: (list: Download[]) => boolean, timeoutMs?: number): Promise<Download[]>
  close(): Promise<void>
}

/** Two fake networks on loopback addresses, as the app sees them in tests. */
export const TWO_NETWORKS = 'Ethernet=127.0.0.2:ethernet,Wi-Fi=127.0.0.3:wifi'

/** Starts the built app with its own data and downloads folders, fake networks and a hidden
 * window. Pass `userData` to start again on the same data. */
export async function launch(
  options: { env?: Record<string, string>; adapters?: string; userData?: string } = {}
): Promise<Launched> {
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), 'mascot-e2e-'))
  const downloads = join(userData, 'Downloads')
  mkdirSync(downloads, { recursive: true })
  const app = await electron.launch({
    args: [join(__dirname, '../..')],
    env: {
      ...process.env,
      MASCOT_TEST_USER_DATA: userData,
      MASCOT_TEST_HIDE_WINDOW: '1',
      MASCOT_TEST_ADAPTERS: options.adapters ?? TWO_NETWORKS,
      MASCOT_TEST_CHOOSE_FOLDER: downloads,
      ...options.env
    }
  })
  if (process.env['MASCOT_TEST_SHOW_OUTPUT']) {
    app.process().stdout?.on('data', (d) => process.stdout.write('[app] ' + d))
    app.process().stderr?.on('data', (d) => process.stdout.write('[app] ' + d))
  }
  const page = await app.firstWindow()
  await page.waitForFunction(() => 'mascot' in window)
  const call: Launched['call'] = (method, ...args) =>
    page.evaluate(([m, a]) => window.mascot.invoke(m as never, ...(a as unknown[])), [
      method,
      args
    ] as const) as never
  // New downloads go to this run's own folder.
  await call('updateSettings', { folder: downloads })
  const list = (): Promise<Download[]> => call('initial').then((s) => s.downloads)
  return {
    app,
    page,
    userData,
    downloads,
    call,
    list,
    until: async (check, timeoutMs = 30_000) => {
      const end = Date.now() + timeoutMs
      for (;;) {
        const current = await list()
        if (check(current)) return current
        if (Date.now() > end)
          throw new Error(
            'Timed out; list is ' +
              JSON.stringify(current.map((d) => [d.name, d.status, d.message]))
          )
        await new Promise((r) => setTimeout(r, 100))
      }
    },
    close: async () => {
      await app.close().catch(() => {})
      // The test is over: its data folder goes, even after a restart that reused it.
      rmSync(userData, { recursive: true, force: true })
    }
  }
}
