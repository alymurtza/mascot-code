/**
 * Adding many links in the background: the Add download window closes at once and a panel in
 * the corner shows each link being checked and added, asks about duplicates, and keeps the
 * ones that fail to try again.
 */
import type { AddRequest, DownloadGroup, DuplicateMatch, LinkInfo } from '@shared/download'
import { matchRule, renameWith, typeOf } from '@shared/rules'
import type { TorrentSource } from '@shared/torrent'
import { api } from './bridge'
import { askDuplicate, showDownload, type DuplicateChoice } from './components/DuplicateDialog'
import { get, set, toast } from './store'

/** What became of one link: added, joined to another download, skipped, or shown; null when
 * the question was closed without an answer. */
export type Outcome = { kind: 'added' | 'joined' | 'skipped' | 'shown'; text: string } | null

type Ask = (
  match: DuplicateMatch,
  url: string,
  many: boolean
) => Promise<{ choice: DuplicateChoice; rest: boolean }>

/** Adds one link, or joins it to the download it duplicates. When adding many, `remembered`
 * holds the answers given "for the rest", by kind of duplicate. */
export async function addOne(
  request: AddRequest,
  info: LinkInfo | undefined,
  remembered?: Map<string, DuplicateChoice>,
  ask: Ask = askDuplicate
): Promise<Outcome> {
  const match = await api.findDuplicate(request.url, info, {
    folder: request.folder,
    name: request.name
  })
  if (match) {
    if (match.kind === 'same-file') {
      await api.addMirror(match.id, request.url)
      return { kind: 'joined', text: `Added as a backup link to ${match.name}.` }
    }
    if (match.kind === 'failed') {
      // Carry on with the new link: it joins the failed download, which starts again.
      await api.addMirror(match.id, request.url).catch(() => {})
      await api.act([match.id], 'retry')
      return { kind: 'joined', text: `${match.name} carries on with this link.` }
    }
    let choice = remembered?.get(match.kind)
    if (!choice) {
      const answer = await ask(match, request.url, remembered !== undefined)
      choice = answer.choice
      if (remembered && answer.rest && choice !== 'close') remembered.set(match.kind, choice)
    }
    if (choice === 'show') {
      showDownload(match.id)
      return { kind: 'shown', text: '' }
    }
    if (choice === 'mirror') {
      await api.addMirror(match.id, request.url, true)
      return { kind: 'joined', text: `Added as a backup link to ${match.name}.` }
    }
    if (choice === 'skip') return { kind: 'skipped', text: `Skipped ${match.name}.` }
    if (choice === 'close') return remembered ? { kind: 'skipped', text: '' } : null
    // 'again' and 'separate': a new download.
  }
  const d = await api.add({ ...request, info })
  return { kind: 'added', text: `Added ${d.name}.` }
}

export const plain = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )

/** Checks a link, trying again a couple of times if the server doesn't answer well. */
async function checkWithRetry(url: string, headers?: Record<string, string>): Promise<LinkInfo> {
  let last: unknown
  for (const wait of [0, 1500, 4000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    try {
      return await api.checkLink(url, headers)
    } catch (error) {
      last = error
    }
  }
  throw last
}

/** Runs `work` on each item, `limit` at a time. */
async function inTurns<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++])
    })
  )
}

/** A magnet link's contents, for adding it with every file chosen. */
async function torrentRequest(link: string): Promise<AddRequest> {
  const source: TorrentSource = { magnet: link }
  const info = await api.torrentInfo(source)
  return { url: link, torrent: { source, info } }
}

export function joinPath(folder: string, name: string): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  return folder.replace(/[\\/]+$/, '') + sep + name
}

/** How the links in one go are added. */
export interface AddOptions {
  /** A folder chosen in the window; otherwise rules, then type folders, then the usual one. */
  folder: string | null
  sortByType: boolean
  when: AddRequest['when']
  perNetwork: 'auto' | number
  group?: DownloadGroup
}

export type ItemState =
  'waiting' | 'checking' | 'ready' | 'adding' | 'ask' | 'added' | 'joined' | 'skipped' | 'failed'

