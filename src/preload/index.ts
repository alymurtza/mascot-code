import { contextBridge, ipcRenderer } from 'electron'
import { CALL_CHANNEL, EVENT_CHANNEL, type Api, type Events } from '../shared/api'

type Listener<K extends keyof Events> = (payload: Events[K]) => void

const listeners = new Map<keyof Events, Set<Listener<keyof Events>>>()
ipcRenderer.on(EVENT_CHANNEL, (_event, name: keyof Events, payload: unknown) => {
  for (const listener of listeners.get(name) ?? []) listener(payload as never)
})

/** `mascot.invoke(method, ...args)` for every Api method (the window wraps it as `mascot.call`),
 * `mascot.on(event, listener)` for events. */
const mascot = {
  platform: process.platform,
  flatpak: Boolean(process.env['FLATPAK_ID']),
  invoke: (method: keyof Api, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(CALL_CHANNEL, method, ...args),
  on<K extends keyof Events>(name: K, listener: Listener<K>): () => void {
    const set = listeners.get(name) ?? new Set()
    set.add(listener as Listener<keyof Events>)
    listeners.set(name, set)
    return () => set.delete(listener as Listener<keyof Events>)
  }
}

contextBridge.exposeInMainWorld('mascot', mascot)
