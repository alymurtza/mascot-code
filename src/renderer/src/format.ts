import type { Download } from '@shared/download'

export type SpeedUnit = 'bytes' | 'bits'

const MB = 1024 * 1024

export function size(bytes: number | undefined): string {
  if (bytes === undefined) return 'Unknown size'
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB'
  if (bytes >= MB) {
    const mb = bytes / MB
    return (mb < 100 ? mb.toFixed(1) : Math.round(mb)) + ' MB'
  }
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

/** A speed as a number and its unit: MB/s or Mbps. */
export function speedParts(bytesPerSecond: number, unit: SpeedUnit): [string, string] {
  const value = unit === 'bits' ? (bytesPerSecond * 8) / 1e6 : bytesPerSecond / MB
  return [
    value >= 100 ? Math.round(value).toString() : value.toFixed(1),
    unit === 'bits' ? 'Mbps' : 'MB/s'
  ]
}

export const speed = (bytesPerSecond: number, unit: SpeedUnit): string =>
  speedParts(bytesPerSecond, unit).join(' ')

/** Bytes/s in the chosen unit, as a plain number. */
export const inUnit = (bytesPerSecond: number, unit: SpeedUnit): number =>
  unit === 'bits' ? (bytesPerSecond * 8) / 1e6 : bytesPerSecond / MB

/** Bytes/s from a number typed in the chosen unit. */
export const fromUnit = (value: number, unit: SpeedUnit): number =>
  unit === 'bits' ? (value * 1e6) / 8 : value * MB

export function duration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
  return `${Math.max(1, Math.ceil(seconds))} s`
}

export const count = (n: number): string => n.toLocaleString('en-US')

/** "ISO", "ZIP": the file's extension for its tile. */
export function fileTag(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && name.length - dot <= 5 ? name.slice(dot + 1).toUpperCase() : 'FILE'
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** "Tonight at 01:00", "Saturday at 02:00", "12 Nov at 09:00". */
export function when(at: number, now = Date.now()): string {
  const date = new Date(at)
  const today = new Date(now)
  const days = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000
  )
  const time = clock(at)
  if (days === 0)
    return date.getHours() >= 18 || date.getHours() < 5 ? `Tonight at ${time}` : `Today at ${time}`
  if (days === 1) return date.getHours() < 5 ? `Tonight at ${time}` : `Tomorrow at ${time}`
  if (days > 1 && days < 7) return `${date.toLocaleDateString([], { weekday: 'long' })} at ${time}`
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`
}

/** Finished at, and how long it took. */
export function finishedNote(d: Download): string {
  if (!d.finishedAt) return 'Finished'
  const took = Math.max(1, Math.round((d.finishedAt - d.createdAt) / 1000))
  return `Finished ${clock(d.finishedAt)} · took ${duration(took)}`
}

export const shortPath = (path: string): string => {
  const home = /^(\/home\/[^/]+|\/Users\/[^/]+|[A-Z]:\\Users\\[^\\]+)/i.exec(path)
  return home ? '~' + path.slice(home[0].length) : path
}

/** A path short enough to show: its start and its end (the file or last folder) with "…"
 * between, when it's longer than `max` characters. */
export const fitPath = (path: string, max = 70): string => {
  const p = shortPath(path)
  const chars = Array.from(p)
  if (chars.length <= max) return p
  const tail = Math.ceil(max * 0.6)
  return chars.slice(0, max - tail - 1).join('') + '…' + chars.slice(-tail).join('')
}