export interface AddItem {
  key: number
  link: string
  state: ItemState
  /** What to show next to it ("Added", why it failed…). */
  note: string
  info?: LinkInfo
  /** From the browser: its cookies and page, which some servers need. */
  headers?: Record<string, string>
  options: AddOptions
}

export interface AddJob {
  items: AddItem[]
  /** Working through the links (false once all are dealt with). */
  running: boolean
  step: 'check' | 'add'
  /** Shrunk to a pill. */
  small: boolean
  /** Duplicates waiting for an answer, first asked first; the other links carry on meanwhile. */
  questions: Question[]
}

export interface Question {
  key: number
  match: DuplicateMatch
  url: string
  resolve: (answer: { choice: DuplicateChoice; rest: boolean }) => void
}

const FINAL: ItemState[] = ['added', 'joined', 'skipped', 'failed']
export const isFinal = (s: ItemState): boolean => FINAL.includes(s)

let nextKey = 1
let remembered = new Map<string, DuplicateChoice>()
let running = false

const job = (): AddJob | null => get().addJob
function update(key: number, patch: Partial<AddItem>): void {
  set((s) =>
    s.addJob
      ? {
          addJob: {
            ...s.addJob,
            items: s.addJob.items.map((it) => (it.key === key ? { ...it, ...patch } : it))
          }
        }
      : {}
  )
}
const patchJob = (patch: Partial<AddJob>): void =>
  set((s) => (s.addJob ? { addJob: { ...s.addJob, ...patch } } : {}))

/** Adds these links in the background (after any already being added). */
export function addInBackground(
  links: (string | { link: string; headers?: Record<string, string> })[],
  options: AddOptions
): void {
  const items = links.map((l) => ({
    key: nextKey++,
    link: typeof l === 'string' ? l : l.link,
    headers: typeof l === 'string' ? undefined : l.headers,
    state: 'waiting' as const,
    note: 'Waiting',
    options
  }))
  const current = job()
  if (current && current.running)
    set({ addJob: { ...current, items: [...current.items, ...items] } })
  else {
    remembered = new Map()
    set({ addJob: { items, running: true, step: 'check', small: false, questions: [] } })
  }
  void work()
}

/** Tries the links that failed again (in the same group as before). */
export function retryFailed(): void {
  const current = job()
  if (!current) return
  set({
    addJob: {
      ...current,
      running: true,
      items: current.items.map((it) =>
        it.state === 'failed' ? { ...it, state: 'waiting', note: 'Waiting', info: undefined } : it
      )
    }
  })
  void work()
}

export function closeJob(): void {
  const current = job()
  for (const q of current?.questions ?? []) q.resolve({ choice: 'skip', rest: false })
  set({ addJob: null })
}

/** Answers the first question waiting; "for the rest" answers the others of its kind too. */
export function answer(q: Question, choice: DuplicateChoice, rest: boolean): void {
  const current = job()
  if (!current) return
  const same = rest ? current.questions.filter((x) => x.match.kind === q.match.kind) : [q]
  patchJob({ questions: current.questions.filter((x) => !same.includes(x)) })
  for (const x of same) x.resolve({ choice, rest })
}

/** Asks in the panel, and tells the adding loop it's waiting so it carries on with the rest. */
function askInPanel(key: number, waiting: () => void): Ask {
  return (match, url) =>
    new Promise((resolve) => {
      update(key, { state: 'ask', note: 'Needs your answer' })
      const current = job()
      if (current) patchJob({ questions: [...current.questions, { key, match, url, resolve }] })
      waiting()
    })
}

