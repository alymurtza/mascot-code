import { existsSync } from 'node:fs'

/** A link the app can take from outside: a web link, a magnet link, or a .torrent file. Our own
 * mascot:// links (from the browser extension) carry a web link as `?url=`. */
export function acceptLink(candidate: string): string | undefined {
  const text = candidate.trim()
  if (/^https?:\/\//i.test(text) || /^magnet:\?/i.test(text)) return text
  if (/^mascot:/i.test(text)) {
    try {
      const inner = new URL(text).searchParams.get('url')
      return inner ? acceptLink(inner) : undefined
    } catch {
      return undefined
    }
  }
  if (/\.torrent$/i.test(text) && existsSync(text)) return text
  return undefined
}

/** The first link in a command line (after the program and its own switches). */
export function linkFromArgs(argv: string[]): string | undefined {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--')) continue
    const link = acceptLink(arg)
    if (link) return link
  }
  return undefined
}
