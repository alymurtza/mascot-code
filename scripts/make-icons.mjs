// Draws the app icon (resources/icon.png, build/icon.png, and the extension's grey extension/icon-off.png) with no image tools: shapes are
// tested per pixel at 4×4 samples and written as a PNG.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4)
    }
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(size, 0)
  head.writeUInt32BE(size, 4)
  head[8] = 8
  head[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
// In unit coordinates (0..1).
const roundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return Math.hypot(x - cx, y - cy) <= r
}
// A rounded rectangle with its own radius for the top and the bottom corners.
const tile = (x, y, x0, y0, x1, y1, rTop, rBottom) => {
  const r = y < (y0 + y1) / 2 ? rTop : rBottom
  return roundRect(x, y, x0, y0, x1, y1, r)
}

// The Mascot face: a cream tile (lighter at the top left) with a faint brown edge and two dark
// brown eyes. (Inside the app, the title bar's face takes the theme's colour instead.) Proportions from the 30-unit mark: corners 10 (top) and 12 (bottom), eyes
// 5×7 at 8 units from each side and 11 from the top.
const u = (n) => 0.04 + (n / 30) * 0.92
function shade(x, y, grey = false) {
  if (!tile(x, y, u(0), u(0), u(30), u(30), (10 / 30) * 0.92, (12 / 30) * 0.92)) return null
  // 160° gradient from the light cream (#fbf2e2) to the cream (#eedab9).
  const t = Math.min(1, Math.max(0, 0.5 + (x - 0.5) * 0.342 + (y - 0.5) * 0.94))
  const color = grey ? mix([214, 208, 203], [178, 170, 163], t) : mix([251, 242, 226], [238, 218, 185], t)
  const eye = (left) => roundRect(x, y, u(left), u(11), u(left + 5), u(18), (3 / 30) * 0.92)
  if (eye(8) || eye(17)) return grey ? [72, 66, 62] : [58, 42, 28]
  // A faint edge, so the light tile shows on light backgrounds.
  const e = (0.7 / 30) * 0.92
  const inner = tile(x, y, u(0) + e, u(0) + e, u(30) - e, u(30) - e, (10 / 30) * 0.92 - e, (12 / 30) * 0.92 - e)
  if (!inner && !grey) return mix(color, [90, 60, 30], 0.28)
  return color
}

function render(size, grey = false) {
  const n = 4
  return png(size, (px, py) => {
    let r = 0,
      g = 0,
      b = 0,
      a = 0
    for (let sy = 0; sy < n; sy++)
      for (let sx = 0; sx < n; sx++) {
        const c = shade((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size, grey)
        if (!c) continue
        r += c[0]
        g += c[1]
        b += c[2]
        a++
      }
    if (!a) return [0, 0, 0, 0]
    return [
      Math.round(r / a),
      Math.round(g / a),
      Math.round(b / a),
      Math.round((a / (n * n)) * 255)
    ]
  })
}

mkdirSync('resources', { recursive: true })
mkdirSync('build', { recursive: true })
writeFileSync('resources/icon.png', render(256))
writeFileSync('build/icon.png', render(1024))
// The extension's toolbar icon while Mascot is closed or the extension is paused.
writeFileSync('extension/icon-off.png', render(128, true))
console.log('icons written')
