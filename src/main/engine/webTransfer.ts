import { mkdir, open, type FileHandle } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Source } from '../../shared/download'
import type { Adapter } from '../../shared/network'
import { Connection } from '../net/http'
import { describe, DownloadError, httpError, isDiskError } from './errors'
import { SpeedMeter } from './meter'
import { PacketTable, type Lease } from './packets'
import { follow } from './probe'
import { takeAll, type Limiter } from './throttle'

/** What a transfer needs from the rest of the app. */
export interface TransferHost {
  /** The networks this download may use right now. */
  networks(): Adapter[]
  /** Speed limits that apply to bytes arriving over `adapterId`. */
  limiters(adapterId: string): (Limiter | undefined)[]
  /** Bytes arrived over a network (for data used and data limits). */
  received(adapterId: string, bytes: number): void
  /** A network keeps failing or works again (for backup networks). */
  networkHealth(adapterId: string, working: boolean): void
  /** A link was dropped (its `dropped` reason is set). */
  sourceDropped(source: Source): void
}

export interface TransferSetup {
  partPath: string
  size?: number
  ranged: boolean
  packetSize: number
  /** Bytes already on disk per packet, from before. */
  filled?: ArrayLike<number>
  /** Shared with the download: links added or removed show up here (see sourcesChanged). */
  sources: Source[]
  headers: Record<string, string>
  /** Connections per network: a number, or 'auto'. */
  perNetwork: 'auto' | number
}

const STALL_MS = Number(process.env['MASCOT_TEST_STALL_MS'] ?? 20_000)
/** No bytes from any network for this long, while networks are there to use: give up. */
const GIVE_UP_MS = Number(process.env['MASCOT_TEST_GIVE_UP_MS'] ?? 90_000)
const AUTO_START = 4
const AUTO_MAX = 16
const AUTO_STEP_MS = 3000

interface Slot {
  key: string
  adapterId: string
  connection: Connection
  abort: AbortController
  source?: Source
  failures: number
  /** Set to stop this slot after its current packet. */
  retire: boolean
  done: Promise<void>
}

/** Per network: how many connections it runs, and how that's adjusting. */
interface Lane {
  target: number
  meter: SpeedMeter
  /** Speed when connections were last added, to see whether that helped. */
  speedAtStep: number
  grew: boolean
  holdUntil: number
  stepAt: number
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })

/**
 * One web download in progress. Ranged files: packets fetched by several connections per
 * network, spread over every link that works. Otherwise: one connection, start to end.
 */
export class WebTransfer {
  readonly table: PacketTable | null
  private file: FileHandle | null = null
  private readonly slots = new Map<string, Slot>()
  private readonly lanes = new Map<string, Lane>()
  private readonly resolved = new Map<Source, string>()
  private readonly stopper = new AbortController()
  private stopped = false
  private failure: DownloadError | null = null
  private lastBytesAt = Date.now()
  private lastError = ''
  private sequential = 0
  private sequentialDone = false
  private wake: () => void = () => {}
  private slotCounter = 0
  readonly meter = new SpeedMeter()

  constructor(
    private readonly setup: TransferSetup,
    private readonly host: TransferHost
  ) {
    this.table =
      setup.ranged && setup.size !== undefined && setup.size > 0
        ? new PacketTable(setup.size, setup.packetSize, setup.filled)
        : null
  }

  /** Bytes on disk. */
  get received(): number {
    return this.table ? this.table.received : this.sequential
  }

  get connections(): number {
    return this.slots.size
  }

