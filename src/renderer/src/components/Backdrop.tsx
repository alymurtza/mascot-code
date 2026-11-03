import { useEffect, useRef, type JSX } from 'react'
import type { Special } from '@shared/settings'
import { runBackdrop } from '../backdrop'
import { useApp } from '../store'

/** A special theme's backdrop: its sky in CSS and anything that moves on a canvas. */
export function Backdrop({
  kind,
  className = '',
  fps
}: {
  kind: Special
  className?: string
  fps?: number
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const still = !useApp((s) => s.settings.animateBackdrop)
  useEffect(
    () => (canvas.current ? runBackdrop(canvas.current, kind, { fps, still }) : undefined),
    [kind, fps, still]
  )
  return (
    <div className={`backdrop bd-${kind}${still ? ' still' : ''} ${className}`} aria-hidden>
      <div className="fx">
        <canvas ref={canvas} />
      </div>
    </div>
  )
}
