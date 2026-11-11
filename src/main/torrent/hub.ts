import { utilityProcess, type UtilityProcess } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '../../shared/network'
import type {
  FromWorker,
  ToWorker,
  TorrentInfo,
  TorrentProgress,
  TorrentSource
} from '../../shared/torrent'
import { DownloadError } from '../engine/errors'
import { SpeedMeter } from '../engine/meter'
import { testMode } from '../net/adapters'

type Listener = (message: FromWorker) => void

/** The torrent process, started when first needed. */
export class TorrentHub {
  private child: UtilityProcess | null = null
  private readonly listeners = new Set<Listener>()
  private nextReq = 1
  private lastNetworks: ToWorker | null = null
  private lastLimit: ToWorker | null = null
  /** Bytes/s per network over torrents, for the speed graph. */
  readonly meters = new Map<string, SpeedMeter>()

  constructor(private readonly onUsage: (adapterId: string, bytes: number) => void) {}

  private ensure(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(join(__dirname, 'torrentWorker.js'), [], {
      serviceName: 'Mascot torrents',
      env: { ...process.env }
    })
    child.on('message', (message: FromWorker) => {
      if (message.type === 'usage') {
        for (const [id, bytes] of Object.entries(message.bytes)) {
          this.onUsage(id, bytes)
          let meter = this.meters.get(id)
          if (!meter) this.meters.set(id, (meter = new SpeedMeter(3000)))
          meter.add(bytes)
        }
      }
      for (const listener of this.listeners) listener(message)
    })
    child.on('exit', () => {
      this.child = null
      // Anything running there has stopped.
      for (const listener of this.listeners)
        listener({ type: 'error', id: '*', message: 'The torrent process stopped' })
    })
    this.child = child
    if (this.lastNetworks) child.postMessage(this.lastNetworks)
    if (this.lastLimit) child.postMessage(this.lastLimit)
    return child
  }

  get running(): boolean {
    return this.child !== null
  }

  post(message: ToWorker): void {
    this.ensure().postMessage(message)
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setNetworks(adapters: Adapter[]): void {
    this.lastNetworks = {
      type: 'networks',
      adapters,
      bindDevices: !testMode() && process.platform !== 'win32'
    }
    this.child?.postMessage(this.lastNetworks)
  }

  setLimit(rate: number): void {
    this.lastLimit = { type: 'limit', rate }
    this.child?.postMessage(this.lastLimit)
  }

  speeds(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [id, meter] of this.meters) {
      const rate = meter.rate()
      if (rate > 0) out[id] = rate
    }
    return out
  }

  /** What's in a torrent: its name and files (a magnet link waits for someone sharing it). */
  info(source: TorrentSource): Promise<TorrentInfo> {
    const req = this.nextReq++
    const tmp = mkdtempSync(join(tmpdir(), 'mascot-torrent-'))
    return new Promise((resolve, reject) => {
      const stop = this.on((m) => {
        if (m.type !== 'info' || m.req !== req) return
        stop()
        if (m.info) resolve(m.info)
        else reject(new Error(m.error ?? 'The torrent couldn’t be read'))
      })
      this.post({ type: 'info', req, source, tmp })
    })
  }
}

/** A torrent download in progress: the same shape the download list uses for web downloads. */
export class TorrentTransfer {
  readonly table = null
  readonly meter = new SpeedMeter()
  received = 0
  private progress: TorrentProgress | null = null
  private stopping = false

  constructor(
    private readonly hub: TorrentHub,
    private readonly id: string,
    private readonly source: TorrentSource,
    private readonly folder: string,
    private files: number[] | undefined,
    initialReceived: number
  ) {
    this.received = initialReceived
  }

  get connections(): number {
    return this.progress?.peers ?? 0
  }

  /** Bytes/s arriving from peers now (pieces count as they come, not once checked). */
  get liveSpeed(): number {
    return this.progress?.speed ?? 0
  }

  get pieces(): TorrentProgress['pieces'] | undefined {
    return this.progress?.pieces.total ? this.progress.pieces : undefined
  }

  get size(): number | undefined {
    return this.progress?.size || undefined
  }

  /** Bytes on disk for each file. */
  get fileProgress(): number[] | undefined {
    return this.progress?.files
  }

  /** Fetch only these files from now on (all when unset). */
  select(files: number[] | undefined): void {
    this.files = files
    if (this.hub.running) this.hub.post({ type: 'select', id: this.id, files })
  }

  speeds(): Record<string, number> {
    return {}
  }

  run(): Promise<'done' | 'stopped'> {
    return new Promise((resolve, reject) => {
      const stop = this.hub.on((m) => {
        if (m.type === 'usage' || m.type === 'info') return
        if (m.id !== this.id && m.id !== '*') return
        if (m.type === 'progress') {
          // Still checking the data it has (after a restart): keep showing what it had.
          if (!m.progress.size) {
            this.progress = { ...m.progress, received: this.received }
            return
          }
          const grew = m.progress.received - this.received
          if (grew > 0) this.meter.add(grew)
          this.received = m.progress.received
          this.progress = m.progress
          return
        }
        stop()
        if (m.type === 'done') resolve('done')
        else if (m.type === 'stopped' || this.stopping) resolve('stopped')
        else reject(new DownloadError(m.message, 'network'))
      })
      this.hub.post({
        type: 'start',
        id: this.id,
        source: this.source,
        folder: this.folder,
        files: this.files
      })
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.hub.running) this.hub.post({ type: 'stop', id: this.id })
  }

  networksChanged(): void {}
  sourcesChanged(): void {}
  async flush(): Promise<void> {}
}