  /** Bytes/s per network, now. */
  speeds(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [id, lane] of this.lanes) {
      const rate = lane.meter.rate()
      if (rate > 0 || this.hasSlotsOn(id)) out[id] = rate
    }
    return out
  }

  private hasSlotsOn(adapterId: string): boolean {
    for (const slot of this.slots.values()) if (slot.adapterId === adapterId) return true
    return false
  }

  private usableSources(): Source[] {
    return this.setup.sources.filter((s) => !s.dropped && !s.removed)
  }

  /** Runs until the file is complete ('done'), stopped ('stopped'), or it fails (throws). */
  async run(): Promise<'done' | 'stopped'> {
    try {
      // The folder may not exist yet (a rule or "sort by type" picked it).
      await mkdir(dirname(this.setup.partPath), { recursive: true })
      this.file = await open(this.setup.partPath, this.table ? 'a+' : 'w+').then(async (h) => {
        // 'a+' only to create the file without truncating; positional writes need r+.
        await h.close()
        return open(this.setup.partPath, 'r+')
      })
    } catch (error) {
      throw new DownloadError(describe(error), isDiskError(error) ? 'fatal' : 'network')
    }
    try {
      if (this.table?.complete) return 'done'
      this.lastBytesAt = Date.now()
      for (;;) {
        if (this.stopped) return 'stopped'
        if (this.failure) throw this.failure
        if (this.table ? this.table.complete : this.sequentialDone) return 'done'
        this.plan()
        if (
          this.slots.size === 0 &&
          this.host.networks().length > 0 &&
          this.usableSources().length === 0
        )
          throw new DownloadError(this.lastError || 'None of the links work', 'source')
        if (this.host.networks().length === 0) this.lastBytesAt = Date.now()
        if (Date.now() - this.lastBytesAt > GIVE_UP_MS)
          throw new DownloadError(this.lastError || 'The download stopped getting data', 'network')
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 500)
          this.wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
        // Changes often come in bursts: plan once for all of them.
        await sleep(25)
      }
    } finally {
      await this.shutdown()
    }
  }

  /** Pauses: every connection stops, what's on disk stays. */
  async stop(): Promise<void> {
    this.stopped = true
    this.wake()
    this.stopper.abort()
  }

  /** The networks allowed changed: connections are added or retired on the next plan. */
  networksChanged(): void {
    this.wake()
  }

  /** Links were added or removed: connections are spread over the links that are left. */
  sourcesChanged(): void {
    const usable = new Set(this.usableSources())
    for (const slot of this.slots.values()) {
      if (slot.source && !usable.has(slot.source)) slot.abort.abort()
      slot.source = undefined
    }
    this.wake()
  }

  /** Flushes what's written to disk. */
  async flush(): Promise<void> {
    await this.file?.datasync().catch(() => {})
  }

  private async shutdown(): Promise<void> {
    this.stopped = true
    this.stopper.abort()
    for (const slot of this.slots.values()) slot.abort.abort()
    await Promise.all([...this.slots.values()].map((s) => s.done))
    if (this.table?.complete && this.setup.size !== undefined)
      await this.file?.truncate(this.setup.size).catch(() => {})
    await this.flush()
    await this.file?.close().catch(() => {})
    this.file = null
  }

  /** Starts or retires connections so each allowed network runs as many as it should. */
  private plan(): void {
    const networks = this.host.networks()
    const allowed = new Set(networks.map((a) => a.id))
    for (const slot of this.slots.values()) {
      if (!allowed.has(slot.adapterId)) {
        slot.retire = true
        slot.abort.abort()
      }
    }
    if (this.usableSources().length === 0) return
    if (!this.table) {
      // One connection, on the first network.
      if (this.slots.size === 0 && networks.length > 0) this.startSlot(networks[0].id)
      return
    }
    let available = this.table.available
    const now = Date.now()
    for (const adapter of networks) {
      const lane = this.lane(adapter.id)
      this.adjust(lane, adapter.id, now)
      const mine = [...this.slots.values()].filter((s) => s.adapterId === adapter.id && !s.retire)
      for (let n = mine.length; n < lane.target && available > 0; n++, available--)
        this.startSlot(adapter.id)
      for (let n = mine.length; n > lane.target; n--) mine[n - 1].retire = true
    }
  }

  private lane(adapterId: string): Lane {
    let lane = this.lanes.get(adapterId)
    if (!lane) {
      const fixed = this.setup.perNetwork === 'auto' ? undefined : this.setup.perNetwork
      lane = {
        target: fixed ?? AUTO_START,
        meter: new SpeedMeter(3000),
        speedAtStep: 0,
        grew: false,
        holdUntil: 0,
        stepAt: Date.now()
      }
      this.lanes.set(adapterId, lane)
    }
    return lane
  }

  /** Auto connections: add two while that makes the network faster; back off when the server
   * says it's busy. */
  private adjust(lane: Lane, adapterId: string, now: number): void {
    if (
      this.setup.perNetwork !== 'auto' ||
      now - lane.stepAt < AUTO_STEP_MS ||
      now < lane.holdUntil
    )
      return
    const speed = lane.meter.rate()
    const limited = this.host
      .limiters(adapterId)
      .some((l) => l && l.rate > 0 && speed > l.rate * 0.85)
    lane.stepAt = now
    if (limited || speed === 0) return
    if (!lane.grew || speed > lane.speedAtStep * 1.1) {
      if (lane.target < AUTO_MAX) {
        lane.target = Math.min(AUTO_MAX, lane.target + 2)
        lane.speedAtStep = speed
        lane.grew = true
      }
    } else {
      // Adding didn't help: go back to what worked as well, and try again only much later
      // (the line or the server may have room by then).
      lane.target = Math.max(AUTO_START, lane.target - 2)
      lane.grew = false
      lane.holdUntil = now + 60_000
    }
  }

  private busy(adapterId: string): void {
    const lane = this.lane(adapterId)
    lane.target = Math.max(1, lane.target - 2)
    lane.grew = false
    lane.holdUntil = Date.now() + 30_000
  }

  private pickSource(): Source | undefined {
    const usable = this.usableSources()
    if (usable.length === 0) return undefined
    const counts = new Map<Source, number>(usable.map((s) => [s, 0]))
    for (const slot of this.slots.values())
      if (slot.source && counts.has(slot.source))
        counts.set(slot.source, counts.get(slot.source)! + 1)
    return usable.reduce((best, s) => (counts.get(s)! < counts.get(best)! ? s : best))
  }

  private startSlot(adapterId: string): void {
    const key = `${adapterId}#${++this.slotCounter}`
    const slot: Slot = {
      key,
      adapterId,
      connection: new Connection(() => this.host.networks().find((a) => a.id === adapterId)),
      abort: new AbortController(),
      failures: 0,
      retire: false,
      done: Promise.resolve()
    }
    this.slots.set(key, slot)
    slot.done = this.runSlot(slot).finally(() => {
      slot.connection.reset()
      this.slots.delete(key)
      this.wake()
    })
  }

  private async runSlot(slot: Slot): Promise<void> {
    while (!this.stopped && !slot.retire && !this.failure && !this.sequentialDone) {
      if (slot.abort.signal.aborted) slot.abort = new AbortController()
      slot.source ??= this.pickSource()
      if (!slot.source) return
      const lease = this.table ? this.table.lease() : null
      if (this.table && !lease) return
      try {
        if (this.table) await this.fetchPacket(slot, lease!)
        else await this.fetchWhole(slot)
        if (slot.failures > 0) this.host.networkHealth(slot.adapterId, true)
        slot.failures = 0
      } catch (error) {
        if (this.stopped || slot.retire) return
        if (slot.abort.signal.aborted && !(error instanceof DownloadError)) continue
        await this.handleError(slot, error)
      } finally {
        if (lease) this.table!.release(lease.index)
      }
    }
  }

  private async handleError(slot: Slot, error: unknown): Promise<void> {
    if (isDiskError(error)) {
      this.failure = new DownloadError(describe(error), 'fatal')
      return
    }
    this.lastError = describe(error)
    const scope = error instanceof DownloadError ? error.scope : 'network'
    if (scope === 'fatal') {
      this.failure = error as DownloadError
      return
    }
    if (scope === 'source' && slot.source) {
      const source = slot.source
      // A link that redirected may have led to a short-lived address: look it up again once.
      if (this.resolved.has(source) && this.resolved.get(source) !== source.url) {
        this.resolved.delete(source)
        return
      }
      if (!source.dropped) {
        source.dropped = this.lastError
        this.host.sourceDropped(source)
      }
      for (const other of this.slots.values()) if (other.source === source) other.source = undefined
      return
    }
    if (scope === 'busy') {
      this.busy(slot.adapterId)
      await sleep(
        (error as DownloadError).retryAfterMs ?? 3000 + Math.random() * 3000,
        this.stopper.signal
      )
      return
    }
    slot.failures++
    slot.connection.reset()
    if (slot.failures >= 3) this.host.networkHealth(slot.adapterId, false)
    await sleep(Math.min(30_000, 500 * 2 ** slot.failures), this.stopper.signal)
  }

  private async request(slot: Slot, range: string | null): Promise<IncomingMessage> {
    const source = slot.source!
    const signal = AbortSignal.any([slot.abort.signal, this.stopper.signal])
    const headers = {
      ...this.setup.headers,
      ...(range ? { range } : {}),
      'accept-encoding': 'identity'
    }
    const known = this.resolved.get(source)
    const { res, url } = await follow(slot.connection, known ?? source.url, headers, signal)
    this.resolved.set(source, url)
    return res
  }

  /** Reads a response into the file from `position`, stopping at `end` (inclusive) or when
   * `enough()` says so. */
  private async stream(
    slot: Slot,
    res: IncomingMessage,
    position: number,
    onWritten: (position: number) => boolean
  ): Promise<number> {
    let watchdog: NodeJS.Timeout | undefined
    const arm = (): void => {
      clearTimeout(watchdog)
      watchdog = setTimeout(
        () => res.destroy(new DownloadError('The server stopped sending', 'network')),
        STALL_MS
      )
    }
    arm()
    try {
      for await (const chunk of res as AsyncIterable<Buffer>) {
        arm()
        this.lastBytesAt = Date.now()
        this.meter.add(chunk.length)
        this.lane(slot.adapterId).meter.add(chunk.length)
        this.host.received(slot.adapterId, chunk.length)
        await takeAll(this.host.limiters(slot.adapterId), chunk.length)
        if (!this.file) throw new Error('Stopped')
        await this.file.write(chunk, 0, chunk.length, position)
        position += chunk.length
        if (!onWritten(position)) {
          res.destroy()
          break
        }
      }
    } finally {
      clearTimeout(watchdog)
    }
    return position
  }

  private async fetchPacket(slot: Slot, lease: Lease): Promise<void> {
    const table = this.table!
    const res = await this.request(slot, `bytes=${lease.start}-${lease.end}`)
    const status = res.statusCode ?? 0
    if (status !== 206) {
      res.destroy()
      if (status === 200)
        throw new DownloadError('This link can’t send parts of the file', 'source')
      // Asked for a part inside the file and told there's no such part: a shorter file.
      if (status === 416) throw new DownloadError('This link sends a different file', 'source')
      throw httpError(status, res.headers['retry-after'] as string | undefined)
    }
    const range = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/.exec(String(res.headers['content-range'] ?? ''))
    if (
      !range ||
      Number(range[1]) !== lease.start ||
      (range[3] !== '*' && Number(range[3]) !== this.setup.size)
    ) {
      res.destroy()
      throw new DownloadError('This link sends a different file', 'source')
    }
    const end = await this.stream(slot, res, lease.start, (position) => {
      table.progress(lease.index, Math.min(position, lease.end + 1))
      return position <= lease.end && !table.isDone(lease.index)
    })
    if (end <= lease.end && !table.isDone(lease.index))
      throw new DownloadError('The connection ended early', 'network')
  }

  private async fetchWhole(slot: Slot): Promise<void> {
    // Without ranges every attempt starts over.
    this.sequential = 0
    await this.file?.truncate(0)
    const res = await this.request(slot, null)
    const status = res.statusCode ?? 0
    if (status !== 200) {
      res.destroy()
      throw httpError(status, res.headers['retry-after'] as string | undefined)
    }
    const end = await this.stream(slot, res, 0, (position) => {
      this.sequential = position
      return true
    })
    if (this.setup.size !== undefined && end < this.setup.size)
      throw new DownloadError('The connection ended early', 'network')
    this.sequentialDone = true
  }
}
