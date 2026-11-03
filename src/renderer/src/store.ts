import type { AddJob } from './adding'
import { create } from 'zustand'
import type { Events, InitialState } from '@shared/api'
import type { Download } from '@shared/download'
import type { NetworkView } from '@shared/network'
import type { Settings } from '@shared/settings'

export type Page = 'downloads' | 'networks' | 'queue' | 'settings'

/** One second of speed per network, for the graph. */
export interface Sample {
  at: number
  speeds: Record<string, number>
}

export const HISTORY_SECONDS = 60

interface State {
  ready: boolean
  settings: Settings
  downloads: Download[]
  networks: NetworkView[]
  version: string
  testMode: boolean
  history: Sample[]
  page: Page
  /** Downloads shown expanded; every download starts collapsed. */
  expanded: Set<string>
  /** Selected downloads (Select, or Ctrl/⌘-click). */
  selected: Set<string>
  /** Select is on: rows show a box and a click selects. */
  selecting: boolean
  /** Downloads waiting for "Delete?" to be answered. */
  deleting: string[] | null
  /** Downloads being put in a group. */
  grouping: string[] | null
  /** Many links being added in the background. */
  addJob: AddJob | null
  /** Failed downloads just retried: when, and whether they've left Needs attention yet. */
  retrying: Map<string, { at: number; left: boolean }>
  /** Add download is open (with a link to fill in). */
  adding: Offer | null
  /** Downloads from the browser that came while the Add download window was open: each opens
   * in turn when it closes. */
  offers: Offer[]
  toast: string | null
  afterAll: Events['afterAll']
  update: Events['update'] | null
  /** "Later" on the update banner: hidden until the next start. */
  updateLater: boolean
  /** The download to scroll to and flash (from a duplicate's "Show it"). */
  focus: string | null
}

export const useApp = create<State>(() => ({
  ready: false,
  settings: {} as Settings,
  downloads: [],
  networks: [],
  version: '',
  testMode: false,
  history: [],
  page: 'downloads',
  expanded: new Set(),
  selected: new Set(),
  selecting: false,
  deleting: null,
  grouping: null,
  retrying: new Map(),
  addJob: null,
  adding: null,
  offers: [],
  toast: null,
  afterAll: null,
  update: null,
  updateLater: false,
  focus: null
}))

export const set = useApp.setState
export const get = useApp.getState

export function loadInitial(s: InitialState): void {
  set({
    ready: true,
    settings: s.settings,
    downloads: s.downloads,
    networks: s.networks,
    version: s.version,
    testMode: s.testMode,
    adding: s.link ? { url: s.link, torrentFile: s.torrentFile, seq: ++seq } : null,
    offers: restoreWaiting()
  })
}

/** A new second of network speeds for the graph. */
export function pushSample(networks: NetworkView[]): void {
  const speeds: Record<string, number> = {}
  for (const n of networks) if (n.speed > 0) speeds[n.id] = n.speed
  const history = [...get().history, { at: Date.now(), speeds }].slice(-HISTORY_SECONDS)
  set({ networks, history })
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(message: string): void {
  set({ toast: message })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => set({ toast: null }), 3800)
}

export function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Shows an error from a call as a toast. */
export const report = (error: unknown): void =>
  toast(
    (error instanceof Error ? error.message : String(error)).replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      ''
    )
  )

/** A link to add: from the browser (with its cookies and page), the clipboard or a file. */
export interface Offer {
  url?: string
  torrentFile?: string
  headers?: Record<string, string>
  /** Tells one opening of the window from the next. */
  seq?: number
}

let seq = 0
const hasLink = (o: Offer): boolean => Boolean(o.url?.trim() || o.torrentFile)

/** A link to add. From the browser it opens Add download when nothing else is open or waiting,
 * and otherwise waits in the corner panel. `mine` (pasted, dropped): opens unless the window
 * is already open. */
export function offer(link: Offer, mine = false): void {
  const next = { ...link, seq: ++seq }
  set((s) => {
    // The same link again (clicked twice): shown once, with the newest cookies from the browser.
    const same = (o: Offer | null): boolean =>
      Boolean(o && next.url?.trim() && !next.torrentFile && !o.torrentFile) &&
      o!.url?.trim() === next.url!.trim()
    const fresh = (o: Offer): Offer => (next.headers ? { ...o, headers: next.headers } : o)
    if (same(s.adding)) return { adding: fresh(s.adding!) }
    if (s.offers.some(same)) return { offers: s.offers.map((o) => (same(o) ? fresh(o) : o)) }
    if (!s.adding && (mine || s.offers.length === 0)) return { adding: next }
    return hasLink(next) ? { offers: [...s.offers, next] } : {}
  })
}

/** Add download, empty (the Add download button). */
export function openAdding(): void {
  set((s) => (s.adding ? {} : { adding: { seq: ++seq } }))
}

/** Closes Add download after adding or cancelling; the next link waiting, if any, opens. */
export function closeAdding(): void {
  set((s) => ({ adding: s.offers[0] ?? null, offers: s.offers.slice(1) }))
}

/** Hides Add download without losing its link: it waits in the corner panel, first in line. */
export function hideAdding(): void {
  set((s) => ({
    adding: null,
    offers: s.adding && hasLink(s.adding) ? [s.adding, ...s.offers] : s.offers
  }))
}

/** Opens a waiting link in Add download (the one open, if any, goes back to waiting). */
export function openOffer(which: number): void {
  set((s) => {
    const it = s.offers.find((o) => o.seq === which)
    if (!it) return {}
    const rest = s.offers.filter((o) => o !== it)
    return { adding: it, offers: s.adding && hasLink(s.adding) ? [s.adding, ...rest] : rest }
  })
}

export function removeOffers(which: number[]): void {
  set((s) => ({ offers: s.offers.filter((o) => !which.includes(o.seq ?? -1)) }))
}

/** What a waiting link is called: its file name, a magnet's name, or the link. */
export function offerName(o: Offer): string {
  const url = o.url?.trim() ?? ''
  if (o.torrentFile) return url || 'Torrent file'
  if (/^magnet:\?/i.test(url))
    return new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('dn') || 'Torrent'
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '') || url
  } catch {
    return url
  }
}

// What waits to be added is kept until it's added or removed, even when Mascot closes.
const SAVED = 'mascot.waiting'
function restoreWaiting(): Offer[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED) ?? '[]') as Offer[]
    return Array.isArray(list) ? list.filter(hasLink).map((o) => ({ ...o, seq: ++seq })) : []
  } catch {
    return []
  }
}
useApp.subscribe((s, before) => {
  if (s.offers === before.offers && s.adding === before.adding) return
  if (!s.ready) return
  const list = [...(s.adding && hasLink(s.adding) ? [s.adding] : []), ...s.offers]
  try {
    localStorage.setItem(SAVED, JSON.stringify(list.map(({ seq: _seq, ...o }) => o)))
  } catch {
    // Storage full or blocked: the list lasts until Mascot closes.
  }
})
