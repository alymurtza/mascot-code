import { app } from 'electron'
import {
  defaultHours,
  defaultLimitWindow,
  COLOURS,
  isSpecial,
  MAX_RUN_AT_ONCE,
  PALETTE_KEYS,
  type Colour,
  type NetworkPrefs,
  type Palette,
  type Settings
} from '../shared/settings'
import { JsonFile } from './store'

const file = new JsonFile<Partial<Settings>>('settings.json', 200)

/** Theme names from earlier versions, by the colour that took their place. */
const RENAMED: Record<string, string> = {
  espresso: 'cream',
  copper: 'cream',
  graphite: 'mint',
  black: 'blue',
  midnight: 'champagne'
}

/** A saved theme, including ones from before themes came in light and dark (then the mode
 * that was set says which). */
function paletteFrom(raw: Partial<Settings> & { mode?: string }): Palette | undefined {
  const saved = (raw.palette as string | undefined)?.replace(/^copper-/, 'cream-')
  const name = RENAMED[saved as string] ?? saved
  if (!name) return undefined
  if ((PALETTE_KEYS as readonly string[]).includes(name)) return name as Palette
  if (
    (COLOURS as readonly string[]).includes(name) &&
    (raw.mode === 'light' || raw.mode === 'dark')
  )
    return `${name as Colour}-${raw.mode}`
  return undefined
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const HEX = /^#[0-9a-f]{6}$/i

function defaults(): Settings {
  return {
    speedUnit: 'bytes',
    folder: app.getPath('downloads'),
    runAtOnce: 3,
    runAtOnceUnlimited: false,
    afterAll: 'notify',
    speedLimit: 0,
    slowMode: false,
    hours: defaultHours(),
    limitWindow: defaultLimitWindow(),
    rules: [],
    closeAction: 'tray',
    openAtLogin: false,
    trayIcon: 'speed',
    taskbarBadge: true,
    animateBackdrop: true,
    autoUpdate: true,
    trayNoticeShown: false,
    browserMinBytes: 5 * 1024 * 1024,
    browserKeepSmall: false,
    // Tests start without the offer, unless they ask for it.
    extensionSeenAt: 0,
    extensionOffered:
      process.env['MASCOT_TEST_USER_DATA'] !== undefined &&
      process.env['MASCOT_TEST_OFFER_EXTENSION'] === undefined,
    networks: {},
    devices: {}
  }
}

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

function cleanNetwork(p: NetworkPrefs): NetworkPrefs {
  const out: NetworkPrefs = {}
  if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim().slice(0, 60)
  if (typeof p.color === 'string' && HEX.test(p.color)) out.color = p.color
  if (typeof p.icon === 'string') out.icon = p.icon.slice(0, 30)
  if (p.off === true) out.off = true
  if (p.role === 'backup') out.role = 'backup'
  if (typeof p.rank === 'number') out.rank = p.rank
  if (typeof p.speedLimit === 'number' && p.speedLimit > 0) out.speedLimit = p.speedLimit
  if (p.dataLimit && p.dataLimit.bytes > 0 && ['day', 'week', 'month'].includes(p.dataLimit.period))
    out.dataLimit = { bytes: p.dataLimit.bytes, period: p.dataLimit.period }
  // Kept both ways: false is "show it", even for a virtual adapter that starts removed.
  if (typeof p.hidden === 'boolean') out.hidden = p.hidden
  return out
}

/** Settings read back from disk or sent by the window, made safe to use. */
export function clean(raw: Partial<Settings>, base: Settings = defaults()): Settings {
  const s: Settings = { ...base }
  if ('palette' in raw) s.palette = paletteFrom(raw)
  if (typeof raw.specialThemes === 'boolean') s.specialThemes = raw.specialThemes
  // The special themes stay hidden until unlocked.
  if (s.palette && isSpecial(s.palette) && !s.specialThemes) s.palette = undefined
  if (raw.speedUnit === 'bits' || raw.speedUnit === 'bytes') s.speedUnit = raw.speedUnit
  if (typeof raw.folder === 'string' && raw.folder) s.folder = raw.folder
  if (raw.runAtOnce !== undefined)
    s.runAtOnce = Math.round(num(raw.runAtOnce, 1, MAX_RUN_AT_ONCE, s.runAtOnce))
  if (typeof raw.runAtOnceUnlimited === 'boolean') s.runAtOnceUnlimited = raw.runAtOnceUnlimited
  if (raw.afterAll && ['notify', 'sleep', 'shutdown', 'nothing'].includes(raw.afterAll))
    s.afterAll = raw.afterAll
  if (raw.speedLimit !== undefined) s.speedLimit = num(raw.speedLimit, 0, 1e12, 0)
  if (typeof raw.slowMode === 'boolean') s.slowMode = raw.slowMode
  if (raw.hours) {
    const h = { ...s.hours, ...raw.hours }
    s.hours = {
      enabled: h.enabled === true,
      days: Array.from({ length: 7 }, (_, i) => h.days?.[i] === true),
      from: HHMM.test(h.from) ? h.from : s.hours.from,
      to: HHMM.test(h.to) ? h.to : s.hours.to,
      ...(h.until && /^\d{4}-\d\d-\d\d$/.test(h.until) ? { until: h.until } : {})
    }
  }
  if (raw.limitWindow) {
    const w = { ...s.limitWindow, ...raw.limitWindow }
    s.limitWindow = {
      enabled: w.enabled === true,
      from: HHMM.test(w.from) ? w.from : s.limitWindow.from,
      to: HHMM.test(w.to) ? w.to : s.limitWindow.to,
      days: w.days === 'everyday' ? 'everyday' : 'weekdays',
      rate: num(w.rate, 1024, 1e12, s.limitWindow.rate)
    }
  }
  if (Array.isArray(raw.rules))
    s.rules = raw.rules
      .filter(
        (r) =>
          r &&
          ['type', 'extension', 'name', 'site'].includes(r.match) &&
          typeof r.folder === 'string'
      )
      .map((r) => ({
        id: String(r.id),
        match: r.match,
        value: String(r.value ?? ''),
        folder: r.folder,
        ...(r.rename ? { rename: String(r.rename) } : {})
      }))
  if (raw.closeAction === 'tray' || raw.closeAction === 'quit') s.closeAction = raw.closeAction
  if (typeof raw.openAtLogin === 'boolean') s.openAtLogin = raw.openAtLogin
  if (raw.trayIcon === 'speed' || raw.trayIcon === 'icon') s.trayIcon = raw.trayIcon
  if (typeof raw.taskbarBadge === 'boolean') s.taskbarBadge = raw.taskbarBadge
  if (typeof raw.animateBackdrop === 'boolean') s.animateBackdrop = raw.animateBackdrop
  if (typeof raw.autoUpdate === 'boolean') s.autoUpdate = raw.autoUpdate
  if (typeof raw.trayNoticeShown === 'boolean') s.trayNoticeShown = raw.trayNoticeShown
  if (raw.browserMinBytes !== undefined) s.browserMinBytes = num(raw.browserMinBytes, 0, 1e13, 0)
  if (typeof raw.browserKeepSmall === 'boolean') s.browserKeepSmall = raw.browserKeepSmall
  if (typeof raw.extensionOffered === 'boolean') s.extensionOffered = raw.extensionOffered
  if (raw.extensionSeenAt !== undefined)
    s.extensionSeenAt = Math.round(num(raw.extensionSeenAt, 0, 8.64e15, 0))
  if (raw.networks && typeof raw.networks === 'object')
    s.networks = Object.fromEntries(
      Object.entries(raw.networks).map(([id, p]) => [id, cleanNetwork(p ?? {})])
    )
  if (raw.devices && typeof raw.devices === 'object') s.devices = { ...raw.devices }
  return s
}

type Listener = (settings: Settings, previous: Settings) => void

/** The settings, saved as they change. */
export class SettingsStore {
  private value: Settings
  private readonly listeners = new Set<Listener>()

  constructor() {
    this.value = clean(file.read() ?? {})
  }

  get(): Settings {
    return this.value
  }

  update(patch: Partial<Settings>): Settings {
    const previous = this.value
    this.value = clean(patch, previous)
    file.write(this.value)
    for (const listener of this.listeners) listener(this.value, previous)
    return this.value
  }

  /** Changes one network's preferences (merged with what it has; `undefined` clears a field). */
  network(id: string, patch: Partial<NetworkPrefs>): Settings {
    const current = this.value.networks[id] ?? {}
    const next = { ...current, ...patch }
    for (const key of Object.keys(patch) as (keyof NetworkPrefs)[])
      if (patch[key] === undefined) delete next[key]
    return this.update({ networks: { ...this.value.networks, [id]: next } })
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  flush(): void {
    file.flush()
  }
}
