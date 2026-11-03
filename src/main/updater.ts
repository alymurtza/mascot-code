/**
 * Automatic updates from the GitHub releases. The installed app checks a little after it
 * starts and every few hours. With "Download updates by itself" on, a new version downloads in
 * the background and installs when Mascot restarts or quits; with it off, it's offered instead. macOS needs a signed app for this, so there it stays off.
 */
import { app } from 'electron'
import type { UpdateState } from '../shared/api'

const FIRST_CHECK_MS = 15_000
const EVERY_MS = 6 * 3600_000

type Updater = typeof import('electron-updater').autoUpdater

export class Updates {
  state: UpdateState = { status: 'idle', version: app.getVersion() }
  private updater: Updater | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly changed: (state: UpdateState) => void,
    private readonly allowed: () => boolean
  ) {}

  /** Tests: what a check finds ('current', 'available' or 'error'), without GitHub. */
  private readonly fake = process.env['MASCOT_TEST_UPDATES']

  /** Updates work only in the installed app, not on macOS (unsigned), and not in tests. */
  get supported(): boolean {
    if (this.fake) return true
    if (!app.isPackaged || process.env['MASCOT_TEST_USER_DATA'] !== undefined) return false
    if (process.platform === 'darwin') return false
    // Flathub updates the Flatpak itself.
    if (process.env['FLATPAK_ID']) return false
    if (process.platform === 'linux' && !process.env['APPIMAGE']) return false
    return true
  }

  async start(): Promise<void> {
    if (!this.supported) {
      this.set({
        status: 'unsupported',
        ...(process.env['FLATPAK_ID'] ? { store: 'Flathub' } : {})
      })
      return
    }
    if (this.fake) return
    let autoUpdater: Updater
    try {
      // electron-updater is CommonJS with a lazy getter: loaded with import() its autoUpdater is
      // on the default export, not a named one (reading the named one gave undefined, and
      // updates silently never started).
      const mod = (await import('electron-updater')) as unknown as {
        autoUpdater?: Updater
        default?: { autoUpdater?: Updater }
      }
      const found = mod.autoUpdater ?? mod.default?.autoUpdater
      if (!found) throw new Error('The updater couldn’t be loaded')
      autoUpdater = found
    } catch (error) {
      console.error('[mascot] updates failed to load', error)
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      return
    }
    this.updater = autoUpdater
    autoUpdater.autoDownload = false
    // Versions before 1.0 are published as pre-releases on GitHub.
    autoUpdater.allowPrerelease = true
    // Installed on our own quit, once downloads are paused (see index.ts).
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () =>
      this.set({ status: 'current', checkedAt: Date.now() })
    )
    autoUpdater.on('update-available', (info) => {
      this.set({ status: 'available', next: info.version })
      if (this.allowed()) void this.download()
    })
    autoUpdater.on('download-progress', (p) =>
      this.set({ status: 'downloading', percent: Math.floor(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', next: info.version }))
    autoUpdater.on('error', (error) =>
      this.set({ status: 'error', message: error?.message ?? String(error) })
    )
    setTimeout(() => void this.check(false), FIRST_CHECK_MS).unref()
    this.timer = setInterval(() => void this.check(false), EVERY_MS)
    this.timer.unref()
  }

  /** Looks for a new version (`byHand`: from the Check for updates button). */
  async check(byHand: boolean): Promise<void> {
    const busy = ['ready', 'downloading', 'checking'].includes(this.state.status)
    if (this.fake && !busy) return this.fakeCheck()
    if (busy) return
    if (!this.updater) {
      this.set({ status: 'error', message: this.state.message ?? 'Updates didn’t start' })
      return
    }
    // Already offered: automatic checks don't ask again.
    if (!byHand && this.state.status === 'available') return
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  private async fakeCheck(): Promise<void> {
    this.set({ status: 'checking' })
    await new Promise((r) => setTimeout(r, 400))
    if (this.fake === 'available') this.set({ status: 'available', next: '9.9.9' })
    else if (this.fake === 'error')
      this.set({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' })
    else this.set({ status: 'current', checkedAt: Date.now() })
  }

  /** Downloads the version a check found. */
  async download(): Promise<void> {
    if (!this.updater || this.state.status !== 'available') return
    this.set({ status: 'downloading', percent: 0 })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  get ready(): boolean {
    return this.state.status === 'ready'
  }

  /** The installer has been started. */
  installing = false

  /** Installs the downloaded version now; `restart` opens Mascot again afterwards. */
  install(restart: boolean): void {
    if (this.installing || !this.ready) return
    this.installing = true
    this.updater?.quitAndInstall(true, restart)
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch, version: app.getVersion() }
    if (patch.status && patch.status !== 'error') delete this.state.message
    this.changed(this.state)
  }
}
