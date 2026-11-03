export type AdapterKind = 'wifi' | 'ethernet' | 'usb' | 'virtual' | 'other'

/** A network adapter with at least one usable address. `id` is stable across reconnects (the
 * OS's device or friendly name). */
export interface Adapter {
  id: string
  /** What the OS calls it: "Wi-Fi", "Ethernet 2", "en0", "wlp2s0". */
  name: string
  kind: AdapterKind
  /** The OS's description of the hardware, where it gives one. */
  description?: string
  ipv4?: string
  ipv6?: string
  /** For binding to the device itself (Linux/macOS); unset where only the address is used. */
  device?: string
}

export type NetworkStatus =
  | 'in-use' // downloads may use it
  | 'covering' // a backup standing in for the Always networks
  | 'standby' // a backup, not needed now
  | 'failing' // can't get through right now
  | 'capped' // at its data limit
  | 'off'

/** A network as the window shows it. */
export interface NetworkView extends Adapter {
  /** The name to show: the user's, or the system's. */
  label: string
  status: NetworkStatus
  /** Bytes/s downloads are getting over it now. */
  speed: number
  /** Data used towards its limit in the current period. */
  limitUsed?: number
}

/** Data used per day (YYYY-MM-DD, local) per network id. */
export type UsageDays = Record<string, Record<string, number>>
