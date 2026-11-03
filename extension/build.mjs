// Builds the extension for Chrome/Edge and Firefox into extension/dist, with a .zip of each.
// The version follows the app's package.json.
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const version = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
const base = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
const icon = readFileSync(join(here, '..', 'resources', 'icon.png'))
const iconOff = readFileSync(join(here, 'icon-off.png'))
// The public half of the extension's key: it fixes the extension's ID, which the app's native
// messaging host allows. (Stores replace it with their own.)
const key = readFileSync(join(here, 'public-key.txt'), 'utf8').trim()

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A .zip of the files in `dir` (deflated). */
function zip(dir) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const name of readdirSync(dir).sort()) {
    const data = readFileSync(join(dir, name))
    const packed = deflateRawSync(data)
    const nameBuf = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + packed.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length / 2, 8)
  end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

const targets = {
  chrome: { ...base, version, key, background: { service_worker: 'background.js' } },
  // For the Chrome Web Store, which refuses the key (it gives the extension its own ID).
  'chrome-store': { ...base, version, background: { service_worker: 'background.js' } },
  firefox: {
    ...base,
    version,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: { id: 'downloader@mascot.app', strict_min_version: '115.0' }
    }
  }
}

const dist = join(here, 'dist')
rmSync(dist, { recursive: true, force: true })
for (const [name, manifest] of Object.entries(targets)) {
  const out = join(dist, name)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  for (const file of ['background.js', 'popup.html', 'popup.js'])
    copyFileSync(join(here, 'src', file), join(out, file))
  // The app icon at each size the browser asks for (it scales the one image).
  for (const size of [16, 32, 48, 128]) {
    writeFileSync(join(out, `icon-${size}.png`), icon)
    writeFileSync(join(out, `icon-off-${size}.png`), iconOff)
  }
  const label = { chrome: 'Chrome', 'chrome-store': 'Chrome-Store', firefox: 'Firefox' }[name]
  writeFileSync(join(dist, `Mascot-Extension-${label}.zip`), zip(out))
}
console.log('extension built:', readdirSync(dist).join(', '))
