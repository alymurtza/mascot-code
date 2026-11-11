import type { TorrentInfo, TorrentSource } from './torrent'

export type DownloadStatus =
  | 'checking' // looking at the link
  | 'queued' // waiting its turn
  | 'scheduled' // waiting for a set time or download hours
  | 'running'
  | 'waiting' // running, but no network can be used right now
  | 'paused'
  | 'verifying' // checking the checksum
  | 'done'
  | 'failed'

export type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha256'

export interface Checksum {
  algorithm: ChecksumAlgorithm
  expected: string
  /** 'checking' while a finished file is checked again. */
  result?: 'match' | 'mismatch' | 'checking'
}

/** A link the file is fetched from: the main link or a backup link. */
export interface Source {
  url: string
  /** Set when the link stopped being used, with why. */
  dropped?: string
  /** Removed by the user: kept only so the same link isn't added back automatically. */
  removed?: boolean
}

export interface Download {
  id: string
  kind: 'web' | 'torrent'
  /** The link the user gave. */
  url: string
  name: string
  /** Folder the file is saved in. */
  folder: string
  /** Where the file is (or will be) saved: folder and name. */
  path: string
  status: DownloadStatus
  /** Total size in bytes, when known. */
  size?: number
  received: number
  /** Whether the server lets the file be fetched in parts. */
  ranged: boolean
  packetSize?: number
  packets?: { total: number; done: number; active: number; partDone: number }
  /** Bytes/s now, overall and per network id. */
  speed: number
  networkSpeeds: Record<string, number>
  connections: number
  sources: Source[]
  checksum?: Checksum
  /** Why it failed, or why it's waiting, in words for the user. */
  message?: string
  /** Seconds left at the current speed. */
  eta?: number
  etag?: string
  lastModified?: string
  /** Connections per network: a number, or 'auto'. */
  perNetwork: 'auto' | number
  /** Local time to start at (ms since epoch). */
  startAt?: number
  /** Do this first. */
  priority?: boolean
  createdAt: number
  finishedAt?: number
  /** Automatic retries made since it last failed. */
  retries?: number
  /** When it will be retried by itself. */
  retryAt?: number
  /** Request headers the browser extension passed on (cookies, referrer). */
  headers?: Record<string, string>
  /** Torrent: info hash. */
  infoHash?: string
  /** Torrent: its files, in order; `name` is the path inside the torrent. */
  files?: TorrentFile[]
  /** The group it was added in, with others (shown together as one row). */
  group?: DownloadGroup
}

/** Downloads added together. */
export interface DownloadGroup {
  id: string
  name: string
}

export interface TorrentFile {
  name: string
  length: number
  /** Bytes on disk. */
  received: number
  /** Being fetched (chosen by the user). */
  selected: boolean
}

/** What checking a link found. */
export interface LinkInfo {
  url: string
  /** Where the link led after redirects. */
  finalUrl: string
  name: string
  size?: number
  ranged: boolean
  etag?: string
  lastModified?: string
  contentType?: string
}

/** What adding a link would duplicate. */
export interface DuplicateMatch {
  /** same-link: that link is already a download. same-file: the same file from another link
   * (size and ETag agree). maybe: only the name and size agree. finished: already downloaded
   * and still on disk. failed: a download of it failed. on-disk: a file of that name is already
   * in the folder, though not in the list. partial: part of it is in the folder, left from a
   * download no longer in the list (a torrent's folder, or a web download's part file). */
  kind: 'same-link' | 'same-file' | 'maybe' | 'finished' | 'failed' | 'on-disk' | 'partial'
  /** The download it matches ('' for on-disk). */
  id: string
  name: string
  status: DownloadStatus
  /** on-disk, partial: the file (or torrent folder) that's there. */
  path?: string
  /** partial: whether Mascot can carry on from it, and how much of it is there. */
  resumable?: boolean
  received?: number
  size?: number
}

export interface AddRequest {
  url: string
  /** From checking the link first; checked again if missing. */
  info?: LinkInfo
  name?: string
  folder?: string
  checksum?: Omit<Checksum, 'result'>
  mirrors?: string[]
  when?: 'now' | 'queue' | { at: number }
  perNetwork?: 'auto' | number
  headers?: Record<string, string>
  /** A magnet link or .torrent file, with what's in it and the files to get (all if unset). */
  torrent?: { source: TorrentSource; info: TorrentInfo; files?: number[] }
  /** Added together with others, as one group. */
  group?: DownloadGroup
  /** What's left of an earlier download of it in the folder: carry on from it, or replace it. */
  existing?: 'continue' | 'replace'
}

export type DownloadAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'remove'
  | 'trash'
  | 'retry'
  | 'restart'
  | 'first'
  | 'queue'
  | 'start-now'
