import type { ChecksumAlgorithm } from './download'

/** The algorithm a checksum is for, from its length; undefined if it isn't one. */
export function detectAlgorithm(value: string): ChecksumAlgorithm | undefined {
  const hex = value.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(hex)) return undefined
  if (hex.length === 32) return 'md5'
  if (hex.length === 40) return 'sha1'
  if (hex.length === 64) return 'sha256'
  return undefined
}
