/**
 * Registers the native messaging host with each browser, so the extension can reach Mascot
 * without a network request (Brave Shields and Chrome's local network rules can't block it) and
 * start it when it's closed. Rewritten at every start, so it always points at this copy of the
 * app; nothing needs admin rights (per-user registry keys and folders).
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { EXTENSION_IDS, FIREFOX_ID, NATIVE_HOST } from '../shared/extension'

const run = promisify(execFile)

/** The host script: shipped next to the app, or in the project when run from source. */
function hostScript(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native-host.cjs')
    : join(app.getAppPath(), 'native', 'host.cjs')
}

/** What starts Mascot when the extension asks and it's closed. */
function launch(): { command: string; args: string[] } {
  return app.isPackaged
    ? { command: process.execPath, args: [] }
    : { command: process.execPath, args: [app.getAppPath()] }
}

/** Chromium-family browsers' own folders (macOS, Linux), relative to the config root. */
const CHROMIUM_DIRS: Record<'darwin' | 'linux', string[]> = {
  darwin: ['Google/Chrome', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Vivaldi'],
  linux: ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge', 'vivaldi']
}
/** Their registry keys under HKCU (Windows). */
const CHROMIUM_KEYS = [
  'Software\\Google\\Chrome',
  'Software\\Chromium',
  'Software\\BraveSoftware\\Brave-Browser',
  'Software\\Microsoft\\Edge',
  'Software\\Vivaldi'
]

/** Writes the host's files and registers them; resolves with where the manifests went. */
export async function registerNativeHost(): Promise<string[]> {
  const dir = join(app.getPath('userData'), 'native-host')
  mkdirSync(dir, { recursive: true })
  const config = join(dir, 'config.json')
  writeFileSync(config, JSON.stringify({ launch: launch() }, null, 2))
  const windows = process.platform === 'win32'
  const launcher = join(dir, windows ? 'mascot-native-host.bat' : 'mascot-native-host.sh')
  if (windows)
    writeFileSync(
      launcher,
      [
        '@echo off',
        'set ELECTRON_RUN_AS_NODE=1',
        `"${process.execPath}" "${hostScript()}" "${config}" %*`,
        ''
      ].join('\r\n')
    )
  else {
    const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
    writeFileSync(
      launcher,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(process.execPath)} ${q(hostScript())} ${q(config)} "$@"\n`
    )
    chmodSync(launcher, 0o755)
  }
  const common = { name: NATIVE_HOST, description: 'Mascot', path: launcher, type: 'stdio' }
  const chrome = join(dir, `${NATIVE_HOST}.chrome.json`)
  writeFileSync(
    chrome,
    JSON.stringify(
      { ...common, allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`) },
      null,
      2
    )
  )
  const firefox = join(dir, `${NATIVE_HOST}.firefox.json`)
  writeFileSync(firefox, JSON.stringify({ ...common, allowed_extensions: [FIREFOX_ID] }, null, 2))

  const done: string[] = []
  if (windows) {
    const add = async (key: string, file: string): Promise<void> => {
      const full = `HKCU\\${key}\\NativeMessagingHosts\\${NATIVE_HOST}`
      await run('reg', ['add', full, '/ve', '/t', 'REG_SZ', '/d', file, '/f'], {
        windowsHide: true
      })
      done.push(full)
    }
    for (const key of CHROMIUM_KEYS) await add(key, chrome).catch(() => {})
    await add('Software\\Mozilla', firefox).catch(() => {})
    return done
  }
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
  const root =
    platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : (process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'))
  // Only for browsers that are there: their folder exists.
  for (const browser of CHROMIUM_DIRS[platform]) {
    const home = join(root, browser)
    if (!existsSync(home)) continue
    const file = join(home, 'NativeMessagingHosts', `${NATIVE_HOST}.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify(
        { ...common, allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`) },
        null,
        2
      )
    )
    done.push(file)
  }
  const mozilla =
    platform === 'darwin'
      ? join(root, 'Mozilla')
      : join(process.env['MASCOT_TEST_HOME'] ?? homedir(), '.mozilla')
  if (existsSync(mozilla)) {
    const file = join(
      mozilla,
      platform === 'darwin' ? 'NativeMessagingHosts' : 'native-messaging-hosts',
      `${NATIVE_HOST}.json`
    )
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ ...common, allowed_extensions: [FIREFOX_ID] }, null, 2))
    done.push(file)
  }
  return done
}
