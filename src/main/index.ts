import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell
} from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, join } from 'node:path'
import type { DeviceView } from '../shared/api'
import type { Download } from '../shared/download'
import { EXTENSION_STORE_URL } from '../shared/extension'
import { isDarkPalette, paletteFor, type Settings } from '../shared/settings'
import { THEMES } from '../shared/themes'
import { Engine } from './downloads'
import { emit, serveApi } from './ipc'
import { acceptLink, linkFromArgs } from './links'
import { setTestAdapters, testMode } from './net/adapters'
import { closeAllConnections } from './net/connect'
import { Networks } from './networks'
import { powerAction } from './power'
import { SettingsStore } from './settings'
import { speedTest } from './speedTest'
import { TrayIcon } from './tray'
import { TorrentHub } from './torrent/hub'
import { extensionLastSeen, startBridge, whenExtensionSeen, type BridgeDownload } from './bridge'
import { Updates } from './updater'
import { extensionInstalled } from './extensionCheck'
import { registerNativeHost } from './nativeHost'

app.setName('Mascot')

// Windows Sandbox shares the graphics card through a fragile virtual GPU; with a browser open
// as well it can bring the whole Sandbox down. Draw in software there (its user is always
// WDAGUtilityAccount, so real PCs are never affected).
if (process.platform === 'win32' && userInfo().username === 'WDAGUtilityAccount')
  app.disableHardwareAcceleration()

// Its own data folder, so it never mixes with another app called Mascot.
app.setPath(
  'userData',
  process.env['MASCOT_TEST_USER_DATA'] ?? join(app.getPath('appData'), 'Mascot Downloader')
)
if (!app.requestSingleInstanceLock()) app.exit(0)

const testing = process.env['MASCOT_TEST_USER_DATA'] !== undefined
const hiddenForTests = process.env['MASCOT_TEST_HIDE_WINDOW'] === '1'
/** Started at sign-in: stay in the tray. */
const startHidden =
  process.argv.includes('--hidden') ||
  (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
const AFTER_ALL_MS = Number(process.env['MASCOT_TEST_AFTER_ALL_MS'] ?? 60_000)

const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
let mainWindow: BrowserWindow | null = null
let quitting = false
let settings: SettingsStore
let networks: Networks
let engine: Engine
let tray: TrayIcon
let updates: Updates
/** A link that arrived before the window could take it. */
let waitingLink: string | undefined
let afterAll: { action: 'sleep' | 'shutdown'; at: number; timer: NodeJS.Timeout } | null = null

/** The window's background, so a resize never flashes the wrong colour. */
const background = (): string => THEMES[paletteFor(settings.get().palette)].tokens['bg']

function showWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow(false)
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!hiddenForTests) mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

