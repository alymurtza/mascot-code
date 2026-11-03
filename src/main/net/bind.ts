import { isIPv6, Socket } from 'node:net'

/**
 * Connects a TCP socket tied to one network device, so the connection leaves through it
 * whatever the routing table prefers:
 * - Linux: SO_BINDTODEVICE.
 * - macOS: IP_BOUND_IF / IPV6_BOUND_IF with the device's index.
 * - Windows: not needed. Windows sends from the interface that owns the source address, so
 *   binding the source address is enough (see connect.ts).
 *
 * Node can't connect a socket it didn't create, so the socket is made and connected with the
 * system's own calls (the connect runs on a koffi worker thread, never blocking the app), then
 * handed to Node once connected.
 *
 * Resolves null when the device can't be used this way (no koffi, unknown device, no
 * permission): the caller then binds the source address only.
 */

interface Libc {
  socket: (domain: number, type: number, protocol: number) => number
  setsockoptStr: (fd: number, level: number, name: number, value: string, len: number) => number
  setsockoptBuf: (fd: number, level: number, name: number, value: Buffer, len: number) => number
  connect: {
    async: (
      fd: number,
      addr: Buffer,
      len: number,
      done: (err: unknown, result: number) => void
    ) => void
  }
  close: (fd: number) => number
  ifNameToIndex: (name: string) => number
  errno: () => number
}

const mac = process.platform === 'darwin'
const C = mac
  ? {
      AF_INET: 2,
      AF_INET6: 30,
      SOCK_STREAM: 1,
      SOL_SOCKET: 0xffff,
      SO_SNDTIMEO: 0x1005,
      IPPROTO_IP: 0,
      IP_BOUND_IF: 25,
      IPPROTO_IPV6: 41,
      IPV6_BOUND_IF: 125,
      IPPROTO_TCP: 6,
      TCP_CONNECTIONTIMEOUT: 0x20
    }
  : {
      AF_INET: 2,
      AF_INET6: 10,
      SOCK_STREAM: 1 | 0x80000 /* SOCK_CLOEXEC */,
      SOL_SOCKET: 1,
      SO_SNDTIMEO: 21,
      SO_BINDTODEVICE: 25
    }

let libc: Libc | null | undefined

function loadLibc(): Libc | null {
  if (libc !== undefined) return libc
  libc = null
  if (process.platform !== 'linux' && !mac) return libc
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const lib = koffi.load(mac ? 'libSystem.B.dylib' : 'libc.so.6')
    libc = {
      socket: lib.func('int socket(int, int, int)'),
      setsockoptStr: lib.func('setsockopt', 'int', ['int', 'int', 'int', 'str', 'uint32']),
      setsockoptBuf: lib.func('setsockopt', 'int', ['int', 'int', 'int', 'void *', 'uint32']),
      connect: lib.func('connect', 'int', ['int', 'void *', 'uint32']),
      close: lib.func('int close(int)'),
      ifNameToIndex: lib.func('unsigned int if_nametoindex(const char *)'),
      errno: () => koffi.errno()
    }
  } catch {
    libc = null
  }
  return libc
}

/** sockaddr_in / sockaddr_in6 for `address`:`port`. */
function socketAddress(address: string, port: number, v6: boolean): Buffer {
  const buf = Buffer.alloc(v6 ? 28 : 16)
  if (mac) {
    buf[0] = buf.length
    buf[1] = v6 ? C.AF_INET6 : C.AF_INET
  } else buf.writeUInt16LE(v6 ? C.AF_INET6 : C.AF_INET, 0)
  buf.writeUInt16BE(port, 2)
  if (!v6) {
    address.split('.').forEach((part, i) => (buf[4 + i] = Number(part)))
    return buf
  }
  const [head, tail = ''] = address.split('%')[0].split('::')
  const groups = (s: string): string[] => (s ? s.split(':') : [])
  const left = groups(head)
  const right = groups(tail)
  const all = address.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left
  all.forEach((g, i) => buf.writeUInt16BE(parseInt(g, 16) || 0, 8 + i * 2))
  return buf
}

/** Whether binding to devices can work here at all. */
export function canBindDevices(): boolean {
  return loadLibc() !== null
}

/** A TCP connection to address:port through `device`; null if the device can't be bound. */
export function connectOnDevice(
  device: string,
  address: string,
  port: number,
  timeoutMs: number
): Promise<Socket | null> {
  const c = loadLibc()
  if (!c) return Promise.resolve(null)
  const v6 = isIPv6(address)
  const index = c.ifNameToIndex(device)
  if (!index) return Promise.resolve(null)
  const fd = c.socket(v6 ? C.AF_INET6 : C.AF_INET, C.SOCK_STREAM, 0)
  if (fd < 0) return Promise.resolve(null)
  const int = (value: number): Buffer => {
    const b = Buffer.alloc(4)
    b.writeInt32LE(value)
    return b
  }
  let bound: boolean
  if (mac) {
    bound = v6
      ? c.setsockoptBuf(fd, C.IPPROTO_IPV6!, C.IPV6_BOUND_IF!, int(index), 4) === 0
      : c.setsockoptBuf(fd, C.IPPROTO_IP!, C.IP_BOUND_IF!, int(index), 4) === 0
    c.setsockoptBuf(
      fd,
      C.IPPROTO_TCP!,
      C.TCP_CONNECTIONTIMEOUT!,
      int(Math.ceil(timeoutMs / 1000)),
      4
    )
  } else {
    const name = device + '\0'
    bound =
      c.setsockoptStr(fd, C.SOL_SOCKET, C.SO_BINDTODEVICE!, name, Buffer.byteLength(name)) === 0
    // struct timeval {long tv_sec; long tv_usec}: the connect gives up after this long.
    const tv = Buffer.alloc(16)
    tv.writeBigInt64LE(BigInt(Math.floor(timeoutMs / 1000)), 0)
    tv.writeBigInt64LE(BigInt((timeoutMs % 1000) * 1000), 8)
    c.setsockoptBuf(fd, C.SOL_SOCKET, C.SO_SNDTIMEO, tv, 16)
  }
  if (!bound) {
    c.close(fd)
    return Promise.resolve(null)
  }
  const addr = socketAddress(address, port, v6)
  return new Promise((resolve, reject) => {
    c.connect.async(fd, addr, addr.length, (err, result) => {
      if (err || result !== 0) {
        c.close(fd)
        return reject(new Error(`Couldn't connect to ${address} over ${device}`))
      }
      resolve(new Socket({ fd, readable: true, writable: true }))
    })
  })
}
