import type { JSX, SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement>
const stroke = (width = 2): Props => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: width,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
})

export const Icon = {
  plus: (p: Props = {}): JSX.Element => (
    <svg {...stroke(2.2)} width={18} height={18} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  downloads: (): JSX.Element => (
    <svg {...stroke()}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  ),
  wifi: (): JSX.Element => (
    <svg {...stroke()}>
      <path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" />
      <circle cx="12" cy="19.5" r="1" fill="currentColor" />
    </svg>
  ),
  clock: (): JSX.Element => (
    <svg {...stroke()}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  settings: (): JSX.Element => (
    <svg {...stroke()}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  ),
  ethernet: (): JSX.Element => (
    <svg {...stroke()}>
      <path d="M4 6h16v10h-4v3H8v-3H4z" />
      <path d="M9 10v2M12 10v2M15 10v2" />
    </svg>
  ),
  usb: (): JSX.Element => (
    <svg {...stroke()}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  ),
  phone: (): JSX.Element => (
    <svg {...stroke()}>
      <rect x="7" y="7" width="10" height="15" rx="2" />
      <path d="M8.5 4a5 5 0 0 1 7 0" />
    </svg>
  ),
  router: (): JSX.Element => (
    <svg {...stroke()}>
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 16.5h.01M11 16.5h.01M8 9a6 6 0 0 1 8 0M10.5 11a2.5 2.5 0 0 1 3 0" />
    </svg>
  ),
  satellite: (): JSX.Element => (
    <svg {...stroke()}>
      <path d="M5 19l4-4" />
      <path d="M9 9l6 6-3 3-6-6z" />
      <path d="M14 4a6 6 0 0 1 6 6M14 7.5a2.5 2.5 0 0 1 2.5 2.5" />
    </svg>
  ),
  globe: (): JSX.Element => (
    <svg {...stroke()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
    </svg>
  ),
  laptop: (): JSX.Element => (
    <svg {...stroke()}>
      <rect x="5" y="5" width="14" height="10" rx="1.5" />
      <path d="M3 19h18" />
    </svg>
  ),
  building: (): JSX.Element => (
    <svg {...stroke()}>
      <path d="M5 21V4h10v17M15 9h4v12M3 21h18" />
      <path d="M8 8h.01M11 8h.01M8 12h.01M11 12h.01M8 16h.01M11 16h.01" />
    </svg>
  ),
  virtual: (): JSX.Element => (
    <svg {...stroke()}>
      <rect x="3" y="7" width="12" height="10" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4" />
    </svg>
  ),
  info: (): JSX.Element => (
    <svg {...stroke()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </svg>
  ),
  check: (): JSX.Element => (
    <svg {...stroke(3)} width={13} height={13}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  ),
  chev: (): JSX.Element => (
    <svg {...stroke(2.4)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  pause: (): JSX.Element => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  play: (): JSX.Element => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  ),
  up: (p: Props = {}): JSX.Element => (
    <svg {...stroke(2.4)} {...p}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  ),
  gauge: (): JSX.Element => (
    <svg {...stroke()}>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-5" />
    </svg>
  )
}

/** Icons a network can be shown with, and what each is called. */
export const NETWORK_ICONS = {
  wifi: ['Wi-Fi', Icon.wifi],
  ethernet: ['Cable', Icon.ethernet],
  usb: ['Phone (USB)', Icon.usb],
  phone: ['Hotspot', Icon.phone],
  router: ['Router', Icon.router],
  satellite: ['Satellite', Icon.satellite],
  globe: ['Internet', Icon.globe],
  laptop: ['Computer', Icon.laptop],
  building: ['Office', Icon.building]
} as const

export type NetworkIcon = keyof typeof NETWORK_ICONS

export function networkIcon(icon: string | undefined, kind: string): JSX.Element {
  const key = (icon && icon in NETWORK_ICONS ? icon : kind) as NetworkIcon | 'virtual' | 'other'
  if (key === 'virtual') return <Icon.virtual />
  if (key === 'other' || !(key in NETWORK_ICONS)) return <Icon.globe />
  const Draw = NETWORK_ICONS[key][1]
  return <Draw />
}
