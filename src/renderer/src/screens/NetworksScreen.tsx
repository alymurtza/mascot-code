import { useEffect, useState, type JSX } from 'react'
import type { DeviceView, SpeedTestResult } from '@shared/api'
import type { NetworkView, UsageDays } from '@shared/network'
import type { DataPeriod, NetworkPrefs } from '@shared/settings'
import { api } from '../bridge'
import { useNow } from '../clock'
import { networkColors, SWATCHES } from '../colors'
import { fromUnit, inUnit, size, speed, speedParts } from '../format'
import { Icon, NETWORK_ICONS, networkIcon, type NetworkIcon } from '../icons'
import { report, toast, useApp } from '../store'
import { Choice, Order, Section, Sheet, Switch } from '../components/ui'

const GB = 1024 ** 3
const PERIOD_WORD: Record<DataPeriod, string> = {
  day: 'today',
  week: 'this week',
  month: 'this month'
}

const update = (id: string, patch: Partial<NetworkPrefs>): Promise<unknown> =>
  api.updateNetwork(id, patch).catch(report)

interface Draft {
  name: string
  color?: string
  icon: string
}

function EditPanel({
  n,
  draft,
  onChange,
  onDone
}: {
  n: NetworkView
  draft: Draft
  onChange: (draft: Draft) => void
  onDone: () => void
}): JSX.Element {
  const { name, color: chosenColor, icon } = draft
  const setName = (v: string): void => onChange({ ...draft, name: v })
  const setColor = (v: string | undefined): void => onChange({ ...draft, color: v })
  const setIcon = (v: string): void => onChange({ ...draft, icon: v })
  return (
    <div className="edit" onClick={(e) => e.stopPropagation()}>
      <div className="field">
        <label htmlFor={`nm-${n.id}`}>Name</label>
        <input
          className="inp"
          id={`nm-${n.id}`}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="muted">The system calls it “{n.name}”.</span>
      </div>
      <div className="field">
        <span style={{ fontWeight: 500 }}>Colour</span>
        <div className="colors" role="group" aria-label="Colour">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="cdot"
              aria-label={`Colour ${c}`}
              aria-pressed={chosenColor === c}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
          <button
            type="button"
            className="link"
            style={{ marginLeft: 6 }}
            onClick={() => setColor(undefined)}
          >
            Theme default
          </button>
        </div>
      </div>
      <div className="field">
        <span style={{ fontWeight: 500 }}>Icon</span>
        <div className="icons" role="group" aria-label="Icon">
          {(Object.keys(NETWORK_ICONS) as NetworkIcon[]).map((k) => {
            const [label, Draw] = NETWORK_ICONS[k]
            return (
              <button
                key={k}
                type="button"
                className="ichoice"
                aria-label={label}
                title={label}
                aria-pressed={icon === k}
                onClick={() => setIcon(k)}
              >
                <Draw />
              </button>
            )
          })}
        </div>
      </div>
      <div className="inline">
        <button
          className="btn primary"
          type="button"
          onClick={() => {
            const trimmed = name.trim()
            void update(n.id, {
              name: trimmed && trimmed !== n.name ? trimmed : undefined,
              color: chosenColor,
              icon: icon === n.kind ? undefined : icon
            }).then(onDone)
          }}
        >
          Save
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Cancel
        </button>
        <button
          className="link"
          type="button"
          style={{ marginLeft: 'auto' }}
          onClick={() =>
            void update(n.id, { name: undefined, color: undefined, icon: undefined }).then(onDone)
          }
        >
          Reset all
        </button>
      </div>
    </div>
  )
}

