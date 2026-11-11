import type {
  AddRequest,
  Download,
  DownloadAction,
  DownloadGroup,
  DuplicateMatch,
  LinkInfo
} from './download'
import type { AdapterKind, NetworkView, UsageDays } from './network'
import type { NetworkPrefs, Settings } from './settings'
import type { TorrentInfo, TorrentSource } from './torrent'

/** The calls the window can make to the main process, and the events main sends back. One IPC
 * channel carries every call (with the method name), another every event. */

export interface WindowState {
  maximized: boolean
  focused: boolean
}

/** A device for All devices: every adapter ever seen. */
export interface DeviceView {
  id: string
  name: string
  label: string
  kind: AdapterKind | string
  description?: string
  connected: boolean
  /** Removed from the Networks page. */
  hidden: boolean
  lastSeen: number
}

export interface InitialState {
  settings: Settings
  downloads: Download[]
  networks: NetworkView[]
  version: string
  testMode: boolean
  /** A link handed to the app before the window opened. */
  link?: string
  /** A .torrent file opened with the app, as base64. */
  torrentFile?: string
}

export interface SpeedTestResult {
  speed: number
  ping: number
}

export interface Api {
  ping(): Promise<'pong'>
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  initial(): Promise<InitialState>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  updateNetwork(id: string, patch: Partial<NetworkPrefs>): Promise<Settings>
  resetDataLimit(id: string): Promise<void>
  devices(): Promise<DeviceView[]>
  forgetDevice(id: string): Promise<void>
  usage(): Promise<UsageDays>
  speedTest(id: string): Promise<SpeedTestResult>
  checkLink(url: string, headers?: Record<string, string>): Promise<LinkInfo>
  /** What's in a magnet link or .torrent file. */
  torrentInfo(source: TorrentSource): Promise<TorrentInfo>
  /** What adding this link would duplicate: a download in the list, or a file already where it
   * would be saved (`place`: its folder and name, when known). */
  findDuplicate(
    url: string,
    info?: LinkInfo,
    place?: { folder?: string; name?: string; torrent?: boolean }
  ): Promise<DuplicateMatch | null>
  add(request: AddRequest): Promise<Download>
  act(ids: string[], action: DownloadAction): Promise<void>
  startAt(ids: string[], at: number): Promise<void>
  reorder(id: string, by: -1 | 1): Promise<void>
  addMirror(id: string, url: string, sameFile?: boolean): Promise<Download>
  removeMirror(id: string, url: string): Promise<Download>
  /** Renames a download (and its file on disk). */
  rename(id: string, name: string): Promise<Download>
  /** Renames a group of downloads. */
  renameGroup(groupId: string, name: string): Promise<void>
  /** Puts downloads in a group (a new one or one already there), or takes them out (null). */
  setGroup(ids: string[], group: DownloadGroup | null): Promise<void>
  pauseAll(): Promise<void>
  resumeAll(): Promise<void>
  clearFinished(): Promise<void>
  chooseFolder(current?: string): Promise<string | null>
  showInFolder(path: string): Promise<void>
  openFile(path: string): Promise<void>
  copyText(text: string): Promise<void>
  /** Sets, changes or (with an empty value) removes a download's checksum; a finished file is
   * checked against it right away. */
  setChecksum(id: string, value: string): Promise<void>
  /** A torrent's files to fetch (indexes into its file list). */
  setTorrentFiles(id: string, files: number[]): Promise<void>
  /** Where updates stand. */
  updateState(): Promise<UpdateState>
  /** Looks for a new version now. */
  checkForUpdates(): Promise<void>
  /** Restarts into the downloaded version (downloads pause first and carry on after). */
  /** Downloads the version a check found (when updates aren't downloaded by themselves). */
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  /** Opens the browser extension's store page in the default browser. */
  openExtensionStore(): Promise<void>
  /** Opens the list of open-source software Mascot includes, and their licences. */
  openLicenses(): Promise<void>
  readClipboard(): Promise<string>
  fileExists(path: string): Promise<boolean>
  cancelAfterAll(): Promise<void>
  /** When the browser extension last checked in (0: never). */
  extensionSeen(): Promise<number>
  /** Whether a browser on this computer has the extension (found in its profile folders). */
  extensionInstalled(): Promise<'yes' | 'no' | 'unknown'>
  /** Tests only: change the fake network adapters. */
  testSetAdapters(spec: string): Promise<void>
  /** Tests only: what the tray and taskbar show. */
  testTray(): Promise<{
    text?: string
    failed: boolean
    tooltip: string
    badge: string
    iconEmpty: boolean
    trayExists: boolean
  }>
  /** Tests only: close the window as the close button would. */
  testCloseWindow(): Promise<void>
  /** Tests only: whether the window is showing. */
  testWindowVisible(): Promise<boolean>
}

/** Automatic updates. */
export interface UpdateState {
  status:
    | 'idle'
    | 'unsupported'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'error'
  /** This version. */
  version: string
  /** The new version being downloaded or ready. */
  next?: string
  percent?: number
  checkedAt?: number
  message?: string
  /** Where updates come from instead, when Mascot came from an app store. */
  store?: string
}

export interface Events {
  windowState: WindowState
  downloads: Download[]
  networks: NetworkView[]
  settings: Settings
  /** A link handed over from outside (another launch, the browser, a file). */
  link: { url: string; torrentFile?: string; headers?: Record<string, string> }
  /** Sleep or shut down is coming once everything finished (null: cancelled). */
  afterAll: { action: 'sleep' | 'shutdown'; at: number } | null
  update: UpdateState
  /** Go to a page (the browser extension's Settings button). */
  show: { page: 'settings' | 'downloads' }
}

export type ApiMethod = keyof Api

export const CALL_CHANNEL = 'mascot:call'
export const EVENT_CHANNEL = 'mascot:event'
