import type { Download } from './download'

/** The file name a link points at ('' when it has none, like a magnet link). */
function fileOf(link: string): string {
  try {
    const u = new URL(link)
    if (!/^https?:$/.test(u.protocol)) return ''
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
  } catch {
    return ''
  }
}

/** What file names start with ("episode-01.mkv", "episode-02.mkv": "episode"), or ''. */
export function commonName(names: string[]): string {
  if (names.length > 1 && names.every(Boolean)) {
    let prefix = names[0]
    for (const n of names.slice(1)) {
      let i = 0
      while (i < prefix.length && i < n.length && prefix[i].toLowerCase() === n[i].toLowerCase())
        i++
      prefix = prefix.slice(0, i)
    }
    // "episode-0" → "episode"; "Show.S01E" → "Show.S01"
    const clean = prefix
      .replace(/[\s._\-([]*[0-9]*$/, '')
      .replace(/(\d)(?:e|ep|part)$/i, '$1')
      .replace(/[\s._\-([]+$/, '')
    if (clean.length >= 3) return clean
  }
  return ''
}

/** A name for links added together: what their file names start with, else their site when
 * they share one, else how many there are. */
export function groupNameFor(links: string[]): string {
  const common = commonName(links.map(fileOf))
  if (common) return common
  const hosts = new Set(
    links.map((l) => {
      try {
        return new URL(l).hostname.replace(/^www\./, '')
      } catch {
        return ''
      }
    })
  )
  const [host] = hosts
  if (hosts.size === 1 && host) return host
  return `${links.length} downloads`
}

export type Section = 'attention' | 'running' | 'queued' | 'scheduled' | 'done'

/** The section one download is shown in. */
export function sectionOf(d: Download): Section {
  switch (d.status) {
    case 'failed':
      return 'attention'
    case 'queued':
      return 'queued'
    case 'scheduled':
      return 'scheduled'
    case 'done':
      return 'done'
    default:
      return 'running'
  }
}

/** The section a group is shown in: Downloading while any of it is under way, else Needs
 * attention if any failed, else Queued, Scheduled, and Finished once all are done. */
export function groupSection(members: Download[]): Section {
  const sections = new Set(members.map(sectionOf))
  for (const s of ['running', 'attention', 'queued', 'scheduled'] as const)
    if (sections.has(s)) return s
  return 'done'
}

/** Downloads in groups, by group id, in the order they were added. */
export function groupsOf(downloads: Download[]): Map<string, Download[]> {
  const groups = new Map<string, Download[]>()
  for (const d of downloads) {
    if (!d.group) continue
    const list = groups.get(d.group.id) ?? []
    list.push(d)
    groups.set(d.group.id, list)
  }
  for (const list of groups.values()) list.sort((a, b) => a.createdAt - b.createdAt)
  return groups
}
