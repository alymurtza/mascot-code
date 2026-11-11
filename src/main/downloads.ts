import { detectAlgorithm } from '../shared/checksum'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  AddRequest,
  Download,
  DownloadStatus,
  DuplicateMatch,
  LinkInfo,
  Source
} from '../shared/download'
import { hoursAllow } from '../shared/settings'
import { describe, DownloadError, isDiskError } from './engine/errors'
import { PART_SUFFIX, safeName, uniquePath } from './engine/names'
import { PacketTable } from './engine/packets'
import { checkLink, strongEtag } from './engine/probe'
import { WebTransfer } from './engine/webTransfer'
import { TorrentTransfer, type TorrentHub } from './torrent/hub'
import type { TorrentSource } from '../shared/torrent'
import type { Networks } from './networks'
import type { SettingsStore } from './settings'
import { JsonFile, writeJsonSync } from './store'

const RETRY_MS = Number(process.env['MASCOT_TEST_RETRY_MS'] ?? 5 * 60_000)
const MAX_RETRIES = 3

/** A download and what only the main process needs for it. */
interface Job {
  d: Download
  partPath: string
  /** Bytes on disk per packet, while not running. */
  filled?: number[]
  transfer?: WebTransfer | TorrentTransfer
  /** Torrents: where it comes from and the files chosen. */
  torrent?: { source: TorrentSource; files?: number[] }
  /** Settles when the running transfer has stopped. */
  running?: Promise<void>
  /** What it should become when its transfer stops (pause, queue, …). */
  stopAs?: DownloadStatus
  /** Fetched; being moved into place and checked. */
  finishing?: boolean
  retryTimer?: NodeJS.Timeout
  /** Queue position: lower goes first. */
  order: number
  /** Failed and not yet looked at by the user. */
  unseen?: boolean
}

interface Saved {
  d: Download
  torrent?: Job['torrent']
  partPath: string
  filled?: string
  order: number
}

export interface EngineEvents {
  changed(): void
  finished(d: Download): void
  failed(d: Download): void
  /** Everything queued has finished. */
  allDone(): void
}

const encode = (filled: ArrayLike<number> | undefined): string | undefined =>
  filled ? Buffer.from(Uint32Array.from(filled).buffer).toString('base64') : undefined
const decode = (text: string | undefined): number[] | undefined => {
  if (!text) return undefined
  const buf = Buffer.from(text, 'base64')
  return Array.from(new Uint32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)))
}

/** Kept next to a web download's part file: enough to carry on from it if the download is ever
 * lost from the list (a power cut, a reinstall). */
interface PartNote {
  url: string
  size: number
  packetSize: number
  etag?: string
  lastModified?: string
  filled?: string
}
const NOTE_SUFFIX = '.json'
const readNote = (partPath: string): PartNote | undefined => {
  try {
    return JSON.parse(readFileSync(partPath + NOTE_SUFFIX, 'utf8')) as PartNote
  } catch {
    return undefined
  }
}
/** Whether a note fits the file a link has now: same size, and not another version of it. */
const noteFits = (note: PartNote | undefined, info: LinkInfo | undefined): note is PartNote => {
  if (!note || !info?.ranged || info.size === undefined || note.size !== info.size) return false
  if (!note.packetSize || !note.filled) return false
  const a = strongEtag(note.etag)
  const b = strongEtag(info.etag)
  if (a && b && a !== b) return false
  if (note.lastModified && info.lastModified && note.lastModified !== info.lastModified)
    return false
  return true
}
const filledBytes = (filled: ArrayLike<number> | undefined): number => {
  let sum = 0
  for (let i = 0; i < (filled?.length ?? 0); i++) sum += filled![i]
  return sum
}

/** A link written the same way however it was pasted. */
export const sameLink = (a: string, b: string): boolean => {
  const norm = (u: string): string => {
    try {
      const url = new URL(u.trim())
      url.hash = ''
      return url.toString()
    } catch {
      return u.trim()
    }
  }
  return norm(a) === norm(b)
}

/** The downloads: the list, the queue, and each one's transfer. */
export class Engine {
  private readonly jobs = new Map<string, Job>()
  private readonly file = new JsonFile<Saved[]>('downloads.json', 1000)
  private timer: NodeJS.Timeout | null = null
  private nextOrder = 1
  private busySinceAllDone = false
  private finishedSinceBusy = false
  private quitting = false

  constructor(
    private readonly settings: SettingsStore,
    private readonly networks: Networks,
    private readonly events: EngineEvents,
    private readonly trash: (path: string) => Promise<void>,
    private readonly torrents: TorrentHub
  ) {
    for (const saved of this.file.read() ?? []) {
      const d = saved.d
      // Whatever was running when the app closed carries on; it's queued like the rest.
      if (d.status === 'running' || d.status === 'waiting' || d.status === 'checking')
        d.status = 'queued'
      if (d.status === 'verifying') d.status = 'queued'
      if (d.checksum?.result === 'checking') d.checksum.result = undefined
      // Closed just as it finished: the file is already in place, so it's done (and its
      // checksum is checked again), not downloaded again.
      if (d.kind === 'web' && d.status !== 'done' && finishedOnDisk(d, saved.partPath)) {
        d.status = 'done'
        d.received = d.size ?? d.received
        d.finishedAt ??= Date.now()
        d.message = undefined
        d.priority = undefined
        if (d.checksum) this.recheck.push(d.id)
      }
      d.speed = 0
      d.networkSpeeds = {}
      d.connections = 0
      this.jobs.set(d.id, {
        d,
        partPath: saved.partPath,
        filled: decode(saved.filled),
        order: saved.order,
        torrent: saved.torrent
      })
      this.nextOrder = Math.max(this.nextOrder, saved.order + 1)
    }
    networks.onChange(() => {
      for (const job of this.jobs.values()) job.transfer?.networksChanged()
    })
  }

