import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'
import type { Adapter, AdapterKind } from '../../shared/network'

const run = promisify(execFile)

/** Names and descriptions that mean a virtual machine's or container's adapter. */
const VIRTUAL =
  /hyper-v|vethernet|virtualbox|vbox|vmware|vmnet|host-only|\bwsl\b|docker|veth|virbr|lxcbr|lxdbr|podman|cni|flannel|kube|npcap|loopback|tap-windows|bridge\d/i

/** Kind from what the OS calls the adapter and how it describes it. */
export function classify(name: string, description = ''): AdapterKind {
  const text = `${name} ${description}`
  if (VIRTUAL.test(text) || /^(br-|docker|veth|virbr)/.test(name)) return 'virtual'
  if (/wi-?fi|wireless|wlan|802\.11|airport|^wl/i.test(text)) return 'wifi'
  if (/iphone|ipad|android|r(emote )?ndis|tether|usb|^enx|^en\w*u\d|apple mobile/i.test(text))
    return 'usb'
  if (/ethernet|^eth|^en[ops]|^en\d|lan\b|realtek|intel.*(i2|e10)/i.test(text)) return 'ethernet'
  return 'other'
}

/** Extra names the OS gives: macOS hardware ports ("Wi-Fi" for en0), Windows adapter
 * descriptions. Looked up only when the set of devices changes; a failure just means less
 * detail. */
async function osDetails(): Promise<Map<string, { name?: string; description?: string }>> {
  const details = new Map<string, { name?: string; description?: string }>()
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await run('networksetup', ['-listallhardwareports'], { timeout: 5000 })
      let port = ''
      for (const line of stdout.split('\n')) {
        const p = /^Hardware Port: (.+)$/.exec(line)
        if (p) port = p[1].trim()
        const d = /^Device: (.+)$/.exec(line)
        if (d && port) details.set(d[1].trim(), { name: port, description: port })
      }
    } else if (process.platform === 'win32') {
      const { stdout } = await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-NetAdapter | Select-Object Name,InterfaceDescription | ConvertTo-Json -Compress'
        ],
        { timeout: 8000, windowsHide: true }
      )
      const parsed = JSON.parse(stdout.trim() || '[]') as
        | { Name: string; InterfaceDescription: string }
        | { Name: string; InterfaceDescription: string }[]
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        details.set(entry.Name, { description: entry.InterfaceDescription })
      }
    }
  } catch {
    // Less detail, nothing worse.
  }
  return details
}

/** Fake adapters for tests: MASCOT_TEST_ADAPTERS="Wi-Fi=127.0.0.2:wifi,Phone=127.0.0.3:usb". */
let testSpec: string | undefined = process.env['MASCOT_TEST_ADAPTERS']

/** Tests change the fake adapters while the app runs. */
export function setTestAdapters(spec: string): void {
  if (testSpec === undefined) throw new Error('Not in test mode')
  testSpec = spec
}

export const testMode = (): boolean => testSpec !== undefined

function testAdapters(): Adapter[] | null {
  const spec = testSpec
  if (spec === undefined) return null
  return spec
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [name, rest = ''] = entry.split('=')
      const [ipv4, kind] = rest.split(':')
      return { id: name, name, ipv4, kind: (kind as AdapterKind) || classify(name) }
    })
}

let cachedDetails: {
  devices: string
  details: Promise<Map<string, { name?: string; description?: string }>>
} | null = null

/** Every adapter with a usable address right now. */
export async function listAdapters(): Promise<Adapter[]> {
  const fake = testAdapters()
  if (fake) return fake
  const all = networkInterfaces()
  const devices = Object.keys(all).sort().join('|')
  if (cachedDetails?.devices !== devices) cachedDetails = { devices, details: osDetails() }
  const details = await cachedDetails.details
  const adapters: Adapter[] = []
  for (const [device, addresses] of Object.entries(all)) {
    const usable = (addresses ?? []).filter(
      (a) => !a.internal && !a.address.startsWith('169.254.') && !/^fe80:/i.test(a.address)
    )
    if (usable.length === 0) continue
    const extra = details.get(device)
    const name = extra?.name ?? device
    adapters.push({
      id: device,
      name,
      kind: classify(device, `${name} ${extra?.description ?? ''}`),
      description: extra?.description,
      ipv4: usable.find((a) => a.family === 'IPv4')?.address,
      ipv6: usable.find((a) => a.family === 'IPv6')?.address,
      device: process.platform === 'win32' ? undefined : device
    })
  }
  return adapters.sort((a, b) => a.name.localeCompare(b.name))
}

/** Looks at the adapters every second and reports when they change. */
export class AdapterWatcher {
  private current: Adapter[] | null = null
  private timer: NodeJS.Timeout | null = null
  private looking = false

  constructor(private readonly onChange: (adapters: Adapter[]) => void) {}

  start(): void {
    void this.look()
    this.timer = setInterval(() => void this.look(), 1000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Null until the first look has finished. */
  get adapters(): Adapter[] | null {
    return this.current
  }

  find(id: string): Adapter | undefined {
    return this.current?.find((a) => a.id === id)
  }

  async look(): Promise<Adapter[]> {
    if (this.looking) return this.current ?? []
    this.looking = true
    try {
      const next = await listAdapters()
      if (JSON.stringify(next) !== JSON.stringify(this.current)) {
        this.current = next
        this.onChange(next)
      }
      return next
    } finally {
      this.looking = false
    }
  }
}
