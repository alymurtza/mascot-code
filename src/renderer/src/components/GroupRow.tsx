import { useState, type JSX } from 'react'
import type { Download } from '@shared/download'
import { groupSection, sectionOf } from '@shared/group'
import { api } from '../bridge'
import { size, speedParts } from '../format'
import { Icon } from '../icons'
import { report, set, toggle, useApp } from '../store'
import { DownloadRow } from './DownloadRow'
import { ProgressRing } from './ProgressRing'
import { retry } from '../retry'

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

const UNDER_WAY = new Set(['running', 'waiting', 'checking', 'verifying'])

/** Downloads added together: one row with their total, opening to each of them. */
export function GroupRow({
  id,
  members,
  firstQueued
}: {
  id: string
  members: Download[]
  firstQueued?: string
}): JSX.Element {
  const unit = useApp((s) => s.settings.speedUnit)
  const open = useApp((s) => s.expanded.has(`group:${id}`))
  const selecting = useApp((s) => s.selecting)
  const chosen = useApp((s) => members.filter((d) => s.selected.has(d.id)).length)
  const [renaming, setRenaming] = useState<string | null>(null)
  const name = members[0].group!.name
  const ids = members.map((d) => d.id)
  const section = groupSection(members)

  const total = members.reduce((n, d) => n + (d.size ?? 0), 0)
  const received = members.reduce((n, d) => n + Math.min(d.received, d.size ?? d.received), 0)
  const speed = members.reduce((n, d) => n + (UNDER_WAY.has(d.status) ? d.speed : 0), 0)
  const [speedValue, speedUnit] = speedParts(speed, unit)
  const tally = (pick: (d: Download) => boolean): number => members.filter(pick).length
  const done = tally((d) => d.status === 'done')
  const going = tally((d) => UNDER_WAY.has(d.status))
  const paused = tally((d) => d.status === 'paused')
  const waiting = tally((d) => sectionOf(d) === 'queued' || sectionOf(d) === 'scheduled')
  const failed = tally((d) => d.status === 'failed')
  const parts = [
    done && `${done} done`,
    going && `${going} downloading`,
    paused && `${paused} paused`,
    waiting && `${waiting} waiting`
  ].filter(Boolean)

  const pauseIds = members.filter((d) => UNDER_WAY.has(d.status) || sectionOf(d) === 'queued')
  const resumeIds = members.filter((d) => d.status === 'paused' || d.status === 'failed')
  const failedIds = members.filter((d) => d.status === 'failed')
  const run = (list: Download[], action: 'pause' | 'resume'): void =>
    void api
      .act(
        list.map((d) => d.id),
        action
      )
      .catch(report)
  const toggleOpen = (): void => set((s) => ({ expanded: toggle(s.expanded, `group:${id}`) }))
  const selectAll = (): void =>
    set((s) => {
      const next = new Set(s.selected)
      const all = ids.every((x) => next.has(x))
      for (const x of ids) {
        if (all) next.delete(x)
        else next.add(x)
      }
      return { selected: next }
    })

  const fraction = total ? received / total : done / members.length
  const tile =
    section === 'running' ? (
      <ProgressRing done={fraction} now={0} />
    ) : (
      <div className="ftype">{FOLDER}</div>
    )
  return (
    <article
      className={[
        'dl group',
        open && 'open',
        section === 'running' && going > 0 && 'running',
        section === 'attention' && 'attn',
        chosen === ids.length && 'selected'
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`${name} (group)`}
    >
      <div className="row" onClick={selecting ? selectAll : toggleOpen}>
        {selecting ? (
          <input
            type="checkbox"
            className="pick"
            aria-label={`Select ${name}`}
            checked={chosen === ids.length}
            ref={(el) => {
              if (el) el.indeterminate = chosen > 0 && chosen < ids.length
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={selectAll}
          />
        ) : (
          <button
            className="chev"
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleOpen()
            }}
          >
            <Icon.chev />
          </button>
        )}
        {tile}
        <div className="main">
          <div className="name with-badges">
            <span title={name}>{name}</span>
            <span className="badge info">{members.length} files</span>
            {failed > 0 && section !== 'attention' && (
              <span className="badge bad">{failed} failed</span>
            )}
          </div>
          <div className="meta">
            <span>{parts.join(' · ') || (failed ? `${failed} failed` : '')}</span>
          </div>
        </div>
        <div className="right">
          <div className="c-side">
            <span className="num">
              {section === 'done' ? size(total) : `${size(received)} of ${size(total)}`}
            </span>
            {section !== 'done' && total > 0 && (
              <span className="num">{Math.floor(fraction * 100)}%</span>
            )}
          </div>
          {going > 0 && (
            <div className="speed">
              {speedValue}
              <small>{speedUnit}</small>
            </div>
          )}
          {!selecting && (pauseIds.length > 0 || resumeIds.length > 0) && (
            <button
              className="icon-btn"
              type="button"
              aria-label={`${pauseIds.length ? 'Pause' : 'Resume'} ${name}`}
              onClick={(e) => {
                e.stopPropagation()
                if (pauseIds.length) run(pauseIds, 'pause')
                else run(resumeIds, 'resume')
              }}
            >
              {pauseIds.length ? <Icon.pause /> : <Icon.play />}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="detail group-detail" onClick={(e) => e.stopPropagation()}>
          {renaming !== null ? (
            <form
              className="actions"
              onSubmit={(e) => {
                e.preventDefault()
                void api
                  .renameGroup(id, renaming)
                  .then(() => setRenaming(null))
                  .catch(report)
              }}
            >
              <input
                className="inp"
                aria-label="Group name"
                value={renaming}
                maxLength={200}
                autoFocus
                onChange={(e) => setRenaming(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button className="btn primary" type="submit" disabled={!renaming.trim()}>
                Save
              </button>
              <button className="btn" type="button" onClick={() => setRenaming(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="actions">
              {pauseIds.length > 0 && (
                <button className="btn" type="button" onClick={() => run(pauseIds, 'pause')}>
                  Pause all
                </button>
              )}
              {resumeIds.length > 0 && (
                <button className="btn" type="button" onClick={() => run(resumeIds, 'resume')}>
                  Resume all
                </button>
              )}
              {failedIds.length > 0 && (
                <button className="btn primary" type="button" onClick={() => void retry(failedIds)}>
                  Retry failed
                </button>
              )}
              <button className="btn" type="button" onClick={() => setRenaming(name)}>
                Rename
              </button>
              <button className="btn danger" type="button" onClick={() => set({ deleting: ids })}>
                Delete group…
              </button>
            </div>
          )}
          <div className="group-list">
            {members.map((d) => (
              <DownloadRow key={d.id} d={d} first={d.id === firstQueued} />
            ))}
          </div>
        </div>
      )}
    </article>
  )
}
