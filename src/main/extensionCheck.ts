/**
 * Whether the browser extension is installed: browsers keep each installed extension in their
 * profile folders (and list it in the profile's preferences), so this works with the browser
 * closed, and notices when the extension has been removed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EXTENSION_IDS } from '../shared/extension'

export type Installed = 'yes' | 'no' | 'unknown'

/** Chromium-family browsers' data folders on this computer. */
function browserRoots(): string[] {
  const test = process.env['MASCOT_TEST_BROWSER_DATA']
  if (test) return [test]
  const home = homedir()
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
    return [
      'Google/Chrome/User Data',
      'BraveSoftware/Brave-Browser/User Data',
      'Microsoft/Edge/User Data',
      'Chromium/User Data',
      'Vivaldi/User Data'
    ].map((p) => join(local, p))
  }
  if (process.platform === 'darwin')
    return [
      'Google/Chrome',
      'BraveSoftware/Brave-Browser',
      'Microsoft Edge',
      'Chromium',
      'Vivaldi'
    ].map((p) => join(home, 'Library', 'Application Support', p))
  const config = process.env['XDG_CONFIG_HOME'] ?? join(home, '.config')
  return [
    'google-chrome',
    'BraveSoftware/Brave-Browser',
    'microsoft-edge',
    'chromium',
    'vivaldi'
  ].map((p) => join(config, p))
}

/** Whether this profile has the extension: its folder (store installs) or its entry in the
 * preferences (also covers one loaded unpacked). */
function profileHas(profile: string): boolean {
  if (EXTENSION_IDS.some((id) => existsSync(join(profile, 'Extensions', id)))) return true
  for (const file of ['Secure Preferences', 'Preferences']) {
    try {
      const prefs = JSON.parse(readFileSync(join(profile, file), 'utf8')) as {
        extensions?: { settings?: Record<string, unknown> }
      }
      const settings = prefs.extensions?.settings ?? {}
      if (EXTENSION_IDS.some((id) => id in settings)) return true
    } catch {
      // Not there or unreadable: go by the folder.
    }
  }
  return false
}

let cached: { at: number; result: Installed } | null = null

/** 'yes' if any profile of any browser here has it, 'no' if browsers were found but none has
 * it, 'unknown' if no browser's data was found. Rechecked at most every few seconds. */
export function extensionInstalled(): Installed {
  if (cached && Date.now() - cached.at < 3000) return cached.result
  let sawBrowser = false
  let result: Installed = 'unknown'
  for (const root of browserRoots()) {
    if (!existsSync(root)) continue
    sawBrowser = true
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      const profile = join(root, name)
      if (!existsSync(join(profile, 'Preferences')) && !existsSync(join(profile, 'Extensions')))
        continue
      if (profileHas(profile)) {
        result = 'yes'
        break
      }
    }
    if (result === 'yes') break
  }
  if (result !== 'yes' && sawBrowser) result = 'no'
  cached = { at: Date.now(), result }
  return result
}
