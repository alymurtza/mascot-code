import { useEffect, useState, type JSX } from 'react'
import type { WindowState } from '@shared/api'
import { api, on, platform } from '../bridge'

const isMac = platform === 'darwin'

function Glyph({ kind }: { kind: 'minimize' | 'maximize' | 'restore' | 'close' }): JSX.Element {
  return (
    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden>
      {kind === 'minimize' && <path d="M0 5.5h10" />}
      {kind === 'maximize' && <rect x=".5" y=".5" width="9" height="9" rx=".5" />}
      {kind === 'restore' && <path d="M.5 2.5h7v7h-7zM2.5 2.5V.5h7v7h-2" />}
      {kind === 'close' && <path d="M.5.5l9 9M9.5.5l-9 9" />}
    </svg>
  )
}

/** The window's title bar: icon and name, the page in the middle, and the window buttons. */
export function TitleBar({ page }: { page: string }): JSX.Element {
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true })
  useEffect(() => on('windowState', setState), [])
  return (
    <div
      className={`titlebar${isMac ? ' mac' : ''}${state.focused ? '' : ' blurred'}`}
      aria-label="Title bar"
    >
      <div className="tb-app">
        {/* The Mascot face, as the app icon, in the theme's colour. Drawn as a picture rather
            than boxes, so both eyes come out the same at any display scaling. */}
        <svg className="tb-face" viewBox="-0.65 -0.65 31.3 31.3" aria-hidden>
          <defs>
            <linearGradient id="tb-face-fill" x1="0.33" y1="0.03" x2="0.67" y2="0.97">
              <stop offset="0" className="tb-face-a" />
              <stop offset="1" className="tb-face-b" />
            </linearGradient>
          </defs>
          <path
            d="M10,0 H20 A10,10 0 0 1 30,10 V18 A12,12 0 0 1 18,30 H12 A12,12 0 0 1 0,18 V10 A10,10 0 0 1 10,0 Z"
            fill="url(#tb-face-fill)"
          />
          <rect className="tb-face-eye" x="8" y="11" width="5" height="7" rx="2.5" />
          <rect className="tb-face-eye" x="17" y="11" width="5" height="7" rx="2.5" />
        </svg>
        Mascot
      </div>
      <div className="tb-page">{page}</div>
      {isMac ? (
        <div />
      ) : (
        <div className="tb-btns" role="group" aria-label="Window">
          <button
            type="button"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => void api.windowControl('minimize')}
          >
            <Glyph kind="minimize" />
          </button>
          <button
            type="button"
            aria-label={state.maximized ? 'Restore window' : 'Maximize window'}
            title={state.maximized ? 'Restore' : 'Maximize'}
            onClick={() => void api.windowControl('maximize')}
          >
            <Glyph kind={state.maximized ? 'restore' : 'maximize'} />
          </button>
          <button
            type="button"
            className="tb-close"
            aria-label="Close window"
            title="Close"
            onClick={() => void api.windowControl('close')}
          >
            <Glyph kind="close" />
          </button>
        </div>
      )}
    </div>
  )
}
