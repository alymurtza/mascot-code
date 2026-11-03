import type { JSX } from 'react'
import { networkColors } from '../colors'
import { inUnit } from '../format'
import { HISTORY_SECONDS, useApp } from '../store'

/** A round top for the axis: 10, 20, 50, 100… */
function niceMax(value: number): number {
  const top = Math.max(1, value * 1.15)
  const step = 10 ** Math.floor(Math.log10(top))
  for (const m of [1, 2, 5, 10]) if (top <= m * step) return m * step
  return 10 * step
}

/** Total speed over the last minute, stacked by network in each network's colour. */
export function SpeedChart(): JSX.Element {
  const { history, networks, settings } = useApp()
  const unit = settings.speedUnit
  const label = unit === 'bits' ? 'Mbps' : 'MB/s'
  const samples = [
    ...Array(Math.max(0, HISTORY_SECONDS - history.length)).fill({ at: 0, speeds: {} }),
    ...history
  ] as typeof history
  const ids = [...new Set(samples.flatMap((s) => Object.keys(s.speeds)))]
  const known = new Map(networks.map((n) => [n.id, n]))
  const colors = networkColors(
    ids.map((id) => ({ id, kind: known.get(id)?.kind ?? 'other' })),
    settings
  )
  const totals = samples.map((s) =>
    inUnit(
      Object.values(s.speeds).reduce((a, v) => a + v, 0),
      unit
    )
  )
  const live = history.slice(-HISTORY_SECONDS)
  const liveTotals = totals.slice(-Math.max(1, live.length))
  const current = totals[totals.length - 1] ?? 0
  const peak = Math.max(0, ...liveTotals)
  const average = liveTotals.reduce((a, v) => a + v, 0) / Math.max(1, liveTotals.length)
  const max = niceMax(peak)
  const n = samples.length
  const X = (i: number): string => ((i / (n - 1)) * 100).toFixed(2)
  const Y = (v: number): string => (100 - (v / max) * 100).toFixed(2)
  const base = samples.map(() => 0)
  const layers = ids.map((id) => {
    const low = base.slice()
    samples.forEach((s, i) => (base[i] += inUnit(s.speeds[id] ?? 0, unit)))
    const top = base.map((v, i) => `${X(i)} ${Y(v)}`)
    const bottom = low.map((v, i) => `${X(i)} ${Y(v)}`).reverse()
    return (
      <g key={id}>
        <path
          d={`M${top.join(' L')} L${bottom.join(' L')} Z`}
          style={{ fill: colors[id], fillOpacity: 0.22 }}
        />
        <path
          d={`M${top.join(' L')}`}
          fill="none"
          style={{ stroke: colors[id], strokeOpacity: 0.9 }}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </g>
    )
  })
  const line = 'M' + totals.map((v, i) => `${X(i)} ${Y(v)}`).join(' L')
  const inUse = networks.filter((x) => x.status === 'in-use' || x.status === 'covering')
  const fmt = (v: number): string => (v >= 100 ? Math.round(v).toString() : v.toFixed(1))
  const legendColors = networkColors(networks, settings)
  return (
    <section className="chart-card" aria-label="Total download speed">
      <div className="chart-top">
        <div>
          <div className="label">Total speed</div>
          <span className="big num" style={{ fontSize: 30, fontWeight: 500, lineHeight: 1 }}>
            {fmt(current)}
          </span>
          <span className="unit muted" style={{ marginLeft: 4, fontSize: 13 }}>
            {label}
          </span>
        </div>
        <div className="stats">
          <div>
            Average
            <b>
              {fmt(average)} {label}
            </b>
          </div>
          <div>
            Peak
            <b>
              {fmt(peak)} {label}
            </b>
          </div>
          <div>
            Networks<b>{inUse.length} combined</b>
          </div>
        </div>
      </div>
      <div className="legend" aria-label="Speed by network">
        {inUse.map((x) => (
          <span key={x.id}>
            <span
              className="dot"
              style={{ background: legendColors[x.id], color: legendColors[x.id] }}
            />
            {x.label}
            <span className="num muted">
              {fmt(inUnit(x.speed, unit))} {label}
            </span>
          </span>
        ))}
      </div>
      <div
        className="plot"
        role="img"
        aria-label={`Total speed over the last 60 seconds, now ${fmt(current)} ${label}`}
      >
        {[0, 50, 100].map((y) => (
          <div key={y}>
            <div className="gl" style={{ top: `${y}%` }} />
            <div className="ylab" style={{ top: `${y}%` }}>
              {y === 0 ? `${max} ${label}` : y === 50 ? max / 2 : 0}
            </div>
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {layers}
          <path
            d={line}
            fill="none"
            style={{ stroke: 'var(--ink)', strokeOpacity: 0.55 }}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        <span className="end" style={{ left: `${X(n - 1)}%`, top: `${Y(current)}%` }} />
      </div>
      <div className="xlab">
        <span>60 s ago</span>
        <span>30 s</span>
        <span>now</span>
      </div>
    </section>
  )
}
