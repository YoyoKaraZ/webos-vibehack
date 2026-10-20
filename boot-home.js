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
 */
'use strict';
const { spawn, execFile } = require('child_process');
const fs = require('fs');

const LAUNCHER = 'com.gathin.tvhome';
const SOURCES = /^com\.webos\.app\.(hdmi\d|livetv|externalinput\.)/;   // leave these on screen
const SETTLE_MS = 6000;      // webOS brings back the last input or app within this after power-on
const LAST_FILE = '/home/root/tvhome/last-app';   // what was in front at power-off, across reboots

function log(msg) { console.log(new Date().toISOString() + ' ' + msg); }

function call(uri, params) {
  return new Promise(resolve => {
    execFile('luna-send', ['-n', '1', uri, JSON.stringify(params || {})], (err, out) => {
      try { resolve(JSON.parse(out)); } catch (e) { resolve({ returnValue: false }); }
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

let busy = false;
async function poweredOn(why, msg) {
  if (busy) return;
  busy = true;
  try {
    if (SOURCES.test(lastApp)) {
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

watchPower();
