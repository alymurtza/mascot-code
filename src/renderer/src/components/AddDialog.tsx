import { useEffect, useMemo, useState, type JSX } from 'react'
import { groupNameFor } from '@shared/group'
import { detectAlgorithm } from '@shared/checksum'
import type { AddRequest, LinkInfo } from '@shared/download'
import type { TorrentInfo, TorrentSource } from '@shared/torrent'
import { describeRule, matchRule, renameWith } from '@shared/rules'
import { api } from '../bridge'
import { inAnHour } from '../clock'
import { fitPath, shortPath, size } from '../format'
import { Icon } from '../icons'
import { closeAdding, hideAdding, report, set, toast, useApp } from '../store'
import { addInBackground, addOne } from '../adding'
import { Choice, Sheet, Switch } from './ui'

type When = 'now' | 'queue' | 'at'
const PER_NETWORK: ['auto' | number, string][] = [
  ['auto', 'Auto'],
  [4, '4'],
  [8, '8'],
  [16, '16'],
  [32, '32']
]

/** Web and magnet links in some text, one each, in order. */
export function parseLinks(text: string): string[] {
  const found = text.match(/(https?:\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+)/gi) ?? []
  return [...new Set(found.map((l) => l.replace(/[),.;]+$/, '')))]
}

const ALGORITHM_NAMES = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256' }

export function AddDialog(): JSX.Element | null {
  const adding = useApp((s) => s.adding)
  if (!adding) return null
  return (
    <AddSheet
      key={adding.seq ?? 0}
      initial={adding.url}
      torrentFile={adding.torrentFile}
      headers={adding.headers}
    />
  )
}

const cleanError = (e: unknown): string =>
  String((e as Error)?.message ?? e).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )

