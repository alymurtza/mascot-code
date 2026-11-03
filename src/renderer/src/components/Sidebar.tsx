import type { JSX } from 'react'
import { networkColors } from '../colors'
import { speedParts } from '../format'
import { Icon } from '../icons'
import { openAdding, set, useApp, type Page } from '../store'

const PAGES: [Page, string, () => JSX.Element][] = [
  ['downloads', 'Downloads', Icon.downloads],
  ['networks', 'Networks', Icon.wifi],
  ['queue', 'Queue & schedule', Icon.clock],
  ['settings', 'Settings', Icon.settings]
]

export function Sidebar(): JSX.Element {
  const { page, downloads, networks, settings } = useApp()
  const colors = networkColors(networks, settings)
  const counts: Partial<Record<Page, number>> = {
    downloads: downloads.length,
    networks: networks.length,
    queue: downloads.filter((d) => d.status === 'queued' || d.status === 'scheduled').length
  }
  const inUse = networks.filter((n) => n.status === 'in-use' || n.status === 'covering')
  const standby = networks.filter((n) => n.status === 'standby')
  return (
    <aside className="side">
      <button className="add" type="button" onClick={openAdding}>
        <Icon.plus />
        Add download
      </button>
      <nav className="nav" aria-label="Pages">
        {PAGES.map(([id, label, Draw]) => (
          <button
            key={id}
            type="button"
            aria-current={page === id ? 'page' : undefined}
            onClick={() => set({ page: id })}
          >
            <Draw />
            {label}
            {counts[id] !== undefined && <span className="count num">{counts[id]}</span>}
          </button>
        ))}
      </nav>
      <div className="netstat" aria-label="Networks in use">
        <div className="label">In use now</div>
        {inUse.length === 0 && <div className="muted">No networks in use</div>}
        {inUse.map((n) => (
          <div className="row" key={n.id}>
            <span className="dot" style={{ background: colors[n.id], color: colors[n.id] }} />
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {n.label}
            </span>
            <span className="muted num" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {speedParts(n.speed, settings.speedUnit)[0]}
            </span>
          </div>
        ))}
        {standby.map((n) => (
          <div className="row" key={n.id}>
            <span className="dot" style={{ background: 'var(--faint)', color: 'var(--faint)' }} />
            {n.label}
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              backup
            </span>
          </div>
        ))}
      </div>
    </aside>
  )
}