async function work(): Promise<void> {
  if (running) return
  running = true
  try {
    for (;;) {
      const now = job()
      if (!now) return
      const waiting = now.items.filter((it) => it.state === 'waiting')
      const ready = now.items.filter((it) => it.state === 'ready')
      if (!waiting.length && !ready.length) break
      // Check every web link first (three at a time), so the first downloads don't compete with
      // the checks of the rest.
      if (waiting.length) {
        patchJob({ step: 'check' })
        await inTurns(waiting, 3, async (it) => {
          if (/^magnet:/i.test(it.link)) return update(it.key, { state: 'ready', note: 'Ready' })
          if (!/^https?:\/\//i.test(it.link))
            return update(it.key, { state: 'failed', note: 'Not a web or magnet link' })
          update(it.key, { state: 'checking', note: 'Checking…' })
          try {
            const info = await checkWithRetry(it.link, it.headers)
            update(it.key, { state: 'ready', note: 'Ready', info })
          } catch (error) {
            update(it.key, { state: 'failed', note: plain(error) })
          }
        })
      }
      patchJob({ step: 'add' })
      const settings = get().settings
      const waitingForAnswers: Promise<void>[] = []
      for (const it of job()?.items.filter((x) => x.state === 'ready') ?? []) {
        if (!job()) return
        update(it.key, { state: 'adding', note: 'Adding…' })
        let asked: () => void = () => {}
        const askedNow = new Promise<'asked'>((r) => (asked = () => r('asked')))
        const adding = addItem(it, settings, asked)
        // Waiting for an answer: go on with the next link, and finish this one when answered.
        if ((await Promise.race([adding.then(() => 'done' as const), askedNow])) === 'asked')
          waitingForAnswers.push(adding)
      }
      await Promise.all(waitingForAnswers)
    }
  } finally {
    running = false
  }
  finish()
}

/** Adds one checked link and notes how it went. */
async function addItem(
  it: AddItem,
  settings: ReturnType<typeof get>['settings'],
  asked: () => void
): Promise<void> {
  const o = it.options
  try {
    let outcome: Outcome
    if (/^magnet:/i.test(it.link)) {
      const request = await torrentRequest(it.link)
      const name = request.torrent?.info.name ?? ''
      outcome = await addOne(
        {
          ...request,
          folder:
            o.folder ??
            matchRule(settings.rules, name, it.link, { torrent: true })?.folder ??
            settings.folder,
          when: o.when,
          group: o.group
        },
        undefined,
        remembered,
        askInPanel(it.key, asked)
      )
    } else {
      const info = it.info!
      const r = matchRule(settings.rules, info.name, it.link)
      const type = typeOf(info.name)
      const folder =
        o.folder ??
        r?.folder ??
        (o.sortByType && type ? joinPath(settings.folder, type) : settings.folder)
      outcome = await addOne(
        {
          url: it.link,
          name: renameWith(r?.rename, info.name, it.link),
          folder,
          when: o.when,
          perNetwork: o.perNetwork,
          group: o.group,
          headers: it.headers
        },
        info,
        remembered,
        askInPanel(it.key, asked)
      )
    }
    const kind = outcome?.kind ?? 'skipped'
    update(it.key, {
      state: kind === 'added' ? 'added' : kind === 'joined' ? 'joined' : 'skipped',
      note:
        kind === 'added'
          ? 'Added'
          : kind === 'joined'
            ? 'Joined as a backup link'
            : kind === 'shown'
              ? 'Shown'
              : 'Skipped'
    })
  } catch (error) {
    update(it.key, { state: 'failed', note: plain(error) })
  }
}

/** All dealt with: say how it went; with nothing failed, the panel goes by itself. */
function finish(): void {
  const done = job()
  if (!done) return
  patchJob({ running: false, small: false })
  const count = (s: ItemState): number => done.items.filter((it) => it.state === s).length
  const added = count('added')
  const failed = count('failed')
  if (failed) return
  const parts = [`Added ${added} download${added === 1 ? '' : 's'}.`]
  if (count('joined')) parts.push(`${count('joined')} joined others as backup links.`)
  if (count('skipped')) parts.push(`Skipped ${count('skipped')}.`)
  toast(parts.join(' '))
  setTimeout(() => {
    const still = job()
    if (still && !still.running && !still.items.some((it) => it.state === 'failed'))
      set({ addJob: null })
  }, 4000)
}
