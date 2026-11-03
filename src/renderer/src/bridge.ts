import type { Api, Events } from '@shared/api'

/** Typed calls to the main process (see shared/api.ts), over the preload's invoke. */
export const api = new Proxy({} as Api, {
  get:
    (_target, method: string) =>
    (...args: unknown[]) =>
      window.mascot.invoke(method as keyof Api, ...args)
})

/** Listens for an event from the main process; returns the unsubscribe. */
export const on = <K extends keyof Events>(
  name: K,
  listener: (payload: Events[K]) => void
): (() => void) => window.mascot.on(name, listener)

export const platform = window.mascot.platform
