import { BrowserWindow, Menu, nativeImage, Tray, type NativeImage } from 'electron'

/** Pixels drawn in code: tray icons with the speed as digits, and taskbar badges. */
class Bitmap {
  readonly data: Buffer
  constructor(readonly size: number) {
    this.data = Buffer.alloc(size * size * 4)
  }
  /** nativeImage bitmaps are BGRA. */
  put(x: number, y: number, rgba: number): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    const at = (y * this.size + x) * 4
    this.data[at] = (rgba >>> 8) & 255
    this.data[at + 1] = (rgba >>> 16) & 255
    this.data[at + 2] = (rgba >>> 24) & 255
    this.data[at + 3] = rgba & 255
  }
  circle(cx: number, cy: number, r: number, rgba: number, edge?: number): void {
    for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++)
      for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (d <= r) this.put(x, y, rgba)
        else if (edge !== undefined && d <= r + 1.5) this.put(x, y, edge)
      }
  }
  rect(x0: number, y0: number, w: number, h: number, rgba: number): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.put(x, y, rgba)
  }
  image(scale = 2): NativeImage {
    return nativeImage.createFromBitmap(this.data, {
      width: this.size,
      height: this.size,
      scaleFactor: scale
    })
  }
}

/** Digits five pixels tall: each row is three bits, left to right. */
const FONT: Record<string, number[]> = {
  '0': [7, 5, 5, 5, 7],
  '1': [2, 6, 2, 2, 7],
  '2': [7, 1, 7, 4, 7],
  '3': [7, 1, 3, 1, 7],
  '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7],
  '6': [7, 4, 7, 5, 7],
  '7': [7, 1, 2, 2, 2],
  '8': [7, 5, 7, 5, 7],
  '9': [7, 5, 7, 1, 7]
}

const SIZE = 32
const INK = 0xf2a46aff
const HALO = 0x1a120cdd
const RED = 0xe5252aff
const WHITE = 0xffffffff

/** The speed in as few characters as fit the tray: "0.8", "9.4", "48", "999". */
export function trayText(value: number): string {
  if (!(value > 0.05)) return '0'
  if (value < 10) return value.toFixed(1)
  return String(Math.min(999, Math.round(value)))
}

function glyphWidth(ch: string): number {
  return ch === '.' ? 1 : 3
}

/** The tray icon showing `text` (digits and a point), with a red dot for a failure. */
export function digitsIcon(text: string, failed: boolean): NativeImage {
  const b = new Bitmap(SIZE)
  const gap = 1
  const width = (s: number): number =>
    [...text].reduce((w, ch) => w + glyphWidth(ch) * s, 0) + (text.length - 1) * gap * s
  const scale = width(3) <= SIZE - 2 ? 3 : 2
  let x = Math.floor((SIZE - width(scale)) / 2)
  const y0 = Math.floor((SIZE - 5 * scale) / 2) + (failed ? 3 : 0)
  const on: [number, number][] = []
  for (const ch of text) {
    if (ch === '.') {
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) on.push([x + dx, y0 + 4 * scale + dy])
    } else {
      FONT[ch]?.forEach((bits, row) => {
        for (let col = 0; col < 3; col++) {
          if (!(bits & (4 >> col))) continue
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              on.push([x + col * scale + dx, y0 + row * scale + dy])
        }
      })
    }
    x += (glyphWidth(ch) + gap) * scale
  }
  // A dark edge round each digit so it reads on light and dark taskbars.
  for (const [px, py] of on)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) b.put(px + dx, py + dy, HALO)
  for (const [px, py] of on) b.put(px, py, INK)
  if (failed) b.circle(SIZE - 5, 5, 4, RED, HALO)
  return b.image()
}

/** The app icon for the tray, with a red dot for a failure. */
export function iconWithDot(base: NativeImage, failed: boolean): NativeImage {
  const small = base.resize({ width: SIZE, height: SIZE, quality: 'best' })
  if (!failed) return small
  const b = new Bitmap(SIZE)
  small.toBitmap().copy(b.data)
  b.circle(SIZE - 6, 6, 5, RED, HALO)
  return b.image(1)
}

