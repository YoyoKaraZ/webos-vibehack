#!/usr/bin/env node
/*
 * Ambient lights control for HyperHDR on a rooted TV: switch the light sync on and off and set how
 * bright the lamps get, on every HyperHDR instance (one per set of lamps), with a toast on screen.
 * Used by the launcher's lights button and by inputhook (CH+ / CH-). install.sh copies it to the TV.
 *
 *   node lights.js toggle | on | off | up | down | apply | status
 *
 * Prints the resulting state as JSON. The state is kept in STATE_FILE; `apply` re-sends it after a
 * reboot. If HyperHDR has an admin password, put it alone in PASSWORD_FILE (never in the repo).
 *
 * Like Hue Sync, switching the sync on remembers how the lamps were (on/off, brightness, colour or
 * white, Nanoleaf effect) and switching it off puts them back. That needs the lamps' keys on the
 * TV, kept out of the repo: HUE_FILE {"bridge", "key", "area"} and NANOLEAF_FILE {"host", "token"}.
 * Without them, the lamps are just left as the sync last set them.
 */
'use strict';
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const { execFile } = require('child_process');

const HOST = '127.0.0.1', PORT = 8090;
const INSTANCES = [0, 1];           // HyperHDR instances to drive (Hue, Nanoleaf)
const STEP = 0.1, MIN = 0.1;        // brightness step and floor (scaleOutput, 0 to 1)
const STATE_FILE = '/home/root/tvhome/lights.json';
const PASSWORD_FILE = '/home/root/tvhome/hyperhdr.pass';
const APP_ID = 'com.gathin.tvhome';
const HUE_FILE = '/home/root/tvhome/hue.json';
const NANOLEAF_FILE = '/home/root/tvhome/nanoleaf.json';
const SNAPSHOT_FILE = '/home/root/tvhome/lights-snapshot.json';

const https = require('https');
const http = require('http');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

/** A JSON request; the Hue bridge uses a self-signed certificate. */
function request(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method: method, headers: headers, rejectUnauthorized: false, timeout: 5000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** The Hue lights of the entertainment area, as light ids. */
async function hueLights(hue) {
  const h = { 'hue-application-key': hue.key };
  const base = 'https://' + hue.bridge + '/clip/v2/resource/';
  const area = (await request(base + 'entertainment_configuration/' + hue.area, 'GET', h)).data[0];
  const ids = [];
  for (const ch of area.channels) {
    for (const m of ch.members) {
      const ent = (await request(base + 'entertainment/' + m.service.rid, 'GET', h)).data[0];
      const light = ent.renderer_reference && ent.renderer_reference.rid;
      if (light && ids.indexOf(light) < 0) ids.push(light);
    }
  }
  return ids;
}

/** How the lamps are now, before the sync takes them over. */
async function snapshot() {
  const snap = {};
  const hue = readJson(HUE_FILE), nl = readJson(NANOLEAF_FILE);
  if (hue) {
    const h = { 'hue-application-key': hue.key };
    snap.hue = [];
    for (const id of await hueLights(hue)) {
      const l = (await request('https://' + hue.bridge + '/clip/v2/resource/light/' + id, 'GET', h)).data[0];
      const s = { id: id, on: l.on.on };
      if (l.dimming) s.brightness = l.dimming.brightness;
      if (l.color_temperature && l.color_temperature.mirek_valid) s.mirek = l.color_temperature.mirek;
      else if (l.color) s.xy = l.color.xy;
      snap.hue.push(s);
    }
  }
  if (nl) {
    const base = 'http://' + nl.host + ':16021/api/v1/' + nl.token;
    const st = await request(base + '/state', 'GET', {});
    snap.nanoleaf = { on: st.on.value, brightness: st.brightness.value, mode: st.colorMode,
      hue: st.hue.value, sat: st.sat.value, ct: st.ct.value };
    if (st.colorMode === 'effect') snap.nanoleaf.effect = await request(base + '/effects/select', 'GET', {});
  }
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap));
}

