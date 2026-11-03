import { BrowserWindow, ipcMain } from 'electron'
import { CALL_CHANNEL, EVENT_CHANNEL, type Api, type Events } from '../shared/api'

type Handlers = {
  [K in keyof Api]: (
    ...args: Parameters<Api[K]>
  ) => ReturnType<Api[K]> | Awaited<ReturnType<Api[K]>>
}

/** Serves the window's calls (see shared/api.ts). Each handler gets the window that called. */
export function serveApi(make: (window: BrowserWindow | null) => Handlers): void {
  ipcMain.handle(CALL_CHANNEL, async (event, method: string, ...args: unknown[]) => {
    const handlers = make(BrowserWindow.fromWebContents(event.sender))
    if (!Object.hasOwn(handlers, method)) throw new Error(`Unknown call: ${method}`)
    const handler = handlers[method as keyof Api] as (...a: unknown[]) => unknown
    return handler(...args)
  })
}

const pending = new Map<keyof Events, NodeJS.Timeout>()

/** Sends an event to every window. With `throttleMs`, bursts are sent once, with the latest. */
export function emit<K extends keyof Events>(
  name: K,
  payload: Events[K] | (() => Events[K]),
  throttleMs = 0
): void {
  const send = (): void => {
    const value = typeof payload === 'function' ? (payload as () => Events[K])() : payload
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, name, value)
    }
  }
  if (!throttleMs) return send()
  if (pending.has(name)) return
  pending.set(
    name,
    setTimeout(() => {
      pending.delete(name)
      send()
    }, throttleMs)
  )
}