  /** Finished downloads whose checksum is checked again once the app has started. */
  private readonly recheck: string[] = []

  start(): void {
    for (const id of this.recheck.splice(0)) {
      const d = this.jobs.get(id)?.d
      if (d?.checksum) void this.setChecksum(id, d.checksum.expected).catch(() => {})
    }
    this.timer = setInterval(() => this.tick(), 1000)
    this.timer.unref()
    this.tick()
  }

  list(): Download[] {
    return [...this.jobs.values()].sort((a, b) => a.order - b.order).map((j) => j.d)
  }

  get(id: string): Download | undefined {
    return this.jobs.get(id)?.d
  }

  private job(id: string): Job {
    const job = this.jobs.get(id)
    if (!job) throw new Error('That download is no longer in the list')
    return job
  }

  private save(): void {
    this.file.write(
      [...this.jobs.values()].map((j) => ({
        d: j.d,
        partPath: j.partPath,
        // What's safely on disk (a running download's table runs ahead of that).
        filled: encode(j.filled),
        order: j.order,
        torrent: j.torrent
      }))
    )
  }

  /** Keeps a web download's note in step with what's on disk. */
  private writeNote(job: Job): void {
    const d = job.d
    if (d.kind !== 'web' || !d.ranged || d.size === undefined || !d.packetSize || !job.filled)
      return
    try {
      writeJsonSync(job.partPath + NOTE_SUFFIX, {
        url: d.url,
        size: d.size,
        packetSize: d.packetSize,
        etag: d.etag,
        lastModified: d.lastModified,
        filled: encode(job.filled)
      } satisfies PartNote)
    } catch {
      // Only a help for later; the download carries on.
    }
  }

  private async removeNote(job: Job): Promise<void> {
    await rm(job.partPath + NOTE_SUFFIX, { force: true }).catch(() => {})
  }

  private changed(): void {
    this.save()
    this.events.changed()
  }

  /** Paths in use by downloads in the list, so two don't save to the same name. */
  private taken = (path: string): boolean => {
    for (const job of this.jobs.values())
      if (job.d.path === path && job.d.status !== 'done') return true
    return false
  }

  /** The first network downloads may use, for checking links. */
  private probeNetwork(): NonNullable<ReturnType<Networks['allowed']>[number]> {
    const network = this.networks.allowed()[0]
    if (!network) throw new DownloadError('No network can be used right now', 'network')
    return network
  }

  async check(url: string, headers: Record<string, string> = {}): Promise<LinkInfo> {
    try {
      return await checkLink(this.probeNetwork(), url, headers)
    } catch (error) {
      // In words for the user ("The server’s name couldn’t be found", not "ENOTFOUND").
      throw new Error(describe(error), { cause: error })
    }
  }

  // ── Duplicates ─────────────────────────────────────────────────────────

  /** What adding this link (with what checking it found) would duplicate. */
  findDuplicate(
    url: string,
    info?: LinkInfo,
    place?: { folder?: string; name?: string; torrent?: boolean }
  ): DuplicateMatch | undefined {
    const inList = this.findInList(url, info)
    if (inList) return inList
    // Not in the list, but something by that name is already where it would be saved.
    const name = place?.name || info?.name
    if (!name) return undefined
    const path = join(place?.folder || this.settings.get().folder, safeName(name))
    if (this.taken(path)) return undefined
    // A torrent's folder (or file): carrying on checks every piece against the torrent.
    if (place?.torrent)
      return existsSync(path)
        ? { kind: 'partial', id: '', name: basename(path), status: 'paused', path, resumable: true }
        : undefined
    if (existsSync(path))
      return { kind: 'on-disk', id: '', name: basename(path), status: 'done', path }
    // Part of it, left from a download that's no longer in the list.
    const part = path + PART_SUFFIX
    if (existsSync(part)) {
      const note = readNote(part)
      const fits = noteFits(note, info)
      return {
        kind: 'partial',
        id: '',
        name: basename(path),
        status: 'paused',
        path,
        resumable: fits,
        received: fits ? filledBytes(decode(note.filled)) : undefined,
        size: info?.size
      }
    }
    return undefined
  }