function AddSheet({
  initial,
  torrentFile,
  headers
}: {
  initial?: string
  torrentFile?: string
  /** From the browser: the page's cookies and address, when the server needs them. */
  headers?: Record<string, string>
}): JSX.Element {
  const { settings, networks } = useApp()
  const [mode, setMode] = useState<'one' | 'many'>(
    initial && parseLinks(initial).length > 1 ? 'many' : 'one'
  )
  const [url, setUrl] = useState(initial ?? '')
  const [many, setMany] = useState(initial ?? '')
  /** What checking the link found, for the link it was checked for. */
  const [checked, setChecked] = useState<{ link: string; info?: LinkInfo; error?: string } | null>(
    null
  )
  const [mirrors, setMirrors] = useState<string[]>([])
  const [checksum, setChecksum] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [sortByType, setSortByType] = useState(true)
  /** Many links: added as one group, with this name ('' for the suggested one). */
  const [grouped, setGrouped] = useState(true)
  const [groupName, setGroupName] = useState('')
  const [when, setWhen] = useState<When>('now')
  const [at, setAt] = useState(inAnHour)
  const [perNetwork, setPerNetwork] = useState<'auto' | number>('auto')
  const [busy, setBusy] = useState(false)
  /** What's in the torrent, for the source it was read from. */
  const [torrent, setTorrent] = useState<{
    key: string
    info?: TorrentInfo
    error?: string
  } | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const close = closeAdding
  /** Downloads that came while this window was open, waiting their turn. */
  const waiting = useApp((s) => s.offers)
  const waitingLinks = waiting.filter((o) => o.url && !o.torrentFile)
  const currentLink =
    mode === 'one' && !torrentFile && /^(https?:\/\/|magnet:\?)/i.test(url.trim()) ? url.trim() : ''
  const canAddAll = waitingLinks.length > 0
  /** Everything waiting (and this one) goes in the background, as one group. */
  const addAll = (): void => {
    const all = [
      ...(currentLink ? [{ link: currentLink, headers }] : []),
      ...waitingLinks.map((o) => ({ link: o.url!, headers: o.headers }))
    ]
    const whenValue: AddRequest['when'] = when === 'at' ? { at: new Date(at).getTime() } : when
    addInBackground(all, {
      folder,
      sortByType: false,
      when: whenValue,
      perNetwork,
      group:
        all.length > 1
          ? { id: crypto.randomUUID(), name: groupNameFor(all.map((a) => a.link)) }
          : undefined
    })
    // Torrent files can't go in the background: they keep their turn.
    set((s) => ({ offers: s.offers.filter((o) => o.torrentFile) }))
    closeAdding()
  }

  const link = url.trim()
  const isWeb = /^https?:\/\//i.test(link)
  // Look at the link once typing stops.
  useEffect(() => {
    if (mode !== 'one' || !/^https?:\/\/[^/\s]+/i.test(link)) return
    let live = true
    const timer = setTimeout(() => {
      api.checkLink(link, headers).then(
        (info) => live && setChecked({ link, info }),
        (e) =>
          live &&
          setChecked({
            link,
            error: String(e?.message ?? e).replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              ''
            )
          })
      )
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [link, mode, headers])
  const torrentSource: TorrentSource | null = torrentFile
    ? { file: torrentFile }
    : mode === 'one' && /^magnet:\?/i.test(link)
      ? { magnet: link }
      : null
  const torrentKey = torrentFile ? 'file' : link
  // Read the torrent's file list.
  useEffect(() => {
    if (!torrentSource) return
    let live = true
    api.torrentInfo(torrentSource).then(
      (info) => live && setTorrent({ key: torrentKey, info }),
      (e) => live && setTorrent({ key: torrentKey, error: cleanError(e) })
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrentKey, mode])
  const torrentNow = torrentSource && torrent?.key === torrentKey ? torrent : null
  const current = checked?.link === link ? checked : null
  const info = current?.info ?? null
  const checkError = current?.error ?? ''
  const checking = mode === 'one' && /^https?:\/\/[^/\s]+/i.test(link) && !current

  const rule = torrentSource
    ? matchRule(settings.rules, torrentNow?.info?.name ?? '', link, {
        torrent: true,
        page: headers?.referer
      })
    : mode === 'one' && info
      ? matchRule(settings.rules, info.name, link, { page: headers?.referer })
      : undefined
  const folderShown = folder ?? rule?.folder ?? settings.folder
  const links = useMemo(() => parseLinks(many), [many])
  const torrents = links.filter((l) => l.startsWith('magnet:')).length
  const algorithm = checksum.trim() ? detectAlgorithm(checksum) : undefined
  const using = networks
    .filter((n) => n.status === 'in-use' || n.status === 'covering')
    .map((n) => n.label)

  const submit = async (): Promise<void> => {
    const whenValue: AddRequest['when'] = when === 'at' ? { at: new Date(at).getTime() } : when
    setBusy(true)
    try {
      if (torrentSource) {
        const info = torrentNow?.info ?? (await api.torrentInfo(torrentSource))
        const files = info.files.map((_, i) => i).filter((i) => !skipped.has(i))
        if (files.length === 0) throw new Error('Choose at least one file')
        const note = await addOne(
          {
            url:
              'magnet' in torrentSource
                ? torrentSource.magnet
                : `magnet:?xt=urn:btih:${info.infoHash}`,
            folder: folderShown,
            when: whenValue,
            torrent: { source: torrentSource, info, files }
          },
          undefined
        )
        if (note !== null) {
          close()
          if (note.text) toast(note.text)
        }
      } else if (mode === 'one') {
        if (!isWeb && !/^magnet:/i.test(link))
          throw new Error('Paste a web link (http or https) or a magnet link')
        const checked = info ?? (isWeb ? await api.checkLink(link, headers) : undefined)
        const name = checked ? renameWith(rule?.rename, checked.name, link) : undefined
        const note = await addOne(
          {
            url: link,
            name,
            folder: folderShown,
            checksum: algorithm ? { algorithm, expected: checksum.trim() } : undefined,
            mirrors: mirrors.map((m) => m.trim()).filter(Boolean),
            when: whenValue,
            perNetwork,
            headers
          },
          checked
        )
        if (note !== null) {
          close()
          if (note.text) toast(note.text)
        }
      } else {
        // The links are checked and added in the background; a panel shows how it goes.
        const group =
          grouped && links.length > 1
            ? { id: crypto.randomUUID(), name: groupName.trim() || groupNameFor(links) }
            : undefined
        addInBackground(links, { folder, sortByType, when: whenValue, perNetwork, group })
        close()
      }
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }

  const canAdd = torrentSource
    ? !busy && !torrentNow?.error
    : mode === 'one'
      ? (isWeb || /^magnet:/i.test(link)) && !busy
      : links.length > 0 && !busy
  return (
    <Sheet title="Add download" id="addT" onClose={close} onOutside={hideAdding}>
      {waiting.length > 0 && (
        <div className="banner" role="region" aria-label="Waiting downloads">
          <span>
            {waiting.length === 1
              ? '1 more download from your browser is waiting.'
              : `${waiting.length} more downloads from your browser are waiting.`}
          </span>
          {canAddAll && (
            <button className="btn primary" type="button" onClick={addAll}>
              Add all {waiting.length + (currentLink ? 1 : 0)}
            </button>
          )}
        </div>
      )}
      <Choice
        label="How many"
        value={mode}
        options={[
          ['one', 'One link'],
          ['many', 'Many links']
        ]}
        onChange={setMode}
      />
      {mode === 'one' ? (
        <>
          <div className="field">
            <label htmlFor="url">Link or magnet</label>
            <input
              className="inp"
              id="url"
              autoFocus
              value={url}
              placeholder="https://"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canAdd && void submit()}
            />
            {checking && <span className="muted">Checking the link…</span>}
            {info && (
              <span className="muted">
                {info.name} · {size(info.size)}
                {info.ranged ? '' : ' · this server sends the file in one piece'}
              </span>
            )}
            {checkError && <span className="err-txt">{checkError}</span>}
            {torrentSource && !torrentNow && (
              <span className="muted">Looking for the torrent’s files…</span>
            )}
            {torrentNow?.error && <span className="err-txt">{torrentNow.error}</span>}
          </div>
          {torrentNow?.info && (
            <div className="field">
              <span style={{ fontWeight: 500 }}>
                {torrentNow.info.name}{' '}
                <span className="muted" style={{ fontWeight: 400 }}>
                  ·{' '}
                  {size(
                    torrentNow.info.files.reduce(
                      (sum, f, i) => sum + (skipped.has(i) ? 0 : f.length),
                      0
                    )
                  )}{' '}
                  of {size(torrentNow.info.size)}
                </span>
              </span>
              <div
                className="mlist"
                role="group"
                aria-label="Files"
                style={{ maxHeight: 220, overflow: 'auto' }}
              >
                {torrentNow.info.files.map((f, i) => (
                  <label
                    key={i}
                    className="mrow"
                    style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      checked={!skipped.has(i)}
                      onChange={() => setSkipped((s) => toggleIndex(s, i))}
                    />
                    <span className="mu">{f.path}</span>
                    <span className="muted mst">{size(f.length)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {isWeb && (
            <div className="field">
              <span style={{ fontWeight: 500 }}>
                Backup links{' '}
                <span className="muted" style={{ fontWeight: 400 }}>
                  (optional: the same file on other servers)
                </span>
              </span>
              {mirrors.length > 0 && (
                <ul className="mlist" aria-label="Backup links">
                  {mirrors.map((m, i) => (
                    <li key={i}>
                      <input
                        className="inp"
                        aria-label={`Backup link ${i + 1}`}
                        value={m}
                        placeholder="https://"
                        onChange={(e) =>
                          setMirrors(mirrors.map((x, k) => (k === i ? e.target.value : x)))
                        }
                      />
                      <button
                        className="mini-btn"
                        type="button"
                        aria-label={`Remove backup link ${i + 1}`}
                        onClick={() => setMirrors(mirrors.filter((_, k) => k !== i))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                className="link"
                type="button"
                style={{ justifySelf: 'start' }}
                onClick={() => setMirrors([...mirrors, ''])}
              >
                + Add a backup link
              </button>
            </div>
          )}
          {isWeb && (
            <div className="field">
              <label htmlFor="sum">
                Checksum <span className="muted">(optional: SHA-256, SHA-1 or MD5)</span>
              </label>
              <input
                className="inp num"
                id="sum"
                value={checksum}
                onChange={(e) => setChecksum(e.target.value)}
              />
              {checksum.trim() &&
                (algorithm ? (
                  <span className="muted">Detected {ALGORITHM_NAMES[algorithm]}.</span>
                ) : (
                  <span className="err-txt">
                    That doesn’t look like an MD5, SHA-1 or SHA-256 checksum.
                  </span>
                ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="many">Paste links, one per line</label>
            <textarea
              className="inp"
              id="many"
              value={many}
              onChange={(e) => {
                setMany(e.target.value)
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const file = e.dataTransfer.files[0]
                if (!file) return
                e.preventDefault()
                void file.text().then((text) => setMany((m) => (m ? m + '\n' : '') + text))
              }}
            />
          </div>
          {links.length > 0 && (
            <div className="inline">
              <span className="badge ok">
                <Icon.check /> {links.length} link{links.length === 1 ? '' : 's'} found
              </span>
              {torrents > 0 && (
                <span className="muted" style={{ fontSize: 13 }}>
                  {links.length - torrents} file{links.length - torrents === 1 ? '' : 's'},{' '}
                  {torrents} torrent{torrents === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
          {links.length > 1 && (
            <div className="field">
              <div className="inline">
                <Switch
                  checked={grouped}
                  label="Add as one group"
                  onChange={setGrouped}
                  style={{ marginLeft: 0 }}
                />
                <span>Add as one group</span>
              </div>
              {grouped && (
                <input
                  className="inp"
                  aria-label="Group name"
                  placeholder={groupNameFor(links)}
                  value={groupName}
                  maxLength={200}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              )}
            </div>
          )}
          <div className="inline">
            <Switch
              checked={sortByType}
              label="Sort into folders by type"
              onChange={setSortByType}
              style={{ marginLeft: 0 }}
            />
            <span>Sort into folders by type (Videos, Archives, Programs)</span>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="dest">Save to</label>
        <div className="inline">
          <input
            className="inp"
            id="dest"
            value={shortPath(folderShown)}
            readOnly
            style={{ flex: 1, minWidth: 0 }}
            title={folderShown}
          />
          <button
            className="btn"
            type="button"
            onClick={() => void api.chooseFolder(folderShown).then((f) => f && setFolder(f))}
          >
            Browse…
          </button>
        </div>
        {rule && folder === null && (
          <span className="muted">
            Set by your rule “{describeRule(rule)} → {fitPath(rule.folder)}”.
          </span>
        )}
      </div>
      <div className="field">
        <span style={{ fontWeight: 500 }}>When</span>
        <div className="radio" role="group" aria-label="When">
          {(
            [
              ['now', 'Now', 'Start right away'],
              ['queue', 'Add to queue', 'After what is running'],
              ['at', 'Start at', 'A time you pick']
            ] as [When, string, string][]
          ).map(([k, a, b]) => (
            <button key={k} type="button" aria-pressed={when === k} onClick={() => setWhen(k)}>
              <b>{a}</b>
              {b}
            </button>
          ))}
        </div>
        {when === 'at' && (
          <input
            className="inp num"
            type="datetime-local"
            aria-label="Start at"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            style={{ width: 'auto' }}
          />
        )}
      </div>
      <div className="field">
        <span style={{ fontWeight: 500 }}>Connections per network</span>
        <Choice
          label="Connections per network"
          value={perNetwork}
          options={PER_NETWORK}
          onChange={setPerNetwork}
        />
      </div>
      <div className="note">
        <Icon.info />
        <span>
          {using.length
            ? `Will use ${using.join(', ')}.`
            : 'No network can be used right now. The download waits for one.'}
        </span>
      </div>
      <div className="sheet-foot">
        <button className="btn" type="button" onClick={close}>
          Cancel
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={!canAdd}
          onClick={() => void submit()}
        >
          {busy
            ? 'Adding…'
            : mode === 'one'
              ? 'Add download'
              : `Add ${links.length} download${links.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Sheet>
  )
}

function toggleIndex(set: Set<number>, i: number): Set<number> {
  const next = new Set(set)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  return next
}
