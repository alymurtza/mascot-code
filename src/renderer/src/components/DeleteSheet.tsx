import { useState, type JSX } from 'react'
import { api } from '../bridge'
import { report, set, toast, useApp } from '../store'
import { Sheet } from './ui'

/** Asks before deleting several downloads: unfinished ones stop and their partial files go;
 * finished ones leave the list, keeping their files or moving them to the Trash. */
export function DeleteSheet(): JSX.Element | null {
  const ids = useApp((s) => s.deleting)
  const downloads = useApp((s) => s.downloads)
  const [busy, setBusy] = useState(false)
  if (!ids) return null
  const list = downloads.filter((d) => ids.includes(d.id))
  const finished = list.filter((d) => d.status === 'done').length
  const unfinished = list.length - finished
  const close = (): void => set({ deleting: null })
  const go = async (action: 'remove' | 'trash'): Promise<void> => {
    setBusy(true)
    try {
      await api.act(
        list.map((d) => d.id),
        action
      )
      set((s) => {
        const selected = new Set(s.selected)
        for (const d of list) selected.delete(d.id)
        return { deleting: null, selected, selecting: selected.size > 0 && s.selecting }
      })
      toast(`Deleted ${list.length} download${list.length === 1 ? '' : 's'}.`)
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }
  const n = (k: number, word: string): string => `${k} ${word}${k === 1 ? '' : 's'}`
  return (
    <Sheet title={`Delete ${n(list.length, 'download')}?`} id="delT" onClose={close} width={460}>
      {unfinished > 0 && (
        <p>
          {n(unfinished, 'unfinished download')} will stop, and what{' '}
          {unfinished === 1 ? 'it has' : 'they have'} downloaded will be deleted.
        </p>
      )}
      {finished > 0 && (
        <p>
          {n(finished, 'finished file')}: keep {finished === 1 ? 'it' : 'them'} on your computer, or
          move {finished === 1 ? 'it' : 'them'} to the Trash.
        </p>
      )}
      <div className="sheet-foot">
        <button className="btn" type="button" onClick={close} autoFocus>
          Cancel
        </button>
        {finished > 0 ? (
          <>
            <button className="btn" type="button" disabled={busy} onClick={() => void go('remove')}>
              Keep files
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={busy}
              onClick={() => void go('trash')}
            >
              Move to Trash
            </button>
          </>
        ) : (
          <button
            className="btn danger"
            type="button"
            disabled={busy}
            onClick={() => void go('remove')}
          >
            Delete
          </button>
        )}
      </div>
    </Sheet>
  )
}