  private findInList(url: string, info?: LinkInfo): DuplicateMatch | undefined {
    const match = (job: Job, kind: DuplicateMatch['kind']): DuplicateMatch => ({
      kind: job.d.status === 'failed' ? 'failed' : job.d.status === 'done' ? 'finished' : kind,
      id: job.d.id,
      name: job.d.name,
      status: job.d.status
    })
    const live = [...this.jobs.values()].filter(
      (j) => j.d.status !== 'done' || existsSync(j.d.path)
    )
    for (const job of live) {
      const links = [job.d.url, ...job.d.sources.filter((s) => !s.removed).map((s) => s.url)]
      if (links.some((l) => sameLink(l, url))) return match(job, 'same-link')
      if (info && info.finalUrl !== url && links.some((l) => sameLink(l, info.finalUrl)))
        return match(job, 'same-link')
    }
    const hash = /xt=urn:btih:([0-9a-z]+)/i.exec(url)?.[1]?.toLowerCase()
    if (hash) {
      const same = live.find((j) => j.d.infoHash?.toLowerCase() === hash)
      if (same) return match(same, 'same-link')
    }
    if (!info || info.size === undefined) return undefined
    for (const job of live) {
      if (job.d.kind !== 'web' || job.d.size !== info.size) continue
      const theirs = strongEtag(job.d.etag)
      const ours = strongEtag(info.etag)
      if (theirs && ours) {
        if (theirs === ours) return match(job, 'same-file')
        continue
      }
      const sameName = job.d.name.toLowerCase() === info.name.toLowerCase()
      const sameDate =
        !job.d.lastModified || !info.lastModified || job.d.lastModified === info.lastModified
      if (sameName && sameDate) return match(job, 'maybe')
    }
    return undefined
  }

  // ── Adding ─────────────────────────────────────────────────────────────

  async add(request: AddRequest): Promise<Download> {
    if (request.torrent) return this.addTorrent(request)
    const info = request.info ?? (await this.check(request.url, request.headers))
    const s = this.settings.get()
    const folder = request.folder || s.folder
    const name = safeName(request.name || info.name)
    let path = uniquePath(folder, name, this.taken)
    // Carry on from (or replace) what's left of an earlier download of it.
    let resume: { filled: number[]; packetSize: number } | undefined
    if (request.existing && !this.taken(join(folder, name))) {
      path = join(folder, name)
      const part = path + PART_SUFFIX
      const note = readNote(part)
      if (request.existing === 'continue' && noteFits(note, info)) {
        const filled = decode(note.filled)
        if (filled) resume = { filled, packetSize: note.packetSize }
      }
      if (!resume) {
        await rm(part, { force: true }).catch(() => {})
        await rm(part + NOTE_SUFFIX, { force: true }).catch(() => {})
      }
    }
    const when = request.when ?? 'now'
    const ranged = info.ranged && info.size !== undefined && info.size > 0
    const d: Download = {
      id: randomUUID(),
      kind: 'web',
      url: request.url,
      name: basename(path),
      folder,
      path,
      status: when === 'now' ? 'queued' : typeof when === 'object' ? 'scheduled' : 'queued',
      size: info.size,
      received: 0,
      ranged,
      packetSize: ranged
        ? (resume?.packetSize ?? PacketTable.packetSizeFor(info.size!))
        : undefined,
      speed: 0,
      networkSpeeds: {},
      connections: 0,
      sources: [{ url: request.url }],
      checksum: request.checksum
        ? { ...request.checksum, expected: request.checksum.expected.toLowerCase() }
        : undefined,
      etag: info.etag,
      lastModified: info.lastModified,
      perNetwork: request.perNetwork ?? 'auto',
      startAt: typeof when === 'object' ? when.at : undefined,
      priority: when === 'now' ? true : undefined,
      createdAt: Date.now(),
      headers: request.headers && Object.keys(request.headers).length ? request.headers : undefined,
      group: groupFrom(request.group)
    }
    const table = ranged ? new PacketTable(info.size!, d.packetSize!, resume?.filled) : undefined
    if (table) {
      d.packets = { total: table.count, done: table.done, active: 0, partDone: table.partDone }
      if (resume) d.received = filledBytes(table.filled)
    }
    const job: Job = {
      d,
      partPath: path + PART_SUFFIX,
      order: this.nextOrder++,
      filled: resume && table ? Array.from(table.filled) : undefined
    }
    this.jobs.set(d.id, job)
    // "Now" goes ahead of the queue, but still counts towards how many run at once.
    if (when === 'now') this.prioritize(job)
    for (const mirror of request.mirrors ?? []) {
      if (!mirror.trim() || sameLink(mirror, request.url)) continue
      void this.addMirror(d.id, mirror.trim()).catch(() => {})
    }
    this.changed()
    this.tick()
    return d
  }

