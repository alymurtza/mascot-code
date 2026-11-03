import { useState, type JSX } from 'react'
import { commonName, groupNameFor, groupsOf } from '@shared/group'
import { api } from '../bridge'
import { report, set, toast, useApp } from '../store'
import { Sheet } from './ui'

/** Puts the chosen downloads in a group: one already there, or a new one with a name. */
export function GroupSheet(): JSX.Element | null {
  const ids = useApp((s) => s.grouping)
  const downloads = useApp((s) => s.downloads)
  const [pick, setPick] = useState<string>('new')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  if (!ids) return null
  const list = downloads.filter((d) => ids.includes(d.id))
  const groups = [...groupsOf(downloads).entries()].map(([id, members]) => ({
    id,
    name: members[0].group!.name,
    count: members.length
  }))
  const suggested = commonName(list.map((d) => d.name)) || groupNameFor(list.map((d) => d.url))
  const close = (): void => {
    set({ grouping: null })
    setPick('new')
    setName('')
  }
  const save = async (): Promise<void> => {
    const group =
      pick === 'new'
        ? { id: crypto.randomUUID(), name: name.trim() || suggested }
        : groups.find((g) => g.id === pick)
    if (!group) return
    setBusy(true)
    try {
      await api.setGroup(
        list.map((d) => d.id),
        { id: group.id, name: group.name }
      )
      set({ selected: new Set(), selecting: false })
      toast(`Added ${list.length} to ${group.name}.`)
      close()
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      title={`Add ${list.length} download${list.length === 1 ? '' : 's'} to a group`}
      id="grpT"
      onClose={close}
      width={460}
    >
      <div className="radio-list" role="radiogroup" aria-label="Group">
        <label className="radio-row">
          <input
            type="radio"
            name="group"
            checked={pick === 'new'}
            onChange={() => setPick('new')}
          />
          <span>New group</span>
        </label>
        {pick === 'new' && (
          <input
            className="inp"
            aria-label="Group name"
            placeholder={suggested}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
        )}
        {groups.map((g) => (
          <label className="radio-row" key={g.id}>
            <input
              type="radio"
              name="group"
              checked={pick === g.id}
              onChange={() => setPick(g.id)}
            />
            <span>{g.name}</span>
            <span className="muted">
              {g.count} file{g.count === 1 ? '' : 's'}
            </span>
          </label>
        ))}
      </div>
      <div className="sheet-foot">
        <button className="btn" type="button" onClick={close}>
          Cancel
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={busy || list.length === 0}
          onClick={() => void save()}
        >
          Add to group
        </button>
      </div>
    </Sheet>
  )
}