function Limits({ n }: { n: NetworkView }): JSX.Element {
  const { settings } = useApp()
  const prefs = settings.networks[n.id] ?? {}
  const unit = settings.speedUnit
  const [editing, setEditing] = useState(false)
  const [gb, setGb] = useState(
    prefs.dataLimit ? String(+(prefs.dataLimit.bytes / GB).toFixed(2)) : '5'
  )
  const [period, setPeriod] = useState<DataPeriod>(prefs.dataLimit?.period ?? 'day')
  const [rate, setRate] = useState(
    prefs.speedLimit ? String(+inUnit(prefs.speedLimit, unit).toFixed(1)) : ''
  )
  const limit = prefs.dataLimit
  const used = n.limitUsed ?? 0
  return (
    <div className="cap" onClick={(e) => e.stopPropagation()}>
      {!editing && limit && (
        <>
          <div className="r">
            <span>
              Limit {+(limit.bytes / GB).toFixed(2)} GB per {limit.period}
            </span>
            <span className="num muted">{size(used)} used</span>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, (used / limit.bytes) * 100).toFixed(0)}%` }} />
          </div>
        </>
      )}
      {!editing && (
        <div className="r">
          <span className="muted">
            {limit ? '' : 'No data limit'}
            {prefs.speedLimit
              ? `${limit ? '' : ' · '}Speed limit ${speed(prefs.speedLimit, unit)}`
              : ''}
          </span>
          <span className="inline">
            {limit && used > 0 && (
              <button
                className="link"
                type="button"
                onClick={() =>
                  void api.resetDataLimit(n.id).then(() => toast('Count starts again from zero.'))
                }
              >
                Reset count
              </button>
            )}
            <button className="link" type="button" onClick={() => setEditing(true)}>
              {limit || prefs.speedLimit ? 'Change' : 'Set a limit'}
            </button>
          </span>
        </div>
      )}
      {editing && (
        <div className="edit" style={{ borderTop: 0, paddingTop: 0 }}>
          <div className="rule">
            <span>Data limit</span>
            <input
              className="inp num"
              style={{ width: 80 }}
              aria-label="Data limit in GB"
              value={gb}
              onChange={(e) => setGb(e.target.value)}
            />
            <span className="muted">GB per</span>
            <Choice
              label="Data limit period"
              value={period}
              options={[
                ['day', 'Day'],
                ['week', 'Week'],
                ['month', 'Month']
              ]}
              onChange={setPeriod}
            />
          </div>
          <div className="rule">
            <span>Speed limit</span>
            <input
              className="inp num"
              style={{ width: 80 }}
              aria-label={`Speed limit in ${unit === 'bits' ? 'Mbps' : 'MB/s'}`}
              placeholder="None"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <span className="muted">{unit === 'bits' ? 'Mbps' : 'MB/s'}</span>
          </div>
          <div className="inline">
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                const g = Number(gb)
                const r = Number(rate)
                void update(n.id, {
                  dataLimit: g > 0 ? { bytes: Math.round(g * GB), period } : undefined,
                  speedLimit: r > 0 ? Math.round(fromUnit(r, unit)) : undefined
                }).then(() => setEditing(false))
              }}
            >
              Save
            </button>
            <button className="btn" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {(limit || prefs.speedLimit) && (
              <button
                className="link"
                type="button"
                style={{ marginLeft: 'auto' }}
                onClick={() =>
                  void update(n.id, { dataLimit: undefined, speedLimit: undefined }).then(() =>
                    setEditing(false)
                  )
                }
              >
                Remove limits
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NetworkRow(props: {
  n: NetworkView
  color: string
  themeColor: string
  backupIndex: number
  backups: number
  lastAlways: boolean
  usedToday: number
}): JSX.Element {
  const { n, color, backupIndex, lastAlways } = props
  const { settings } = useApp()
  const prefs = settings.networks[n.id] ?? {}
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const editing = draft !== null
  const startEditing = (): void =>
    setDraft({ name: n.label, color: prefs.color, icon: prefs.icon ?? n.kind })
  const shownColor = draft ? (draft.color ?? props.themeColor) : color
  const shownLabel = draft ? draft.name.trim() || n.name : n.label
  const [hint, setHint] = useState(false)
  const [test, setTest] = useState<string | null>(null)
  const on = !prefs.off
  const backup = prefs.role === 'backup'
  const covering = n.status === 'covering'
  const statusText: Record<string, string> = {
    'in-use': 'In use',
    covering: 'Covering for your Always networks',
    standby: backupIndex === 0 ? 'First to take over' : 'Standby',
    off: 'Not used for downloads',
    failing: 'Can’t get through right now',
    capped: 'Reached its data limit'
  }
  const [speedValue, speedUnit] = speedParts(n.speed, settings.speedUnit)
  const runTest = (): void => {
    setTest('Testing…')
    api
      .speedTest(n.id)
      .then((r: SpeedTestResult) =>
        setTest(`${speed(r.speed, settings.speedUnit)} · ping ${r.ping} ms`)
      )
      .catch((e) =>
        setTest(
          String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        )
      )
  }
  const limit = prefs.dataLimit
  return (
    <article className={`dl net-row${open || editing ? ' open' : ''}`} aria-label={n.label}>
      <div className="row" onClick={() => setOpen(!open)}>
        <button
          className="chev"
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${n.label}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          <Icon.chev />
        </button>
        <div className="ftype net-tile" style={{ color: shownColor }}>
          {networkIcon(draft ? draft.icon : prefs.icon, n.kind)}
        </div>
        <div className="main">
          <div className="name">
            {shownLabel}
            {covering && (
              <>
                {' '}
                <span className="badge gold">Covering</span>
              </>
            )}
          </div>
          <div className="meta">
            {hint && lastAlways ? (
              <span className="warn-txt" role="status">
                Keep at least one network on Always. Set another one to Always first.
              </span>
            ) : (
              <>
                <span>{statusText[n.status] ?? n.status}</span>
                {limit && on && (
                  <span className="num">
                    {size(n.limitUsed ?? 0)} / {+(limit.bytes / GB).toFixed(2)} GB{' '}
                    {PERIOD_WORD[limit.period]}
                  </span>
                )}
                {test && (
                  <span
                    className={
                      test === 'Testing…' ? '' : test.includes('ping') ? 'ok-txt' : 'warn-txt'
                    }
                  >
                    {test}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="right">
          {backupIndex >= 0 && on && (
            <Order
              name={n.label}
              first={backupIndex === 0}
              last={backupIndex === props.backups - 1}
              move={(by) => {
                // Swap ranks with the neighbour.
                const list = useApp
                  .getState()
                  .networks.filter(
                    (x) =>
                      settings.networks[x.id]?.role === 'backup' && !settings.networks[x.id]?.off
                  )
                  .sort(
                    (a, b) =>
                      (settings.networks[a.id]?.rank ?? 0) - (settings.networks[b.id]?.rank ?? 0)
                  )
                const other = list[backupIndex + by]
                if (!other) return
                void Promise.all([
                  update(n.id, { rank: backupIndex + by }),
                  update(other.id, { rank: backupIndex })
                ]).then(() =>
                  list.forEach(
                    (x, i) => x.id !== n.id && x.id !== other.id && update(x.id, { rank: i })
                  )
                )
              }}
            />
          )}
          {on && (
            <Choice
              label={`When to use ${n.label}`}
              value={backup ? 'backup' : 'always'}
              options={[
                ['always', 'Always'],
                ['backup', 'Backup']
              ]}
              disabled={lastAlways ? ['backup'] : []}
              onChange={(role) => {
                if (role === 'backup' && lastAlways) return setHint(true)
                setHint(false)
                void update(n.id, {
                  role: role === 'backup' ? 'backup' : undefined,
                  rank: role === 'backup' ? 999 : undefined
                })
              }}
            />
          )}
          <div className="speed">
            {n.status === 'in-use' || n.status === 'covering' ? (
              <>
                {speedValue}
                <small>{speedUnit}</small>
              </>
            ) : (
              <span className="muted">
                {on ? (n.status === 'standby' ? 'Standby' : '—') : 'Off'}
              </span>
            )}
          </div>
          {on && (
            <button
              className="mini-btn"
              type="button"
              aria-label={`Test the speed of ${n.label}`}
              title="Test speed"
              disabled={test === 'Testing…'}
              onClick={(e) => {
                e.stopPropagation()
                runTest()
              }}
            >
              <Icon.gauge />
            </button>
          )}
          <Switch
            checked={on}
            label={`Use ${n.label} for downloads`}
            style={{ marginLeft: 2 }}
            onChange={(next) => {
              if (!next && lastAlways) return setHint(true)
              void update(n.id, { off: next ? undefined : true })
            }}
          />
        </div>
      </div>
      {(open || editing) && (
        <div className="detail" onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <EditPanel n={n} draft={draft} onChange={setDraft} onDone={() => setDraft(null)} />
          ) : (
            <>
              <div className="facts">
                <div>
                  Address<b>{[n.ipv4, n.ipv6].filter(Boolean).join(' · ') || '—'}</b>
                </div>
                <div>
                  System name<b>{n.description ? `${n.name} · ${n.description}` : n.name}</b>
                </div>
                <div>
                  Used today<b>{size(props.usedToday)}</b>
                </div>
                <div>
                  Shown as
                  <b>{(NETWORK_ICONS[(prefs.icon ?? n.kind) as NetworkIcon] ?? ['Internet'])[0]}</b>
                </div>
              </div>
              <Limits n={n} />
              <div className="actions">
                <button className="btn" type="button" onClick={startEditing}>
                  Name, colour &amp; icon
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    if (lastAlways) return setHint(true)
                    void update(n.id, { hidden: true }).then(() =>
                      toast(`${n.label} removed from this page. Add it back from All devices.`)
                    )
                  }}
                >
                  Remove from this page
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  )
}

const TYPE_FILTERS: [string, string][] = [
  ['all', 'All types'],
  ['wifi', 'Wi-Fi'],
  ['ethernet', 'Ethernet'],
  ['usb', 'Phone & USB'],
  ['virtual', 'Virtual'],
  ['other', 'Other']
]

export function DevicesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const settings = useApp((s) => s.settings)
  const [devices, setDevices] = useState<DeviceView[]>([])
  const [q, setQ] = useState('')
  const [show, setShow] = useState<'all' | 'shown' | 'hidden'>('all')
  const [type, setType] = useState('all')
  const [connected, setConnected] = useState(false)
  const now = useNow(60_000)
  useEffect(() => {
    void api.devices().then(setDevices)
  }, [settings])
  const colors = networkColors(devices, settings)
  const list = devices
    .filter((d) => show === 'all' || (show === 'shown') === !d.hidden)
    .filter((d) => type === 'all' || d.kind === type)
    .filter((d) => !connected || d.connected)
    .filter(
      (d) =>
        !q || `${d.label} ${d.name} ${d.description ?? ''}`.toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.label.localeCompare(b.label))
  const removed = devices.filter((d) => d.hidden).length
  const virtualShown = devices.filter((d) => d.kind === 'virtual' && !d.hidden && d.connected)
  const seen = (d: DeviceView): string => {
    if (d.connected) return [d.description].filter(Boolean).join(' · ') || 'Connected'
    const days = Math.floor((now - d.lastSeen) / 86_400_000)
    return days < 1
      ? 'Seen today'
      : days === 1
        ? 'Seen yesterday'
        : days < 7
          ? `Seen ${days} days ago`
          : days < 14
            ? 'Seen last week'
            : `Seen ${new Date(d.lastSeen).toLocaleDateString()}`
  }
  return (
    <Sheet title="All devices" id="devT" className="dev-sheet" onClose={onClose}>
      <div className="dev-tools" role="search">
        <input
          className="find"
          type="search"
          placeholder="Search devices"
          aria-label="Search devices"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Choice
          label="Show"
          value={show}
          options={[
            ['all', 'All'],
            ['shown', 'On Networks page'],
            [
              'hidden',
              <>
                Removed <span className="num">{removed}</span>
              </>
            ]
          ]}
          onChange={setShow}
        />
        <label className="dev-conn">
          <Switch checked={connected} label="Connected only" onChange={setConnected} />
          Connected only
        </label>
      </div>
      <div className="dev-types" role="group" aria-label="Type">
        {TYPE_FILTERS.map(([v, l]) => (
          <button
            key={v}
            type="button"
            className="tchip"
            aria-pressed={type === v}
            onClick={() => setType(v)}
          >
            {l}{' '}
            <span className="num">
              {v === 'all' ? devices.length : devices.filter((d) => d.kind === v).length}
            </span>
          </button>
        ))}
      </div>
      {virtualShown.length > 0 && (
        <div className="banner" role="status">
          <span>
            {virtualShown.length} virtual{' '}
            {virtualShown.length === 1 ? 'adapter is' : 'adapters are'} on your Networks page. They
            rarely reach the internet.
          </span>
          <button
            className="btn"
            type="button"
            onClick={() => virtualShown.forEach((d) => update(d.id, { hidden: true }))}
          >
            Remove virtual adapters
          </button>
        </div>
      )}
      <section className="section" aria-label="Devices">
        {list.length === 0 && <div className="empty">No device matches.</div>}
        {list.map((d) => (
          <article
            key={d.id}
            className={`dl dev-row${d.connected ? '' : ' dev-off'}`}
            aria-label={d.label}
          >
            <div className="row qr">
              <div className="ftype net-tile" style={{ color: colors[d.id] }}>
                {networkIcon(settings.networks[d.id]?.icon, d.kind)}
              </div>
              <div className="main">
                <div className="name">
                  {d.label}
                  {d.kind === 'virtual' && (
                    <>
                      {' '}
                      <span className="badge info">Virtual</span>
                    </>
                  )}
                  {!d.connected && (
                    <>
                      {' '}
                      <span className="badge warn">Not connected</span>
                    </>
                  )}
                </div>
                <div className="meta">
                  <span>{seen(d)}</span>
                  <span>
                    {d.hidden
                      ? settings.networks[d.id]?.hidden
                        ? 'Removed by you'
                        : 'Removed automatically'
                      : 'On the Networks page'}
                  </span>
                </div>
              </div>
              <div className="right">
                {!d.connected ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      void api.forgetDevice(d.id).then(() => api.devices().then(setDevices))
                    }
                  >
                    Forget
                  </button>
                ) : d.hidden ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void update(d.id, { hidden: false })}
                  >
                    Add to Networks
                  </button>
                ) : (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void update(d.id, { hidden: true })}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </section>
      <div className="sheet-foot">
        <button className="btn primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  )
}

type Span = 'days' | 'weeks' | 'months'

/** Data used per day, week or month, stacked by network. */
function Usage({ usage, devices }: { usage: UsageDays; devices: DeviceView[] }): JSX.Element {
  const settings = useApp((s) => s.settings)
  const [span, setSpan] = useState<Span>('days')
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const key = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const buckets: { label: string; days: string[] }[] = []
  if (span === 'days') {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      buckets.push({ label: String(d.getDate()), days: [key(d)] })
    }
  } else if (span === 'weeks') {
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - ((now.getDay() + 6) % 7)
    )
    for (let i = 11; i >= 0; i--) {
      const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - i * 7)
      buckets.push({
        label: `${start.getDate()}/${start.getMonth() + 1}`,
        days: Array.from({ length: 7 }, (_, k) =>
          key(new Date(start.getFullYear(), start.getMonth(), start.getDate() + k))
        )
      })
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const prefix = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-`
      buckets.push({
        label: m.toLocaleDateString([], { month: 'short' }),
        days: Object.keys(usage).filter((d) => d.startsWith(prefix))
      })
    }
  }
  const ids = [...new Set(Object.values(usage).flatMap((day) => Object.keys(day)))]
  const byId = new Map(devices.map((d) => [d.id, d]))
  const colors = networkColors(
    ids.map((id) => ({ id, kind: byId.get(id)?.kind ?? 'other' })),
    settings
  )
  const rows = buckets.map((b) =>
    ids.map((id) => b.days.reduce((sum, day) => sum + (usage[day]?.[id] ?? 0), 0))
  )
  const totals = ids.map((_, k) => rows.reduce((sum, r) => sum + r[k], 0))
  const top = Math.max(1, ...rows.map((r) => r.reduce((a, v) => a + v, 0)))
  const unit = top >= GB ? GB : 1024 ** 2
  const unitName = unit === GB ? 'GB' : 'MB'
  const max = Math.max(1, Math.ceil(top / unit / 2) * 2)
  const title =
    span === 'days' ? 'last 14 days' : span === 'weeks' ? 'last 12 weeks' : 'last 12 months'
  return (
    <section className="usage" aria-label="Data used">
      <div className="head" style={{ alignItems: 'center' }}>
        <div className="label">Data used · {title}</div>
        <Choice
          label="Period"
          value={span}
          options={[
            ['days', 'Days'],
            ['weeks', 'Weeks'],
            ['months', 'Months']
          ]}
          onChange={setSpan}
        />
      </div>
      <div className="legend">
        {ids.length === 0 && <span className="muted">Nothing downloaded yet.</span>}
        {ids.map((id, k) => (
          <span key={id}>
            <span className="dot" style={{ background: colors[id], color: colors[id] }} />
            {settings.networks[id]?.name ?? byId.get(id)?.name ?? id}
            <span className="num muted">{size(totals[k])}</span>
            {byId.get(id)?.connected === false && <span className="muted">· not connected</span>}
          </span>
        ))}
      </div>
      <div
        className="ubars"
        role="img"
        aria-label={`Data used by network over the ${title}`}
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
      >
        {[0, 50, 100].map((y) => (
          <div key={y}>
            <div className="gl" style={{ top: `${y}%` }} />
            <div className="ylab" style={{ top: `${y}%` }}>
              {y === 0 ? `${max} ${unitName}` : y === 50 ? max / 2 : 0}
            </div>
          </div>
        ))}
        {rows.map((r, i) => (
          <div
            className="ubar"
            key={i}
            title={`${buckets[i].label}: ${size(r.reduce((a, v) => a + v, 0))}`}
          >
            {r
              .map((v, k) => [v, k] as const)
              .reverse()
              .map(([v, k]) =>
                v > 0 ? (
                  <i
                    key={k}
                    style={{
                      height: `${((v / unit / max) * 100).toFixed(1)}%`,
                      background: colors[ids[k]]
                    }}
                  />
                ) : null
              )}
          </div>
        ))}
      </div>
      <div
        className="ulab"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
      >
        {buckets.map((b, i) => (
          <span key={i}>{span === 'days' && i % 2 ? '' : b.label}</span>
        ))}
      </div>
    </section>
  )
}