  private addTorrent(request: AddRequest): Download {
    const t = request.torrent!
    const s = this.settings.get()
    let folder = request.folder || s.folder
    const name = safeName(t.info.name)
    // Never mix with something already there (a folder of its own instead), unless asked to
    // carry on from it: then every piece already there is checked against the torrent.
    const carryOn = request.existing === 'continue' && !this.taken(join(folder, name))
    if (!carryOn && (existsSync(join(folder, name)) || this.taken(join(folder, name))))
      folder = uniquePath(folder, name, this.taken)
    const files = t.files && t.files.length < t.info.files.length ? t.files : undefined
    const size = files
      ? files.reduce((sum, i) => sum + (t.info.files[i]?.length ?? 0), 0)
      : t.info.size
    const when = request.when ?? 'now'
    const d: Download = {
      id: randomUUID(),
      kind: 'torrent',
      url: request.url,
      name,
      folder,
      path: join(folder, name),
      status: typeof when === 'object' ? 'scheduled' : 'queued',
      size,
      received: 0,
      ranged: true,
      speed: 0,
      networkSpeeds: {},
      connections: 0,
      sources: [],
      perNetwork: 'auto',
      startAt: typeof when === 'object' ? when.at : undefined,
      priority: when === 'now' ? true : undefined,
      createdAt: Date.now(),
      group: groupFrom(request.group),
      infoHash: t.info.infoHash,
      files: t.info.files.map((f, i) => ({
        name:
          f.path
            .split(/[\\/]/)
            .slice(t.info.files.length > 1 ? 1 : 0)
            .join('/') || f.name,
        length: f.length,
        received: 0,
        selected: !files || files.includes(i)
      }))
    }
    const job: Job = {
      d,
      partPath: d.path,
      order: this.nextOrder++,
      torrent: { source: t.source, files }
    }
    this.jobs.set(d.id, job)
    if (when === 'now') this.prioritize(job)
    this.changed()
    this.tick()
    return d
  }

  /** Adds a backup link to a download. `sameFile`: the user said it's the same file even
   * though the server's version tag differs. */
  async addMirror(id: string, url: string, sameFile = false): Promise<Download> {
    const job = this.job(id)
    const d = job.d
    if (d.kind !== 'web') throw new Error('Only web downloads can have backup links')
    if (d.status === 'done') throw new Error('That download has finished')
    const existing = d.sources.find((s) => sameLink(s.url, url))
    if (existing && !existing.removed && !existing.dropped) return d
    const info = await this.check(url, d.headers)
    let dropped: string | undefined
    if (info.size !== d.size) dropped = 'This link has a file of a different size'
    else if (d.ranged && !info.ranged) dropped = 'This link can’t send parts of the file'
    else {
      const a = strongEtag(d.etag)
      const b = strongEtag(info.etag)
      if (!sameFile && a && b && a !== b && d.lastModified !== info.lastModified)
        dropped = 'This link has a different version of the file'
    }
    if (existing) {
      existing.removed = undefined
      existing.dropped = dropped
    } else d.sources.push({ url, dropped })
    job.transfer?.sourcesChanged()
    this.changed()
    if (dropped) throw new Error(dropped)
    return d
  }

  removeMirror(id: string, url: string): Download {
    const job = this.job(id)
    if (
      sameLink(job.d.url, url) &&
      job.d.sources.filter((s) => !s.removed && !s.dropped).length <= 1
    )
      throw new Error('A download needs at least one link')
    const source = job.d.sources.find((s) => sameLink(s.url, url))
    if (source) {
      source.removed = true
      source.dropped = 'Removed'
      job.transfer?.sourcesChanged()
      this.changed()
    }
    return job.d
  }

  // ── Actions ────────────────────────────────────────────────────────────

  private prioritize(job: Job): void {
    for (const other of this.jobs.values()) if (other !== job) other.d.priority = undefined
    job.d.priority = true
    job.order = Math.min(...[...this.jobs.values()].map((j) => j.order)) - 1
  }

  async pause(id: string): Promise<void> {
    const job = this.job(id)
    if (job.d.status === 'done' || job.d.status === 'failed') return
    clearTimeout(job.retryTimer)
    await this.stopAs(job, 'paused')
  }

  resume(id: string): void {
    const job = this.job(id)
    if (job.d.status !== 'paused' && job.d.status !== 'failed' && job.d.status !== 'scheduled')
      return
    clearTimeout(job.retryTimer)
    job.d.status = 'queued'
    job.d.message = undefined
    job.d.startAt = undefined
    this.changed()
    this.tick()
  }

  /** Back to the queue, keeping what it has. */
  async toQueue(id: string): Promise<void> {
    const job = this.job(id)
    job.d.priority = undefined
    job.d.startAt = undefined
    job.order = this.nextOrder++
    if (job.running) await this.stopAs(job, 'queued')
    else if (job.d.status !== 'done') job.d.status = 'queued'
    this.changed()
    this.tick()
  }

  /** Waits until `at`, keeping what it has. */
  async startAt(id: string, at: number): Promise<void> {
    const job = this.job(id)
    job.d.startAt = at
    job.d.priority = undefined
    if (job.running) await this.stopAs(job, 'scheduled')
    else if (job.d.status !== 'done') job.d.status = 'scheduled'
    this.changed()
  }

  /** Starts it now, ahead of the queue (even past how many run at once). */
  startNow(id: string): void {
    const job = this.job(id)
    job.d.startAt = undefined
    job.d.message = undefined
    this.prioritize(job)
    if (!job.running && job.d.status !== 'done') this.run(job)
    this.changed()
  }

  /**
   * Download first: it goes to the front and starts now. To keep to how many run at once, the
   * running download furthest back in the queue goes back to wait (keeping what it has), at
   * the front, so it carries on next. One already running gets most of the speed.
   */
  /** How many may run at once. */
  private runAtOnce(): number {
    const s = this.settings.get()
    return s.runAtOnceUnlimited ? Infinity : s.runAtOnce
  }

