// Mascot browser extension: hands downloads to the Mascot app on this computer.
//
// It reaches the app through Mascot's native messaging host (which the app registers with the
// browser), so no browser setting can get in the way, and the host can start Mascot when it's
// closed. If the host isn't there (an older Mascot), it falls back to the app's local bridge.
// While Mascot is closed, downloads can wait here and are handed over once it opens.
const api = globalThis.browser ?? globalThis.chrome
const HOST = 'com.mascot.downloader'
const PORTS = [19400, 19401, 19402]
const ICON_ON = { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' }
const ICON_OFF = {
  16: 'icon-off-16.png',
  32: 'icon-off-32.png',
  48: 'icon-off-48.png',
  128: 'icon-off-128.png'
}

// ── Settings and the waiting list ─────────────────────────────────────────

const DEFAULTS = { off: false, whenClosed: 'wait', excluded: [], waiting: [] }
async function load() {
  return { ...DEFAULTS, ...(await api.storage.local.get(Object.keys(DEFAULTS))) }
}
const save = (patch) => api.storage.local.set(patch)

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ── Talking to the app ────────────────────────────────────────────────────

/** A message to the native host; null when the host isn't installed or failed. */
async function native(message) {
  try {
    const reply = await api.runtime.sendNativeMessage(HOST, message)
    return reply && !reply.error ? reply : null
  } catch {
    return null
  }
}

async function bridge(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(2500)
  })
  return { ok: res.ok, body: await res.json().catch(() => null) }
}

async function bridgeFind() {
  for (const port of PORTS) {
    try {
      const r = await bridge(port, '/hello')
      if (r.body?.app === 'mascot-downloader') return { port, ...r.body }
    } catch {
      // Not on this port.
    }
  }
  return null
}

/** Whether Mascot is running (and its version and size threshold). */
async function hello() {
  const r = await native({ type: 'hello' })
  if (r) return r
  const app = await bridgeFind()
  return app
    ? { running: true, version: app.version, minBytes: app.minBytes ?? 0 }
    : { running: false }
}

/** Hands one download to Mascot; false when it couldn't. */
async function deliver(download) {
  const r = await native({ type: 'download', download })
  if (r) return r.ok === true
  const app = await bridgeFind()
  if (!app) return false
  try {
    return (await bridge(app.port, '/download', download)).ok
  } catch {
    return false
  }
}

/** Opens Mascot (starting it if needed), on a page if asked; true once it's running. */
async function openApp(page) {
  known = null
  const r = await native({ type: 'open', page })
  if (r) return r.running === true
  const app = await bridgeFind()
  if (!app) return false
  await bridge(app.port, '/show', { page }).catch(() => {})
  return true
}

// ── The toolbar icon ──────────────────────────────────────────────────────

async function refreshIcon(running) {
  const { off, waiting } = await load()
  const on = !off && running !== false
  try {
    await api.action.setIcon({ path: on ? ICON_ON : ICON_OFF })
    await api.action.setBadgeBackgroundColor({ color: '#8a6a41' })
    if (api.action.setBadgeTextColor) await api.action.setBadgeTextColor({ color: '#1d1007' })
    await api.action.setBadgeText({ text: waiting.length ? String(waiting.length) : '' })
  } catch {
    // The toolbar may not be ready yet.
  }
}

/** Links handed back to the browser on purpose: let them through. */
const passThrough = new Set()
function toBrowser(url) {
  passThrough.add(url)
  return api.downloads.download({ url })
}

// ── Downloads ─────────────────────────────────────────────────────────────

async function cookiesFor(url) {
  try {
    const list = await api.cookies.getAll({ url })
    return list.map((c) => `${c.name}=${c.value}`).join('; ')
  } catch {
    return ''
  }
}

async function describe(url, item = {}) {
  return {
    url,
    referrer: item.referrer || undefined,
    cookies: (await cookiesFor(url)) || undefined,
    filename: item.filename ? item.filename.split(/[\\/]/).pop() : undefined,
    size: item.totalBytes > 0 ? item.totalBytes : undefined
  }
}

