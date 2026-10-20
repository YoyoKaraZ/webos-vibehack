# webos-vibehack

An Apple TV-style home screen for LG TVs. It's a webOS port of the launcher from
[tv-vibehack](https://github.com/Gathin23/tv-vibehack), which does the same for Android TVs.

![The launcher running on an LG OLED C6](docs/screenshot.jpg)

Tested on an LG OLED C6 (OLED55C6XLA, webOS 26, firmware 43.21.79) and, for this fork, on a rooted
LG OLED B5 (OLED55B56LA, webOS 10.3.2, firmware 33.31.75).

## About this fork

This is [YoyoKaraZ/webos-vibehack](https://github.com/YoyoKaraZ/webos-vibehack), a fork of
[OmkarK97/webos-vibehack](https://github.com/OmkarK97/webos-vibehack). It keeps the Developer Mode
setup working and adds what a TV rooted with Homebrew Channel makes possible, plus a few interface
changes:

| Area | Change |
|---|---|
| App list | Read live on the TV through Homebrew Channel's root service, so apps installed later (homebrew ones included) appear without a resync. Icons of those apps are read as root too, since a web app can't open files in another app's folder |
| Inputs menu | Only the inputs with a device plugged in, read live; an audio-only device on the eARC port (a sound bar) is left out. Live TV is off by default (`liveTvApp: ''`) |
| Install | `ROOT_SSH=root@<TV>` installs over Homebrew Channel's SSH, with no Developer Mode app |
| Power-on | [`boot-home.js`](boot-home.js) runs on the TV and opens the launcher at power-on, unless the TV was turned off on an HDMI input or an HDMI device turned it on |
| Memory | `boot-home.js` stops webOS's background preloading (YouTube, Netflix, Amazon, LG Channels, browser, voice), which kept a few hundred MB of the TV's 1.7 GB busy; apps opened by hand still stay suspended in memory |
| Themes | A theme button cycles backgrounds defined in `config.js` (Aurore, the default, App colour, Noir, Graphite, Minuit); the choice is kept on the TV. Aurore is animated: six coloured halos drift across a near-black background and fade in and out at their own pace, so colours trade places and dark patches come and go. Only transform and opacity animate, on half-size layers, and it pauses while an app is in front |
| Layout | Five columns by default; tile size follows the column count. The header stays in place and is aligned with the grid; only the grid scrolls |
| Language | Interface in French, 24-hour clock |
| Focus | The glass frame that slid between tiles is gone: the focused tile itself lifts, tvOS style (12 % larger, raised, soft shadow, light sheen, a 5° spring tilt toward the direction of travel). Only transform and opacity animate, so it stays smooth on the TV's GPU |
| Ambient lights | A lights button in the header and the remote's AI, CH+ and CH- keys drive [HyperHDR](https://github.com/awawa-dev/HyperHDR) through [`lights.js`](lights.js): sync on or off and brightness, with a toast. Like Hue Sync, switching off puts the lamps back as they were (Hue and Nanoleaf). See [Ambient lights](#ambient-lights) |
| Pointer | webOS shows the Magic Remote pointer on every Home press; the launcher blanks it when it comes back (`webOSSystem.setCursor('blank')`) until the remote really moves |
| Header | Wi-Fi and lights are icon-only round buttons, so the header fits next to the date |
| Fix | The dock app name no longer stays on screen when scrolling right after switching apps |
| Fix | Several root calls at once (apps, inputs, lights) could drop one another's reply, which brought back unused inputs |

The Home button itself is remapped outside this repo, with the homebrew tool inputhook: see
[The Home button on a rooted TV](#the-home-button-on-a-rooted-tv).

## What's different from Android

webOS is more locked down than Android TV, so three things work differently:

| | Android TV | LG webOS |
|---|---|---|
| Install | ADB, no account | LG's **Developer Mode** app (free LG developer account) |
| App list | read on the TV | read from your computer by `sync-apps.py` and bundled in; webOS won't let an app list installed apps |
| Home button | the launcher *is* Home | webOS always opens LG's home; `home-watch.py`, running on another device, switches straight back (about 0.1 s) |

There's no debloat step: webOS has no ADB-style package disabling. Turn off LG's ads in the TV's
own settings instead (see [Cleaning up LG's home](#cleaning-up-lgs-home)).

Nothing is rooted. Developer Mode is LG's official way to install your own apps, firmware updates
keep working, and deleting the Developer Mode app removes everything.

## Setup

You need a Mac on the same Wi-Fi as the TV, with Node.js (for LG's `ares` CLI, fetched with `npx`)
and Python 3. The steps are macOS only for now: `install.sh` makes the app icon with `sips`.

**1. Developer Mode on the TV**

1. Create a free account at [webostv.developer.lge.com](https://webostv.developer.lge.com).
2. On the TV, install **Developer Mode** from the LG Content Store and sign in.
3. Turn on **Dev Mode Status** (the TV restarts), open the app again and turn on **Key Server**.
   Note the **IP address** and **Passphrase** it shows.

**2. Connect your computer** (once)

```bash
export TV_HOST=192.168.1.50                       # the IP from the Developer Mode app
npx -y -p @webos-tools/cli ares-setup-device -a lgtv -i "{'host':'$TV_HOST','port':'9922','username':'prisoner'}"
npx -y -p @webos-tools/cli ares-novacom --device lgtv --getkey        # type the passphrase
npx -y -p @webos-tools/cli ares-setup-device -m lgtv -i "{'privatekey':'lgtv_webos','passphrase':'ABC123'}"
```

**3. Install**

```bash
git clone https://github.com/YoyoKaraZ/webos-vibehack.git
cd webos-vibehack
python3 -m venv venv && venv/bin/pip install websockets
TV_HOST=192.168.1.50 ./install.sh
```

The first run shows an "allow this device?" prompt on the TV: accept it. That pairing lets
`sync-apps.py` read your apps and icons. `install.sh` then packages the app, installs it and opens
it. Run it again whenever you install or remove apps on the TV.

**4. A one-press shortcut**

With the launcher open, hold a number key on the remote (say **1**) and assign it. From then on,
holding 1 opens the launcher from anywhere.

## The Home button

webOS hard-wires Home to LG's home, and blocks Developer Mode apps from seeing which app is in front,
so the TV can't redirect it on its own. [`home-watch.py`](home-watch.py) does it from another
always-on device on the same network: it watches the TV's foreground app and, the moment LG's home
appears, opens the launcher on top.

- **Press Home twice** within three seconds to stay on LG's home, for its menus.
- When the TV powers on to LG's home, it goes to the launcher too.
- When the watcher isn't running, Home simply opens LG's home as usual.

On a Mac, install it as a background service that starts at login:

```bash
TV_HOST=192.168.1.50 ./home-watch-mac.sh       # install or update
./home-watch-mac.sh uninstall                  # remove
```

macOS will ask for Local Network access for Python: allow it (System Settings → Privacy & Security →
Local Network), or the watcher logs "No route to host". The log is at
`~/Library/Logs/tv-vibehack-home-watch.log`. A Mac only redirects Home while it's awake and at
home; for every time, run `python3 home-watch.py 192.168.1.50` on something that's always on, such
as a Raspberry Pi.

## Rooted TVs

On a TV rooted with [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel), the
launcher asks Homebrew Channel's root service (`org.webosbrew.hbchannel.service/exec`) for the real
app list and the plugged-in inputs each time it opens, so apps installed later (homebrew apps
included) show up without running `install.sh` again. Apps already synced keep their store banner;
new ones use the icon the TV has, read as root. Without root, the launcher shows the synced list as
before.

Root also replaces the two Developer Mode workarounds:

- **Install** over Homebrew Channel's root SSH (turn on SSH in its settings), with no Developer
  Mode app and no session to extend:
  `TV_HOST=192.168.1.50 ROOT_SSH=root@192.168.1.50 ./install.sh`
- **Home button**: map Home to `com.gathin.tvhome` with inputhook instead of running
  `home-watch.py`, see below.
- **Power-on**: the root install also adds [`boot-home.js`](boot-home.js), which runs on the TV.
  When the TV turns off it notes what was on screen (in `/home/root/tvhome/last-app`); when it
  turns on, it opens the launcher right away and keeps it in front for a few seconds while webOS
  restores the last input, unless the TV was turned off on an HDMI input or Live TV, or an HDMI
  device turned it on (HDMI-CEC). It also keeps energy saving off: EU firmware switches it back to
  Auto after a reboot and on every picture mode change, so the script watches the setting and turns
  it off again within a second (set `ENERGY_SAVING` to `''` in the script to keep the TV's
  own setting). It starts at boot from
  `/var/lib/webosbrew/init.d/tvhome-boot` and logs to `/tmp/tvhome-boot.log` on the TV.

### The Home button on a rooted TV

[inputhook](https://github.com/Simon34545/lginputhook) (in Homebrew Channel) remaps remote buttons
from `/home/root/.config/lginputhook/keybinds.json`. Its keys are the **uinput codes** shown in its
log (`/tmp/lginput-hook-lginput2.log`, field `uinput_code`), not the `keyid`. On an LG MR25GA remote:

```json
{
  "773":  {"action": "launch", "id": "com.gathin.tvhome"},
  "1086": {"action": "exec", "command": "luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreenSaver {}"},
  "1043": {"action": "exec", "command": "touch /tmp/tvhome-lghome; luna-send -n 1 luna://com.webos.applicationManager/launch {\\\"id\\\":\\\"com.webos.app.home\\\"}"}
}
```

Home (773) opens the launcher, the Alexa button (1086) starts the screensaver, and the LG Channels
button (1043) opens LG's own home, kept for its menus. Launching `com.webos.app.home` is safer than
a `replace` to the Home code, which inputhook could send through the Home rule again.

Closing an app sends webOS back to LG's home; `boot-home.js` watches the foreground app and opens
the launcher instead. The LG Channels rule touches `/tmp/tvhome-lghome` first, which tells
`boot-home.js` to leave LG's home on screen.

### Ambient lights

With HyperHDR (lamps) and PicCap (screen capture) from Homebrew Channel, [`lights.js`](lights.js)
switches the light sync on and off and sets its brightness on every HyperHDR instance, over
HyperHDR's WebSocket, and shows a toast. The launcher's bulb button and inputhook call it:

```json
{
  "428": {"action": "exec", "command": "node /home/root/tvhome/lights.js toggle"},
  "402": {"action": "exec", "command": "node /home/root/tvhome/lights.js up"},
  "403": {"action": "exec", "command": "node /home/root/tvhome/lights.js down"}
}
```

(AI, CH+ and CH- on an LG MR25GA remote.) Switching on saves the state of the lamps, switching
off restores it, for Philips Hue (CLIP v2) and Nanoleaf; this needs `/home/root/tvhome/hue.json`
(`bridge`, `key`, `area`) and `nanoleaf.json` (`host`, `token`) on the TV, never in the repo.
`boot-home.js` re-applies the sync state at boot, since HyperHDR forgets it when it restarts.
The bulb button hides itself when `lights.js` is not installed. Protected video (Netflix and
other DRM apps) comes through the capture as black: only YouTube, HDMI sources and the like can
drive the lamps.

### Undo everything on a rooted TV

```bash
ssh root@<TV>
pkill -f '[b]oot-home.js'
rm -rf /var/lib/webosbrew/init.d/tvhome-boot /home/root/tvhome   # also removes lights.js and the lamp keys
echo '{}' > /home/root/.config/lginputhook/keybinds.json
luna-send -n 1 luna://com.webos.appInstallService/dev/remove '{"id":"com.gathin.tvhome"}'
```

## Using it

Same as the [Android launcher](https://github.com/Gathin23/tv-vibehack#the-launcher), with a
tvOS-style focus where the tile lifts off the page: a dock of one row of apps with the focused app's
name above it and a glow in its colour, the rest of your
apps in a grid below, and Inputs, Wi-Fi, Settings and the theme button at the top. The header stays in place; the grid scrolls below it. The interface is in
French.

**Rearrange tiles on the TV**: hold **OK** on a tile until it wiggles, move it with the arrows
(into the top row puts it in the dock), then **OK** to place it or **Back** to cancel. The order is
saved on the TV.

**Change the background** with the theme button at the top (it shows the current theme's name): each press switches to the next
theme, and the TV remembers the choice.

**Configure** in [`app/config.js`](app/config.js): the starting dock, apps to hide, the Live TV
app, the number of columns and the themes (any CSS background, or an image placed in `app/`, plus optional drifting `blobs`). App ids come from `venv/bin/python sync-apps.py $TV_HOST --list`.
Changing `dockApps` resets an order arranged on the TV.

## Cleaning up LG's home

For when you do land on it. Names vary a little by webOS version:

- **Settings → General → System → Additional Settings → Home Settings**: turn off **Home
  Promotion** and **Content Recommendation**.
- **Settings → Support → Privacy & Terms → User Agreements**: untick **Viewing Information** and
  **Interest-Based Recommendations**.

## Troubleshooting

- **Pairing fails with "403 Pairing rejected: blacklisted certificate detected".** Newer firmware
  rejects the signed manifest that open-source LG clients share. `lgtv.py` pairs with an unsigned
  one, which still works.
- **No pairing prompt on the TV.** Turn on the TV's option for connecting from mobile apps (on the
  C6: Settings → General → Devices → External Devices; named "LG Connect Apps" or similar).
- **`ares` says "All configured authentication methods failed".** The device profile is missing
  its key: run the third command in step 2 again.
- **Apps stop opening after a while.** Developer Mode sessions expire (LG shows the time left in
  the Developer Mode app; it was 999 hours on our C6). Press **Extend Session Time** there.

## Files

| File | What it does |
|---|---|
| [`app/`](app/) | The launcher: `index.html`, `style.css`, `app.js`, `config.js`, `appinfo.json` |
| [`install.sh`](install.sh) | Syncs your apps, packages and installs the launcher, and opens it |
| [`sync-apps.py`](sync-apps.py) | Reads apps, icons and HDMI inputs from the TV into `app/apps.js` and `app/icons/` |
| [`home-watch.py`](home-watch.py) | Sends the Home button to the launcher |
| [`home-watch-mac.sh`](home-watch-mac.sh) | Runs the watcher as a macOS background service |
| [`boot-home.js`](boot-home.js) | On a rooted TV: opens the launcher at power-on |
| [`lgtv.py`](lgtv.py) | Pairs with and talks to the TV's remote-control service |
| [`assets/icon.jpg`](assets/icon.jpg) | The app icon, resized to PNG by `install.sh` |

## Credits

The design, layout and app icon come from [tv-vibehack](https://github.com/Gathin23/tv-vibehack)
by [Gathin](https://github.com/Gathin23). The Outfit font is under the SIL Open Font License
([`app/fonts/OFL.txt`](app/fonts/OFL.txt)). MIT licensed, see [`LICENSE`](LICENSE).