  async first(id: string): Promise<void> {
    const job = this.job(id)
    if (job.d.status === 'done') return
    clearTimeout(job.retryTimer)
    job.d.startAt = undefined
    job.d.message = undefined
    this.prioritize(job)
    if (!job.running) {
      const others = [...this.jobs.values()].filter((j) => j.running && j !== job)
      const stoppable = others.filter((j) => this.stoppable(j))
      if (others.length >= this.runAtOnce() && stoppable.length) {
        const bump = stoppable.sort((a, b) => b.order - a.order)[0]
        bump.order = job.order + 0.5
        await this.stopAs(bump, 'queued')
      }
      // The queue may have started it while that one stopped.
      if (!job.running && (job.d.status as string) !== 'done') {
        job.d.status = 'queued'
        this.run(job)
      }
    }
    this.changed()
    this.tick()
  }

  /** Sets, changes or removes the checksum. A finished file is checked against it now; one
   * still downloading is checked when it finishes. */
  async setChecksum(id: string, value: string): Promise<void> {
    const job = this.job(id)
    const d = job.d
    const text = value.trim().toLowerCase()
    if (!text) {
      d.checksum = undefined
      this.changed()
      return
    }
    const algorithm = detectAlgorithm(text)
    if (!algorithm) throw new Error('That doesn’t look like an MD5, SHA-1 or SHA-256 checksum.')
    d.checksum = { algorithm, expected: text }
    this.changed()
    if (d.status !== 'done') return
    const checksum = d.checksum
    checksum.result = 'checking'
    d.message = undefined
    this.changed()
    try {
      const actual = await hashFile(d.path, algorithm)
      if (d.checksum !== checksum) return
      checksum.result = actual === checksum.expected ? 'match' : 'mismatch'
    } catch {
      if (d.checksum !== checksum) return
      checksum.result = undefined
      d.message = 'The file isn’t where it was saved, so it can’t be checked'
    }
    this.changed()
  }

  /** A torrent's files to fetch (indexes). Taking some out keeps what they have on disk; adding
   * files to a finished torrent sends it back to fetch them. */
  setTorrentFiles(id: string, chosen: number[]): void {
    const job = this.job(id)
    const d = job.d
    if (d.kind !== 'torrent' || !d.files || !job.torrent) return
    const valid = [...new Set(chosen)]
      .filter((i) => i >= 0 && i < d.files!.length)
      .sort((a, b) => a - b)
    if (valid.length === 0) throw new Error('Choose at least one file')
    const all = valid.length === d.files.length
    job.torrent.files = all ? undefined : valid
    d.files.forEach((f, i) => (f.selected = valid.includes(i)))
    d.size = d.files.filter((f) => f.selected).reduce((sum, f) => sum + f.length, 0)
    d.received = d.files
      .filter((f) => f.selected)
      .reduce((sum, f) => sum + Math.min(f.length, f.received), 0)
    if (job.transfer instanceof TorrentTransfer) job.transfer.select(job.torrent.files)
    // More to fetch on a finished torrent: back to the queue to get it.
    if (d.status === 'done' && d.received < d.size) {
      d.status = 'queued'
      d.finishedAt = undefined
      this.tick()
    }
    this.changed()
  }

  /** Moves a queued download up (-1) or down (+1) among the queued. */
  reorder(id: string, by: -1 | 1): void {
    const job = this.job(id)
    const queued = [...this.jobs.values()]
      .filter((j) => j.d.status === job.d.status)
      .sort((a, b) => a.order - b.order)
    const at = queued.indexOf(job)
    const other = queued[at + by]
    if (!other) return
    ;[job.order, other.order] = [other.order, job.order]
    this.changed()
  }

  async cancel(id: string): Promise<void> {
    const job = this.job(id)
    clearTimeout(job.retryTimer)
    await this.stopAs(job, 'paused')
    this.jobs.delete(id)
    if (job.d.status !== 'done') {
      await rm(job.partPath, { force: true, recursive: job.d.kind === 'torrent' }).catch(() => {})
      await this.removeNote(job)
    }
    this.changed()
    this.tick()
  }

  /** Off the list; a finished file stays where it is (or goes to the Trash with `trash`). */
  async remove(id: string, trash = false): Promise<void> {
    const job = this.job(id)
    if (job.d.status !== 'done') return this.cancel(id)
    this.jobs.delete(id)
    if (trash && existsSync(job.d.path)) await this.trash(job.d.path)
    this.changed()
  }

  /** Gives a download a new name; its file (or part of it) is renamed on disk too. */
  async rename(id: string, newName: string): Promise<Download> {
    const job = this.job(id)
    const d = job.d
    const name = safeName(newName.trim())
    if (!newName.trim() || !name) throw new Error('Give it a name')
    if (name === d.name) return d
    if (d.kind === 'torrent' && d.status !== 'done')
      throw new Error('A torrent can be renamed once it has finished')
    if (job.finishing || d.status === 'verifying')
      throw new Error('Wait a moment: it’s just finishing')
    const path = join(d.folder, name)
    if (existsSync(path) || existsSync(path + PART_SUFFIX) || this.taken(path))
      throw new Error(`There’s already something called ${name} in that folder`)
    // A running download lets go of its file first, then carries on.
    const wasRunning = job.running !== undefined
    if (wasRunning) await this.stopAs(job, 'queued')
    if (d.status === 'done') {
      if (existsSync(d.path)) await rename(d.path, path)
    } else {
      const part = path + PART_SUFFIX
      if (existsSync(job.partPath)) await rename(job.partPath, part)
      if (existsSync(job.partPath + NOTE_SUFFIX))
        await rename(job.partPath + NOTE_SUFFIX, part + NOTE_SUFFIX).catch(() => {})
      job.partPath = part
    }
    d.path = path
    d.name = name
    if (wasRunning) this.run(job)
    this.changed()
    return d
  }

