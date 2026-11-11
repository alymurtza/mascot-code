import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { Download, DuplicateMatch } from '@shared/download'
import { api } from '../bridge'
import { clock, fitPath, size } from '../format'
import { get, set } from '../store'
import { Sheet } from './ui'

export type DuplicateChoice =
  'show' | 'mirror' | 'separate' | 'again' | 'skip' | 'close' | 'continue' | 'replace'

interface Answer {
  choice: DuplicateChoice
  /** Do the same for the rest of the links being added. */
  rest: boolean
}

interface Asking {
  match: DuplicateMatch
  url: string
  /** One of many links being added. */
  many: boolean
  resolve: (answer: Answer) => void
}

let ask: ((a: Asking) => void) | null = null

/** Asks what to do about a duplicate; resolves with the choice. */
export function askDuplicate(match: DuplicateMatch, url: string, many = false): Promise<Answer> {
  return new Promise((resolve) => {
    if (!ask) return resolve({ choice: 'separate', rest: false })
    ask({ match, url, many, resolve })
  })
}

/** Shows a download on the Downloads page: expanded and scrolled to. */
export function showDownload(id: string): void {
  set((s) => ({
    page: 'downloads',
    adding: s.offers[0] ?? null,
    offers: s.offers.slice(1),
    expanded: new Set([...s.expanded, id]),
    focus: id
  }))
}

/** One way to answer a duplicate question: a choice, or (Show in folder) something to do. */
export interface QuestionChoice {
  label: string
  primary?: boolean
  choice?: DuplicateChoice
  run?: () => void
}

/** What to ask about a duplicate, and the answers it takes: shared by this window and the
 * panel that adds many links. */
export function questionFor(
  match: DuplicateMatch,
  many: boolean
): { title: string; body: ReactNode; choices: QuestionChoice[]; rest: boolean } {
  const d: Download | undefined = get().downloads.find((x) => x.id === match.id)
  const haveIt = (show: () => void): QuestionChoice[] => [
    { label: 'Show in folder', run: show },
    { label: 'Skip', choice: 'skip', primary: true },
    { label: 'Download again', choice: 'again' }
  ]
  if (match.kind === 'partial' && match.path) {
    const folder = fitPath(match.path.slice(0, match.path.length - match.name.length - 1))
    const keepBoth: QuestionChoice = { label: 'Keep both', choice: 'separate' }
    if (match.resumable && match.received === undefined)
      return {
        title: 'Part of this is already here',
        body: (
          <>
            <b>{match.name}</b> is already in {folder}. Continuing checks what’s there and downloads
            only what’s missing.
          </>
        ),
        choices: [keepBoth, { label: 'Continue', choice: 'continue', primary: true }],
        rest: many
      }
    if (match.resumable)
      return {
        title: 'Part of this is already here',
        body: (
          <>
            <b>{match.name}</b> is partly downloaded in {folder}
            {match.size ? `: ${size(match.received ?? 0)} of ${size(match.size)}` : ''}.
          </>
        ),
        choices: [
          keepBoth,
          { label: 'Start over', choice: 'replace' },
          { label: 'Continue', choice: 'continue', primary: true }
        ],
        rest: many
      }
    return {
      title: 'A partly downloaded copy is here',
      body: (
        <>
          Part of <b>{match.name}</b> is in {folder}, but Mascot can’t tell which parts of it are
          complete.
        </>
      ),
      choices: [keepBoth, { label: 'Start over', choice: 'replace', primary: true }],
      rest: many
    }
  }
  if (match.kind === 'on-disk' && match.path) {
    const path = match.path
    return {
      title: 'This file is already there',
      body: (
        <>
          <b>{match.name}</b> is already in{' '}
          {fitPath(path.slice(0, path.length - match.name.length - 1))}. Downloading it again keeps
          both: the new one gets a number after its name.
        </>
      ),
      choices: haveIt(() => void api.showInFolder(path)),
      rest: many
    }
  }
  if (match.kind === 'finished')
    return {
      title: 'You already downloaded this',
      body: (
        <>
          <b>{match.name}</b> finished
          {d?.finishedAt
            ? ` on ${new Date(d.finishedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${clock(d.finishedAt)}`
            : ''}
          {d ? `, in ${fitPath(d.folder)}` : ''}.
        </>
      ),
      choices: haveIt(() => d && void api.showInFolder(d.path)),
      rest: many
    }
  if (match.kind === 'maybe')
    return {
      title: 'Is this the same file?',
      body: (
        <>
          This link has the same name and size as <b>{match.name}</b>
          {d && d.status !== 'done' ? ', which is downloading' : ''}. The server doesn’t say whether
          it’s the same file.
        </>
      ),
      choices: [
        ...(many ? [{ label: 'Skip', choice: 'skip' as const }] : []),
        { label: 'Different file: download separately', choice: 'separate' },
        { label: 'Same file: use as a backup link', choice: 'mirror', primary: true }
      ],
      rest: many
    }
  const percent = d?.size ? Math.floor((d.received / d.size) * 100) : 0
  return {
    title: 'Already downloading',
    body: (
      <>
        {match.name} is{' '}
        {d?.status === 'queued'
          ? 'queued'
          : d?.status === 'scheduled'
            ? 'scheduled'
            : 'downloading'}{' '}
        from this link
        {percent ? `: ${percent}% done` : ''}.
      </>
    ),
    choices: many
      ? [{ label: 'Skip', choice: 'skip' }]
      : [
          { label: 'Skip', choice: 'skip' },
          { label: 'Show it', choice: 'show', primary: true }
        ],
    rest: many
  }
}

export function DuplicateDialog(): JSX.Element | null {
  const [asking, setAsking] = useState<Asking | null>(null)
  const [rest, setRest] = useState(false)
  useEffect(() => {
    ask = setAsking
    return () => {
      ask = null
    }
  }, [])
  if (!asking) return null
  const { match, url, many } = asking
  const q = questionFor(match, many)
  const done = (choice: DuplicateChoice): void => {
    setAsking(null)
    setRest(false)
    asking.resolve({ choice, rest })
  }
  return (
    <Sheet title={q.title} id="dupT" width={520} onClose={() => done('close')}>
      <p style={{ margin: 0 }}>{q.body}</p>
      {match.kind === 'maybe' && (
        <p className="muted" style={{ margin: 0, fontSize: 13, overflowWrap: 'anywhere' }}>
          {url}
        </p>
      )}
      <div className="sheet-foot">
        {q.rest && (
          <label className="inline" style={{ marginRight: 'auto', fontSize: 13.5 }}>
            <input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} />
            Do the same for the rest
          </label>
        )}
        {q.choices.map((c) => (
          <button
            key={c.label}
            className={`btn${c.primary ? ' primary' : ''}`}
            type="button"
            onClick={() => (c.run ? c.run() : done(c.choice!))}
          >
            {c.label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
