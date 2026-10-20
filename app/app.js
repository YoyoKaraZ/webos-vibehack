/*
 * tvOS style home for webOS: a pinned dock row and an app grid, where the focused tile lifts off the
 * page with a soft shadow, a light sheen and a small spring tilt in the
 * direction of travel. A port of the Android launcher in ../../launcher.
 *
 * webOS does not let third-party apps list installed apps, so sync-apps.py writes them into apps.js.
 * On a TV rooted with Homebrew Channel, the live list replaces that snapshot (fetchLiveApps).
 */
(function () {
  'use strict';

  var COLUMNS = Math.max(1, CONFIG.columns || 4);
  var CELL_W = (1920 - 2 * 112) / COLUMNS;
  var TILE_W = Math.min(360, Math.floor(CELL_W - 40));   // 360 x 202 up to 4 columns, smaller beyond
  var TILE_H = Math.round(TILE_W * 202 / 360);
  var ROW_PITCH = TILE_H + 90;
  var DOCK_TOP = 708;           // tile top of the dock row: next row peeks in at the bottom
  var DOCK_GAP = 36;            // extra space below the dock
  var TILT_DEG = 5;             // how far a newly focused tile leans toward the direction of travel
  var VIEW_TOP, VIEW_BOTTOM = 1060;         // area grid rows scroll into: below the header, set at start

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27 };

  var GREETINGS = [[5, 'Bonne nuit'], [12, 'Bonjour'], [17, 'Bon après-midi'], [22, 'Bonsoir'], [24, 'Bonne nuit']];
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
    'octobre', 'novembre', 'décembre'];

  var ICON_INPUT = 'M18,7V4c0,-1.1 -0.9,-2 -2,-2H8C6.9,2 6,2.9 6,4v3H5v6l3,6v3h8v-3l3,-6V7H18zM8,4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z';
  var ICON_LIVETV = 'M21,6h-7.59l3.29,-3.29L16,2l-4,4l-4,-4l-0.71,0.71L10.59,6H3c-1.1,0 -2,0.89 -2,2v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.89 2,-2V8C23,6.89 22.1,6 21,6zM21,20H3V8h18V20zM9,10v8l7,-4L9,10z';

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), tilesEl = $('tiles'), hero = $('hero');
  var ambients = [$('ambientA'), $('ambientB')], ambientFront = 0, ambientColor = null;
  var pills = [$('btnInputs'), $('btnWifi'), $('btnSettings'), $('btnTheme'), $('btnLights')];
  var panel = $('inputsPanel');

  var items = [];               // {app, el, color}
  var zone = 'grid';            // 'grid' | 'top' | 'inputs'
  var focused = 0, pillFocus = 0, inputFocus = 0, inputRows = [];
  var offset = 0, heroShown = false, tiltTimer = null;
  var editing = null;           // {item, snapshot} while a tile is being moved

  // ---- luna bus ------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        if (cb) cb(res);
        // indexOf is -1 once already removed: splice(-1) would drop another call's bridge.
        var k = bridges.indexOf(b);
        if (k >= 0 && (!params || !params.subscribe)) bridges.splice(k, 1);
      };
      bridges.push(b);
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (cb) cb({ returnValue: false, errorText: String(e) });   // not on a TV (desktop preview)
    }
  }

  function launch(id, title, params) {
    luna('luna://com.webos.applicationManager/launch', { id: id, params: params || {} }, function (res) {
      if (res.returnValue === false) toast("Impossible d'ouvrir " + (title || id));
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('shown'); }, 2200);
  }

  // ---- apps ----------------------------------------------------------------------------------

  function orderedApps() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });
    var hidden = {};
    (CONFIG.hiddenApps || []).forEach(function (id) { hidden[id] = true; });
    var byTitle = function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; };

    // An order arranged on the TV wins, until dockApps in config.js changes.
    var saved = loadOrder();
    if (saved) {
      var placed = [];
      saved.forEach(function (id) {
        if (byId[id] && !hidden[id]) { placed.push(byId[id]); hidden[id] = true; }
      });
      return placed.concat(all.filter(function (a) { return !hidden[a.id]; }).sort(byTitle));
    }

    var dock = [];
    (CONFIG.dockApps || []).forEach(function (id) {
      if (byId[id] && !hidden[id] && dock.length < COLUMNS) { dock.push(byId[id]); hidden[id] = true; }
    });
    var rest = all.filter(function (a) { return !hidden[a.id]; });
    rest.sort(byTitle);
    return dock.concat(rest);
  }

  /**
   * On a TV rooted with Homebrew Channel, its root service can read the real app list, so apps
   * installed after the last sync (homebrew ones included) show up. Without it, apps.js stays.
   */
  /** A luna call made as root through Homebrew Channel; cb only runs when it worked. */
  function rootLuna(uri, cb) {
    var cmd = 'luna-send -n 1 ' + uri + " '{}'";
    luna('luna://org.webosbrew.hbchannel.service/exec', { command: cmd }, function (res) {
      var out = res.stdoutString || '', reply;
      try { reply = JSON.parse(out.slice(out.indexOf('{'))); } catch (e) { /* not rooted, or refused */ }
      if (res.returnValue && reply && reply.returnValue !== false) cb(reply);
    });
  }

  /**
   * Icons of apps installed after the last sync live in their own app folders, which a web app
   * can't read: read them as root instead and show them as data URLs.
   */
  var rootIcons = {};
  function loadRootIcon(path, img) {
    if (rootIcons[path]) { img.src = rootIcons[path]; return; }
    var type = /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';
    luna('luna://org.webosbrew.hbchannel.service/exec', { command: "cat '" + path + "'" }, function (res) {
      if (!res.returnValue || !res.stdoutBytes) return;
      img.src = rootIcons[path] = 'data:' + type + ';base64,' + res.stdoutBytes;
    });
  }

  function fetchLiveApps(cb) {
    rootLuna('luna://com.webos.applicationManager/listLaunchPoints', function (reply) {
      var points = reply.launchPoints;
      if (!points) return;

      var synced = {};
      ((window.TV_APPS && TV_APPS.apps) || []).forEach(function (a) { synced[a.id] = a; });
      cb(points.filter(function (p) { return !p.hidden; }).map(function (p) {
        var icon = p.largeIcon || p.icon || '';
        return {
          id: p.id,
          title: p.title,
          icon: synced[p.id] ? synced[p.id].icon : icon,   // keep the synced icon: it is the store banner
          iconColor: p.iconColor || p.bgColor || ''
        };
      }));
    });
  }

  function appsKey(apps) {
    return apps.map(function (a) { return a.id + '|' + a.title; }).sort().join('\n');
  }

  /** Swaps in the live app list and rebuilds the tiles when it differs from what is shown. */
  function refreshApps() {
    fetchLiveApps(function (apps) {
      if (editing || appsKey(apps) === appsKey((window.TV_APPS && TV_APPS.apps) || [])) return;
      window.TV_APPS = window.TV_APPS || {};
      TV_APPS.apps = apps;
      build();
      animateIn();
      if (zone === 'grid' || zone === 'none') focusTile(focused);
    });
  }

  var ORDER_KEY = 'tvhome.order';

  function loadOrder() {
    try {
      var s = JSON.parse(localStorage.getItem(ORDER_KEY));
      return s && s.dock === (CONFIG.dockApps || []).join(',') ? s.ids : null;
    } catch (e) {
      return null;
    }
  }

  function saveOrder() {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify({
        dock: (CONFIG.dockApps || []).join(','),
        ids: items.map(function (it) { return it.app.id; })
      }));
    } catch (e) { /* storage unavailable: the order lasts until the app restarts */ }
  }

  function rowOf(i) { return Math.floor(i / COLUMNS); }
  function tileLeft(i) { return 112 + (i % COLUMNS) * CELL_W + (CELL_W - TILE_W) / 2; }
  function tileTop(i) { var r = rowOf(i); return DOCK_TOP + r * ROW_PITCH + (r > 0 ? DOCK_GAP : 0); }

  function build() {
    tilesEl.innerHTML = '';
    items = orderedApps().map(function (app) {
      var el = document.createElement('div');
      el.className = 'item';
      var card = document.createElement('div');
      card.className = 'card';
      var img = document.createElement('img');
      var item = { app: app, el: el, card: card, color: null };
      img.onload = function () { paintTile(item, img); };
      if (app.icon.charAt(0) === '/') loadRootIcon(app.icon, img);
      else img.src = app.icon;
      card.appendChild(img);
      el.appendChild(card);
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = app.title;
      el.appendChild(name);
      el.addEventListener('mouseover', function () {
        if (zone !== 'inputs' && !editing && !pointerBlank) focusTile(items.indexOf(item));
      });
      el.addEventListener('click', function () {
        if (editing) finishEdit(true);
        else launch(app.id, app.title);
      });
      tilesEl.appendChild(el);
      return item;
    });
    layout();
  }

  /** Places every tile by its position in items; tiles glide when the order changes. */
  function layout() {
    items.forEach(function (it, i) {
      it.el.style.left = tileLeft(i) + 'px';
      it.el.style.top = tileTop(i) + 'px';
      it.el.classList.toggle('dock', rowOf(i) === 0);   // the dock has no labels: the top shelf names it
    });

    var band = $('dockBand');
    var n = Math.min(COLUMNS, items.length);
    band.style.display = n ? 'block' : 'none';
    band.style.left = (tileLeft(0) - 28) + 'px';
    band.style.top = (DOCK_TOP - 28) + 'px';
    band.style.width = ((n - 1) * CELL_W + TILE_W + 56) + 'px';
    band.style.height = (TILE_H + 56) + 'px';
  }

  function animateIn() {
    items.forEach(function (it, i) {
      it.el.classList.remove('shown');
      setTimeout(function () { it.el.classList.add('shown'); }, 60 + Math.min(i, 16) * 40);
    });
  }

  /**
   * Store icons are square logos on a solid colour: fill the wide tile with that colour so the logo
   * reads as a banner. LG's system icons are glyphs on transparent: use the app's own colour.
   */
  function paintTile(item, img) {
    var px = null, edge = null;
    try {
      var c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0, 12, 12);
      px = g.getImageData(0, 0, 12, 12).data;
      edge = edgeColor(img);
    } catch (e) { /* tainted canvas: fall back to the app's colour */ }

    var glyphColor = null;
    if (edge && edge[3] > 200) {
      item.card.style.background = 'rgb(' + edge[0] + ',' + edge[1] + ',' + edge[2] + ')';
    } else {
      item.card.classList.add('glyph');
      item.card.style.background = glyphBackground(item.app.iconColor);
      glyphColor = glyphBackground(item.app.iconColor) === '#2c2c2e' ? null : parseColor(item.app.iconColor);
    }
    // A white glyph says nothing about the app: glow in the tile's colour instead.
    item.color = glyphColor || (px ? vividColor(px) : parseColor(item.app.iconColor));
    if (items[focused] === item) setAmbient(item.color);
  }

  /**
   * The icon's background at full size: a corner pixel, or the middle of the left edge for rounded
   * icons whose corners are transparent. A downscaled sample would blend in the logo.
   */
  function edgeColor(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var corner = g.getImageData(2, 2, 1, 1).data;
    return corner[3] > 200 ? corner : g.getImageData(2, Math.floor(h / 2), 1, 1).data;
  }

  function glyphBackground(hex) {
    var c = parseColor(hex);
    if (!c) return '#2c2c2e';
    var hsv = rgbToHsv(c);
    if (hsv[1] < 0.15 && (hsv[2] > 0.85 || hsv[2] < 0.1)) return '#2c2c2e';   // white or black glyph colour
    return 'rgb(' + c.join(',') + ')';
  }

  /** A vivid colour from the icon: the most saturated, not too dark pixel, or the lifted average. */
  function vividColor(px) {
    var best = null, bestScore = -1, sum = [0, 0, 0], n = 0;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      var p = [px[i], px[i + 1], px[i + 2]];
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
      var hsv = rgbToHsv(p);
      var score = hsv[1] * Math.min(1, hsv[2] * 1.4);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!n) return [68, 68, 68];
    if (bestScore < 0.25) {   // nearly monochrome icon (e.g. white): its average, lifted
      var avg = rgbToHsv([sum[0] / n, sum[1] / n, sum[2] / n]);
      avg[2] = Math.max(avg[2], 0.55);
      return hsvToRgb(avg);
    }
    var h = rgbToHsv(best);
    h[1] = Math.min(1, h[1] * 1.1);
    h[2] = Math.max(0.5, h[2]);
    return hsvToRgb(h);
  }

  function parseColor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }

  function rgbToHsv(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }

  function hsvToRgb(hsv) {
    var h = hsv[0], s = hsv[1], v = hsv[2];
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(function (k) { return Math.round((k + m) * 255); });
  }

  // ---- focus -------------------------------------------------------------------------------

  function focusTile(i) {
    if (!items.length) return;
    i = Math.max(0, Math.min(i, items.length - 1));
    var from = zone === 'grid' && i !== focused ? focused : -1;
    setZone('grid');
    if (items[focused]) items[focused].el.classList.remove('focused');
    focused = i;
    items[i].el.classList.add('focused');
    if (from >= 0) tilt(items[i].card, (i % COLUMNS) - (from % COLUMNS), rowOf(i) - rowOf(from));

    var top = tileTop(i), row = rowOf(i);
    if (row === 0) {
      offset = 0;
    } else {
      // Scroll just enough so the whole lifted tile and the name below it are visible.
      if (top - offset + TILE_H + 70 > VIEW_BOTTOM) offset = top + TILE_H + 70 - VIEW_BOTTOM;
      if (top - offset - 24 < VIEW_TOP) offset = top - 24 - VIEW_TOP;
    }
    stage.style.transform = 'translateY(' + (-offset) + 'px)';

    if (row === 0) showHero(items[i]);
    else hideHero();
    setAmbient(items[i].color);   // the glow follows the focused tile in every row
  }

  /**
   * Leans the card toward the direction of travel, then lets it spring back flat (the spring is the
   * CSS transition on .card).
   */
  function tilt(card, dx, dy) {
    dx = Math.max(-1, Math.min(1, dx));
    dy = Math.max(-1, Math.min(1, dy));
    card.style.setProperty('--tilt-x', (-dy * TILT_DEG) + 'deg');
    card.style.setProperty('--tilt-y', (dx * TILT_DEG) + 'deg');
    clearTimeout(tiltTimer);
    tiltTimer = setTimeout(function () {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    }, 140);
  }

  function showHero(item) {
    var label = item.app.title;
    hero.style.top = (DOCK_TOP - 28 - 52 - 96) + 'px';
    if (!heroShown) {
      clearTimeout(hero.swap);
      hero.textContent = label;
      hero.style.transform = 'none';
      hero.style.opacity = '1';
      heroShown = true;
    } else if (hero.textContent !== label) {
      hero.style.opacity = '0';
      hero.style.transform = 'translateX(-24px)';
      clearTimeout(hero.swap);
      hero.swap = setTimeout(function () {
        hero.textContent = label;
        hero.style.transition = 'none';
        hero.style.transform = 'translateX(24px)';
        hero.offsetWidth;
        hero.style.transition = '';
        hero.style.transform = 'none';
        hero.style.opacity = '1';
      }, 120);
    }
    setAmbient(item.color);
  }

  function hideHero() {
    clearTimeout(hero.swap);   // a name swap still pending would show it again
    if (!heroShown) return;
    heroShown = false;
    hero.style.opacity = '0';
  }

  /** Crossfades the glow to a new colour by swapping between two layers. */
  function setAmbient(color) {
    if (!color) return;
    var key = color.join(',');
    if (key === ambientColor) return;
    ambientColor = key;
    var back = ambients[1 - ambientFront];
    back.style.background = 'radial-gradient(circle 1190px at 32% 42%, rgba(' + key + ',0.36) 0%, rgba(' +
      key + ',0.15) 50%, rgba(' + key + ',0) 100%)';
    back.style.opacity = '1';
    ambients[ambientFront].style.opacity = '0';
    ambientFront = 1 - ambientFront;
  }

  function focusPill(i) {
    setZone('top');
    pills[pillFocus].classList.remove('focused');
    var last = pills.length - 1;
    while (last > 0 && pills[last].hidden) last--;   // the lights button hides without root
    pillFocus = Math.max(0, Math.min(i, last));
    pills[pillFocus].classList.add('focused');
  }

  function setZone(z) {
    if (zone === z) return;
    if (zone === 'top') pills[pillFocus].classList.remove('focused');
    if (zone === 'grid') {
      if (items[focused]) items[focused].el.classList.remove('focused');
    }
    zone = z;
  }

  /** The pill straight above a dock tile, by horizontal distance. */
  function pillAbove(i) {
    var cx = tileLeft(i) + TILE_W / 2, best = 0, bestD = Infinity;
    pills.forEach(function (p, k) {
      if (p.hidden) return;
      var r = p.getBoundingClientRect();
      var d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  // ---- top bar -------------------------------------------------------------------------------

  function updateClock() {
    var now = new Date(), h = now.getHours();
    for (var k = 0; k < GREETINGS.length; k++) {
      if (h < GREETINGS[k][0]) { $('greeting').textContent = GREETINGS[k][1]; break; }
    }
    var m = now.getMinutes();
    $('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    $('date').textContent = DAYS[now.getDay()] + '  ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
  }

  /** Shows the Wi-Fi network name when the TV reports it, otherwise the connection type. */
  function watchNetwork() {
    luna('luna://com.palm.connectionmanager/getStatus', { subscribe: true }, function (res) {
      if (res.returnValue === false && !res.wifi && !res.wired) return;
      var text = 'Wi-Fi';
      if (res.wired && res.wired.state === 'connected') text = 'Ethernet';
      else if (res.wifi && res.wifi.state === 'connected') text = res.wifi.ssid || 'Wi-Fi';
      else if (res.isInternetConnectionAvailable === false) text = 'Hors ligne';
      $('wifiLabel').textContent = text;
      $('btnWifi').title = text;   // the pill shows only its icon
      $('btnWifi').classList.toggle('on', text !== 'Hors ligne');
    });
  }

  function activatePill(i) {
    if (i === 0) showInputs();
    else if (i === 1) launch('com.palm.app.settings', 'Paramètres', { target: 'network' });
    else if (i === 2) launch('com.palm.app.settings', 'Paramètres');
    else if (i === 3) applyTheme(theme + 1, true);
    else lights('toggle');
  }

  // ---- ambient lights ------------------------------------------------------------------------

  /**
   * Runs lights.js on the TV (as root, through Homebrew Channel): HyperHDR's light sync on or off,
   * or just its state. The button shows the state; lights.js shows the toast.
   */
  var LIGHTS = 'node /home/root/tvhome/lights.js ';
  function lights(action) {
    luna('luna://org.webosbrew.hbchannel.service/exec', { command: LIGHTS + action }, function (res) {
      var state;
      try { state = JSON.parse((res.stdoutString || '').trim().split('\n').pop()); } catch (e) { /* no lights.js */ }
      var btn = $('btnLights');
      btn.hidden = !state;   // no root or no lights.js: no button
      if (!state) { if (pills.indexOf(btn) === pillFocus && zone === 'top') focusPill(pillFocus - 1); return; }
      btn.classList.toggle('on', state.enabled && !state.error);
      if (state.error && action !== 'status') toast("L'éclairage ne répond pas");
    });
  }

  // ---- themes --------------------------------------------------------------------------------

  var THEMES = CONFIG.themes && CONFIG.themes.length ? CONFIG.themes : [{ name: "Couleur de l'app", bg: '#000', glow: true }];
  var THEME_KEY = 'tvhome.theme';
  var theme = 0;

  function loadTheme() {
    try {
      var name = localStorage.getItem(THEME_KEY);
      for (var k = 0; k < THEMES.length; k++) if (THEMES[k].name === name) return k;
    } catch (e) { /* storage unavailable: start on the default */ }
    return 0;
  }

  /** Shows theme i (wrapping around); `save` remembers it for the next start. */
  function applyTheme(i, save) {
    theme = (i + THEMES.length) % THEMES.length;
    var t = THEMES[theme];
    var backdrop = $('backdrop');
    backdrop.style.background = t.bg || '#000';
    backdrop.innerHTML = '';
    (t.blobs || []).forEach(function (b) {
      // Drawn at half size and scaled up by the animation: the GPU only moves a small texture,
      // and on a gradient this soft the difference can't be seen.
      var el = document.createElement('div');
      el.className = 'blob';
      el.style.width = el.style.height = (b.size / 2) + 'px';
      el.style.left = (b.x / 100 * 1920 - b.size / 4) + 'px';
      el.style.top = (b.y / 100 * 1080 - b.size / 4) + 'px';
      el.style.background = 'radial-gradient(circle closest-side, rgba(' + b.color + ',' + b.alpha + '), rgba(' +
        b.color + ',0))';
      // Two animations at different rates: the drift moves it, the fade lets colours take over
      // from one another and dark patches open between halos.
      var delay = -(b.offset || 0) + 's';
      el.style.animation = 'drift-' + (b.path || 1) + ' ' + (b.drift || 30) + 's ease-in-out ' + delay +
        ' infinite alternate, fade ' + (b.fade || 10) + 's ease-in-out ' + delay + ' infinite alternate';
      backdrop.appendChild(el);
    });
    document.body.classList.toggle('noGlow', !t.glow);
    $('themeLabel').textContent = t.name;
    if (!save) return;
    try { localStorage.setItem(THEME_KEY, t.name); } catch (e) { /* lasts until the app restarts */ }
  }

  // ---- inputs dropdown -----------------------------------------------------------------------

  var liveInputs = null;   // on a rooted TV: only the inputs with something plugged in

  function refreshInputs() {
    rootLuna('luna://com.webos.service.eim/getAllInputStatus', function (reply) {
      if (!reply.devices) return;
      liveInputs = reply.devices.filter(function (d) {
        // The sound bar on the eARC port is plugged in too, but has no picture (CEC audio system).
        var audioOnly = (d.subList || []).some(function (s) { return s.cecpDevType === 5; });
        return d.hdmiPlugIn !== false && !audioOnly;
      }).map(function (d) { return { appId: d.appId, label: d.label }; });
    });
  }

  function showInputs() {
    panel.innerHTML = '';
    inputRows = [];
    var inputs = liveInputs || (window.TV_APPS && TV_APPS.inputs) || [];
    refreshInputs();   // for next time: something may have been plugged in meanwhile
    inputs.forEach(function (inp) { addInputRow(ICON_INPUT, inp.label, inp.appId); });
    if (CONFIG.liveTvApp) {
      if (inputRows.length) panel.appendChild(Object.assign(document.createElement('div'), { className: 'separator' }));
      addInputRow(ICON_LIVETV, 'TV en direct', CONFIG.liveTvApp);
    }
    if (!inputRows.length) { toast('Aucune entrée active'); return; }

    // Hang right below the Inputs pill, at least as wide as it.
    var r = pills[0].getBoundingClientRect();
    panel.style.left = r.left + 'px';
    panel.style.top = (r.bottom + 20) + 'px';
    panel.style.minWidth = Math.max(r.width, 300) + 'px';
    panel.classList.remove('hidden');
    pills[pillFocus].classList.remove('focused');
    zone = 'inputs';
    focusInput(0);
  }

  function addInputRow(icon, label, appId) {
    var row = document.createElement('div');
    row.className = 'inputRow';
    row.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
    row.appendChild(document.createTextNode(label));
    var idx = inputRows.length;
    row.addEventListener('mouseover', function () { if (!pointerBlank) focusInput(idx); });
    row.addEventListener('click', function () { hideInputs(); launch(appId, label); });
    row.appId = appId;
    row.label = label;
    inputRows.push(row);
    panel.appendChild(row);
  }

  function focusInput(i) {
    if (inputRows[inputFocus]) inputRows[inputFocus].classList.remove('focused');
    inputFocus = Math.max(0, Math.min(i, inputRows.length - 1));
    inputRows[inputFocus].classList.add('focused');
  }

  function hideInputs() {
    panel.classList.add('hidden');
    zone = 'none';
    focusPill(0);
  }

  // ---- rearranging ---------------------------------------------------------------------------

  /** Hold OK on a tile: it wiggles, the arrows move it, OK places it, Back puts everything back. */
  function startEdit() {
    var it = items[focused];
    if (!it) return;
    editing = { item: it, snapshot: items.slice() };
    it.el.classList.add('moving');
    document.body.classList.add('editing');
    toast('Flèches pour déplacer  ·  OK pour placer  ·  Retour pour annuler');
  }

  function moveTo(to) {
    if (to < 0 || to >= items.length || to === focused) return;
    items.splice(to, 0, items.splice(focused, 1)[0]);
    focused = to;
    layout();
    focusTile(to);
  }

  function finishEdit(keep) {
    var it = editing.item;
    if (!keep) {
      items = editing.snapshot;
      layout();
    }
    editing = null;
    it.el.classList.remove('moving');
    document.body.classList.remove('editing');
    if (keep) saveOrder();
    focused = items.indexOf(it);
    focusTile(focused);
  }

  // ---- keys ----------------------------------------------------------------------------------

  var LONG_PRESS_MS = 600;
  var okDown = false, okTimer = null;

  // On tiles OK acts on release, so a held OK can start rearranging instead of opening the app.
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    okDown = false;
    if (!okTimer) return;
    clearTimeout(okTimer);
    okTimer = null;
    var it = items[focused];
    if (zone === 'grid' && it && !editing) launch(it.app.id, it.app.title);
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === KEY.OK && okDown) { e.preventDefault(); return; }   // key repeat while held
    if (k === KEY.OK) okDown = true;
    if (editing) {
      if (k === KEY.LEFT) moveTo(focused - 1);
      else if (k === KEY.RIGHT) moveTo(focused + 1);
      else if (k === KEY.UP) moveTo(focused - COLUMNS);
      else if (k === KEY.DOWN) moveTo(Math.min(focused + COLUMNS, items.length - 1));
      else if (k === KEY.OK) finishEdit(true);
      else if (k === KEY.BACK || k === KEY.ESC) finishEdit(false);
      else return;
    } else if (zone === 'inputs') {
      if (k === KEY.UP) focusInput(inputFocus - 1);
      else if (k === KEY.DOWN) focusInput(inputFocus + 1);
      else if (k === KEY.OK) { var row = inputRows[inputFocus]; hideInputs(); launch(row.appId, row.label); }
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.LEFT || k === KEY.RIGHT) hideInputs();
      else return;
    } else if (zone === 'top') {
      if (k === KEY.LEFT) focusPill(pillFocus - 1);
      else if (k === KEY.RIGHT) focusPill(pillFocus + 1);
      else if (k === KEY.DOWN) focusTile(rowOf(focused) === 0 ? focused : 0);
      else if (k === KEY.OK) activatePill(pillFocus);
      else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    } else {
      var col = focused % COLUMNS, last = items.length - 1;
      if (k === KEY.LEFT) { if (col > 0) focusTile(focused - 1); }
      else if (k === KEY.RIGHT) { if (col < COLUMNS - 1 && focused < last) focusTile(focused + 1); }
      else if (k === KEY.UP) {
        if (rowOf(focused) === 0) focusPill(pillAbove(focused));
        else focusTile(focused - COLUMNS);
      } else if (k === KEY.DOWN) {
        if (rowOf(focused) < rowOf(last)) focusTile(Math.min(focused + COLUMNS, last));
      } else if (k === KEY.OK) {
        okTimer = setTimeout(function () { okTimer = null; startEdit(); }, LONG_PRESS_MS);
      } else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    }
    e.preventDefault();
  });

  pills.forEach(function (p, i) {
    p.addEventListener('mouseover', function () { if (zone !== 'inputs' && !pointerBlank) focusPill(i); });
    p.addEventListener('click', function () { activatePill(i); });
  });

  // ---- pointer -------------------------------------------------------------------------------

  /**
   * webOS shows the Magic Remote pointer whenever Home is pressed, before the launcher even opens.
   * Blank it when the launcher comes back, and bring it back once the remote really moves. While
   * blank, hovering does nothing: the hidden pointer would otherwise pick the tile under it.
   */
  var webOS = window.webOSSystem || window.PalmSystem;
  var pointerBlank = false, blankFrom = null;

  function blankPointer() {
    if (!webOS || !webOS.setCursor) return;
    webOS.setCursor('blank');
    pointerBlank = true;
    blankFrom = null;
  }

  document.addEventListener('mousemove', function (e) {
    if (!pointerBlank) return;
    if (!blankFrom) { blankFrom = [e.clientX, e.clientY]; return; }   // where the hidden pointer sits
    if (Math.abs(e.clientX - blankFrom[0]) + Math.abs(e.clientY - blankFrom[1]) > 40) {
      webOS.setCursor('default');
      pointerBlank = false;
    }
  });

  // ---- lifecycle -----------------------------------------------------------------------------

  /** Back from another app (or opened again from the shortcut): replay the entrance, keep the tile. */
  function resume() {
    blankPointer();
    if (editing) finishEdit(false);
    updateClock();
    if (zone === 'inputs') panel.classList.add('hidden');
    pills.forEach(function (p) { p.classList.remove('focused'); });
    zone = 'none';
    animateIn();
    focusTile(focused);
    refreshApps();
    refreshInputs();
    lights('status');
  }

  document.addEventListener('webOSRelaunch', resume);
  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('away', document.hidden);   // pauses the background while an app is in front
    if (!document.hidden) resume();
  });

  document.documentElement.style.setProperty('--tile-w', TILE_W + 'px');
  document.documentElement.style.setProperty('--tile-h', TILE_H + 'px');

  // The header stays put: the grid scrolls in the band below it, in the same page coordinates.
  var header = document.querySelector('header');
  var headerBottom = header.offsetTop + header.offsetHeight + 16;
  $('viewport').style.top = headerBottom + 'px';
  stage.style.top = -headerBottom + 'px';
  VIEW_TOP = headerBottom + 8;

  applyTheme(loadTheme(), false);
  build();
  updateClock();
  setInterval(updateClock, 10000);
  watchNetwork();
  animateIn();
  zone = 'none';
  focusTile(0);
  refreshApps();
  refreshInputs();
  lights('status');
})();
