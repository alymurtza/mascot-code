import { useEffect } from 'react'
import type { Download } from '@shared/download'
import { api } from './bridge'
import { useNow } from './clock'
import { get, report, set, toast, useApp } from './store'

/** A retry that fails again this quickly may never be seen leaving Needs attention. */
const QUICK_MS = 4000

/** Retries failed downloads and shows it: "Retrying…" until each one leaves Needs attention,
 * and a note if it fails again. */
export async function retry(list: Download[]): Promise<void> {
  const failed = list.filter((d) => d.status === 'failed')
  if (!failed.length) return
  set((s) => {
    const retrying = new Map(s.retrying)
    for (const d of failed) retrying.set(d.id, { at: Date.now(), left: false })
    return { retrying }
  })
  if (failed.length > 1) toast(`Retrying ${failed.length} downloads.`)
  try {
    await api.act(
      failed.map((d) => d.id),
      'retry'
    )
  } catch (error) {
    set((s) => {
      const retrying = new Map(s.retrying)
      for (const d of failed) retrying.delete(d.id)
      return { retrying }
    })
    report(error)
  }
}

/** Follows retried downloads: once one is under way it's no longer "Retrying…"; one that
 * fails again says so. */
export function useRetryWatch(): void {
  const downloads = useApp((s) => s.downloads)
  const watching = useApp((s) => s.retrying.size > 0)
  const now = useNow(watching ? 1000 : 60_000)
  useEffect(() => {
    const { retrying } = get()
    if (!retrying.size) return
    const next = new Map(retrying)
    const again: Download[] = []
    for (const [id, { at, left }] of retrying) {
      const d = downloads.find((x) => x.id === id)
      if (!d) next.delete(id)
      else if (d.status !== 'failed') {
        // Queued or waiting: keep watching; running, done or paused: it's been retried.
        if (d.status === 'queued' || d.status === 'checking') next.set(id, { at, left: true })
        else next.delete(id)
      } else if (left || now - at > QUICK_MS) {
        next.delete(id)
        again.push(d)
      }
    }
    set({ retrying: next })
    if (again.length === 1)
      toast(`${again[0].name} failed again: ${again[0].message ?? 'it couldn’t be downloaded'}.`)
    else if (again.length > 1) toast(`${again.length} downloads failed again.`)
  }, [downloads, now])
}