function createWindow(hidden: boolean): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Mascot',
    backgroundColor: background(),
    ...(process.platform !== 'darwin' ? { icon } : {}),
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 11 } } : {}),
    ...(process.platform === 'linux' ? { frame: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: !hiddenForTests
    }
  })
  const sendState = (): void => {
    if (!window.isDestroyed())
      emit('windowState', { maximized: window.isMaximized(), focused: window.isFocused() })
  }
  for (const name of ['maximize', 'unmaximize', 'focus', 'blur', 'show'] as const)
    window.on(name as 'focus', sendState)
  // Looking at the window counts as seeing failed downloads.
  window.on('focus', () => {
    engine.seen()
    updateTray()
  })
  window.once('ready-to-show', () => {
    if (!hiddenForTests && !hidden) window.show()
    sendState()
  })
  // Closing keeps Mascot running in the tray, unless Settings says closing quits.
  window.on('close', (event) => {
    if (quitting || settings.get().closeAction === 'quit') return
    event.preventDefault()
    window.hide()
    tray.ensure()
    if (!settings.get().trayNoticeShown && !testing && Notification.isSupported()) {
      settings.update({ trayNoticeShown: true })
      const notice = new Notification({
        title: 'Mascot is still running',
        body:
          process.platform === 'win32'
            ? 'Downloads carry on in the background. Open Mascot from its icon by the clock (under ^ if it’s hidden).'
            : 'Downloads carry on in the background. Open Mascot from its tray icon.'
      })
      notice.on('click', () => showWindow())
      notice.show()
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Cut, copy and paste in text fields; copy for selected text.
  window.webContents.on('context-menu', (_event, { isEditable, selectionText, editFlags }) => {
    const items: Electron.MenuItemConstructorOptions[] = isEditable
      ? [
          { role: 'cut', enabled: editFlags.canCut },
          { role: 'copy', enabled: editFlags.canCopy },
          { role: 'paste', enabled: editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll' }
        ]
      : selectionText.trim()
        ? [{ role: 'copy' }]
        : []
    if (items.length) Menu.buildFromTemplate(items).popup()
  })
  if (process.env['ELECTRON_RENDERER_URL'])
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

/** A link from outside goes to the window's Add download. */
function offerLink(candidate: string, headers?: Record<string, string>): void {
  const link = acceptLink(candidate)
  if (!link) return
  if (!app.isReady() || !mainWindow) {
    waitingLink = link
    if (app.isReady()) showWindow()
    return
  }
  showWindow()
  // A .torrent file goes over as its contents; the window can't read files itself.
  if (/\.torrent$/i.test(link) && existsSync(link))
    return emit('link', { url: basename(link), torrentFile: readFileSync(link).toString('base64') })
  emit('link', { url: link, headers })
}

app.on('second-instance', (_event, argv) => {
  const link = linkFromArgs(argv)
  if (link) offerLink(link)
  else if (app.isReady()) showWindow()
})
app.on('open-url', (event, url) => {
  event.preventDefault()
  offerLink(url)
})
app.on('open-file', (event, path) => {
  event.preventDefault()
  offerLink(path)
})
const launchLink = linkFromArgs(process.argv)
if (launchLink) waitingLink = launchLink

function trayStatus(): Parameters<TrayIcon['update']>[0] {
  const list = engine.list()
  const running = list.filter((d) => d.status === 'running' || d.status === 'waiting')
  return {
    speed: running.reduce((sum, d) => sum + d.speed, 0),
    downloading: running.length,
    queued: list.filter((d) => d.status === 'queued').length,
    failed: list.filter((d) => d.status === 'failed').length,
    unseenFailure: engine.unseenFailure
  }
}

function updateTray(): void {
  const s = settings.get()
  tray.style = s.trayIcon
  tray.unit = s.speedUnit
  tray.taskbarBadge = s.taskbarBadge
  tray.update(trayStatus())
}

function notify(title: string, body: string, d?: Download): void {
  if (testing || !Notification.isSupported()) return
  const notice = new Notification({ title, body })
  notice.on('click', () => {
    showWindow()
    if (d && d.status === 'done' && existsSync(d.path)) shell.showItemInFolder(d.path)
  })
  notice.show()
}

function startAfterAll(): void {
  const action = settings.get().afterAll
  if (action === 'nothing') return
  if (action === 'notify')
    return notify('Downloads finished', 'Everything in the queue has finished.')
  const at = Date.now() + AFTER_ALL_MS
  afterAll = {
    action,
    at,
    timer: setTimeout(() => {
      afterAll = null
      emit('afterAll', null)
      if (!testing) powerAction(action)
    }, AFTER_ALL_MS)
  }
  emit('afterAll', { action, at })
  notify(
    action === 'sleep' ? 'Going to sleep in a minute' : 'Shutting down in a minute',
    'Everything finished. Open Mascot to cancel.'
  )
}

function applySettings(s: Settings): void {
  // A chosen theme is light or dark itself; until then, follow the system.
  nativeTheme.themeSource = isDarkPalette(paletteFor(s.palette)) ? 'dark' : 'light'
  mainWindow?.setBackgroundColor(background())
  if (app.isPackaged && process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: s.openAtLogin, args: ['--hidden'] })
  }
  updateTray()
}

function devices(): DeviceView[] {
  const s = settings.get()
  const connected = new Map(networks.adapters.map((a) => [a.id, a]))
  const ids = new Set([...Object.keys(s.devices), ...connected.keys()])
  return [...ids].map((id) => {
    const known = s.devices[id]
    const live = connected.get(id)
    const name = live?.name ?? known?.name ?? id
    return {
      id,
      name,
      label: s.networks[id]?.name ?? name,
      kind: live?.kind ?? known?.kind ?? 'other',
      description: live?.description ?? known?.description,
      connected: !!live,
      hidden: live
        ? networks.isHidden(live)
        : (s.networks[id]?.hidden ?? known?.kind === 'virtual'),
      lastSeen: live ? Date.now() : (known?.lastSeen ?? 0)
    }
  })
}

void app.whenReady().then(async () => {
  app.setAppUserModelId('com.mascot.downloader')
  settings = new SettingsStore()
  networks = new Networks(settings)
  const torrents = new TorrentHub((id, bytes) => networks.received(id, bytes))
  networks.onChange(() => torrents.setNetworks(networks.allowed()))
  setInterval(() => torrents.setLimit(networks.total.rate), 1000).unref()
  engine = new Engine(
    settings,
    networks,
    {
      changed: () => {
        emit('downloads', () => engine.list(), 250)
        updateTray()
      },
      finished: (d) => notify('Download finished', d.name, d),
      failed: (d) => notify('Download failed', `${d.name}: ${d.message ?? ''}`, d),
      allDone: startAfterAll
    },
    (path) => shell.trashItem(path),
    torrents
  )
  tray = new TrayIcon(
    icon,
    {
      open: () => showWindow(),
      pauseAll: () => void engine.pauseAll(),
      resumeAll: () => engine.resumeAll(),
      quit: () => app.quit()
    },
    () => mainWindow
  )
  networks.onChange(() => emit('networks', () => networks.views(), 250))
  settings.onChange((s) => {
    applySettings(s)
    // Run at once and download hours take effect right away.
    engine.tick()
    emit('settings', s)
    emit('networks', () => networks.views(), 250)
  })
  setInterval(() => emit('networks', () => networks.views(), 0), 1000).unref()
  await networks.ready()
  networks.start()
  engine.start()
  applySettings(settings.get())
  updates = new Updates(
    (state) => emit('update', state),
    () => settings.get().autoUpdate
  )
  // Remember that the extension made contact (at most once a minute), so Settings knows it's
  // there even before the browser opens next time.
  whenExtensionSeen((at) => {
    if (at - settings.get().extensionSeenAt > 60_000) settings.update({ extensionSeenAt: at })
  })
  updates.start().catch((error) => console.error('[mascot] updates failed to start', error))

  serveApi((window) => ({
    ping: async () => 'pong' as const,
    windowControl: async (action) => {
      if (!window) return
      if (action === 'minimize') window.minimize()
      else if (action === 'maximize') {
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
      } else window.close()
    },
    initial: async () => {
      const link = waitingLink
      waitingLink = undefined
      return {
        settings: settings.get(),
        downloads: engine.list(),
        networks: networks.views(),
        version: app.getVersion(),
        testMode: testMode(),
        ...(link && /\.torrent$/i.test(link) && existsSync(link)
          ? { link: basename(link), torrentFile: readFileSync(link).toString('base64') }
          : { link })
      }
    },
    updateSettings: async (patch) => settings.update(patch),
    updateNetwork: async (id, patch) => {
      // At least one Always network stays among those on the Networks page.
      if (patch.role === 'backup' || patch.hidden === true) {
        const s = settings.get()
        const always = networks.adapters.filter(
          (a) => a.id !== id && !networks.isHidden(a) && s.networks[a.id]?.role !== 'backup'
        )
        if (always.length === 0 && patch.role === 'backup')
          throw new Error('Keep at least one network on Always')
      }
      return settings.network(id, patch)
    },
    resetDataLimit: async (id) => networks.resetLimit(id),
    devices: async () => devices(),
    forgetDevice: async (id) => {
      const s = settings.get()
      const devices = { ...s.devices }
      const prefs = { ...s.networks }
      delete devices[id]
      delete prefs[id]
      settings.update({ devices, networks: prefs })
    },
    usage: async () => networks.usageDays(),
    speedTest: async (id) => {
      const adapter = networks.adapters.find((a) => a.id === id)
      if (!adapter) throw new Error('That network isn’t connected')
      return speedTest(adapter)
    },
    checkLink: async (url, headers) => engine.check(url, headers),
    torrentInfo: async (source) => {
      torrents.setNetworks(networks.allowed())
      return torrents.info(source)
    },
    findDuplicate: async (url, info, place) => engine.findDuplicate(url, info, place) ?? null,
    add: async (request) => engine.add(request),
    act: async (ids, action) => {
      for (const id of ids) {
        if (action === 'pause') await engine.pause(id)
        else if (action === 'resume' || action === 'retry') engine.resume(id)
        else if (action === 'cancel') await engine.cancel(id)
        else if (action === 'remove') await engine.remove(id)
        else if (action === 'trash') await engine.remove(id, true)
        else if (action === 'restart') await engine.restart(id)
        else if (action === 'first') await engine.first(id)
        else if (action === 'queue') await engine.toQueue(id)
        else if (action === 'start-now') engine.startNow(id)
      }
    },
    startAt: async (ids, at) => {
      for (const id of ids) await engine.startAt(id, at)
    },
    reorder: async (id, by) => engine.reorder(id, by),
    addMirror: async (id, url, sameFile) => engine.addMirror(id, url, sameFile),
    removeMirror: async (id, url) => engine.removeMirror(id, url),
    renameGroup: async (groupId, name) => engine.renameGroup(groupId, name),
    setGroup: async (ids, group) => engine.setGroup(ids, group),
    pauseAll: async () => engine.pauseAll(),
    resumeAll: async () => engine.resumeAll(),
    clearFinished: async () => engine.clearFinished(),
    chooseFolder: async (current) => {
      if (process.env['MASCOT_TEST_CHOOSE_FOLDER']) return process.env['MASCOT_TEST_CHOOSE_FOLDER']
      const options: Electron.OpenDialogOptions = {
        defaultPath: current,
        properties: ['openDirectory', 'createDirectory']
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    showInFolder: async (path) => {
      if (existsSync(path)) shell.showItemInFolder(path)
      else await shell.openPath(join(path, '..'))
    },
    openFile: async (path) => {
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    },
    copyText: async (text) => clipboard.writeText(text),
    setChecksum: async (id, value) => engine.setChecksum(id, value),
    setTorrentFiles: async (id, files) => engine.setTorrentFiles(id, files),
    updateState: async () => updates.state,
    checkForUpdates: async () => updates.check(true),
    downloadUpdate: async () => updates.download(),
    installUpdate: async () => updates.install(true),
    openExtensionStore: async () => {
      if (process.env['MASCOT_TEST_USER_DATA'] !== undefined) return
      await shell.openExternal(EXTENSION_STORE_URL)
    },
    openLicenses: async () => {
      const file = app.isPackaged
        ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.md')
        : join(app.getAppPath(), 'THIRD_PARTY_NOTICES.md')
      const error = await shell.openPath(file)
      if (error) throw new Error('The licence list couldn’t be opened')
    },
    readClipboard: async () => clipboard.readText(),
    fileExists: async (path) => existsSync(path),
    cancelAfterAll: async () => {
      if (afterAll) clearTimeout(afterAll.timer)
      afterAll = null
      emit('afterAll', null)
    },
    testSetAdapters: async (spec) => {
      setTestAdapters(spec)
      await networks.look()
    },
    testTray: async () => ({ ...tray.drawn, iconEmpty: icon.isEmpty(), trayExists: tray.exists }),
    testCloseWindow: async () => {
      window?.close()
    },
    extensionSeen: async () => Math.max(extensionLastSeen(), settings.get().extensionSeenAt),
    extensionInstalled: async () => extensionInstalled(),
    testWindowVisible: async () =>
      !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
  }))

  if (!testing && app.isPackaged) app.setAsDefaultProtocolClient('mascot')
  // The browser extension reaches Mascot through its native messaging host (registered with
  // each browser) and, as a fallback, the local bridge.
  if ((!testing && app.isPackaged) || process.env['MASCOT_TEST_NATIVE'])
    void registerNativeHost().catch((error) =>
      console.error('[mascot] couldn’t register with the browsers', error)
    )
  // The browser extension hands downloads over here.
  if (!testing || process.env['MASCOT_TEST_BRIDGE']) {
    void startBridge({
      version: app.getVersion(),
      minBytes: () => (settings.get().browserKeepSmall ? settings.get().browserMinBytes : 0),
      take: (d: BridgeDownload) => {
        const headers: Record<string, string> = {}
        if (d.cookies) headers['cookie'] = d.cookies
        if (d.referrer) headers['referer'] = d.referrer
        offerLink(d.url, Object.keys(headers).length ? headers : undefined)
      },
      show: (page) => {
        showWindow()
        if (page === 'settings' || page === 'downloads') emit('show', { page })
      }
    }).catch((error) => console.error('[mascot] browser bridge failed to start', error))
  }
  mainWindow = createWindow(startHidden)
  if (startHidden || settings.get().closeAction === 'tray') tray.ensure()
  if (hiddenForTests) app.dock?.hide()
  app.on('activate', () => showWindow())
  nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(background()))
})

let suspended = false
let shuttingDown = false
app.on('before-quit', (event) => {
  quitting = true
  if (suspended || !engine) return
  event.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  const force = setTimeout(() => app.exit(0), 6000)
  // Downloads pause (they carry on next time), then every connection closes before exiting,
  // so no data is still arriving while the app shuts down. It starts on a turn of its own:
  // a quit can be asked for while a connection is in the middle of handing over data, and
  // closing that connection underneath it would fail.
  setImmediate(() => {
    void engine
      .suspend()
      .then(() => closeAllConnections(3000))
      .finally(() => {
        clearTimeout(force)
        suspended = true
        networks.stop()
        settings.flush()
        tray.destroy()
        // A downloaded update installs as Mascot closes (and doesn't open it again).
        if (updates?.ready && !updates.installing) updates.install(false)
        else app.exit(0)
      })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
