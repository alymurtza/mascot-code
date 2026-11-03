// The toolbar popup: whether Mascot is connected, the switches, and downloads waiting for it.
const api = globalThis.browser ?? globalThis.chrome
const root = document.getElementById('root')
let site = ''
let busy = false

const ICONS = {
  browser:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M12 12v5M9.5 14.5 12 17l2.5-2.5"/></svg>',
  remove:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
}

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
const size = (n) => {
  if (!n) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}
const ext = (name) => (/\.([a-z0-9]{1,4})$/i.exec(name)?.[1] ?? 'file').slice(0, 4)

const send = (message) => api.runtime.sendMessage({ ...message, site })

function head(pill, off) {
  return `<div class="head"><span class="face${off ? ' off' : ''}"></span><span class="title">Mascot</span>${pill}</div>`
}

function render(s, error = '') {
  if (!s) {
    root.innerHTML =
      head('') +
      '<div class="main"><p class="error">Something went wrong. Close this and try again.</p></div>'
    return
  }
  const running = s.app.running
  let html
  if (!s.on) {
    html =
      head('<span class="pill off"><i></i>Paused</span>', true) +
      `<div class="main">
        <div class="row"><div class="grow"><b>Send downloads to Mascot</b><div class="sub">Off: the browser downloads everything.</div></div>
        <button class="switch" role="switch" aria-checked="false" aria-label="Send downloads to Mascot" data-act="on"></button></div>
      </div>
      <div class="foot"><button class="btn" data-act="open">Open Mascot</button><button class="btn ghost" data-act="settings">Settings</button></div>`
  } else if (running) {
    html =
      head('<span class="pill ok"><i></i>Connected</span>') +
      `<div class="main">
        <div class="row"><div class="grow"><b>Send downloads to Mascot</b><div class="sub">Mascot ${esc(s.app.version ?? '')}</div></div>
        <button class="switch" role="switch" aria-checked="true" aria-label="Send downloads to Mascot" data-act="on"></button></div>
        <div class="card">
          ${
            s.site
              ? `<div class="row"><span class="grow">Don't send from <span class="site">${esc(s.site)}</span></span>
            <button class="switch" role="switch" aria-checked="${s.excluded}" aria-label="Don't send from ${esc(s.site)}" data-act="exclude"></button></div>`
              : ''
          }
          <div class="row"><span class="grow">When Mascot is closed</span>
            <span class="seg" role="group" aria-label="When Mascot is closed">
              <button aria-pressed="${s.whenClosed === 'wait'}" data-act="wait">Wait for it</button>
              <button aria-pressed="${s.whenClosed === 'browser'}" data-act="browser">Use the browser</button>
            </span></div>
        </div>
      </div>
      <div class="foot"><button class="btn primary" data-act="open">Open Mascot</button><button class="btn ghost" data-act="settings">Settings</button></div>`
  } else if (s.waiting.length) {
    html =
      head('<span class="pill idle"><i></i>Not open</span>', true) +
      `<div class="main">
        <div class="note"><b>Mascot isn't open.</b> These downloads are waiting and go to Mascot as soon as it opens.</div>
        <div>
          <div class="label">Waiting for Mascot<b>${s.waiting.length}</b></div>
          <div class="list">${s.waiting
            .map(
              (w) => `<div class="item"><span class="tile">${esc(ext(w.name))}</span>
              <div style="min-width:0"><div class="n" title="${esc(w.name)}">${esc(w.name)}</div><div class="m">${esc([size(w.size), w.site].filter(Boolean).join(' · '))}</div></div>
              <span class="acts">
                <button class="ico" title="Download in the browser instead" aria-label="Download ${esc(w.name)} in the browser instead" data-act="to-browser" data-id="${esc(w.id)}">${ICONS.browser}</button>
                <button class="ico" title="Remove" aria-label="Remove ${esc(w.name)}" data-act="remove" data-id="${esc(w.id)}">${ICONS.remove}</button>
              </span></div>`
            )
            .join('')}</div>
        </div>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
      </div>
      <div class="foot"><button class="btn primary" data-act="open">Open Mascot</button><button class="btn ghost" data-act="all-to-browser">All to browser</button></div>`
  } else {
    html =
      head('<span class="pill idle"><i></i>Not open</span>', true) +
      `<div class="main">
        <div class="empty"><span class="big"></span><h1>Mascot isn't open</h1>
        <p>${s.whenClosed === 'wait' ? 'Downloads you start now wait here, and go to Mascot when it opens.' : 'Downloads go to your browser until it is. Open it and they’ll go to Mascot again.'}</p></div>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
      </div>
      <div class="foot"><button class="btn primary" data-act="open">Open Mascot</button></div>`
  }
  root.innerHTML = html
}

let state = null
async function run(message) {
  if (busy) return
  busy = true
  root.querySelectorAll('button').forEach((b) => (b.disabled = true))
  try {
    const next = await send(message)
    state = next ?? state
    const failed = message.type === 'open' && next && !next.opened
    render(state, failed ? 'Mascot couldn’t be started from here. Open it from your computer.' : '')
  } finally {
    busy = false
  }
}

root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]')
  if (!b || !state) return
  const act = b.dataset.act
  if (act === 'on') run({ type: 'set-on', on: b.getAttribute('aria-checked') !== 'true' })
  else if (act === 'exclude')
    run({ type: 'exclude', on: b.getAttribute('aria-checked') !== 'true' })
  else if (act === 'wait' || act === 'browser') run({ type: 'when-closed', value: act })
  else if (act === 'open') run({ type: 'open' })
  else if (act === 'settings') run({ type: 'open', page: 'settings' })
  else if (act === 'to-browser') run({ type: 'to-browser', id: b.dataset.id })
  else if (act === 'all-to-browser') run({ type: 'to-browser' })
  else if (act === 'remove') run({ type: 'remove', id: b.dataset.id })
})

;(async () => {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true })
    site =
      tab?.url && /^https?:/i.test(tab.url) ? new URL(tab.url).hostname.replace(/^www\./, '') : ''
  } catch {
    site = ''
  }
  state = await send({ type: 'state' })
  render(state)
})()
