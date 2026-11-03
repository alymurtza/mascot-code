import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { sectionOf, type Section } from '@shared/group'
import type { Download, DownloadAction } from '@shared/download'
import { detectAlgorithm } from '@shared/checksum'
import { api } from '../bridge'
import { inAnHour, useNow } from '../clock'
import { count, duration, fileTag, finishedNote, fitPath, size, speedParts, when } from '../format'
import { Icon } from '../icons'
import { get, report, set, toast, toggle, useApp } from '../store'
import { ProgressRing } from './ProgressRing'
import { retry } from '../retry'

/** The section a download is shown in. */
export type Group = Section
export const groupOf = sectionOf

/** Runs an action on this download, or on every selected one when it's selected. */
async function act(d: Download, action: DownloadAction): Promise<void> {
  const selected = get().selected
  const ids = selected.has(d.id) ? [...selected] : [d.id]
  try {
    await api.act(ids, action)
  } catch (error) {
    report(error)
  }
}

function Links({ d }: { d: Download }): JSX.Element {
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const usable = d.sources.filter((s) => !s.removed && !s.dropped).length
  const visible = d.sources.filter((s) => !s.removed)
  const add = async (): Promise<void> => {
    const url = adding.trim()
    if (!url) return
    setBusy(true)
    try {
      await api.addMirror(d.id, url)
      setAdding('')
      toast(`Added as a backup link. It now downloads from ${usable + 1} links.`)
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mlist-box" onClick={(e) => e.stopPropagation()}>
      <div className="label">Links</div>
      <ul className="mlist" aria-label={`Links for ${d.name}`}>
        {visible.map((s, i) => {
          const main = s.url === d.url
          const color = s.dropped ? 'var(--warn)' : 'var(--ok)'
          return (
            <li className="mrow" key={s.url}>
              <span className="dot" style={{ background: color, color }} />
              <span className="mu" title={s.url}>
                {s.url}
              </span>
              <span className="muted mst">
                {s.dropped ? `Not used: ${s.dropped}` : main ? 'Main link' : 'In use'}
              </span>
              {!main && (
                <button
                  className="mini-btn"
                  type="button"
                  aria-label={`Remove link ${i + 1}`}
                  onClick={() => void api.removeMirror(d.id, s.url).catch(report)}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {d.status !== 'done' && (
        <div className="inline">
          <input
            className="inp"
            placeholder="Add a backup link: https://"
            aria-label="Add a backup link"
            style={{ flex: 1, minWidth: 200 }}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <button
            className="btn"
            type="button"
            disabled={busy || !adding.trim()}
            onClick={() => void add()}
          >
            {busy ? 'Checking…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  )
}

function StartAt({ d, onDone }: { d: Download; onDone: () => void }): JSX.Element {
  const [value, setValue] = useState(inAnHour)
  return (
    <div className="inline" onClick={(e) => e.stopPropagation()}>
      <input
        className="inp num"
        type="datetime-local"
        aria-label="Start at"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 'auto' }}
      />
      <button
        className="btn primary"
        type="button"
        onClick={() => {
          const at = new Date(value).getTime()
          if (!Number.isFinite(at)) return
          const ids = get().selected.has(d.id) ? [...get().selected] : [d.id]
          void api.startAt(ids, at).then(onDone, report)
        }}
      >
        Set
      </button>
      <button className="btn" type="button" onClick={onDone}>
        Cancel
      </button>
    </div>
  )
}

function Facts({ items }: { items: [string, ReactNode][] }): JSX.Element {
  return (
    <div className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          {k}
          <b>{v}</b>
        </div>
      ))}
    </div>
  )
}

const checksumText = (d: Download): string => {
  if (!d.checksum) return 'None given'
  const name =
    d.checksum.algorithm === 'md5' ? 'MD5' : d.checksum.algorithm === 'sha1' ? 'SHA-1' : 'SHA-256'
  if (d.checksum.result === 'checking') return `Checking the ${name}…`
  if (d.checksum.result === 'match') return `${name} matches`
  if (d.checksum.result === 'mismatch') return `${name} doesn’t match`
  return `${name} given`
}

/** A file or folder path, shortened in the middle when long; the whole of it on hover. */
function PathText({ path }: { path: string }): JSX.Element {
  return <span title={path}>{fitPath(path)}</span>
}

/** The checksum, which can be added or changed at any time; a finished file is checked now. */
function ChecksumFact({ d }: { d: Download }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const done = d.status === 'done'
  const apply = (text: string): void => {
    setError('')
    api.setChecksum(d.id, text).then(
      () => setEditing(false),
      (e) =>
        setError(
          String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        )
    )
  }
  if (!editing)
    return (
      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {checksumText(d)}
        {d.checksum?.result !== 'checking' && (
          <button
            className="link"
            type="button"
            onClick={() => {
              setValue(d.checksum?.expected ?? '')
              setError('')
              setEditing(true)
            }}
          >
            {d.checksum ? 'Change' : 'Add'}
          </button>
        )}
      </span>
    )
  const algorithm = value.trim() ? detectAlgorithm(value) : undefined
  const bad = !!value.trim() && !algorithm
  return (
    <span style={{ display: 'grid', gap: 6, fontWeight: 400 }}>
      <input
        className="inp num"
        aria-label="Checksum"
        placeholder="SHA-256, SHA-1 or MD5"
        value={value}
        autoFocus
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !bad) apply(value)
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      {bad && (
        <span className="warn-txt">That doesn’t look like an MD5, SHA-1 or SHA-256 checksum.</span>
      )}
      {error && <span className="warn-txt">{error}</span>}
      <span className="inline">
        <button
          className="btn primary"
          type="button"
          disabled={bad || !value.trim()}
          onClick={() => apply(value)}
        >
          {done ? 'Check file' : 'Save'}
        </button>
        <button className="btn" type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {d.checksum && (
          <button className="link" type="button" onClick={() => apply('')}>
            Remove
          </button>
        )}
      </span>
    </span>
  )
}

const FOLDER = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

/** A torrent's files: each one's size and how far along it is, with a box to fetch it or not
 * (changeable while it downloads; at least one stays chosen). */
function TorrentFiles({ d }: { d: Download }): JSX.Element {
  const files = d.files!
  const saved = files.flatMap((f, i) => (f.selected ? [i] : []))
  // The tick shows at once; the app's answer replaces it.
  const [pending, setPending] = useState<{ was: string; next: number[] } | null>(null)
  const key = saved.join()
  const chosen = pending && pending.was === key ? pending.next : saved
  const all = chosen.length === files.length
  const put = (next: number[]): void => {
    if (next.length === 0) return toast('Keep at least one file.')
    setPending({ was: key, next })
    void api.setTorrentFiles(d.id, next).catch((e) => {
      setPending(null)
      report(e)
    })
  }
  const pct = (f: { length: number; received: number }): string =>
    f.length ? `${Math.floor((Math.min(f.received, f.length) / f.length) * 100)}%` : '100%'
  const total = files.reduce((n, f) => n + f.length, 0)
  const got = files.reduce((n, f) => n + Math.min(f.received, f.length), 0)
  const allBox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = !all && chosen.length > 0
  })
  return (
    <div className="tfiles" role="group" aria-label="Files">
      <label className="tfile tfile-head">
        <input
          ref={allBox}
          type="checkbox"
          checked={all}
          aria-label="All files"
          onChange={() => put(all ? [chosen[0] ?? 0] : files.map((_, i) => i))}
        />
        <span className="tfile-ico">{FOLDER}</span>
        <span className="tfile-name">{d.name}</span>
        <span className="tfile-size num">{size(total)}</span>
        <span className="tfile-pct num">{total ? `${Math.floor((got / total) * 100)}%` : ''}</span>
      </label>
      <div className="tfile-list">
        {files.map((f, i) => (
          <label key={i} className={`tfile${chosen.includes(i) ? '' : ' off'}`}>
            <input
              type="checkbox"
              checked={chosen.includes(i)}
              aria-label={f.name}
              onChange={() =>
                put(
                  chosen.includes(i)
                    ? chosen.filter((x) => x !== i)
                    : [...chosen, i].sort((a, b) => a - b)
                )
              }
            />
            <span className="tfile-name" title={f.name}>
              {f.name}
            </span>
            <span className="tfile-size num">{size(f.length)}</span>
            <span className="tfile-pct num">{pct(f)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function Detail({ d, group }: { d: Download; group: Group }): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [picking, setPicking] = useState(false)
  const queuedOthers = useApp((s) => s.downloads.some((x) => x.status === 'queued'))
  const ranged = d.ranged && d.packets
  const links = d.kind === 'web' && (group !== 'done' || d.sources.length > 1)
  const now = useNow(15_000)
  const remaining = d.retryAt ? Math.max(1, Math.round((d.retryAt - now) / 60_000)) : undefined
  const torrentFiles = d.files
    ? `${d.files.filter((f) => f.selected).length} of ${d.files.length} chosen`
    : 'All'
  const facts: [string, ReactNode][] =
    d.kind === 'torrent' && group !== 'attention'
      ? [
          [group === 'done' ? 'Saved to' : 'Saving to', <PathText key="path" path={d.path} />],
          ['Size', size(d.size)],
          ['Files', torrentFiles],
          group === 'done'
            ? ['Pieces', d.packets ? count(d.packets.total) : '—']
            : ['Peers', group === 'running' ? count(d.connections) : '—']
        ]
      : group === 'running'
        ? [
            ['Saving to', <PathText key="path" path={d.folder} />],
            ['Packet size', d.packetSize ? size(d.packetSize) : 'One piece'],
            ['Links', `${d.sources.filter((s) => !s.removed && !s.dropped).length} in use`],
            ['Checksum', <ChecksumFact key="checksum" d={d} />]
          ]
        : group === 'attention'
          ? [
              ['Saving to', <PathText key="path" path={d.folder} />],
              ['Size', size(d.size)],
              ['Kept so far', size(d.received)],
              ['Mascot will', remaining ? `Retry by itself in ${remaining} min` : 'Wait for you']
            ]
          : group === 'done'
            ? [
                ['Saved to', <PathText key="path" path={d.folder} />],
                ['Size', size(d.size)],
                ['Checksum', <ChecksumFact key="checksum" d={d} />],
                [
                  'Packets',
                  d.packets ? `${count(d.packets.total)} of ${size(d.packetSize)}` : 'One piece'
                ]
              ]
            : [
                ['Saving to', <PathText key="path" path={d.folder} />],
                ['Size', size(d.size)],
                [
                  d.received ? 'Continues' : 'Starts',
                  group === 'queued'
                    ? 'When a download slot frees up'
                    : d.startAt
                      ? when(d.startAt)
                      : (d.message ?? '—')
                ],
                d.received
                  ? [
                      'Kept so far',
                      `${size(d.received)}${ranged ? ` · ${count(d.packets!.done)} packets` : ''}`
                    ]
                  : ['Checksum', <ChecksumFact key="checksum" d={d} />]
              ]
  const retryingNow = useApp((s) => s.retrying.has(d.id))
  const retryNow = (
    <button
      className="btn primary"
      type="button"
      disabled={retryingNow}
      onClick={() => void retry([d])}
    >
      {retryingNow ? 'Retrying…' : 'Retry now'}
    </button>
  )
  const btn = (label: string, run: () => void, kind = ''): JSX.Element => (
    <button className={`btn ${kind}`} type="button" onClick={run}>
      {label}
    </button>
  )
  const cancel = confirming
    ? btn('Click again to cancel', () => void act(d, 'cancel'), 'danger')
    : btn(
        group === 'done' ? 'Remove from list' : 'Cancel',
        () => (group === 'done' ? void act(d, 'remove') : setConfirming(true)),
        group === 'done' ? '' : 'danger'
      )
  let actions: JSX.Element
  if (picking) actions = <StartAt d={d} onDone={() => setPicking(false)} />
  else if (group === 'running')
    actions = (
      <>
        {btn(
          d.status === 'paused' ? 'Resume' : 'Pause',
          () => void act(d, d.status === 'paused' ? 'resume' : 'pause')
        )}
        {!d.priority && btn('Download first', () => void act(d, 'first'))}
        {queuedOthers && btn('Move to queue', () => void act(d, 'queue'))}
        {btn('Start at…', () => setPicking(true))}
        {btn('Show in folder', () => void api.showInFolder(d.path))}
        {btn('Copy link', () => void api.copyText(d.url).then(() => toast('Link copied.')))}
        {cancel}
      </>
    )
  else if (group === 'attention')
    actions = (
      <>
        {retryNow}
        {/changed on the server/.test(d.message ?? '') &&
          btn('Download again', () => void act(d, 'restart'))}
        {btn('Copy link', () => void api.copyText(d.url).then(() => toast('Link copied.')))}
        {cancel}
      </>
    )
  else if (group === 'done')
    actions = (
      <>
        {btn('Open', () => void api.openFile(d.path).catch(report), 'primary')}
        {btn('Show in folder', () => void api.showInFolder(d.path))}
        {d.checksum?.result === 'mismatch' && btn('Download again', () => void act(d, 'restart'))}
        {cancel}
        {btn('Move file to Trash', () => void act(d, 'trash'), 'danger')}
      </>
    )
  else
    actions = (
      <>
        {btn('Download first', () => void act(d, 'first'), 'primary')}
        {btn(group === 'scheduled' ? 'Change time' : 'Start at…', () => setPicking(true))}
        {cancel}
      </>
    )
  return (
    <div className="detail" onClick={(e) => e.stopPropagation()}>
      {links && <Links d={d} />}
      {d.kind === 'torrent' && d.files && d.files.length > 0 && <TorrentFiles d={d} />}
      <Facts items={facts} />
      <div className="actions">{actions}</div>
    </div>
  )
}

export function DownloadRow({ d, first }: { d: Download; first?: boolean }): JSX.Element {
  const unit = useApp((s) => s.settings.speedUnit)
  const open = useApp((s) => s.expanded.has(d.id))
  const selected = useApp((s) => s.selected.has(d.id))
  const selecting = useApp((s) => s.selecting)
  const retrying = useApp((s) => s.retrying.has(d.id))
  const focused = useApp((s) => s.focus === d.id)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])
  const group = groupOf(d)
  const running = d.status === 'running' || d.status === 'waiting'
  const paused = d.status === 'paused'
  const pk = d.packets
  const fraction = d.size ? d.received / d.size : 0
  const ringDone = pk ? pk.done / pk.total : fraction
  const ring = (
    <ProgressRing
      done={pk ? Math.max(ringDone, fraction) : fraction}
      now={running && pk ? pk.active / pk.total : 0}
    />
  )
  const packetsLine = pk ? (
    <span className="num">
      <b className="c-strong">{count(pk.done)}</b> of {count(pk.total)} packets
    </span>
  ) : null
  const [speedValue, speedUnit] = speedParts(d.speed, unit)
  const toggleButton = (
    <button
      className="icon-btn"
      type="button"
      aria-label={`${paused ? 'Resume' : 'Pause'} ${d.name}`}
      onClick={(e) => {
        e.stopPropagation()
        void act(d, paused ? 'resume' : 'pause')
      }}
    >
      {paused ? <Icon.play /> : <Icon.pause />}
    </button>
  )
  let tile: JSX.Element = <div className="ftype">{fileTag(d.name)}</div>
  let sub: ReactNode = null
  let right: ReactNode = null
  if (group === 'running') {
    tile = ring
    const left =
      d.status === 'waiting'
        ? (d.message ?? 'Waiting')
        : paused
          ? 'Paused'
          : d.status === 'verifying'
            ? 'Checking the checksum'
            : d.status === 'checking'
              ? 'Checking the link'
              : `${duration(d.eta)} left`
    sub = pk ? (
      <>
        {packetsLine}
        {running && pk.active > 0 && (
          <span className="c-now">
            <span className="c-pulse" aria-hidden />
            {pk.active} downloading at once
          </span>
        )}
        {!running && pk.partDone > 0 && <span className="num">· {pk.partDone} part done</span>}
      </>
    ) : (
      <span>
        {d.size ? 'One connection: this server can’t send parts of the file' : 'Size not known yet'}
      </span>
    )
    right = (
      <>
        <div className="c-side">
          <span className="num">
            {size(d.received)} of {size(d.size)}
          </span>
          <span>{left}</span>
        </div>
        <div className="speed">
          {paused ? (
            <span className="muted">Paused</span>
          ) : (
            <>
              {speedValue}
              <small>{speedUnit}</small>
            </>
          )}
        </div>
        {d.status !== 'verifying' && toggleButton}
      </>
    )
  } else if (group === 'queued' || group === 'scheduled') {
    const badge =
      group === 'queued' ? (
        <span className="badge info">{first ? 'Next' : 'Queued'}</span>
      ) : (
        <span className="badge gold">Scheduled</span>
      )
    const whenText =
      group === 'scheduled' ? (d.startAt ? when(d.startAt) : (d.message ?? 'Scheduled')) : ''
    if (d.received > 0) {
      tile = ring
      sub = (
        <>
          {packetsLine}
          {pk && pk.partDone > 0 && <span className="num">· {pk.partDone} part done</span>}
        </>
      )
      right = (
        <>
          <div className="c-side">
            <span className="num">
              {size(d.received)} of {size(d.size)}
            </span>
            <span>
              {group === 'queued'
                ? first
                  ? 'Continues next'
                  : 'Waiting for a turn'
                : `Continues ${whenText
                    .replace(/^Tonight/, 'tonight')
                    .replace(/^Today/, 'today')
                    .replace(/^Tomorrow/, 'tomorrow')}`}
            </span>
          </div>
          {badge}
        </>
      )
    } else {
      sub = (
        <>
          <span className="num">{size(d.size)}</span>
          <span>
            {group === 'queued'
              ? first
                ? 'Starts when a download finishes'
                : 'Waiting in the queue'
              : whenText}
          </span>
        </>
      )
      right = badge
    }
  } else if (group === 'attention') {
    sub = <span>{retrying ? 'Retrying…' : d.message}</span>
    right = (
      <button
        className="btn primary"
        type="button"
        disabled={retrying}
        onClick={(e) => {
          e.stopPropagation()
          void retry([d])
        }}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    )
  } else {
    sub = (
      <>
        <span className="num">{size(d.size)}</span>
        <span>{finishedNote(d)}</span>
      </>
    )
    right =
      d.checksum?.result === 'match' ? (
        <span className="badge ok">
          <Icon.check /> Checksum matches
        </span>
      ) : d.checksum?.result === 'mismatch' ? (
        <span className="badge bad">Checksum doesn’t match</span>
      ) : d.checksum?.result === 'checking' ? (
        <span className="badge info">Checking…</span>
      ) : (
        <span className="badge warn">Not verified</span>
      )
  }
  const classes = [
    'dl',
    open && 'open',
    running && 'running',
    group === 'attention' && 'attn',
    selected && 'selected',
    focused && 'flash'
  ]
    .filter(Boolean)
    .join(' ')
  const onClick = (e: React.MouseEvent): void => {
    if (selecting || e.ctrlKey || e.metaKey) {
      set((s) => ({ selected: toggle(s.selected, d.id) }))
      return
    }
    set((s) => ({ expanded: toggle(s.expanded, d.id), focus: null }))
  }
  return (
    <article
      className={classes}
      ref={ref}
      aria-label={d.name}
      aria-selected={selected || undefined}
    >
      <div className="row" onClick={onClick}>
        {selecting ? (
          <input
            type="checkbox"
            className="pick"
            aria-label={`Select ${d.name}`}
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={() => set((s) => ({ selected: toggle(s.selected, d.id) }))}
          />
        ) : (
          <button
            className="chev"
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${d.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onClick(e)
            }}
          >
            <Icon.chev />
          </button>
        )}
        {tile}
        <div className="main">
          <div className="name">
            {d.priority && group !== 'done' && (
              <span className="badge gold" style={{ marginRight: 8 }}>
                First
              </span>
            )}
            <span title={d.name}>{d.name}</span>
          </div>
          <div className="meta">{sub}</div>
        </div>
        <div className="right">{right}</div>
      </div>
      {open && <Detail d={d} group={group} />}
    </article>
  )
}
