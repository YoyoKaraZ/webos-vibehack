#!/usr/bin/env node
/*
 * Opens the launcher when a rooted TV turns on, unless it was turned off on an HDMI input or Live
 * TV, or an HDMI device (HDMI-CEC) turned it on.
 * Runs on the TV itself (Node ships with webOS), started at boot from Homebrew Channel's init.d.
 * install.sh copies it there when ROOT_SSH is set.
 *
 * Covers both a cold boot and waking from Quick Start+ standby, which never reboots. webOS brings
 * back the last input (or app) on its own a moment after waking, so the launcher is opened right
 * away and put back in front for a few seconds.
 *
 * It also stands in for LG's home: when an app is closed, webOS goes back to LG's home, so the
 * launcher is opened instead. A key bound to LG's home can still open it by touching LG_HOME_PASS
 * just before (see the inputhook keybinds in the README).
 */
'use strict';
const { spawn, execFile } = require('child_process');
const fs = require('fs');

const LAUNCHER = 'com.gathin.tvhome';
const SOURCES = /^com\.webos\.app\.(hdmi\d|livetv|externalinput\.)/;   // leave these on screen
const SETTLE_MS = 6000;      // webOS brings back the last input or app within this after power-on
const LAST_FILE = '/home/root/tvhome/last-app';   // what was in front at power-off, across reboots
const LG_HOME = 'com.webos.app.home';
const LG_HOME_PASS = '/tmp/tvhome-lghome';        // touched by a key that asks for LG's home on purpose

function log(msg) { console.log(new Date().toISOString() + ' ' + msg); }

