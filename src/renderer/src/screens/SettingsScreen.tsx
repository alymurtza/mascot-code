import { useEffect, useState, type JSX } from 'react'
import { describeRule, TYPES } from '@shared/rules'
import {
  COLOURS,
  isSpecial,
  SPECIAL,
  type Palette,
  type Rule,
  type Settings,
  type Special
} from '@shared/settings'
import { api, platform } from '../bridge'
import { useNow } from '../clock'
import { clock, fitPath, shortPath } from '../format'
import { report, toast, useApp } from '../store'
import { paletteInUse, THEMES } from '../theme'
import { Backdrop } from '../components/Backdrop'
import { Choice, Order, Switch } from '../components/ui'

/** A fresh id for a new rule. */
const newRuleId = (): string => Math.random().toString(36).slice(2)

const save = (patch: Partial<Settings>): void => void api.updateSettings(patch).catch(report)

function RuleEditor({
  rule,
  onDone
}: {
  rule: Rule
  onDone: (rule: Rule | null) => void
}): JSX.Element {
  const [draft, setDraft] = useState(rule)
  return (
    <div className="edit" style={{ borderTop: 0, paddingTop: 0 }}>
      <div className="rule">
        <span>When</span>
        <Choice
          label="Rule matches"
          value={draft.match}
          options={[
            ['type', 'File type'],
            ['extension', 'File ends in'],
            ['name', 'Name contains'],
            ['site', 'Link is from']
          ]}
          onChange={(match) =>
            setDraft({ ...draft, match, value: match === 'type' ? 'Videos' : '' })
          }
        />
        {draft.match === 'type' ? (
          <select
            className="inp"
            aria-label="File type"
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          >
            {Object.keys(TYPES).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        ) : (
          <input
            className="inp"
            style={{ width: 200 }}
            aria-label={
              draft.match === 'extension' ? 'Extensions' : draft.match === 'name' ? 'Name' : 'Site'
            }
            placeholder={
              draft.match === 'extension'
                ? 'iso, img'
                : draft.match === 'name'
                  ? 'S01E, or report-*.pdf'
                  : 'example.com'
            }
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          />
        )}
      </div>
      <div className="rule">
        <span>Save to</span>
        <input
          className="inp"
          style={{ flex: 1, minWidth: 160 }}
          aria-label="Folder"
          value={draft.folder}
          readOnly
        />
        <button
          className="btn"
          type="button"
          onClick={() =>
            void api.chooseFolder(draft.folder).then((f) => f && setDraft({ ...draft, folder: f }))
          }
        >
          Browse…
        </button>
      </div>
      <div className="rule">
        <span>Rename to</span>
        <input
          className="inp"
          style={{ flex: 1, minWidth: 160 }}
          aria-label="Rename pattern"
          placeholder="Keep the file’s own name"
          value={draft.rename ?? ''}
          onChange={(e) => setDraft({ ...draft, rename: e.target.value || undefined })}
        />
        <span className="muted" style={{ fontSize: 12.5 }}>
          {'{name} {ext} {date} {site}'}
        </span>
      </div>
      <div className="inline">
        <button
          className="btn primary"
          type="button"
          disabled={!draft.value.trim() || !draft.folder}
          onClick={() => onDone(draft)}
        >
          Save rule
        </button>
        <button className="btn" type="button" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function Rules(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const [editing, setEditing] = useState<string | null>(null)
  const rules = settings.rules
  const put = (next: Rule[]): void => save({ rules: next })
  return (
    <div className="card">
      <h3>Folder &amp; name rules</h3>
      {rules.length === 0 && editing !== 'new' && (
        <div className="empty">No rules. Every download goes to {fitPath(settings.folder)}.</div>
      )}
      {rules.map((r, i) =>
        editing === r.id ? (
          <RuleEditor
            key={r.id}
            rule={r}
            onDone={(next) => (
              next && put(rules.map((x) => (x.id === r.id ? next : x))),
              setEditing(null)
            )}
          />
        ) : (
          <div key={r.id} className="rule" style={{ justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{describeRule(r)}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Save to {fitPath(r.folder)}
                {r.rename ? `, rename to “${r.rename}”` : ''}
              </div>
            </div>
            <span className="inline">
              <Order
                name={describeRule(r)}
                first={i === 0}
                last={i === rules.length - 1}
                move={(by) => {
                  const next = [...rules]
                  ;[next[i], next[i + by]] = [next[i + by], next[i]]
                  put(next)
                }}
              />
              <button className="link" type="button" onClick={() => setEditing(r.id)}>
                Edit
              </button>
              <button
                className="link"
                type="button"
                style={{ color: 'var(--bad)' }}
                onClick={() => put(rules.filter((x) => x.id !== r.id))}
              >
                Delete
              </button>
            </span>
          </div>
        )
      )}
      {editing === 'new' ? (
        <RuleEditor
          rule={{ id: newRuleId(), match: 'type', value: 'Videos', folder: settings.folder }}
          onDone={(next) => (next && put([...rules, next]), setEditing(null))}
        />
      ) : (
        <button
          className="btn"
          type="button"
          style={{ justifySelf: 'start' }}
          onClick={() => setEditing('new')}
        >
          Add rule
        </button>
      )}
    </div>
  )
}

/** "5 minutes ago", "3 hours ago", "2 days ago". */
function ago(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

function ExtensionStatus(): JSX.Element {
  const now = useNow(5_000)
  const [seen, setSeen] = useState(0)
  const [installed, setInstalled] = useState<'yes' | 'no' | 'unknown'>('unknown')
  useEffect(() => {
    void api.extensionSeen().then(setSeen)
    void api.extensionInstalled().then(setInstalled)
  }, [now])
  const recently = seen > 0 && now - seen < 5 * 60_000
  // Found in a browser, or (when no browser's folders can be read) it has made contact before.
  const added = installed === 'yes' || (installed === 'unknown' && seen > 0)
  // It just made contact: it's there, whichever browser it's in.
  if (recently)
    return (
      <span className="badge ok" style={{ justifySelf: 'start' }}>
        Connected
      </span>
    )
  if (added)
    return (
      <span className="muted" style={{ fontSize: 13 }}>
        Added to your browser.{seen > 0 ? ` Last connected ${ago(now - seen)}.` : ''}
      </span>
    )
  return (
    <div className="inline" style={{ justifyContent: 'space-between' }}>
      <span className="muted" style={{ fontSize: 13 }}>
        {seen > 0
          ? 'Not added to your browser.'
          : 'Not connected. Add the Mascot extension to your browser to send downloads here.'}
      </span>
      <button
        className="btn"
        type="button"
        onClick={() => void api.openExtensionStore().catch(report)}
      >
        Add to browser
      </button>
    </div>
  )
}

type ThemeTab = 'light' | 'dark' | 'special'

/** Every theme in one place: light, dark and (once unlocked) special, in tabs. */
function ThemePicker(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const current = paletteInUse(settings)
  const tabOf = (p: Palette): ThemeTab =>
    isSpecial(p) ? 'special' : p.endsWith('-dark') ? 'dark' : 'light'
  const [tab, setTab] = useState<ThemeTab>(tabOf(current))
  const tabs: [ThemeTab, string, number][] = [
    ['light', 'Light', COLOURS.length],
    ['dark', 'Dark', COLOURS.length]
  ]
  if (settings.specialThemes) tabs.push(['special', 'Special', Object.keys(SPECIAL).length])
  const shown = tabs.some(([t]) => t === tab) ? tab : 'light'
  const pressKey = (e: React.KeyboardEvent, i: number): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0]
    setTab(next)
    document.getElementById(`theme-tab-${next}`)?.focus()
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h3>Theme</h3>
      <div className="theme-tabs" role="tablist" aria-label="Themes">
        {tabs.map(([key, label, n], i) => (
          <button
            key={key}
            id={`theme-tab-${key}`}
            type="button"
            role="tab"
            className="theme-tab"
            aria-selected={shown === key}
            aria-controls="theme-panel"
            tabIndex={shown === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={(e) => pressKey(e, i)}
          >
            {label} <span className="num">{n}</span>
          </button>
        ))}
      </div>
      <div id="theme-panel" role="tabpanel" aria-labelledby={`theme-tab-${shown}`}>
        {shown === 'special' ? (
          <div style={{ display: 'grid', gap: 12, paddingTop: 12 }}>
            <div className="inline">
              <Switch
                checked={settings.animateBackdrop}
                label="Animated backgrounds"
                style={{ marginLeft: 0 }}
                onChange={(animateBackdrop) => save({ animateBackdrop })}
              />
              <span>Animated backgrounds</span>
            </div>
            <div className="specials" role="group" aria-label="Special themes">
              {(Object.keys(SPECIAL) as Special[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="sp"
                  aria-pressed={current === key}
                  aria-label={THEMES[key].name}
                  onClick={() => save({ palette: key })}
                >
                  <Backdrop kind={key} fps={20} />
                  <span className="sp-name">
                    <i
                      className="dot"
                      style={{
                        background: THEMES[key].tokens['accent'],
                        color: THEMES[key].tokens['accent']
                      }}
                    />
                    {THEMES[key].name}
                    <small>{SPECIAL[key] === 'dark' ? 'Dark' : 'Light'}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="swatches"
            role="group"
            aria-label={shown === 'dark' ? 'Dark themes' : 'Light themes'}
          >
            {COLOURS.map((colour) => {
              const key: Palette = `${colour}-${shown}`
              const t = THEMES[key].tokens
              return (
                <button
                  key={key}
                  type="button"
                  className="sw"
                  aria-pressed={current === key}
                  onClick={() => save({ palette: key })}
                >
                  <i
                    style={{
                      background: `linear-gradient(135deg, ${t['bg']} 0 50%, ${t['accent']} 50% 100%)`
                    }}
                    aria-hidden
                  />
                  {THEMES[key].name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** This version, automatic updates, and the open-source licences. */
function UpdatesCard({ version }: { version: string }): JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.update)
  const [asking, setAsking] = useState(false)
  const status = asking ? 'checking' : (update?.status ?? 'idle')
  /** Check for updates, then say what was found. */
  const check = async (): Promise<void> => {
    setAsking(true)
    try {
      await api.checkForUpdates()
      const found = await api.updateState()
      toast(
        found.status === 'current'
          ? `You have the latest version (${found.version}).`
          : found.status === 'available'
            ? `Mascot ${found.next} is available.`
            : found.status === 'downloading'
              ? `Mascot ${found.next} is available. Downloading it now.`
              : found.status === 'ready'
                ? `Mascot ${found.next} is ready to install.`
                : 'Couldn’t check for updates. Check your internet connection and try again.'
      )
    } catch (error) {
      report(error)
    } finally {
      setAsking(false)
    }
  }
  const line =
    status === 'unsupported'
      ? platform === 'darwin'
        ? 'Updates come as new downloads from the website on this Mac.'
        : 'Updates work in the installed app.'
      : status === 'checking'
        ? 'Looking for a new version…'
        : status === 'available'
          ? `Mascot ${update?.next} is available.`
          : status === 'downloading'
            ? `Downloading Mascot ${update?.next ?? ''}${update?.percent ? ` (${update.percent}%)` : ''}…`
            : status === 'ready'
              ? `Mascot ${update?.next} is ready to install.`
              : status === 'current'
                ? `You have the latest version.${update?.checkedAt ? ` Checked at ${clock(update.checkedAt)}.` : ''}`
                : status === 'error'
                  ? 'Couldn’t check for updates. Check your internet connection and try again.'
                  : ''
  return (
    <div className="card">
      <h3>Updates</h3>
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <span>
          Mascot <span className="num">{version}</span>
        </span>
        {status === 'ready' ? (
          <button className="btn primary" type="button" onClick={() => void api.installUpdate()}>
            Restart to update
          </button>
        ) : status === 'available' ? (
          <button
            className="btn primary"
            type="button"
            onClick={() => void api.downloadUpdate().catch(report)}
          >
            Download update
          </button>
        ) : (
          <button
            className="btn"
            type="button"
            disabled={status === 'unsupported' || status === 'checking' || status === 'downloading'}
            onClick={() => void check()}
          >
            {status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
      {line && (
        <span className="muted update-line" style={{ fontSize: 13 }} aria-live="polite">
          {line}
        </span>
      )}
      <div className="inline">
        <Switch
          checked={settings.autoUpdate}
          label="Download updates by itself"
          style={{ marginLeft: 0, flex: 'none' }}
          onChange={(autoUpdate) => save({ autoUpdate })}
        />
        <span>Download updates by itself</span>
      </div>
      <button
        className="link"
        type="button"
        style={{ justifySelf: 'start' }}
        onClick={() => void api.openLicenses().catch(report)}
      >
        Open-source licences
      </button>
    </div>
  )
}

export function SettingsScreen(): JSX.Element {
  const { settings, version } = useApp()
  const [minMb, setMinMb] = useState(String(Math.round(settings.browserMinBytes / 1024 ** 2)))
  const signInWord = platform === 'darwin' ? 'Mac' : 'Windows'
  return (
    <>
      <div className="head">
        <div>
          <h2>Settings</h2>
        </div>
      </div>
      <ThemePicker />
      <div
        className="qgrid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 14,
          alignItems: 'start'
        }}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card">
            <h3>Downloads</h3>
            <div className="field">
              <span style={{ fontWeight: 500 }}>Save new downloads to</span>
              <div className="inline">
                <input
                  className="inp"
                  readOnly
                  aria-label="Download folder"
                  value={shortPath(settings.folder)}
                  title={settings.folder}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    void api.chooseFolder(settings.folder).then((f) => f && save({ folder: f }))
                  }
                >
                  Browse…
                </button>
              </div>
            </div>
            <div className="field">
              <span style={{ fontWeight: 500 }}>Show speeds in</span>
              <Choice
                label="Speed unit"
                value={settings.speedUnit}
                options={[
                  ['bytes', 'MB/s'],
                  ['bits', 'Mbps']
                ]}
                onChange={(speedUnit) => save({ speedUnit })}
              />
            </div>
          </div>
          <Rules />
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card">
            <h3>Background</h3>
            <div className="field">
              <span style={{ fontWeight: 500 }}>When I close the window</span>
              <Choice
                label="When I close the window"
                value={settings.closeAction}
                options={[
                  ['tray', 'Keep running in the tray'],
                  ['quit', 'Quit Mascot']
                ]}
                onChange={(closeAction) => save({ closeAction })}
              />
            </div>
            {platform !== 'linux' && (
              <div className="inline">
                <Switch
                  checked={settings.openAtLogin}
                  label="Start Mascot when I sign in"
                  style={{ marginLeft: 0, flex: 'none' }}
                  onChange={(openAtLogin) => save({ openAtLogin })}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  Start Mascot in the tray when I sign in to {signInWord}
                </span>
              </div>
            )}
            <div className="field">
              <span style={{ fontWeight: 500 }}>Tray icon while downloading</span>
              <Choice
                label="Tray icon"
                value={settings.trayIcon}
                options={[
                  ['speed', 'Speed'],
                  ['icon', 'Mascot icon']
                ]}
                onChange={(trayIcon) => save({ trayIcon })}
              />
            </div>
          </div>
          <div className="card">
            <h3>Extras</h3>
            <div className="inline">
              <Switch
                checked={settings.taskbarBadge}
                label="Show on the taskbar button when something downloads"
                style={{ marginLeft: 0, flex: 'none' }}
                onChange={(taskbarBadge) => save({ taskbarBadge })}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                Show on the taskbar button when something downloads
              </span>
            </div>
          </div>
          <div className="card">
            <h3>Browser extension</h3>
            <ExtensionStatus />
            <div className="inline">
              <Switch
                checked={settings.browserKeepSmall}
                label="Leave small files to the browser"
                style={{ marginLeft: 0, flex: 'none' }}
                onChange={(browserKeepSmall) => save({ browserKeepSmall })}
              />
              <span>Leave small files to the browser</span>
            </div>
            {settings.browserKeepSmall && (
              <div className="inline">
                <span className="muted" style={{ fontSize: 13 }}>
                  Files smaller than
                </span>
                <input
                  className="inp num"
                  style={{ width: 64 }}
                  aria-label="Minimum size in MB"
                  value={minMb}
                  onChange={(e) => setMinMb(e.target.value)}
                  onBlur={() =>
                    save({ browserMinBytes: Math.max(1, Number(minMb) || 1) * 1024 ** 2 })
                  }
                />
                <span className="muted" style={{ fontSize: 13 }}>
                  MB stay in the browser
                </span>
              </div>
            )}
          </div>
          <UpdatesCard version={version} />
        </div>
      </div>
    </>
  )
}