/** Puts the lamps back as snapshot() found them. */
async function restore() {
  const snap = readJson(SNAPSHOT_FILE);
  if (!snap) return;
  const hue = readJson(HUE_FILE), nl = readJson(NANOLEAF_FILE);
  if (hue && snap.hue) {
    const h = { 'hue-application-key': hue.key, 'Content-Type': 'application/json' };
    for (const s of snap.hue) {
      const body = { on: { on: s.on } };
      if (s.brightness !== undefined) body.dimming = { brightness: s.brightness };
      if (s.mirek !== undefined) body.color_temperature = { mirek: s.mirek };
      else if (s.xy) body.color = { xy: s.xy };
      await request('https://' + hue.bridge + '/clip/v2/resource/light/' + s.id, 'PUT', h, body);
    }
  }
  if (nl && snap.nanoleaf) {
    const base = 'http://' + nl.host + ':16021/api/v1/' + nl.token, n = snap.nanoleaf;
    const j = { 'Content-Type': 'application/json' };
    if (n.mode === 'effect' && typeof n.effect === 'string') await request(base + '/effects', 'PUT', j, { select: n.effect });
    else if (n.mode === 'ct') await request(base + '/state', 'PUT', j, { ct: { value: n.ct } });
    else await request(base + '/state', 'PUT', j, { hue: { value: n.hue }, sat: { value: n.sat } });
    await request(base + '/state', 'PUT', j, { brightness: { value: n.brightness }, on: { value: n.on } });
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function load() {
  try { return Object.assign({ enabled: true, level: 1 }, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); }
  catch (e) { return { enabled: true, level: 1 }; }
}

/** One WebSocket session with HyperHDR: switching instance only works over its WebSocket. */
function hyperhdr(commands) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, HOST);
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0), upgraded = false, pending = null;
    const replies = [];
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('HyperHDR did not answer')); }, 8000);

    function send(obj) {
      const data = Buffer.from(JSON.stringify(obj));
      const mask = crypto.randomBytes(4);
      const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length])
        : Buffer.from([0x81, 0x80 | 126, data.length >> 8, data.length & 0xff]);
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      sock.write(Buffer.concat([head, mask, data]));
    }

    function next() {
      const cmd = commands.shift();
      if (!cmd) { clearTimeout(timer); sock.end(); return resolve(replies); }
      pending = replies.length + 1;
      send(Object.assign({ tan: pending }, cmd));
    }

    sock.on('connect', () => {
      sock.write('GET /json-rpc HTTP/1.1\r\nHost: ' + HOST + ':' + PORT + '\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        if (!/^HTTP\/1\.1 101/.test(buf.slice(0, end).toString())) return reject(new Error('no WebSocket'));
        upgraded = true;
        buf = buf.slice(end + 4);
        next();
      }
      // Server frames are unmasked; HyperHDR replies are single text frames.
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const opcode = buf[0] & 0x0f, payload = buf.slice(off, off + len).toString();
        buf = buf.slice(off + len);
        if (opcode !== 1) continue;
        let msg;
        try { msg = JSON.parse(payload); } catch (e) { continue; }
        if (msg.tan === pending) { replies.push(msg); next(); }
      }
    });
    sock.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

/** Sends the state to every instance. */
async function push(state) {
  const cmds = [];
  try {
    const password = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
    if (password) cmds.push({ command: 'authorize', subcommand: 'login', password: password });
  } catch (e) { /* no admin password set */ }
  for (const i of INSTANCES) {
    cmds.push({ command: 'instance', subcommand: 'switchTo', instance: i });
    cmds.push({ command: 'adjustment', adjustment: { classic_config: true, scaleOutput: state.level } });
    cmds.push({ command: 'componentstate', componentstate: { component: 'LEDDEVICE', state: state.enabled } });
  }
  const failed = (await hyperhdr(cmds)).filter(r => r.success === false);
  if (failed.length) throw new Error(failed.map(r => r.command + ': ' + r.error).join('; '));
}

function toast(message) {
  execFile('luna-send', ['-n', '1', '-a', APP_ID, 'luna://com.webos.notification/createToast',
    JSON.stringify({ sourceId: APP_ID, message: message, noaction: true })], () => {});
}


async function main(action) {
  const state = load();
  const wasOn = state.enabled;
  const round = v => Math.round(v * 10) / 10;
  if (action === 'toggle') state.enabled = !state.enabled;
  else if (action === 'on') state.enabled = true;
  else if (action === 'off') state.enabled = false;
  else if (action === 'up') { state.level = round(Math.min(1, state.level + STEP)); state.enabled = true; }
  else if (action === 'down') { state.level = round(Math.max(MIN, state.level - STEP)); state.enabled = true; }
  else if (action !== 'apply' && action !== 'status') throw new Error('unknown action ' + action);

  if (action !== 'status') {
    // The TV's toast font has no block or bar characters: plain text only.
    if (!wasOn && state.enabled) await snapshot().catch(e => console.error('snapshot: ' + e.message));
    await push(state);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    if (wasOn && !state.enabled) {
      await sleep(1500);   // let HyperHDR close the Hue stream before setting the lights
      await restore().catch(e => console.error('restore: ' + e.message));
    }
    if (action === 'up' || action === 'down') toast('Éclairage : ' + Math.round(state.level * 100) + ' %');
    else if (action !== 'apply') toast(state.enabled ? "Éclairage d'ambiance activé" : "Éclairage d'ambiance coupé");
  }
  console.log(JSON.stringify(state));
}

main(process.argv[2] || 'status').catch(e => {
  console.log(JSON.stringify(Object.assign(load(), { error: e.message })));
  process.exit(1);
});
