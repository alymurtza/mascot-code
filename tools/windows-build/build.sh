#!/usr/bin/env bash
# Builds the Windows installer (dist/Mascot-Downloader-Setup.exe) from WSL, without wine: the
# stand-ins in bin/ run electron-builder's Windows tools natively. node-datachannel's Windows
# native file is fetched for the build, and the Linux one put back afterwards.
#   npm run build:win
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../.."
export PATH="$HERE/bin:$PATH"
if ! command -v node >/dev/null && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi
rm -rf dist
npx electron-vite build
node scripts/notices.mjs
ND=node_modules/node-datachannel
KEEP="$(mktemp -d)"
cp -r "$ND/build" "$KEEP/build"
restore() { rm -rf "$ND/build" && cp -r "$KEEP/build" "$ND/build" && rm -rf "$KEEP"; }
trap restore EXIT
(cd "$ND" && rm -rf build && npx --yes prebuild-install@7.1.3 -r napi --platform win32 --arch x64)
NODE_OPTIONS="--require $HERE/wslpaths.cjs" npx electron-builder --win --publish never
