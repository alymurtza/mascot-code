import { useState, type JSX, type ReactNode } from 'react'
import type { Download } from '@shared/download'
import { groupSection, groupsOf } from '@shared/group'
import { api } from '../bridge'
import { DownloadRow, groupOf, type Group } from '../components/DownloadRow'
import { GroupRow } from '../components/GroupRow'
import { SpeedChart } from '../components/SpeedChart'
import { Section } from '../components/ui'
import { retry } from '../retry'
import { report, set, useApp } from '../store'

const SECTIONS: [Group, string][] = [
  ['attention', 'Needs attention'],
  ['running', 'Downloading'],
  ['queued', 'Queued'],
  ['scheduled', 'Scheduled'],
  ['done', 'Finished']
]

/** Runs an action on some downloads, each only where it applies. */
function each(list: Download[], action: Parameters<typeof api.act>[1]): Promise<void> {
  return list.length
    ? api.act(
        list.map((d) => d.id),
        action
      )
    : Promise.resolve()
}

export function DownloadsScreen(): JSX.Element {
  const { downloads, networks, selected, selecting } = useApp()
  const [query, setQuery] = useState('')
  const inUse = networks.filter((n) => n.status === 'in-use' || n.status === 'covering').length
  const anyRunning = downloads.some(
    (d) => d.status === 'running' || d.status === 'waiting' || d.status === 'queued'
  )
  const q = query.trim().toLowerCase()
  const matches = (d: Download): boolean =>
    !q || d.name.toLowerCase().includes(q) || !!d.group?.name.toLowerCase().includes(q)
  const groups = groupsOf(downloads)
  const sorted = (g: Group): Download[] =>
    // Finished: newest first.
    g === 'done'
      ? [...downloads].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      : downloads

  const chosen = downloads.filter((d) => selected.has(d.id))
  const failed = downloads.filter((d) => d.status === 'failed')
  const visible = downloads.filter(matches)
  const start = async (): Promise<void> => {
    await each(
      chosen.filter((d) => d.status === 'paused' || d.status === 'failed'),
      'resume'
    )
    await each(
      chosen.filter((d) => d.status === 'queued' || d.status === 'scheduled'),
      'start-now'
    )
  }
  const pause = (): Promise<void> =>
    each(
      chosen.filter((d) => !['paused', 'done', 'failed'].includes(d.status)),
      'pause'
    )
  const run = (work: () => Promise<void>): void => void work().catch(report)
  const stopSelecting = (): void => set({ selecting: false, selected: new Set() })
  const btn = (label: string, onClick: () => void, kind = ''): ReactNode => (
    <button className={`btn ${kind}`} type="button" disabled={!chosen.length} onClick={onClick}>
      {label}
    </button>
  )

  return (
    <>
      <div className="head">
        <div>
          <h2>Downloads</h2>
          <p>
            {inUse} network{inUse === 1 ? '' : 's'} combined
          </p>
        </div>
        <div className="inline">
          <input
            className="find"
            type="search"
            placeholder="Search downloads"
            aria-label="Search all downloads"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="btn"
            type="button"
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : set({ selecting: true }))}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void (anyRunning ? api.pauseAll() : api.resumeAll()).catch(report)}
          >
            {anyRunning ? 'Pause all' : 'Resume all'}
          </button>
        </div>
      </div>
      {(selecting || chosen.length > 0) && (
        <div className="banner selbar" role="region" aria-label="Selection">
          <span>
            <b className="num">{chosen.length}</b> selected
          </span>
          <div className="inline">
            <button
              className="link-btn"
              type="button"
              onClick={() =>
                set({
                  selecting: true,
                  selected:
                    chosen.length === visible.length && visible.length
                      ? new Set()
                      : new Set(visible.map((d) => d.id))
                })
              }
            >
              {chosen.length === visible.length && visible.length ? 'Select none' : 'Select all'}
            </button>
            {btn('Start', () => run(start))}
            {btn('Pause', () => run(pause))}
            {btn('Move to queue', () =>
              run(() =>
                each(
                  chosen.filter((d) => d.status !== 'done'),
                  'queue'
                )
              )
            )}
            {btn('Add to group…', () => set({ grouping: chosen.map((d) => d.id) }))}
            {chosen.some((d) => d.group) &&
              btn('Take out of group', () =>
                run(() =>
                  api.setGroup(
                    chosen.map((d) => d.id),
                    null
                  )
                )
              )}
            {btn('Delete…', () => set({ deleting: chosen.map((d) => d.id) }), 'danger')}
          </div>
        </div>
      )}
      <SpeedChart />
      {SECTIONS.map(([section, label]) => {
        const shownGroups = new Set<string>()
        const rows: ReactNode[] = []
        let all = 0
        let shown = 0
        const firstQueued =
          section === 'queued'
            ? downloads.find((d) => groupOf(d) === 'queued' && matches(d))?.id
            : undefined
        for (const d of sorted(section)) {
          const members = d.group ? groups.get(d.group.id) : undefined
          if (members) {
            if (shownGroups.has(d.group!.id) || groupSection(members) !== section) continue
            shownGroups.add(d.group!.id)
            all += members.length
            const hits = members.filter(matches)
            if (!hits.length) continue
            shown += hits.length
            rows.push(
              <GroupRow
                key={`g:${d.group!.id}`}
                id={d.group!.id}
                members={q ? hits : members}
                firstQueued={firstQueued}
              />
            )
          } else if (groupOf(d) === section) {
            all++
            if (!matches(d)) continue
            shown++
            rows.push(<DownloadRow key={d.id} d={d} first={d.id === firstQueued} />)
          }
        }
        if (section === 'attention' && all === 0) return null
        if (q && rows.length === 0) return null
        return (
          <Section
            key={section}
            label={label}
            count={q ? `${shown} of ${all}` : all}
            tools={
              section === 'done' && !q && all > 0 ? (
                <button className="link" type="button" onClick={() => void api.clearFinished()}>
                  Clear finished
                </button>
              ) : section === 'attention' && failed.length > 0 ? (
                <button className="link" type="button" onClick={() => void retry(failed)}>
                  Retry all
                </button>
              ) : undefined
            }
          >
            {rows.length ? rows : <div className="empty">Nothing {label.toLowerCase()}.</div>}
          </Section>
        )
      })}
      {q && !downloads.some(matches) && (
        <div className="empty">No download matches “{query.trim()}”.</div>
      )}
    </>
  )
}
