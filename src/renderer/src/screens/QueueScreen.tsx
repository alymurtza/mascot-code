import { useState, type JSX } from 'react'
import type { Download } from '@shared/download'
import { minutesOf, type Settings } from '@shared/settings'
import { api } from '../bridge'
import { inAnHour, localInput } from '../clock'
import { fileTag, fromUnit, inUnit, size, speed, when } from '../format'
import { report, useApp } from '../store'
import { Choice, Order, Section, Switch } from '../components/ui'

const save = (patch: Partial<Settings>): void => void api.updateSettings(patch).catch(report)
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Monday first on screen; settings keep Sunday first. */
const settingsDay = (i: number): number => (i + 1) % 7

/** A time window as pieces of one day: one piece, or two when it runs past midnight. */
const segments = (from: string, to: string): [number, number][] => {
  const a = minutesOf(from)
  const b = minutesOf(to)
  if (a === b) return [[0, 1440]]
  return a < b
    ? [[a, b]]
    : [
        [a, 1440],
        [0, b]
      ]
}

function StartAtPicker({ d, onDone }: { d: Download; onDone: () => void }): JSX.Element {
  const [value, setValue] = useState(() =>
    d.startAt ? localInput(new Date(d.startAt)) : inAnHour()
  )
  return (
    <span className="inline">
      <input
        className="inp num"
        type="datetime-local"
        aria-label="Start at"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 'auto' }}
      />
      <button
        className="btn primary"
        type="button"
        onClick={() => void api.startAt([d.id], new Date(value).getTime()).then(onDone, report)}
      >
        Set
      </button>
      <button className="btn" type="button" onClick={onDone}>
        Cancel
      </button>
    </span>
  )
}

