/** Errors that say what went wrong in words for the user, and whether trying again can help. */
export class DownloadError extends Error {
  constructor(
    message: string,
    /** 'source': this link is no good (other links may be); 'network': this network had
     * trouble; 'busy': the server asked to slow down; 'fatal': nothing will help. */
    readonly scope: 'source' | 'network' | 'busy' | 'fatal',
    readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

export function httpError(status: number, retryAfter?: string): DownloadError {
  const after = retryAfter ? retryAfterMs(retryAfter) : undefined
  if (status === 429 || status === 503)
    return new DownloadError('The server is busy', 'busy', after)
  if (status === 401) return new DownloadError('The server asks for a sign-in', 'source')
  if (status === 403) return new DownloadError('The server refused access (403)', 'source')
  if (status === 404)
    return new DownloadError('The file isn’t on the server any more (404)', 'source')
  if (status === 410)
    return new DownloadError('The file was removed from the server (410)', 'source')
  if (status === 416)
    return new DownloadError('The server can’t send that part of the file', 'source')
  if (status >= 500) return new DownloadError(`The server had a problem (${status})`, 'network')
  return new DownloadError(`The server answered ${status}`, 'source')
}

function retryAfterMs(value: string): number | undefined {
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.min(120_000, Math.max(0, seconds * 1000))
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.min(120_000, Math.max(0, at - Date.now())) : undefined
}

/** The user-facing text for a system or socket error. */
export function describe(error: unknown): string {
  if (error instanceof DownloadError) return error.message
  const code = (error as NodeJS.ErrnoException)?.code
  switch (code) {
    case 'ENOSPC':
      return 'The disk is full'
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'Mascot can’t write to that folder'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The server’s name couldn’t be found'
    case 'ECONNREFUSED':
      return 'The server refused the connection'
    case 'ECONNRESET':
    case 'EPIPE':
      return 'The connection was cut'
    case 'ETIMEDOUT':
      return 'The server didn’t answer'
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'The server’s security certificate isn’t valid'
  }
  return error instanceof Error ? error.message : String(error)
}

/** Disk errors: retrying won't help until the user does something. */
export function isDiskError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
}
