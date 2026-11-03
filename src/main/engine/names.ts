import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/** A name that is safe to save under on every system. */
export function safeName(raw: string): string {
  let name = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  if (!name) name = 'download'
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  if (RESERVED.test(stem)) name = '_' + name
  if (Buffer.byteLength(name) > 200) {
    const ext = extname(name).slice(0, 20)
    // Whole characters only (an emoji is two code units).
    const base = Array.from(name.slice(0, name.length - ext.length))
    while (Buffer.byteLength(base.join('') + ext) > 200) base.pop()
    name = base.join('').trimEnd() + ext
  }
  return name
}

/** The name from a Content-Disposition header, if it has one. */
export function nameFromDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''))
    } catch {
      // fall through to the plain name
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  return plain ? (plain[2] ?? plain[1]).trim() : undefined
}

/** The last part of the link's path, decoded. */
export function nameFromUrl(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : undefined
  } catch {
    return undefined
  }
}

/** `name` in `folder`, or "name (2).ext" and so on if that is taken (or reserved). */
export function uniquePath(
  folder: string,
  name: string,
  taken: (path: string) => boolean = () => false
): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = join(folder, n === 1 ? name : `${stem} (${n})${ext}`)
    if (!existsSync(candidate) && !existsSync(candidate + PART_SUFFIX) && !taken(candidate))
      return candidate
  }
}

/** A file being downloaded is saved under its name plus this, until it's complete. */
export const PART_SUFFIX = '.mascot-part'