function ScheduledRow({ d }: { d: Download }): JSX.Element {
  const [picking, setPicking] = useState(false)
  const time = d.startAt
    ? new Date(d.startAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      })
    : '—'
  return (
    <article className="dl" aria-label={d.name}>
      <div className="row qr">
        <div className="timetile">{time}</div>
        <div className="main">
          <div className="name">{d.name}</div>
          <div className="meta">
            <span className="num">{size(d.size)}</span>
            <span>{d.startAt ? when(d.startAt) : (d.message ?? '')}</span>
          </div>
        </div>
        <div className="right">
          {picking ? (
            <StartAtPicker d={d} onDone={() => setPicking(false)} />
          ) : (
            <>
              <button className="btn" type="button" onClick={() => setPicking(true)}>
                Change time
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => void api.act([d.id], 'first').catch(report)}
              >
                Download first
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

/** A download running (or paused) now, with what's needed to change the order. */
function ActiveRow({
  d,
  canLead,
  unit
}: {
  d: Download
  canLead: boolean
  unit: Settings['speedUnit']
}): JSX.Element {
  const paused = d.status === 'paused'
  const pct = d.size ? Math.min(100, Math.floor((d.received / d.size) * 100)) : undefined
  return (
    <article className="dl" aria-label={d.name}>
      <div className="row qr">
        <div className="ftype">{fileTag(d.name)}</div>
        <div className="main">
          <div className="name">
            {d.priority && (
              <>
                <span className="badge gold">First</span>{' '}
              </>
            )}
            {d.name}
          </div>
          <div className="meta">
            <span className="num">
              {pct !== undefined ? `${pct}% of ${size(d.size)}` : size(d.received)}
            </span>
            <span>
              {paused ? 'Paused' : d.status === 'checking' ? 'Checking' : speed(d.speed, unit)}
            </span>
          </div>
        </div>
        <div className="right">
          <button
            className="btn"
            type="button"
            onClick={() => void api.act([d.id], paused ? 'resume' : 'pause').catch(report)}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          {canLead && !d.priority && !paused && (
            <button
              className="btn"
              type="button"
              onClick={() => void api.act([d.id], 'first').catch(report)}
            >
              Download first
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

/** How many run at once, typed in (any number from 1); saved on Enter or leaving the box. */
function RunAtOnceInput({ value }: { value: number }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const n = Math.round(Number(draft))
    if (Number.isFinite(n) && n >= 1 && n !== value) save({ runAtOnce: n })
    setDraft(null)
  }
  return (
    <input
      className="inp num run-at-once"
      inputMode="numeric"
      aria-label="Run at once"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

export function QueueScreen(): JSX.Element {
  const { downloads, settings } = useApp()
  const queued = downloads.filter((d) => d.status === 'queued')
  const active = downloads.filter(
    (d) => d.status === 'running' || d.status === 'checking' || d.status === 'paused'
  )
  const scheduled = downloads
    .filter((d) => d.status === 'scheduled')
    .sort((a, b) => (a.startAt ?? Infinity) - (b.startAt ?? Infinity))
  const unit = settings.speedUnit
  const unitName = unit === 'bits' ? 'Mbps' : 'MB/s'
  const hours = settings.hours
  const window = settings.limitWindow
  const [limitText, setLimitText] = useState(String(+inUnit(window.rate, unit).toFixed(1)))
  const [totalText, setTotalText] = useState(
    settings.speedLimit ? String(+inUnit(settings.speedLimit, unit).toFixed(1)) : ''
  )
  const now = new Date()
  const today = (now.getDay() + 6) % 7
  const nowPct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100
  const pct = (v: number): string => ((v / 1440) * 100).toFixed(2)
  const groups: { day: string; items: Download[] }[] = []
  for (const d of scheduled) {
    const day = d.startAt
      ? when(d.startAt)
          .replace(/ at .*/, '')
          .replace(/^Today|^Tonight/, 'Today')
      : 'Waiting for download hours'
    const g = groups.find((x) => x.day === day)
    if (g) g.items.push(d)
    else groups.push({ day, items: [d] })
  }
  return (
    <>
      <div className="head">
        <div>
          <h2>Queue &amp; schedule</h2>
          <p>
            {active.length} downloading · {queued.length} queued · {scheduled.length} scheduled
          </p>
        </div>
      </div>
      <div className="qbar">
        <div className="inline">
          <span className="muted">Run at once</span>
          {!settings.runAtOnceUnlimited && (
            <span className="stepper">
              <button
                className="mini-btn"
                type="button"
                aria-label="Fewer at once"
                disabled={settings.runAtOnce <= 1}
                onClick={() => save({ runAtOnce: settings.runAtOnce - 1 })}
              >
                −
              </button>
              <RunAtOnceInput value={settings.runAtOnce} />
              <button
                className="mini-btn"
                type="button"
                aria-label="More at once"
                onClick={() => save({ runAtOnce: settings.runAtOnce + 1 })}
              >
                +
              </button>
            </span>
          )}
          <Switch
            checked={settings.runAtOnceUnlimited}
            label="No limit"
            style={{ marginLeft: 6, flex: 'none' }}
            onChange={(runAtOnceUnlimited) => save({ runAtOnceUnlimited })}
          />
          <span>No limit</span>
        </div>
        <div className="inline">
          <span className="muted">When all finish</span>
          <Choice
            label="When all downloads finish"
            value={settings.afterAll}
            options={[
              ['notify', 'Notify me'],
              ['sleep', 'Sleep'],
              ['shutdown', 'Shut down'],
              ['nothing', 'Nothing']
            ]}
            onChange={(afterAll) => save({ afterAll })}
          />
        </div>
        {(settings.afterAll === 'shutdown' || settings.afterAll === 'sleep') && (
          <span className="muted" style={{ fontSize: 13 }}>
            You get 60 seconds to cancel first.
          </span>
        )}
        <div className="inline">
          <span className="muted">Total speed limit</span>
          <input
            className="inp num"
            style={{ width: 70 }}
            aria-label={`Total speed limit in ${unitName}`}
            placeholder="None"
            value={totalText}
            onChange={(e) => setTotalText(e.target.value)}
            onBlur={() =>
              save({
                speedLimit:
                  Number(totalText) > 0 ? Math.round(fromUnit(Number(totalText), unit)) : 0
              })
            }
          />
          <span className="muted">{unitName}</span>
        </div>
        <div className="inline">
          <button
            className="switch"
            type="button"
            role="switch"
            aria-checked={settings.slowMode}
            aria-label="Slow mode"
            style={{ marginLeft: 0 }}
            onClick={() => save({ slowMode: !settings.slowMode })}
          />
          <span>Slow mode</span>
        </div>
      </div>
      <Section label="Downloading" count={active.length}>
        {active.length === 0 && <div className="empty">Nothing downloading.</div>}
        {active.map((d) => (
          <ActiveRow key={d.id} d={d} canLead={active.length > 1} unit={settings.speedUnit} />
        ))}
      </Section>
      <Section label="Queued" count={queued.length}>
        {queued.length === 0 && <div className="empty">Nothing queued.</div>}
        {queued.map((d, i) => (
          <article className="dl" key={d.id} aria-label={d.name}>
            <div className="row qr">
              <div className="ftype">{fileTag(d.name)}</div>
              <div className="main">
                <div className="name">{d.name}</div>
                <div className="meta">
                  <span className="num">{size(d.size)}</span>
                  <span>{i === 0 ? 'Starts next' : 'Waiting'}</span>
                </div>
              </div>
              <div className="right">
                <Order
                  name={d.name}
                  first={i === 0}
                  last={i === queued.length - 1}
                  move={(by) => void api.reorder(d.id, by).catch(report)}
                />
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void api.act([d.id], 'first').catch(report)}
                >
                  Download first
                </button>
              </div>
            </div>
          </article>
        ))}
      </Section>
      <Section label="Scheduled" count={scheduled.length}>
        {groups.length === 0 && <div className="empty">Nothing scheduled.</div>}
        {groups.map((g) => (
          <div key={g.day} style={{ display: 'grid', gap: 10 }}>
            <div className="sched-day">{g.day}</div>
            {g.items.map((d) => (
              <ScheduledRow key={d.id} d={d} />
            ))}
          </div>
        ))}
      </Section>
      <Section label="Weekly schedule">
        <div className="week">
          <div className="rules">
            <div className="rule">
              <button
                className="switch"
                type="button"
                role="switch"
                aria-checked={hours.enabled}
                aria-label="Download hours"
                style={{ marginLeft: 0 }}
                onClick={() => save({ hours: { ...hours, enabled: !hours.enabled } })}
              />
              <span className="key hrs" aria-hidden />
              <span>Download hours</span>
              <input
                className="inp num tm"
                type="time"
                aria-label="Download hours start"
                value={hours.from}
                onChange={(e) => save({ hours: { ...hours, from: e.target.value } })}
              />
              <span className="muted">to</span>
              <input
                className="inp num tm"
                type="time"
                aria-label="Download hours end"
                value={hours.to}
                onChange={(e) => save({ hours: { ...hours, to: e.target.value } })}
              />
              <span className="muted">until</span>
              <input
                className="inp num"
                type="date"
                aria-label="Download hours end date"
                style={{ width: 'auto' }}
                value={hours.until ?? ''}
                onChange={(e) => save({ hours: { ...hours, until: e.target.value || undefined } })}
              />
            </div>
            <div className="rule">
              <button
                className="switch"
                type="button"
                role="switch"
                aria-checked={window.enabled}
                aria-label="Speed limit for set hours"
                style={{ marginLeft: 0 }}
                onClick={() => save({ limitWindow: { ...window, enabled: !window.enabled } })}
              />
              <span className="key lim" aria-hidden />
              <span>Speed limit</span>
              <input
                className="inp num"
                style={{ width: 58 }}
                aria-label={`Speed limit in ${unitName}`}
                value={limitText}
                onChange={(e) => setLimitText(e.target.value)}
                onBlur={() =>
                  Number(limitText) > 0 &&
                  save({
                    limitWindow: { ...window, rate: Math.round(fromUnit(Number(limitText), unit)) }
                  })
                }
              />
              <span className="muted">{unitName} from</span>
              <input
                className="inp num tm"
                type="time"
                aria-label="Speed limit start"
                value={window.from}
                onChange={(e) => save({ limitWindow: { ...window, from: e.target.value } })}
              />
              <span className="muted">to</span>
              <input
                className="inp num tm"
                type="time"
                aria-label="Speed limit end"
                value={window.to}
                onChange={(e) => save({ limitWindow: { ...window, to: e.target.value } })}
              />
              <Choice
                label="Speed limit days"
                value={window.days}
                options={[
                  ['weekdays', 'Weekdays'],
                  ['everyday', 'Every day']
                ]}
                onChange={(days) => save({ limitWindow: { ...window, days } })}
              />
            </div>
          </div>
          <div className="wticks">
            <span />
            <div>
              {['00', '06', '12', '18', '24'].map((h) => (
                <span key={h}>{h}</span>
              ))}
            </div>
          </div>
          {DAY_NAMES.map((name, i) => {
            const on = hours.days[settingsDay(i)]
            return (
              <div className="wrow" key={name}>
                <button
                  className="wday"
                  type="button"
                  aria-pressed={on}
                  aria-label={`Download hours on ${name}`}
                  onClick={() =>
                    save({
                      hours: {
                        ...hours,
                        days: hours.days.map((v, k) => (k === settingsDay(i) ? !v : v))
                      }
                    })
                  }
                >
                  {name}
                </button>
                <div className="wtrack">
                  {hours.enabled &&
                    on &&
                    segments(hours.from, hours.to).map(([a, b], k) => (
                      <i
                        key={`h${k}`}
                        className="wseg hrs"
                        style={{ left: `${pct(a)}%`, width: `${pct(b - a)}%` }}
                      />
                    ))}
                  {window.enabled &&
                    (window.days === 'everyday' || i < 5) &&
                    segments(window.from, window.to).map(([a, b], k) => (
                      <i
                        key={`l${k}`}
                        className="wseg lim"
                        style={{ left: `${pct(a)}%`, width: `${pct(b - a)}%` }}
                      />
                    ))}
                  {i === today && (
                    <i className="wnow" style={{ left: `${nowPct.toFixed(2)}%` }} title="Now" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </>
  )
}
