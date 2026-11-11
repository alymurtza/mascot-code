import type { Adapter, NetworkStatus, NetworkView, UsageDays } from '../shared/network'
import type { DataPeriod, NetworkPrefs, Settings } from '../shared/settings'
import { limitWindowActive, SLOW_MODE_RATE } from '../shared/settings'
import { AdapterWatcher } from './net/adapters'
import { Limiter } from './engine/throttle'
import type { SettingsStore } from './settings'
import { JsonFile } from './store'

/** A network that kept failing is tried again after this long. */
const FAILING_MS = 30_000
/** Backups stand down once an Always network has worked again for this long. */
const SETTLE_MS = 5_000
const KEEP_DAYS = 400

interface UsageFile {
  days: UsageDays
  /** Per network: data used towards its limit, in the period with this key. */
  limits: Record<string, { key: string; bytes: number }>
}

const pad = (n: number): string => String(n).padStart(2, '0')
export const dayKey = (d = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Which period a date is in: the day, the week (from Monday), or the month. */
export function periodKey(period: DataPeriod, d = new Date()): string {
  if (period === 'day') return dayKey(d)
  if (period === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return 'w' + dayKey(monday)
}

/**
 * The networks: which are connected, which downloads may use (on/off, Always and Backup, data
 * limits, failing ones), their speed limits, and the data used over each.
 */
export class Networks {
  private readonly watcher: AdapterWatcher
  private readonly usageFile = new JsonFile<UsageFile>('usage.json', 2000)
  private readonly usage: UsageFile
  private readonly failingUntil = new Map<string, number>()
  private readonly limiters = new Map<string, Limiter>()
  readonly total = new Limiter()
  private covering: string | null = null
  private alwaysBackSince = 0
  private allowedNow: Adapter[] = []
  private readonly listeners = new Set<() => void>()
  private timer: NodeJS.Timeout | null = null
  /** Bytes/s per network, from the downloads (set by the engine each second). */
  speeds: Record<string, number> = {}

  constructor(private readonly settings: SettingsStore) {
    this.usage = this.usageFile.read() ?? { days: {}, limits: {} }
    this.watcher = new AdapterWatcher((adapters) => {
      this.remember(adapters)
      this.refresh()
    })
    settings.onChange(() => this.refresh())
  }

  start(): void {
    this.watcher.start()
    this.timer = setInterval(() => this.refresh(), 1000)
    this.timer.unref()
  }

  /** Writes the data usage to disk now. */
  saveNow(): void {
    this.usageFile.flush()
  }

  stop(): void {
    this.watcher.stop()
    if (this.timer) clearInterval(this.timer)
    this.usageFile.flush()
  }

  /** Called when what downloads may use changes. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get adapters(): Adapter[] {
    return this.watcher.adapters ?? []
  }

  /** Waits for the first look at the adapters. */
  async ready(): Promise<void> {
    if (!this.watcher.adapters) await this.watcher.look()
  }

  /** Looks at the adapters now (tests change them). */
  async look(): Promise<void> {
    await this.watcher.look()
  }

  /** The networks downloads may use right now. */
  allowed(): Adapter[] {
    return this.allowedNow
  }

  private prefs(id: string): NetworkPrefs {
    return this.settings.get().networks[id] ?? {}
  }

  /** Virtual adapters start removed from the Networks page. */
  isHidden(adapter: Adapter): boolean {
    const p = this.settings.get().networks[adapter.id]
    return p?.hidden ?? adapter.kind === 'virtual'
  }

  private capped(id: string): boolean {
    const limit = this.prefs(id).dataLimit
    return !!limit && this.limitUsed(id) >= limit.bytes
  }

  limitUsed(id: string): number {
    const limit = this.prefs(id).dataLimit
    if (!limit) return 0
    const entry = this.usage.limits[id]
    return entry && entry.key === periodKey(limit.period) ? entry.bytes : 0
  }

  /** Starts the data limit's count again from zero. */
  resetLimit(id: string): void {
    const limit = this.prefs(id).dataLimit
    if (limit) this.usage.limits[id] = { key: periodKey(limit.period), bytes: 0 }
    this.usageFile.write(this.usage)
    this.refresh()
  }

  private failing(id: string, now: number): boolean {
    return (this.failingUntil.get(id) ?? 0) > now
  }

  /** Works out which networks downloads may use, and tells listeners if that changed. */
  refresh(): void {
    const now = Date.now()
    const usable = this.adapters.filter(
      (a) => !this.isHidden(a) && !this.prefs(a.id).off && !this.capped(a.id)
    )
    const always = usable.filter(
      (a) => this.prefs(a.id).role !== 'backup' && !this.failing(a.id, now)
    )
    const backups = usable
      .filter((a) => this.prefs(a.id).role === 'backup' && !this.failing(a.id, now))
      .sort((a, b) => (this.prefs(a.id).rank ?? 0) - (this.prefs(b.id).rank ?? 0))
    let next: Adapter[]
    if (always.length > 0) {
      if (this.alwaysBackSince === 0) this.alwaysBackSince = now
      const cover = this.covering ? backups.find((b) => b.id === this.covering) : undefined
      if (cover && now - this.alwaysBackSince < SETTLE_MS) next = [...always, cover]
      else {
        this.covering = null
        next = always
      }
    } else {
      this.alwaysBackSince = 0
      const first = backups[0]
      this.covering = first?.id ?? null
      next = first ? [first] : []
    }
    this.applyLimits(now)
    const changed =
      next.map((a) => a.id + a.ipv4 + a.ipv6).join() !==
      this.allowedNow.map((a) => a.id + a.ipv4 + a.ipv6).join()
    this.allowedNow = next
    if (changed) for (const listener of this.listeners) listener()
  }

  private applyLimits(now: number): void {
    const s = this.settings.get()
    const window = limitWindowActive(s.limitWindow, new Date(now)) ? s.limitWindow.rate : 0
    const rates = [s.speedLimit, s.slowMode ? SLOW_MODE_RATE : 0, window].filter((r) => r > 0)
    this.total.setRate(rates.length ? Math.min(...rates) : 0)
    for (const [id, limiter] of this.limiters) limiter.setRate(this.prefs(id).speedLimit ?? 0)
  }

  /** The speed limits for bytes over `id`: its own, then everything's. */
  limitersFor(id: string): Limiter[] {
    let limiter = this.limiters.get(id)
    if (!limiter) {
      limiter = new Limiter(this.prefs(id).speedLimit ?? 0)
      this.limiters.set(id, limiter)
    }
    return [limiter, this.total]
  }

  /** Bytes arrived over a network: counted for data used and its data limit. */
  received(id: string, bytes: number): void {
    const day = dayKey()
    const today = (this.usage.days[day] ??= {})
    today[id] = (today[id] ?? 0) + bytes
    const limit = this.prefs(id).dataLimit
    if (limit) {
      const key = periodKey(limit.period)
      const old = this.usage.limits[id]
      const entry = old && old.key === key ? old : (this.usage.limits[id] = { key, bytes: 0 })
      entry.bytes += bytes
      if (entry.bytes >= limit.bytes) this.refresh()
    }
    this.usageFile.write(this.usage)
  }

  health(id: string, working: boolean): void {
    if (working) {
      if (this.failingUntil.delete(id)) this.refresh()
    } else if (!this.failing(id, Date.now())) {
      this.failingUntil.set(id, Date.now() + FAILING_MS)
      this.refresh()
    }
  }

  usageDays(): UsageDays {
    const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 86_400_000))
    for (const day of Object.keys(this.usage.days)) if (day < cutoff) delete this.usage.days[day]
    return this.usage.days
  }

  private remember(adapters: Adapter[]): void {
    const s = this.settings.get()
    const devices = { ...s.devices }
    let changed = false
    for (const a of adapters) {
      const known = devices[a.id]
      if (!known || known.name !== a.name || Date.now() - known.lastSeen > 60_000) {
        devices[a.id] = {
          name: a.name,
          kind: a.kind,
          description: a.description,
          lastSeen: Date.now()
        }
        changed = true
      }
    }
    if (changed) this.settings.update({ devices })
  }

  status(adapter: Adapter): NetworkStatus {
    const p = this.prefs(adapter.id)
    if (p.off) return 'off'
    if (this.capped(adapter.id)) return 'capped'
    if (this.failing(adapter.id, Date.now())) return 'failing'
    const allowed = this.allowedNow.some((a) => a.id === adapter.id)
    if (p.role === 'backup') return allowed ? 'covering' : 'standby'
    return 'in-use'
  }

  /** The Networks page: connected networks not removed from it. */
  views(settings: Settings = this.settings.get()): NetworkView[] {
    return this.adapters
      .filter((a) => !this.isHidden(a))
      .map((a) => ({
        ...a,
        label: settings.networks[a.id]?.name ?? a.name,
        status: this.status(a),
        speed: this.speeds[a.id] ?? 0,
        limitUsed: settings.networks[a.id]?.dataLimit ? this.limitUsed(a.id) : undefined
      }))
  }
}