/** Keeps a download until Mascot opens. */
async function hold(download, site) {
  const { waiting } = await load()
  // The same link again: kept once, with the newest cookies.
  const same = waiting.find((w) => w.url === download.url)
  if (same) {
    Object.assign(same, download)
    await save({ waiting })
    return
  }
  const magnet = /^magnet:\?/i.test(download.url)
  const name =
    download.filename ||
    (magnet
      ? new URLSearchParams(download.url.slice(download.url.indexOf('?') + 1)).get('dn') ||
        'Torrent'
      : decodeURIComponent(new URL(download.url).pathname.split('/').pop() || '')) ||
    download.url
  waiting.push({ ...download, id: crypto.randomUUID(), name, site, at: Date.now() })
  await save({ waiting })
  await refreshIcon(false)
}

/** Hands over everything waiting, if Mascot is running. */
let flushing = null
function flush() {
  flushing ??= (async () => {
    try {
      const { waiting } = await load()
      if (!waiting.length) return
      const app = await hello()
      if (!app.running) return refreshIcon(false)
      const left = []
      for (const w of waiting) {
        const download = {
          url: w.url,
          referrer: w.referrer,
          cookies: w.cookies,
          filename: w.filename,
          size: w.size
        }
        if (!(await deliver(download))) left.push(w)
      }
      // Anything added while handing over stays too.
      const now = (await load()).waiting.filter((w) => !waiting.some((x) => x.id === w.id))
      await save({ waiting: [...left, ...now] })
      await refreshIcon(true)
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** Mascot's status, remembered briefly: a burst of downloads asks once. */
let known = null
async function status() {
  if (known && Date.now() - known.at < 10_000) return known.app
  const app = await hello()
  known = { app, at: Date.now() }
  return app
}

/** Takes a new download from the browser when it should go to Mascot (or wait for it). The
 * browser has held it already, so even a quick one can't finish first. */
async function handle(item) {
  const url = item.finalUrl || item.url
  if (!/^https?:\/\//i.test(url)) return false
  if (passThrough.delete(url) || passThrough.delete(item.url)) return false
  const settings = await load()
  if (settings.off) return false
  const site = hostOf(item.referrer || url)
  if (settings.excluded.includes(site) || settings.excluded.includes(hostOf(url))) return false
  const app = await status()
  if (app.running && item.totalBytes > 0 && item.totalBytes < (app.minBytes ?? 0)) return false
  if (!app.running && settings.whenClosed !== 'wait') {
    void refreshIcon(false)
    return false
  }
  try {
    await api.downloads.cancel(item.id)
    await api.downloads.erase({ id: item.id })
  } catch {
    // Already finished or gone: nothing to hand over.
    return false
  }
  const download = await describe(url, item)
  if (!app.running) {
    await hold(download, site)
    return true
  }
  // The app went away just now: keep it waiting, or give it back to the browser.
  if (!(await deliver(download))) {
    known = null
    if (settings.whenClosed === 'wait') await hold(download, site)
    else void toBrowser(url)
  }
  await refreshIcon(true)
  return true
}

/** Each new download is decided once, whichever of the browser's events comes first. */
const deciding = new Map()
function decide(item, pause) {
  let job = deciding.get(item.id)
  if (!job) {
    job = (async () => {
      // Hold it at once: a quick download could otherwise finish while Mascot is asked.
      const paused = pause
        ? await api.downloads.pause(item.id).then(
            () => true,
            () => false
          )
        : false
      const taken = await handle(item).catch(() => false)
      if (!taken && paused) await api.downloads.resume(item.id).catch(() => {})
      return taken
    })()
    deciding.set(item.id, job)
    void job.finally(() => setTimeout(() => deciding.delete(item.id), 60_000))
  }
  return job
}

api.downloads.onCreated.addListener((item) => void decide(item, true))
// Chrome, Edge, Brave: the browser also waits for this answer before the download goes ahead.
api.downloads.onDeterminingFilename?.addListener((item, suggest) => {
  decide(item, false).finally(() => {
    try {
      suggest()
    } catch {
      // Already cancelled.
    }
  })
  return true
})

// "Download with Mascot" on links, and on images, videos and audio themselves (for pages that
// save their files from inside the page, where there's no link to hand over).
const MENUS = [
  { id: 'mascot-link', title: 'Download with Mascot', contexts: ['link'] },
  { id: 'mascot-image', title: 'Download image with Mascot', contexts: ['image'] },
  { id: 'mascot-video', title: 'Download video with Mascot', contexts: ['video'] },
  { id: 'mascot-audio', title: 'Download audio with Mascot', contexts: ['audio'] }
]
api.runtime.onInstalled.addListener(() => {
  for (const menu of MENUS) api.contextMenus.create(menu)
  api.alarms.create('mascot-flush', { periodInMinutes: 1 })
  void refreshIcon()
})
api.runtime.onStartup?.addListener(() => {
  api.alarms.create('mascot-flush', { periodInMinutes: 1 })
  void flush()
})
/** Sends a link from the right-click menu to Mascot: web links, and magnet links too. */
async function sendLink(url, pageUrl, tabId) {
  const magnet = /^magnet:\?/i.test(url)
  if (!url || !(magnet || /^https?:\/\//i.test(url))) return false
  const download = await describe(url, { referrer: pageUrl })
  const app = await hello()
  if (app.running && (await deliver(download))) {
    void refreshIcon(true)
    return true
  }
  const { whenClosed } = await load()
  if (whenClosed === 'wait') await hold(download, hostOf(pageUrl || url))
  // The browser can't download a magnet link: open it, for whatever app handles them.
  else if (magnet) await api.tabs.update(tabId, { url }).catch(() => {})
  else void toBrowser(url)
  return true
}

api.contextMenus.onClicked.addListener((info, tab) => {
  if (!MENUS.some((m) => m.id === info.menuItemId)) return
  const url = info.menuItemId === 'mascot-link' ? info.linkUrl : info.srcUrl
  void sendLink(url, tab?.url, tab?.id)
})
// Every minute while something waits: hand it over if Mascot has opened.
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'mascot-flush') void flush()
})

// ── The popup ─────────────────────────────────────────────────────────────

async function popupState(site) {
  const settings = await load()
  const app = await hello()
  if (app.running && settings.waiting.length) await flush()
  const { waiting } = await load()
  await refreshIcon(app.running)
  return {
    app,
    on: !settings.off,
    whenClosed: settings.whenClosed,
    site,
    excluded: !!site && settings.excluded.includes(site),
    waiting: waiting.map(({ id, name, size, site }) => ({ id, name, size, site }))
  }
}

async function act(message) {
  const settings = await load()
  switch (message.type) {
    case 'state':
      return popupState(message.site)
    case 'set-on':
      await save({ off: !message.on })
      await refreshIcon()
      return popupState(message.site)
    case 'when-closed':
      await save({ whenClosed: message.value === 'browser' ? 'browser' : 'wait' })
      return popupState(message.site)
    case 'exclude': {
      const excluded = settings.excluded.filter((s) => s !== message.site)
      if (message.on && message.site) excluded.push(message.site)
      await save({ excluded })
      return popupState(message.site)
    }
    case 'open': {
      const running = await openApp(message.page)
      if (running) await flush()
      return { ...(await popupState(message.site)), opened: running }
    }
    case 'to-browser': {
      const all = message.id === undefined
      const go = settings.waiting.filter((w) => all || w.id === message.id)
      await save({ waiting: settings.waiting.filter((w) => !go.includes(w)) })
      for (const w of go) await toBrowser(w.url)
      return popupState(message.site)
    }
    case 'remove':
      await save({ waiting: settings.waiting.filter((w) => w.id !== message.id) })
      return popupState(message.site)
  }
  return null
}

api.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || typeof message !== 'object') return false
  act(message).then(respond, () => respond(null))
  return true
})