function call(uri, params) {
  return new Promise(resolve => {
    execFile('luna-send', ['-n', '1', uri, JSON.stringify(params || {})], (err, out) => {
      try { resolve(JSON.parse(out)); } catch (e) { resolve({ returnValue: false }); }
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * True if appId is an input with something to watch: not one whose device is an audio system on
 * HDMI-CEC (a sound bar on the eARC port), which webOS can switch to while the TV turns off.
 */
async function isPictureSource(appId) {
  if (!SOURCES.test(appId)) return false;
  const r = await call('luna://com.webos.service.eim/getAllInputStatus');
  const dev = (r.devices || []).find(d => d.appId === appId);
  return !(dev && (dev.subList || []).some(s => s.cecpDevType === 5));
}

function foreground() {
  return call('luna://com.webos.applicationManager/getForegroundAppInfo').then(r => r.appId || '');
}

function launchLauncher() {
  return call('luna://com.webos.applicationManager/launch', { id: LAUNCHER }).then(r => !!r.returnValue);
}

let lastApp = '';
try { lastApp = fs.readFileSync(LAST_FILE, 'utf8').trim(); } catch (e) { /* first run */ }

/** Turning off: remember what was in front, which decides what power-on does. */
async function poweringOff() {
  const app = await foreground();
  if (!app || app === 'com.webos.app.screensaver') return;
  lastApp = app;
  try { fs.writeFileSync(LAST_FILE, app); } catch (e) { /* kept in memory until a reboot */ }
  log('powering off on ' + app);
}

/**
 * EU firmware puts energy saving (which dims the picture) back to Auto after a reboot and whenever
 * the picture mode changes: turn it off again each time. Set ENERGY_SAVING to '' to leave the TV's
 * own setting alone.
 */
const ENERGY_SAVING = 'off';
async function keepEnergySaving(why) {
  if (!ENERGY_SAVING) return;
  const r = await call('luna://com.webos.settingsservice/getSystemSettings',
    { category: 'picture', keys: ['energySaving'] });
  const now = r.settings && r.settings.energySaving;
  if (!now || now === ENERGY_SAVING) return;
  await call('luna://com.webos.settingsservice/setSystemSettings',
    { category: 'picture', settings: { energySaving: ENERGY_SAVING } });
  log(why + ': energy saving was ' + now + ', set to ' + ENERGY_SAVING);
}

/**
 * webOS preloads apps in the background (YouTube, Netflix, LG Channels...) so they open faster,
 * at the cost of a few hundred MB of the TV's 1.7 GB, which makes everything else stutter. Its
 * per-app policy resets on wake, so preloading is stopped altogether: the setting lasts until the
 * next reboot. At boot, apps preloaded before this ran are closed too; nothing the viewer opened
 * is running yet then. Apps opened by hand still stay suspended in memory as usual.
 * Set STOP_PRELOAD to false to leave webOS's preloading alone.
 */
const STOP_PRELOAD = true;
const PRELOADED = ['youtube.leanback.v4', 'netflix', 'amazon', 'com.webos.app.lgchannels',
  'com.webos.app.browser', 'com.webos.app.voice'];
async function stopPreload(why) {
  if (!STOP_PRELOAD) return;
  await call('luna://com.webos.service.preloadmanager/setPreloadStatus', { status: 'stop' });
  if (why !== 'boot') return;
  const running = ((await call('luna://com.webos.applicationManager/running')).running || []).map(a => a.id);
  const front = await foreground();
  const closed = [];
  for (const id of PRELOADED) {
    if (running.indexOf(id) >= 0 && id !== front) {
      await call('luna://com.webos.applicationManager/closeByAppId', { id: id });
      closed.push(id);
    }
  }
  log(why + ': preloading stopped' + (closed.length ? ', closed ' + closed.join(', ') : ''));
}

/**
 * HyperHDR forgets the lights state (on or off, brightness) set by lights.js when it restarts:
 * re-apply it at boot, retrying while HyperHDR starts. Skipped when lights.js isn't installed.
 */
const LIGHTS = '/home/root/tvhome/lights.js';
async function restoreLights() {
  if (!fs.existsSync(LIGHTS)) return;
  for (let i = 0; i < 12; i++) {
    const ok = await new Promise(r => execFile('node', [LIGHTS, 'apply'], err => r(!err)));
    if (ok) return log('boot: lights state restored');
    await sleep(10000);
  }
  log('boot: could not restore the lights state, HyperHDR not answering');
}

let busy = false;
async function poweredOn(why, msg) {
  keepEnergySaving(why);
  if (why !== 'boot') stopPreload(why);   // at boot it already ran when the script started
  if (busy) return;
  busy = true;
  try {
    if (await isPictureSource(lastApp)) {
      log(why + ': turned off on ' + lastApp + ', leaving the input');
      return;
    }
    if (/cec/i.test(JSON.stringify(msg))) {
      log(why + ': turned on by an HDMI device, leaving it');
      return;
    }
    // Open it now, then keep it in front while webOS restores the last input or app. Early in a
    // cold boot the app manager may not take launches yet, so keep trying for a while.
    const start = Date.now();
    let launched = 0;
    while (launched ? Date.now() - launched < SETTLE_MS : Date.now() - start < 40000) {
      const app = await foreground();
      if (app === LAUNCHER && !launched) launched = Date.now();   // already up: just hold it briefly
      if (app !== LAUNCHER && (await launchLauncher())) {
        log(why + ': opened the launcher' + (app ? ' over ' + app : ''));
        if (!launched) launched = Date.now();
        await sleep(800);   // give the launch time to reach the front before checking again
      }
      await sleep(200);
    }
    if (!launched) log(why + ': could not open the launcher');
  } finally {
    busy = false;
  }
}

// Screen Saver and Screen Off (picture off, sound on) come back to Active without a power-on.
const AWAKE = ['Active', 'Screen Saver', 'Screen Off'];
const POWER_OFF = /power ?off|suspend|standby/i;   // tvpowerd's "processing" while it shuts down
let state = null, started = false;

function watchPower() {
  const p = spawn('luna-send', ['-i', 'luna://com.webos.service.tvpower/power/getPowerState', '{"subscribe":true}']);
  let buf = '';
  p.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (!msg.state) continue;
      if (!started) {
        started = true;
        log('started, power state ' + msg.state);
        stopPreload('boot');
        restoreLights();
        if (msg.state === 'Active') poweredOn('boot', msg);
      } else if (state === null) {
        // resubscribed: just pick up the current state
      } else if (msg.state !== state) {
        log('power ' + state + ' -> ' + msg.state);
        if (msg.state === 'Active' && AWAKE.indexOf(state) < 0) poweredOn('wake', msg);
      } else if (msg.state === 'Active' && POWER_OFF.test(msg.processing || '')) {
        poweringOff();
      }
      state = msg.state;
    }
  });
  p.on('close', () => {
    log('power subscription ended, resubscribing');
    state = null;
    setTimeout(watchPower, 5000);
  });
}

/** Swaps LG's home for the launcher, unless LG's home was asked for on purpose. */
function watchForeground() {
  const p = spawn('luna-send', ['-i', 'luna://com.webos.applicationManager/getForegroundAppInfo', '{"subscribe":true}']);
  let buf = '', previous = '';
  p.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.appId === undefined) continue;
      if (msg.appId === LG_HOME && previous !== LG_HOME && !busy) {
        let asked = false;
        try {
          asked = Date.now() - fs.statSync(LG_HOME_PASS).mtimeMs < 10000;
          fs.unlinkSync(LG_HOME_PASS);
        } catch (e) { /* no pass: not asked for */ }
        if (asked) {
          log('LG home opened on purpose');
        } else {
          launchLauncher().then(ok => log('LG home after ' + (previous || 'nothing') + (ok ? ', opened the launcher' : ', could not open the launcher')));
        }
      }
      if (msg.appId) previous = msg.appId;
    }
  });
  p.on('close', () => {
    log('foreground subscription ended, resubscribing');
    setTimeout(watchForeground, 5000);
  });
}

/** Re-applies ENERGY_SAVING whenever the TV changes it (picture mode switch, reboot). */
function watchEnergySaving() {
  if (!ENERGY_SAVING) return;
  const p = spawn('luna-send', ['-i', 'luna://com.webos.settingsservice/getSystemSettings',
    JSON.stringify({ category: 'picture', keys: ['energySaving'], subscribe: true })]);
  let buf = '';
  p.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      const now = msg.settings && msg.settings.energySaving;
      if (now && now !== ENERGY_SAVING) keepEnergySaving('setting changed');
    }
  });
  p.on('close', () => {
    log('energy saving subscription ended, resubscribing');
    setTimeout(watchEnergySaving, 5000);
  });
}

watchPower();
watchForeground();
watchEnergySaving();
