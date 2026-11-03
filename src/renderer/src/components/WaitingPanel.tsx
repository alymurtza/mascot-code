import { useState, type JSX } from 'react'
import { groupNameFor } from '@shared/group'
import { addInBackground } from '../adding'
import { offerName, openOffer, removeOffers, useApp } from '../store'

/** Downloads waiting to be added (from the browser, or hidden from Add download): open one,
 * remove one, or add them all. Kept when Mascot closes. */
export function WaitingPanel(): JSX.Element | null {
  const offers = useApp((s) => s.offers)
  const [small, setSmall] = useState(false)
  if (offers.length === 0) return null
  const links = offers.filter((o) => o.url && !o.torrentFile)
  const addAll = (): void => {
    const all = links.map((o) => ({ link: o.url!.trim(), headers: o.headers }))
    addInBackground(all, {
      folder: null,
      sortByType: false,
      when: 'now',
      perNetwork: 'auto',
      group:
        all.length > 1
          ? { id: crypto.randomUUID(), name: groupNameFor(all.map((a) => a.link)) }
          : undefined
    })
    removeOffers(links.map((o) => o.seq ?? -1))
  }
  const title = `${offers.length} waiting to be added`
  if (small)
    return (
      <button
        className="add-pill"
        type="button"
        aria-label="Show downloads waiting to be added"
        onClick={() => setSmall(false)}
      >
        <span className="wait-count">{offers.length}</span>
        <span>{title}</span>
      </button>
    )
  return (
    <section className="add-panel" aria-label="Waiting to be added">
      <div className="add-head">
        <b>{title}</b>
        <button
          className="icon-btn"
          type="button"
          aria-label="Minimise"
          onClick={() => setSmall(true)}
        >
          –
        </button>
      </div>
      <ul className="add-list" aria-label="Waiting">
        {offers.map((o) => {
          const name = offerName(o)
          return (
            <li key={o.seq} className="wait-item">
              <button
                className="wait-open"
                type="button"
                title={o.url}
                aria-label={`Open ${name}`}
                onClick={() => openOffer(o.seq ?? -1)}
              >
                {name}
              </button>
              <button
                className="wait-x"
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => removeOffers([o.seq ?? -1])}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      {links.length > 0 && (
        <div className="add-done">
          <div className="actions">
            <button className="btn primary" type="button" onClick={addAll}>
              {links.length === 1 ? 'Add it' : `Add all ${links.length}`}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
