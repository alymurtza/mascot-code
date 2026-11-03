import type { Rule } from './settings'

/** File types by extension, for folder rules and "sort into folders by type". */
export const TYPES: Record<string, string[]> = {
  Videos: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv', 'flv'],
  Music: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma'],
  Images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'bmp', 'tiff'],
  Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'odt', 'csv'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'xz', 'bz2', 'tgz', 'zst'],
  Programs: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk', 'msix'],
  'Disk images': ['iso', 'img', 'vhd', 'vhdx', 'vmdk'],
  Torrents: ['torrent']
}

export const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function typeOf(name: string): string | undefined {
  const ext = extOf(name)
  return Object.keys(TYPES).find((type) => TYPES[type].includes(ext))
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Whether a file name contains `text` (any case), or with * as a wildcard, fits the whole
 * pattern ("report-*.pdf"). */
export function nameMatches(name: string, text: string): boolean {
  const n = name.toLowerCase()
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (!t.includes('*')) return n.includes(t)
  const re = new RegExp(
    '^' +
      t
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$'
  )
  return re.test(n)
}

/** The first rule that matches a file name and link. A torrent (magnet link or .torrent) is of
 * the Torrents type whatever its name; `page` is where a link came from, for site rules when
 * the link itself has no site (a magnet). */
export function matchRule(
  rules: Rule[],
  name: string,
  url: string,
  options: { torrent?: boolean; page?: string } = {}
): Rule | undefined {
  const torrent = options.torrent || /^magnet:/i.test(url)
  const ext = torrent ? 'torrent' : extOf(name)
  const host = hostOf(url) || (options.page ? hostOf(options.page) : '')
  return rules.find((rule) => {
    const value = rule.value.trim().toLowerCase()
    if (!value) return false
    if (rule.match === 'type') return (torrent ? 'torrents' : typeOf(name)?.toLowerCase()) === value
    if (rule.match === 'name') return nameMatches(name, value)
    if (rule.match === 'extension')
      return value
        .split(/[\s,]+/)
        .map((e) => e.replace(/^\./, ''))
        .includes(ext)
    const site = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    return host === site || host.endsWith('.' + site)
  })
}

/** A name from a rule's pattern: {name} {ext} {date} {site}. */
export function renameWith(
  pattern: string | undefined,
  name: string,
  url: string,
  now = new Date()
): string {
  if (!pattern?.trim()) return name
  const ext = extOf(name)
  const stem = ext ? name.slice(0, -(ext.length + 1)) : name
  const date = now.toISOString().slice(0, 10)
  const out = pattern
    // No extension: drop the dot before it too.
    .replaceAll('.{ext}', ext ? '.{ext}' : '')
    .replaceAll('{name}', stem)
    .replaceAll('{ext}', ext)
    .replaceAll('{date}', date)
    .replaceAll('{site}', hostOf(url))
    .trim()
    // Windows doesn't allow a name ending in a dot or space.
    .replace(/[. ]+$/, '')
  return out || name
}

/** "Rule: File is a video → ~/Videos" for the user. */
export function describeRule(rule: Rule): string {
  if (rule.match === 'type')
    return `File is ${/^[aeiou]/i.test(rule.value) ? 'an' : 'a'} ${rule.value.replace(/s$/, '').toLowerCase()}`
  if (rule.match === 'extension')
    return `File ends in ${rule.value
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((e) => '.' + e.replace(/^\./, ''))
      .join(', ')}`
  if (rule.match === 'name')
    return rule.value.includes('*')
      ? `Name is like ${rule.value.trim()}`
      : `Name contains “${rule.value.trim()}”`
  return `Link is from ${rule.value}`
}
