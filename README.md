# Mascot

Downloads files and torrents faster by using all your internet connections at once: Wi-Fi,
Ethernet and a phone's connection together.

- **Every network at once.** Each file is split into packets, and every network you allow
  fetches packets in parallel, several connections each.
- **Backup links.** The same file on other servers is used at the same time.
- **Backup networks.** A network kept in reserve takes over when your main ones drop.
- **Queue and schedule.** How many run at once, download hours, speed limits for set hours,
  and sleep or shut down when everything finishes.
- **Data limits** per network, and a history of the data each one used.
- **Torrents and magnet links**, with the files you choose.
- **Browser extension** for Chrome, Edge and Firefox.

## Download

Installers for Windows and Linux are on the
[Mascot releases page](https://github.com/alymurtza/mascot/releases/latest). This repository
holds the source code.

## Build from source

You need Node.js 24.

```
npm ci
npm run dev                # run the app
npm run typecheck && npm run lint
npm run test:unit          # engine tests
npm run build && npm run test:e2e   # the app, end to end
npm run build:extension    # browser extension (Chrome and Firefox)
npm run dist:win           # Windows installer (on Windows)
npm run dist:linux         # AppImage and .deb (on Linux)
npm run build:win          # Windows installer, built from WSL
```

On WSL or Ubuntu without the desktop libraries Electron needs, `npm run setup:test-libs`
fetches them for the end-to-end tests (no sudo), then
`export LD_LIBRARY_PATH="$PWD/.local-libs/root/usr/lib/x86_64-linux-gnu"`.

### Layout

- `src/main/`: the app's main process: downloads and queue, the packet engine, binding
  connections to networks, torrents, the browser bridge, updates and settings.
- `src/renderer/`: the window (React).
- `src/shared/`: types and data both sides use.
- `extension/`: the browser extension; `native/`: its native messaging host.
- `test/unit`, `test/e2e`: node:test and Playwright suites.
- `tools/themes/`: theme colour generator (`src/shared/themes.ts` is generated from it).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

- Committers and reviewers: [alymurtza](https://github.com/alymurtza)
- Approvers: [alymurtza](https://github.com/alymurtza)

Privacy: this program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it. See
[PRIVACY.md](PRIVACY.md).

## Privacy

See also [PRIVACY.md](PRIVACY.md).


Mascot runs on your computer and sends nothing about you anywhere. It contacts the servers you
download from, and GitHub to look for new versions (with "Download updates by itself" off, it only tells you a new version is out).

## Licence

Mascot is MIT-licensed: see [LICENSE](LICENSE). It includes open-source libraries and fonts, each
under its own licence; they're listed with their licence texts in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which also ships with the app (Settings →
Open-source licences).