/** Taskbar badge: something is downloading (a down arrow). */
export function downloadingBadge(): NativeImage {
  const b = new Bitmap(SIZE)
  b.circle(16, 16, 15, 0x6b4f33ff)
  b.circle(16, 16, 14, 0xeedab9ff)
  const ink = 0x3a2a1cff
  b.rect(14, 7, 4, 11, ink)
  for (let row = 0; row < 7; row++) b.rect(9 + row, 17 + row, 14 - 2 * row, 1, ink)
  return b.image()
}

/** Taskbar badge: a download failed ("!"). */
export function failedBadge(): NativeImage {
  const b = new Bitmap(SIZE)
  b.circle(16, 16, 14, RED)
  b.rect(14, 7, 4, 12, WHITE)
  b.rect(14, 22, 4, 4, WHITE)
  return b.image()
}

export interface TrayStatus {
  /** Bytes/s for everything. */
  speed: number
  downloading: number
  queued: number
  failed: number
  /** A failure the user hasn't looked at yet. */
  unseenFailure: boolean
}

/** The tray icon and the taskbar badge, kept up to date with the downloads. */
export class TrayIcon {
  private tray: Tray | null = null
  private shown = ''
  private badge = ''
  style: 'speed' | 'icon' = 'speed'
  unit: 'bytes' | 'bits' = 'bytes'
  taskbarBadge = true
  /** Tests read what was drawn. */
  readonly drawn: { text?: string; failed: boolean; tooltip: string; badge: string } = {
    failed: false,
    tooltip: '',
    badge: ''
  }

  constructor(
    private readonly icon: NativeImage,
    private readonly actions: { open(): void; pauseAll(): void; resumeAll(): void; quit(): void },
    private readonly window: () => BrowserWindow | null
  ) {}

  get exists(): boolean {
    return this.tray !== null
  }

  ensure(): void {
    if (this.tray) return
    this.tray = new Tray(iconWithDot(this.icon, false))
    this.tray.setToolTip('Mascot')
    this.tray.on('click', () => this.actions.open())
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Mascot', click: () => this.actions.open() },
        { type: 'separator' },
        { label: 'Pause all', click: () => this.actions.pauseAll() },
        { label: 'Resume all', click: () => this.actions.resumeAll() },
        { type: 'separator' },
        { label: 'Quit Mascot', click: () => this.actions.quit() }
      ])
    )
  }

  update(status: TrayStatus): void {
    const value = this.unit === 'bits' ? (status.speed * 8) / 1e6 : status.speed / (1024 * 1024)
    const unit = this.unit === 'bits' ? 'Mbps' : 'MB/s'
    const digits = status.downloading > 0 && this.style === 'speed' ? trayText(value) : undefined
    const failed = status.unseenFailure
    const parts = ['Mascot']
    if (status.downloading)
      parts.push(
        `${status.downloading} downloading · ${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`
      )
    if (status.queued) parts.push(`${status.queued} queued`)
    if (status.failed) parts.push(`${status.failed} failed`)
    const tooltip = parts.join('\n')
    const key = `${digits}|${failed}`
    if (this.tray && key !== this.shown) {
      this.tray.setImage(
        digits !== undefined ? digitsIcon(digits, failed) : iconWithDot(this.icon, failed)
      )
      this.shown = key
    }
    this.tray?.setToolTip(tooltip)
    Object.assign(this.drawn, { text: digits, failed, tooltip })
    // Taskbar (Windows): a badge, never a progress bar.
    const badge = failed
      ? 'failed'
      : status.downloading > 0 && this.taskbarBadge
        ? 'downloading'
        : ''
    if (badge !== this.badge) {
      this.badge = badge
      this.drawn.badge = badge
      const window = this.window()
      if (window && process.platform === 'win32') {
        window.setOverlayIcon(
          badge === 'failed' ? failedBadge() : badge === 'downloading' ? downloadingBadge() : null,
          badge === 'failed' ? 'A download failed' : badge === 'downloading' ? 'Downloading' : ''
        )
      }
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
