import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomFile, startServer, type TestServer } from '../support/server'
import { launch, type Launched } from './app'

let server: TestServer
test.beforeAll(async () => {
  server = await startServer({ '/big.iso': { body: randomFile(20_000_000), rate: 1_000_000 } })
})
test.afterAll(async () => {
  await server.close()
})

let run: Launched
test.afterEach(async () => {
  await run?.close()
})

/** Adds a download, pauses it, and quits: the list on disk has it. */
async function oneSaved(): Promise<string> {
  run = await launch()
  const d = await run.call('add', { url: server.url('/big.iso') })
  await run.until((l) => l[0]?.received > 2_000_000)
  await run.call('act', [d.id], 'pause')
  await run.until((l) => l[0]?.status === 'paused')
  // Long enough for the list to have been saved more than once.
  await run.page.waitForTimeout(2500)
  await run.app.evaluate(({ app }) => app.quit())
  await new Promise<void>((r) =>
    run.app.process().exitCode !== null ? r() : void run.app.process().once('exit', () => r())
  )
  return run.userData
}

test('a list file blanked by a power cut is read back from its backup', async () => {
  const userData = await oneSaved()
  const file = join(userData, 'downloads.json')
  expect(existsSync(file + '.bak')).toBe(true)
  // What a power cut can leave: the file in place, its contents never written.
  writeFileSync(file, Buffer.alloc(readFileSync(file).length))
  run = await launch({ userData })
  const list = await run.list()
  expect(list.map((d) => [d.name, d.status])).toEqual([['big.iso', 'paused']])
  expect(list[0].received).toBeGreaterThan(0)
})

test('an unreadable list with no backup is kept aside, not written over', async () => {
  const userData = await oneSaved()
  const file = join(userData, 'downloads.json')
  writeFileSync(file, '{ not json')
  writeFileSync(file + '.bak', '')
  run = await launch({ userData })
  expect(await run.list()).toEqual([])
  const kept = readdirSync(userData).filter((f) => f.startsWith('downloads.json.broken-'))
  expect(kept).toHaveLength(1)
  expect(readFileSync(join(userData, kept[0]), 'utf8')).toBe('{ not json')
})