export function NetworksScreen(): JSX.Element {
  const { networks, settings } = useApp()
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [usage, setUsage] = useState<UsageDays>({})
  const [devices, setDevices] = useState<DeviceView[]>([])
  useEffect(() => {
    const load = (): void => {
      void api.usage().then(setUsage)
      void api.devices().then(setDevices)
    }
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [settings])
  const colors = networkColors(networks, settings)
  const themeColors = networkColors(networks, {
    ...settings,
    networks: Object.fromEntries(
      Object.entries(settings.networks).map(([id, p]) => [id, { ...p, color: undefined }])
    )
  })
  const prefs = (id: string): NetworkPrefs => settings.networks[id] ?? {}
  const on = networks.filter((n) => !prefs(n.id).off)
  const always = on.filter((n) => prefs(n.id).role !== 'backup')
  const backups = on
    .filter((n) => prefs(n.id).role === 'backup')
    .sort((a, b) => (prefs(a.id).rank ?? 0) - (prefs(b.id).rank ?? 0))
  const off = networks.filter((n) => prefs(n.id).off)
  const covering = backups.filter((n) => n.status === 'covering')
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const removed = devices.filter((d) => d.hidden).length
  const row = (n: NetworkView): JSX.Element => (
    <NetworkRow
      key={n.id}
      n={n}
      color={colors[n.id]}
      themeColor={themeColors[n.id]}
      backupIndex={backups.indexOf(n)}
      backups={backups.length}
      lastAlways={always.length === 1 && always[0] === n}
      usedToday={usage[todayKey]?.[n.id] ?? 0}
    />
  )
  const lost = devices
    .filter((d) => !d.connected && !d.hidden && prefs(d.id).role !== 'backup' && !prefs(d.id).off)
    .map((d) => d.label)
  return (
    <>
      <div className="head">
        <div>
          <h2>Networks</h2>
          <p>
            {networks.length} on this page · {devices.length} devices in all
          </p>
        </div>
        <div className="inline">
          <button className="btn" type="button" onClick={() => setDevicesOpen(true)}>
            All devices <span className="num muted">{devices.length}</span>
          </button>
        </div>
      </div>
      {always.length === 0 && covering.length > 0 && (
        <div className="banner" role="status">
          <span>
            {lost.length
              ? `${lost.join(' and ')} ${lost.length > 1 ? 'are' : 'is'} disconnected. `
              : 'No Always network is in use. '}
            {covering.map((n) => n.label).join(' and ')} {covering.length > 1 ? 'are' : 'is'}{' '}
            covering{lost.length ? ' until it’s back' : ''}.
            {backups[backups.indexOf(covering[covering.length - 1]) + 1]
              ? ` If that drops too, ${backups[backups.indexOf(covering[covering.length - 1]) + 1].label} is next.`
              : ''}
          </span>
        </div>
      )}
      <Section label="Always" count={always.length}>
        {always.length ? (
          always.map(row)
        ) : (
          <div className="empty">
            No Always network is connected.
            {backups.length
              ? ' Your top backup is covering.'
              : ' Downloads wait until you switch one on.'}
          </div>
        )}
      </Section>
      {backups.length > 0 && (
        <Section label="Backup" count={backups.length}>
          {backups.map(row)}
        </Section>
      )}
      {off.length > 0 && (
        <Section label="Not used" count={off.length}>
          {off.map(row)}
        </Section>
      )}
      {removed > 0 && (
        <button
          className="link"
          type="button"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setDevicesOpen(true)}
        >
          {removed} {removed === 1 ? 'device' : 'devices'} removed from this page · See all devices
        </button>
      )}
      <Usage usage={usage} devices={devices} />
      {devicesOpen && <DevicesDialog onClose={() => setDevicesOpen(false)} />}
    </>
  )
}
