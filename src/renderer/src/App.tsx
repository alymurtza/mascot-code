import { useEffect, useState, type JSX } from 'react'
import { api, on } from './bridge'
import { useNow } from './clock'
import { AddDialog } from './components/AddDialog'
import { AddPanel } from './components/AddPanel'
import { WaitingPanel } from './components/WaitingPanel'
import { DeleteSheet } from './components/DeleteSheet'
import { GroupSheet } from './components/GroupSheet'
import { DuplicateDialog } from './components/DuplicateDialog'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { NetworksScreen } from './screens/NetworksScreen'
import { QueueScreen } from './screens/QueueScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import {
  get,
  loadInitial,
  offer,
  pushSample,
  report,
  set,
  toast as showToast,
  useApp
} from './store'
import { applyTheme, paletteInUse } from './theme'
import { Backdrop } from './components/Backdrop'
import { isSpecial } from '@shared/settings'
import { useRetryWatch } from './retry'

const TITLES = {
  downloads: 'Downloads',
  networks: 'Networks',
  queue: 'Queue & schedule',
  settings: 'Settings'
}

/** Once, until the extension is first seen: offer to add it to the browser. */
function ExtensionBanner(): JSX.Element | null {
  const offered = useApp((s) => s.settings.extensionOffered)
  const [seen, setSeen] = useState<number | null>(null)
  useEffect(() => {
    if (!offered) void api.extensionSeen().then(setSeen)
  }, [offered])
  if (offered || seen !== 0) return null
  const done = (): void => void api.updateSettings({ extensionOffered: true }).catch(report)
  return (
    <div className="banner" role="region" aria-label="Browser extension">
      <span>Send your browser downloads to Mascot with the Mascot extension.</span>
      <button
        className="btn primary"
        type="button"
        onClick={() => {
          void api.openExtensionStore().catch(report)
          done()
        }}
      >
        Add to browser
      </button>
      <button className="btn" type="button" onClick={done}>
        Not now
      </button>
    </div>
  )
}

function AfterAllBanner(): JSX.Element | null {
  const afterAll = useApp((s) => s.afterAll)
  const now = useNow(500)
  if (!afterAll) return null
  const seconds = Math.max(0, Math.ceil((afterAll.at - now) / 1000))
  return (
    <div className="banner" role="alert">
      <span>
        Everything finished. {afterAll.action === 'sleep' ? 'Going to sleep' : 'Shutting down'} in{' '}
        {seconds} s.
      </span>
      <button className="btn" type="button" onClick={() => void api.cancelAfterAll()}>
        Cancel
      </button>
    </div>
  )
}

/** A new version is downloaded: restart into it now, or later (it installs on quit). */
function UpdateBanner(): JSX.Element | null {
  const update = useApp((s) => s.update)
  const later = useApp((s) => s.updateLater)
  if (update?.status !== 'ready' || later) return null
  return (
    <div className="banner" role="status">
      <span>
        Mascot {update.next} is ready. Downloads pause for the restart and carry on after.
      </span>
      <button className="btn primary" type="button" onClick={() => void api.installUpdate()}>
        Restart now
      </button>
      <button className="btn" type="button" onClick={() => set({ updateLater: true })}>
        Later
      </button>
    </div>
  )
}

export function App(): JSX.Element {
  const { ready, page, toast, settings } = useApp()
  useRetryWatch()
  useEffect(() => {
    const stops = [
      on('downloads', (downloads) => set({ downloads })),
      on('networks', pushSample),
      on('settings', (s) => set({ settings: s })),
      on('link', (link) => offer(link)),
      on('afterAll', (afterAll) => set({ afterAll })),
      on('update', (update) => set({ update })),
      on('show', ({ page }) => set({ page }))
    ]
    api.initial().then(loadInitial, report)
    api.updateState().then((update) => set({ update }), report)
    return () => stops.forEach((stop) => stop())
  }, [])
  useEffect(() => {
    if (ready) applyTheme(settings)
  }, [ready, settings])
  // Files and links dropped anywhere on the window go to Add download.
  useEffect(() => {
    const over = (e: DragEvent): void => e.preventDefault()
    const drop = (e: DragEvent): void => {
      if ((e.target as HTMLElement).closest('textarea, input')) return
      e.preventDefault()
      const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain')
      const file = e.dataTransfer?.files[0]
      if (text) offer({ url: text.trim() }, true)
      else if (file && /\.torrent$/i.test(file.name))
        void file
          .arrayBuffer()
          .then((b) => offer({ url: file.name, torrentFile: toBase64(b) }, true))
      else if (file) void file.text().then((t) => offer({ url: t }, true))
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
  // Ctrl+V (⌘V) outside a text field adds the copied links.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'v') return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]')) return
      if (get().adding || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      void api.readClipboard().then((text) => {
        if (LINK.test(text)) {
          set({ page: 'downloads' })
          offer({ url: text.trim() }, true)
        } else showToast('There’s no link to paste.')
      }, report)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  // The secret keys (↑ ↑ ↓ ↓ ← → ← → B A) unlock the special themes, or hide them again.
  useEffect(() => {
    let typed: string[] = []
    const key = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      typed = [...typed, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-SECRET.length)
      if (typed.join() !== SECRET.join()) return
      typed = []
      const unlock = !get().settings.specialThemes
      void api
        .updateSettings(
          unlock ? { specialThemes: true, palette: 'aurora' } : { specialThemes: false }
        )
        .then(
          () =>
            showToast(
              unlock
                ? 'Special themes unlocked ✨ Find them in Settings → Theme.'
                : 'Special themes hidden again'
            ),
          report
        )
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const theme = ready ? paletteInUse(settings) : undefined
  return (
    <>
      {theme && isSpecial(theme) && <Backdrop kind={theme} className="backdrop-page" />}
      <div className="app">
        <TitleBar page={TITLES[page]} />
        {ready ? (
          <>
            <Sidebar />
            <main className="page">
              <AfterAllBanner />
              <UpdateBanner />
              {page === 'downloads' && <ExtensionBanner />}
              {page === 'downloads' && <DownloadsScreen />}
              {page === 'networks' && <NetworksScreen />}
              {page === 'queue' && <QueueScreen />}
              {page === 'settings' && <SettingsScreen />}
            </main>
            <AddDialog />
            <div className="corner">
              <WaitingPanel />
              <AddPanel />
            </div>
            <DeleteSheet />
            <GroupSheet />
            <DuplicateDialog />
          </>
        ) : (
          <div />
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </div>
    </>
  )
}

const SECRET = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a'
]

const LINK = /\b(https?|ftp):\/\/\S+|\bmagnet:\?\S+/i

function toBase64(buffer: ArrayBuffer): string {
  let text = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
