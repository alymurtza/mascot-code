#!/usr/bin/env bash
# Electron needs a few system libraries a bare WSL/Ubuntu may lack (NSS, NSPR, ALSA). This
# fetches them with apt (no sudo needed) and unpacks them into .local-libs/ (not in git).
# Afterwards, the end-to-end tests run with:
#   export LD_LIBRARY_PATH="$PWD/.local-libs/root/usr/lib/x86_64-linux-gnu"
# (With sudo, `sudo apt install libnss3 libnspr4 libasound2t64` does the same system-wide.)
set -e
cd "$(dirname "$0")/.."
mkdir -p .local-libs/debs .local-libs/root
cd .local-libs/debs
alsa=libasound2t64
apt-cache show "$alsa" >/dev/null 2>&1 || alsa=libasound2
apt-get download libnss3 libnspr4 "$alsa"
for d in *.deb; do dpkg-deb -x "$d" ../root; done
echo "Done. export LD_LIBRARY_PATH=\"$(cd ../root && pwd)/usr/lib/x86_64-linux-gnu\""
