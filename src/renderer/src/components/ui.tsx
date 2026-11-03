import type { JSX, ReactNode } from 'react'

export function Switch(props: {
  checked: boolean
  label: string
  onChange: (on: boolean) => void
  style?: React.CSSProperties
}): JSX.Element {
  return (
    <button
      className="switch"
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      style={props.style}
      onClick={(e) => {
        e.stopPropagation()
        props.onChange(!props.checked)
      }}
    />
  )
}

/** A row of small choice buttons. */
export function Choice<T extends string | number>(props: {
  label: string
  value: T
  options: [T, ReactNode][]
  onChange: (value: T) => void
  disabled?: T[]
}): JSX.Element {
  return (
    <div
      className="mini-seg"
      role="group"
      aria-label={props.label}
      onClick={(e) => e.stopPropagation()}
    >
      {props.options.map(([value, text]) => (
        <button
          key={String(value)}
          type="button"
          aria-pressed={props.value === value}
          aria-disabled={props.disabled?.includes(value) || undefined}
          onClick={() => props.onChange(value)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function Section(props: {
  label: string
  count?: ReactNode
  tools?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="section" aria-label={props.label}>
      <div className="sec-head">
        <h3>{props.label}</h3>
        {props.count !== undefined && <span className="n">{props.count}</span>}
        <span className="rule" />
        {props.tools}
      </div>
      {props.children}
    </section>
  )
}

export function Sheet(props: {
  title: string
  id: string
  onClose: () => void
  width?: number
  children: ReactNode
  className?: string
  /** What a click outside does, instead of closing it. */
  onOutside?: () => void
}): JSX.Element {
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) (props.onOutside ?? props.onClose)()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose()
      }}
    >
      <div
        className={`sheet ${props.className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.id}
        style={props.width ? { width: `min(${props.width}px, 100%)` } : undefined}
      >
        <div className="sheet-head">
          <h3 id={props.id}>{props.title}</h3>
          <button className="x" type="button" aria-label="Close" onClick={props.onClose}>
            ×
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

function Up(p: { flip?: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={p.flip ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  )
}

/** Up and down arrows for reordering. */
export function Order(props: {
  name: string
  first: boolean
  last: boolean
  move: (by: -1 | 1) => void
}): JSX.Element {
  return (
    <span className="order" onClick={(e) => e.stopPropagation()}>
      <button
        className="mini-btn"
        type="button"
        aria-label={`Move ${props.name} up`}
        disabled={props.first}
        onClick={() => props.move(-1)}
      >
        <Up />
      </button>
      <button
        className="mini-btn"
        type="button"
        aria-label={`Move ${props.name} down`}
        disabled={props.last}
        onClick={() => props.move(1)}
      >
        <Up flip />
      </button>
    </span>
  )
}
