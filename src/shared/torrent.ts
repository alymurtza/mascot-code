/** Messages between the main process and the torrent process. */

import type { Adapter } from './network'

export type TorrentSource = { magnet: string } | { file: string /* base64 of a .torrent */ }

export interface TorrentFileInfo {
  name: string
  path: string
  length: number
}

export interface TorrentInfo {
  name: string
  infoHash: string
  files: TorrentFileInfo[]
  size: number
}

export type ToWorker =
  | { type: 'networks'; adapters: Adapter[]; bindDevices: boolean }
  | { type: 'limit'; rate: number }
  | { type: 'info'; req: number; source: TorrentSource; tmp: string }
  | { type: 'start'; id: string; source: TorrentSource; folder: string; files?: number[] }
  | { type: 'stop'; id: string }
  /** Change which files are fetched (indexes; all when unset) while it runs. */
  | { type: 'select'; id: string; files?: number[] }

export interface TorrentProgress {
  received: number
  size: number
  speed: number
  peers: number
  pieces: { total: number; done: number; active: number }
  /** Bytes on disk for each file, in the torrent's order. */
  files?: number[]
}

export type FromWorker =
  | { type: 'info'; req: number; info?: TorrentInfo; error?: string }
  | { type: 'progress'; id: string; progress: TorrentProgress }
  | { type: 'done'; id: string }
  | { type: 'stopped'; id: string }
  | { type: 'error'; id: string; message: string }
  /** Bytes received per network since the last report. */
  | { type: 'usage'; bytes: Record<string, number> }
