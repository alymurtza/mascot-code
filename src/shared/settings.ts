/** The ten colours; each comes as a light and a dark theme. */
export const COLOURS = [
  'cream',
  'rose',
  'ember',
  'champagne',
  'sunflower',
  'forest',
  'mint',
  'ocean',
  'blue',
  'violet'
] as const
export type Colour = (typeof COLOURS)[number]
/** Special themes, each made for light or dark, with a moving backdrop. Hidden until unlocked. */
export const SPECIAL = {
  aurora: 'dark',
  meteor: 'dark',
  jellyfish: 'dark',
  lanterns: 'dark',
  stillnight: 'dark',
  nightgarden: 'dark',
  glowkoi: 'dark',
  blossom: 'light',
  mountains: 'light',
  dunes: 'light',
  bamboo: 'light',
  koi: 'light',
  garden: 'light',
  reeds: 'light',
  balloons: 'light'
} as const
export type Special = keyof typeof SPECIAL
export type Palette = `${Colour}-light` | `${Colour}-dark` | Special
export const PALETTE_KEYS: readonly Palette[] = [
  ...COLOURS.flatMap((c) => [`${c}-light`, `${c}-dark`] as const),
  ...(Object.keys(SPECIAL) as Special[])
]
export const isSpecial = (p: Palette): p is Special => p in SPECIAL
export const isDarkPalette = (p: Palette): boolean =>
  isSpecial(p) ? SPECIAL[p] === 'dark' : p.endsWith('-dark')
export type DataPeriod = 'day' | 'week' | 'month'
export type AfterAll = 'notify' | 'sleep' | 'shutdown' | 'nothing'

export interface NetworkPrefs {
  /** Shown instead of the system's name. */
  name?: string
  /** A colour for this network (hex), instead of the theme's. */
  color?: string
  icon?: string
  /** Off: downloads don't use it. */
  off?: boolean
  role?: 'always' | 'backup'
  /** Order among backups: lower takes over first. */
  rank?: number
  /** Bytes/s; unset or 0 for no limit. */
  speedLimit?: number
  dataLimit?: { bytes: number; period: DataPeriod }
  /** Removed from the Networks page (and so not used). */
  hidden?: boolean
}

/** Every device seen, connected or not (for All devices). */
export interface KnownDevice {
  name: string
  kind: string
  description?: string
  lastSeen: number
}

export interface Rule {
  id: string
  match: 'type' | 'extension' | 'name' | 'site'
  /** Type name (Videos, Music, …), extensions ("zip, rar"), text in the name ("S01E", or with
   * * as a wildcard: "report-*.pdf"), or a site ("example.com"). */
  value: string
  folder: string
  /** {name} {ext} {date} {site}; empty keeps the file's own name. */
  rename?: string
}

export interface WeeklyHours {
  enabled: boolean
  /** Sunday first. */
  days: boolean[]
  from: string
  to: string
  /** Stop applying after this day (YYYY-MM-DD). */
  until?: string
}

export interface LimitWindow {
  enabled: boolean
  from: string
  to: string
  days: 'weekdays' | 'everyday'
  /** Bytes/s. */
  rate: number
}

export interface Settings {
  /** Unset until the user picks one: Cream dark. */
  palette?: Palette
  /** The special themes have been unlocked with the secret keys. */
  specialThemes?: boolean
  /** Special themes' backgrounds move. */
  animateBackdrop: boolean
  /** Check for new versions and download them by itself. */
  autoUpdate: boolean
  speedUnit: 'bytes' | 'bits'
  folder: string
  runAtOnce: number
  /** Everything in the queue runs at once (runAtOnce is kept for when it's turned off). */
  runAtOnceUnlimited: boolean
  afterAll: AfterAll
  /** Bytes/s for everything together; 0 for none. */
  speedLimit: number
  slowMode: boolean
  hours: WeeklyHours
  limitWindow: LimitWindow
  rules: Rule[]
  closeAction: 'tray' | 'quit'
  openAtLogin: boolean
  trayIcon: 'speed' | 'icon'
  taskbarBadge: boolean
  trayNoticeShown: boolean
  /** Files smaller than this stay with the browser. */
  browserMinBytes: number
  /** Files smaller than browserMinBytes stay with the browser; off: every file comes here. */
  browserKeepSmall: boolean
  /** The offer to add the browser extension was taken or turned down. */
  extensionOffered: boolean
  /** When the browser extension last made contact (0: never), kept across restarts. */
  extensionSeenAt: number
  networks: Record<string, NetworkPrefs>
  devices: Record<string, KnownDevice>
}

/** The theme in use: the chosen one, or Cream dark until one is chosen. */
export const paletteFor = (chosen: Palette | undefined): Palette => chosen ?? 'cream-dark'

/** Slow mode caps everything at this. */
export const SLOW_MODE_RATE = 512 * 1024

export const defaultHours = (): WeeklyHours => ({
  enabled: false,
  days: [true, true, true, true, true, true, true],
  from: '01:00',
  to: '07:00'
})

export const defaultLimitWindow = (): LimitWindow => ({
  enabled: false,
  from: '09:00',
  to: '18:00',
  days: 'weekdays',
  rate: 2 * 1024 * 1024
})

/** Minutes since midnight for "HH:MM". */
export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Whether `date` falls in a from–to window (which may wrap past midnight) on an allowed day.
 * A window that wraps belongs to the day it starts on. */
export function inWindow(
  date: Date,
  from: string,
  to: string,
  day: (weekday: number) => boolean
): boolean {
  const now = date.getHours() * 60 + date.getMinutes()
  const a = minutesOf(from)
  const b = minutesOf(to)
  const today = date.getDay()
  if (a === b) return day(today)
  if (a < b) return now >= a && now < b && day(today)
  if (now >= a) return day(today)
  return now < b && day((today + 6) % 7)
}

export function hoursAllow(hours: WeeklyHours, date = new Date()): boolean {
  if (!hours.enabled) return true
  if (hours.until) {
    const until = new Date(hours.until + 'T23:59:59')
    if (date > until) return true
  }
  return inWindow(date, hours.from, hours.to, (d) => hours.days[d] === true)
}

export function limitWindowActive(window: LimitWindow, date = new Date()): boolean {
  if (!window.enabled) return false
  return inWindow(
    date,
    window.from,
    window.to,
    (d) => window.days === 'everyday' || (d >= 1 && d <= 5)
  )
}

/** A guard against nonsense values only: "Run at once" has no real limit. */
export const MAX_RUN_AT_ONCE = 100_000
