import type { NetworkView } from '@shared/network'
import type { Settings } from '@shared/settings'

/** Colours for a second network of the same kind, so two Ethernet ports don't look alike. */
const EXTRA = [
  '#5fd0b2',
  '#64c8ff',
  '#8fb4ff',
  '#d29bff',
  '#ff7d9c',
  '#ff9a62',
  '#f2c46e',
  '#9be07a'
]

export const SWATCHES = EXTRA

const kindVar = (kind: string): string =>
  kind === 'wifi'
    ? 'var(--n-wifi)'
    : kind === 'ethernet'
      ? 'var(--n-eth)'
      : kind === 'usb'
        ? 'var(--n-usb)'
        : 'var(--muted)'

/** Each network's colour: the user's, its kind's, or a spare one when its kind is taken. */
export function networkColors(
  networks: { id: string; kind: string }[],
  settings: Settings
): Record<string, string> {
  const out: Record<string, string> = {}
  const usedKinds = new Set<string>()
  let spare = 0
  for (const n of [...networks].sort((a, b) => a.id.localeCompare(b.id))) {
    const own = settings.networks?.[n.id]?.color
    if (own) out[n.id] = own
    else if (n.kind !== 'virtual' && n.kind !== 'other' && !usedKinds.has(n.kind)) {
      out[n.id] = kindVar(n.kind)
      usedKinds.add(n.kind)
    } else out[n.id] = n.kind === 'virtual' ? 'var(--muted)' : EXTRA[spare++ % EXTRA.length]
  }
  return out
}

export const labelOf = (n: NetworkView): string => n.label
