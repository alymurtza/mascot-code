import type { JSX } from 'react'

/** Finished packets as a ring, the ones downloading now as a pulsing arc at its front, and the
 * percentage in the middle. */
export function ProgressRing(props: { done: number; now: number }): JSX.Element {
  const r = 18
  const c = 2 * Math.PI * r
  const done = Math.min(1, Math.max(0, props.done))
  const now = props.now > 0 ? Math.max(props.now, 0.045) : 0
  const percent = Math.floor(done * 100)
  return (
    <div
      className="ring"
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <svg viewBox="0 0 44 44" aria-hidden>
        <circle cx="22" cy="22" r={r} className="ring-track" />
        <circle
          cx="22"
          cy="22"
          r={r}
          className="ring-done"
          strokeDasharray={`${(done * c).toFixed(2)} ${c.toFixed(2)}`}
        />
        {now > 0 && (
          <circle
            cx="22"
            cy="22"
            r={r}
            className="ring-now"
            strokeDasharray="2 2"
            style={{ '--arc': (now * c).toFixed(2), '--c': c.toFixed(2) } as React.CSSProperties}
            strokeDashoffset={(-done * c).toFixed(2)}
            pathLength={c}
          />
        )}
      </svg>
      <span className="num">
        {percent}
        <small>%</small>
      </span>
    </div>
  )
}
