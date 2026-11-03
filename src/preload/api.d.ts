import type { Api, Events } from '../shared/api'

declare global {
  interface Window {
    mascot: {
      platform: NodeJS.Platform
      flatpak: boolean
      invoke(method: keyof Api, ...args: unknown[]): Promise<unknown>
      on<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): () => void
    }
  }
}
export {}