  /** Renames a group of downloads. */
  renameGroup(groupId: string, name: string): void {
    const clean = name.trim().slice(0, 200)
    if (!clean) throw new Error('Give the group a name')
    for (const job of this.jobs.values())
      if (job.d.group?.id === groupId) job.d.group = { id: groupId, name: clean }
    this.changed()
  }

  /** Puts downloads in a group, or takes them out of theirs. */
  setGroup(ids: string[], group: AddRequest['group'] | null): void {
    const clean = group ? groupFrom(group) : undefined
    if (group && !clean) throw new Error('Give the group a name')
    for (const id of ids) {
      const job = this.jobs.get(id)
      if (job) job.d.group = clean
    }
    this.changed()
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs) if (job.d.status === 'done') this.jobs.delete(id)
    this.changed()
  }

  /** Starts over from nothing: a failed checksum, or the file changed on the server. */
  async restart(id: string): Promise<void> {
    const job = this.job(id)
    clearTimeout(job.retryTimer)
    await this.stopAs(job, 'paused')
    await rm(job.partPath, { force: true }).catch(() => {})
    await this.removeNote(job)
    if (job.d.status === 'done') job.d.path = uniquePath(job.d.folder, job.d.name, this.taken)
    job.filled = undefined
    job.d.received = 0
    job.d.retries = 0
    job.d.message = undefined
    job.d.finishedAt = undefined
    job.d.etag = undefined
    job.d.lastModified = undefined
    if (job.d.checksum) job.d.checksum.result = undefined
    for (const s of job.d.sources) if (!s.removed) s.dropped = undefined
    job.d.status = 'queued'
    job.partPath = job.d.path + PART_SUFFIX
    this.prioritize(job)
    this.changed()
    this.tick()
  }

  async pauseAll(): Promise<void> {
    await Promise.all(
      [...this.jobs.values()]
        .filter((j) => ['running', 'waiting', 'queued', 'checking'].includes(j.d.status))
        .map((j) => this.stopAs(j, 'paused'))
    )
    this.changed()
  }

  resumeAll(): void {
    for (const job of this.jobs.values()) {
      if (job.d.status === 'paused') {
        job.d.status = 'queued'
        job.d.message = undefined
      }
    }
    this.changed()
    this.tick()
  }

  /** The user has seen the failed ones (the window was looked at). */
  seen(): void {
    for (const job of this.jobs.values()) job.unseen = false
  }

  get unseenFailure(): boolean {
    return [...this.jobs.values()].some((j) => j.unseen && j.d.status === 'failed')
  }

  /** Writes the list to disk now (Windows is shutting down). */
  saveNow(): void {
    this.save()
    this.file.flush()
  }

  /** Stops every transfer and saves where each one got to (quitting). */
  async suspend(): Promise<void> {
    this.quitting = true
    if (this.timer) clearInterval(this.timer)
    await Promise.all(
      [...this.jobs.values()].filter((j) => j.running).map((j) => this.stopAs(j, 'queued'))
    )
    this.save()
    this.file.flush()
  }

  private async stopAs(job: Job, status: DownloadStatus): Promise<void> {
    if (job.running) {
      job.stopAs = status
      await job.transfer?.stop()
      await job.running
    } else if (job.d.status !== 'done') {
      job.d.status = status
    }
    this.changed()
  }

  // ── Running ────────────────────────────────────────────────────────────

  private active(): number {
    let n = 0
    for (const job of this.jobs.values()) if (job.running) n++
    return n
  }

  /** Once a second: starts what's due, updates speeds, and notices when everything is done. */
  tick(): void {
    if (this.quitting) return
    const s = this.settings.get()
    const now = Date.now()
    const hours = hoursAllow(s.hours, new Date(now))
    const before = this.signature()
    for (const job of this.jobs.values()) {
      const d = job.d
      if (d.status === 'scheduled' && d.startAt !== undefined && d.startAt <= now) {
        d.startAt = undefined
        d.status = 'queued'
        this.prioritize(job)
      }
      // Download hours: outside them, the queue waits and running downloads stop.
      if (!hours && !d.startAt && (d.status === 'queued' || (job.running && !d.priority))) {
        if (job.running) void this.stopAs(job, 'scheduled')
        else d.status = 'scheduled'
        d.message = 'Waits for download hours'
      } else if (hours && d.status === 'scheduled' && d.startAt === undefined) {
        d.status = 'queued'
        d.message = undefined
      }
    }
    // Fewer at once than are running (the setting went down): the ones furthest back in the
    // queue go back to wait, keeping what they have. The one put first keeps going.
    const going = [...this.jobs.values()].filter((j) => j.running && !j.stopAs)
    let excess = going.length - this.runAtOnce()
    const bumpable = going.filter((j) => !j.d.priority && this.stoppable(j))
    for (const job of bumpable.sort((a, b) => b.order - a.order)) {
      if (excess-- <= 0) break
      void this.stopAs(job, 'queued')
    }
    const queued = [...this.jobs.values()]
      .filter((j) => j.d.status === 'queued' && !j.running)
      .sort((a, b) => a.order - b.order)
    let running = this.active()
    for (const job of queued) {
      if (running >= this.runAtOnce()) break
      this.run(job)
      running++
    }
    // Speeds and progress for the window.
    const totals: Record<string, number> = {}
    for (const job of this.jobs.values()) {
      if (!job.running) continue
      this.snapshot(job)
      for (const [id, v] of Object.entries(job.d.networkSpeeds)) totals[id] = (totals[id] ?? 0) + v
    }
    this.networks.speeds = totals
    const busy = [...this.jobs.values()].some(
      (j) => j.running || j.d.status === 'queued' || j.d.status === 'checking'
    )
    if (busy) this.busySinceAllDone = true
    else if (this.busySinceAllDone) {
      this.busySinceAllDone = false
      const anyFailed = [...this.jobs.values()].some((j) => j.d.status === 'failed')
      if (!anyFailed && this.finishedSinceBusy) this.events.allDone()
      this.finishedSinceBusy = false
    }
    if (running > 0 || this.signature() !== before) this.changed()
  }

  /** Each download's state, to tell whether a tick changed anything. */
  private signature(): string {
    let out = ''
    for (const job of this.jobs.values())
      out += job.d.id + job.d.status + (job.d.message ?? '') + job.order + ';'
    return out
  }

  private snapshot(job: Job): void {
    const t = job.transfer
    const d = job.d
    if (!t) return
    d.received = t.received
    if (t instanceof TorrentTransfer) {
      // Its live speed, split over the networks in the shares torrent traffic is using them.
      d.speed = t.liveSpeed
      const shares = this.torrents.speeds()
      const all = Object.values(shares).reduce((a, b) => a + b, 0)
      d.networkSpeeds = {}
      if (all > 0 && d.speed > 0)
        for (const [id, v] of Object.entries(shares)) d.networkSpeeds[id] = (d.speed * v) / all
    } else {
      d.networkSpeeds = t.speeds()
      const lanes = Object.values(d.networkSpeeds)
      // The sum of its networks, so the downloads add up to the total.
      d.speed = lanes.length ? lanes.reduce((a, b) => a + b, 0) : t.meter.rate()
    }
    d.connections = t.connections
    if (t instanceof TorrentTransfer) {
      const pieces = t.pieces
      if (pieces) d.packets = { ...pieces, partDone: 0 }
      if (t.size) d.size = t.size
      t.fileProgress?.forEach((bytes, i) => {
        if (d.files?.[i]) d.files[i].received = bytes
      })
    } else if (t.table) {
      d.packets = {
        total: t.table.count,
        done: t.table.done,
        active: t.table.active,
        partDone: t.table.partDone
      }
    }
    d.eta =
      d.size !== undefined && d.speed > 0 ? Math.max(0, (d.size - d.received) / d.speed) : undefined
    if (d.status === 'running' || d.status === 'waiting') {
      const none = this.networks.allowed().length === 0
      d.status = none ? 'waiting' : 'running'
      d.message = none ? 'Waiting for a network' : undefined
    }
  }

  /** Still fetching, so it can go back to wait. Not one that's finishing (being moved into
   * place or checked against its checksum). */
  private stoppable(job: Job): boolean {
    return job.d.status === 'running' && !job.finishing
  }

  private run(job: Job): void {
    // Never two transfers for one download: they'd fight over its file.
    if (job.running) return
    const d = job.d
    clearTimeout(job.retryTimer)
    d.retryAt = undefined
    d.status = 'running'
    d.message = undefined
    job.stopAs = undefined
    job.running = this.runTransfer(job).finally(() => {
      job.running = undefined
      job.transfer = undefined
      d.speed = 0
      d.networkSpeeds = {}
      d.connections = 0
      d.eta = undefined
      if (d.packets) d.packets.active = 0
      this.changed()
      this.tick()
    })
  }

  private async runTransfer(job: Job): Promise<void> {
    const d = job.d
    try {
      if (d.kind === 'torrent') return await this.runTorrent(job)
      if (job.filled && d.ranged) await this.checkUnchanged(job)
      const transfer = new WebTransfer(
        {
          partPath: job.partPath,
          size: d.size,
          ranged: d.ranged,
          packetSize: d.packetSize ?? 0,
          filled: job.filled,
          sources: d.sources,
          headers: d.headers ?? {},
          perNetwork: d.perNetwork
        },
        {
          networks: () => this.networks.allowed(),
          limiters: (id) => this.networks.limitersFor(id),
          received: (id, bytes) => this.networks.received(id, bytes),
          networkHealth: (id, working) => this.networks.health(id, working),
          sourceDropped: () => this.changed()
        }
      )
      job.transfer = transfer
      // Every 2 s the data goes to the disk, and only then is it recorded as there: after a
      // power cut, nothing is marked done that didn't reach the disk.
      const saver = setInterval(() => {
        const filled = transfer.table ? Array.from(transfer.table.filled) : undefined
        void transfer.flush().then(() => {
          if (job.transfer !== transfer) return
          job.filled = filled
          this.writeNote(job)
          this.save()
        })
      }, 2000)
      let result: 'done' | 'stopped'
      try {
        result = await transfer.run()
      } finally {
        clearInterval(saver)
        job.filled = transfer.table ? Array.from(transfer.table.filled) : undefined
        d.received = transfer.received
        if (transfer.table)
          d.packets = {
            total: transfer.table.count,
            done: transfer.table.done,
            active: 0,
            partDone: transfer.table.partDone
          }
      }
      if (result === 'stopped') {
        d.status = job.stopAs ?? 'paused'
        this.writeNote(job)
        return
      }
      job.finishing = true
      try {
        await this.finish(job)
      } finally {
        job.finishing = undefined
      }
    } catch (error) {
      if (job.stopAs) {
        d.status = job.stopAs
        return
      }
      this.fail(job, error)
    }
  }

  private async runTorrent(job: Job): Promise<void> {
    const d = job.d
    const transfer = new TorrentTransfer(
      this.torrents,
      d.id,
      job.torrent!.source,
      d.folder,
      job.torrent!.files,
      d.received
    )
    job.transfer = transfer
    const result = await transfer.run()
    d.received = transfer.received
    if (result === 'stopped') {
      d.status = job.stopAs ?? 'paused'
      return
    }
    if (d.size !== undefined) d.received = d.size
    if (d.packets) d.packets = { ...d.packets, done: d.packets.total, active: 0 }
    // Every chosen file is complete (the last progress report may not have come).
    for (const f of d.files ?? []) if (f.selected) f.received = f.length
    d.status = 'done'
    d.finishedAt = Date.now()
    d.priority = undefined
    d.retries = undefined
    d.message = undefined
    this.finishedSinceBusy = true
    this.events.finished(d)
  }

  /** Resuming: the file on the server must still be the one we have part of. */
  private async checkUnchanged(job: Job): Promise<void> {
    const d = job.d
    const info = await this.check(
      d.sources.find((s) => !s.dropped && !s.removed)?.url ?? d.url,
      d.headers
    )
    const changed =
      info.size !== d.size ||
      (strongEtag(d.etag) &&
        strongEtag(info.etag) &&
        strongEtag(d.etag) !== strongEtag(info.etag)) ||
      (d.lastModified && info.lastModified && d.lastModified !== info.lastModified)
    if (changed)
      throw new DownloadError('The file changed on the server since this download started', 'fatal')
  }

  private async finish(job: Job): Promise<void> {
    const d = job.d
    let path = d.path
    if (existsSync(path)) path = uniquePath(dirname(path), basename(path), this.taken)
    await rename(job.partPath, path)
    await this.removeNote(job)
    d.path = path
    d.name = basename(path)
    d.received = (await stat(path)).size
    if (d.size === undefined) d.size = d.received
    job.filled = undefined
    if (d.checksum) {
      d.status = 'verifying'
      this.changed()
      const actual = await hashFile(path, d.checksum.algorithm)
      d.checksum.result = actual === d.checksum.expected ? 'match' : 'mismatch'
    }
    d.status = 'done'
    d.finishedAt = Date.now()
    d.priority = undefined
    d.retries = undefined
    d.message = undefined
    this.finishedSinceBusy = true
    this.events.finished(d)
  }

  private fail(job: Job, error: unknown): void {
    const d = job.d
    d.status = 'failed'
    d.message = describe(error)
    job.unseen = true
    const scope = error instanceof DownloadError ? error.scope : 'network'
    const retryable = !isDiskError(error) && scope !== 'fatal' && scope !== 'source'
    d.retryAt = undefined
    if (retryable && (d.retries ?? 0) < MAX_RETRIES) {
      d.retryAt = Date.now() + RETRY_MS
      job.retryTimer = setTimeout(() => {
        d.retryAt = undefined
        if (d.status !== 'failed') return
        d.retries = (d.retries ?? 0) + 1
        d.status = 'queued'
        this.changed()
        this.tick()
      }, RETRY_MS)
      job.retryTimer.unref()
    }
    this.events.failed(d)
  }
}

/** The file is in place, complete, and its part file is gone. */
function finishedOnDisk(d: Download, partPath: string): boolean {
  if (existsSync(partPath) || !existsSync(d.path) || d.size === undefined) return false
  try {
    return statSync(d.path).size === d.size
  } catch {
    return false
  }
}

export function hashFile(path: string, algorithm: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export const partPathOf = (path: string): string =>
  join(dirname(path), basename(path) + PART_SUFFIX)
export type { Source }

/** A group as given by the window: an id and a name, both kept short. */
function groupFrom(group: AddRequest['group']): Download['group'] {
  if (!group || typeof group.id !== 'string' || typeof group.name !== 'string') return undefined
  const name = group.name.trim().slice(0, 200)
  return group.id && name ? { id: group.id.slice(0, 64), name } : undefined
}
