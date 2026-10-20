#!/usr/bin/env bash
# Sync the TV's apps, package the launcher and install it on an LG TV in Developer Mode.
#   TV_HOST=192.168.1.50 ./install.sh
# One-time setup (Developer Mode app open on the TV, Key Server on):
#   ares-setup-device -a lgtv -i "{'host':'$TV_HOST','port':'9922','username':'prisoner'}"
#   ares-novacom --device lgtv --getkey          # enter the passphrase shown on the TV
#   ares-setup-device -m lgtv -i "{'privatekey':'lgtv_webos','passphrase':'<passphrase>'}"
# On a TV rooted with Homebrew Channel (no Developer Mode needed), install over its root SSH instead:
#   TV_HOST=192.168.1.50 ROOT_SSH=root@192.168.1.50 ./install.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${TV_HOST:?set TV_HOST to the TV IP address, e.g. TV_HOST=192.168.1.50 $0}"
DEVICE="${DEVICE:-lgtv}"
APP_ID=com.gathin.tvhome

# LG's webOS CLI: use it from PATH, otherwise fetch it with npx.
ares() {
  if command -v "ares-$1" >/dev/null; then "ares-$1" "${@:2}"
  else npx -y -p @webos-tools/cli "ares-$1" "${@:2}"; fi
}

PY="${PY:-python3}"
[ -x venv/bin/python ] && PY=venv/bin/python
"$PY" sync-apps.py "$TV_HOST"

if [ ! -f app/icon.png ]; then
  # The webOS app list wants PNG icons: 80px and 130px.
  sips -s format png -z 80 80 assets/icon.jpg --out app/icon.png >/dev/null
  sips -s format png -z 130 130 assets/icon.jpg --out app/largeIcon.png >/dev/null
fi

rm -rf build && mkdir build
ares package app -o build
if [ -n "${ROOT_SSH:-}" ]; then
  # What ares does, by hand: hand the package to the TV's installer and wait for its verdict.
  ssh "$ROOT_SSH" 'cat > /tmp/tvhome.ipk' < build/${APP_ID}_*.ipk
  ssh "$ROOT_SSH" "
    luna-send -i luna://com.webos.appInstallService/dev/install \
      '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/tmp/tvhome.ipk\",\"subscribe\":true}' > /tmp/tvhome.log 2>&1 &
    for i in \$(seq 60); do grep -qE 'installed|failed' /tmp/tvhome.log && break; sleep 1; done
    kill \$! 2>/dev/null; rm -f /tmp/tvhome.ipk
    grep -q '\"installed\"' /tmp/tvhome.log || { cat /tmp/tvhome.log; exit 1; }
    luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$APP_ID\"}' >/dev/null"

  # Open the launcher at power-on (see boot-home.js), started at boot by Homebrew Channel. setsid
  # keeps it apart from whatever session starts it.
  ssh "$ROOT_SSH" 'mkdir -p /home/root/tvhome && cat > /home/root/tvhome/boot-home.js' < boot-home.js
  ssh "$ROOT_SSH" 'cat > /home/root/tvhome/lights.js' < lights.js   # ambient lights, see lights.js
  ssh "$ROOT_SSH" "
    printf '#!/bin/sh\nsetsid node /home/root/tvhome/boot-home.js >> /tmp/tvhome-boot.log 2>&1 < /dev/null &\n' > /var/lib/webosbrew/init.d/tvhome-boot
    chmod 755 /var/lib/webosbrew/init.d/tvhome-boot"
  # Separate session: pkill -f matches command lines, and the one above contains the script's name.
  ssh "$ROOT_SSH" "pkill -f '[b]oot-home.js'; /var/lib/webosbrew/init.d/tvhome-boot"
else
  ares install -d "$DEVICE" build/${APP_ID}_*.ipk
  ares launch -d "$DEVICE" "$APP_ID"
fi
echo "Installed. Hold a number key on the remote while it is open to make it a one-press shortcut."
