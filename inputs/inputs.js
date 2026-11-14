/*
 * Quick input picker: a small overlay over whatever is on screen, with the inputs that have a
 * device plugged in, in the launcher's style. Opened by a remote key (inputhook); left/right to
 * choose, OK to switch, Back or the same key again to close.
 *
 * It shows the last known list at once and refreshes it in the background: reading the inputs
 * takes a root call through Homebrew Channel, which is what makes the big launcher slow to switch.
 */
(function () {
  'use strict';

  var KEY = { LEFT: 37, RIGHT: 39, OK: 13, BACK: 461, ESC: 27 };
  var CACHE_KEY = 'inputs.cache';
  var ICON_CONSOLE = 'M21.58,16.09l-1.09,-7.66C20.21,6.46 18.52,5 16.53,5H7.47C5.48,5 3.79,6.46 3.51,8.43l-1.09,7.66C2.2,17.63 3.39,19 4.94,19c0.68,0 1.32,-0.27 1.8,-0.75L9,16h6l2.25,2.25c0.48,0.48 1.13,0.75 1.8,0.75C20.61,19 21.8,17.63 21.58,16.09zM11,11H9v2H8v-2H6v-1h2V8h1v2h2V11zM15,10c-0.55,0 -1,-0.45 -1,-1s0.45,-1 1,-1 1,0.45 1,1S15.55,10 15,10zM17,13c-0.55,0 -1,-0.45 -1,-1s0.45,-1 1,-1 1,0.45 1,1S17.55,13 17,13z';
  var ICON_INPUT = 'M18,7V4c0,-1.1 -0.9,-2 -2,-2H8C6.9,2 6,2.9 6,4v3H5v6l3,6v3h8v-3l3,-6V7H18zM8,4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z';

  var cardsEl = document.getElementById('cards');
  var inputs = [], cards = [], focused = 0, current = '', closing = false;

  // ---- luna ----------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        var k = bridges.indexOf(b);
        if (k >= 0) bridges.splice(k, 1);
        if (cb) cb(res);
      };
      bridges.push(b);
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (cb) cb({ returnValue: false });   // not on a TV (desktop preview)
    }
  }

  /** A luna call made as root through Homebrew Channel. */
  function rootLuna(uri, cb) {
    luna('luna://org.webosbrew.hbchannel.service/exec', { command: 'luna-send -n 1 ' + uri + " '{}'" }, function (res) {
      var out = res.stdoutString || '', reply;
      try { reply = JSON.parse(out.slice(out.indexOf('{'))); } catch (e) { /* not rooted */ }
      if (res.returnValue && reply) cb(reply);
    });
  }

  // ---- inputs --------------------------------------------------------------------------------

  function render() {
    cardsEl.innerHTML = '';
    cards = inputs.map(function (inp, i) {
      var card = document.createElement('div');
      card.className = 'card' + (inp.appId === current ? ' current' : '');
      card.innerHTML = '<span class="now"></span><svg viewBox="0 0 24 24"><path d="' +
        (inp.console ? ICON_CONSOLE : ICON_INPUT) + '"/></svg>';
      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = inp.name;
      card.appendChild(label);
      var sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = inp.port;
      card.appendChild(sub);
      card.addEventListener('mouseover', function () { focus(i); });
      card.addEventListener('click', function () { choose(i); });
      cardsEl.appendChild(card);
      return card;
    });
    if (!inputs.length) cardsEl.innerHTML = '<div id="empty">Aucune entrée active</div>';
    focus(Math.max(0, Math.min(focused, inputs.length - 1)));
  }

  function focus(i) {
    if (!cards.length) return;
    if (cards[focused]) cards[focused].classList.remove('focused');
    focused = i;
    cards[i].classList.add('focused');
  }

  /** Inputs with something to watch: plugged in, and not an audio-only device (a sound bar). */
  function refresh() {
    rootLuna('luna://com.webos.service.eim/getAllInputStatus', function (reply) {
      if (!reply.devices) return;
      var fresh = reply.devices.filter(function (d) {
        var audioOnly = (d.subList || []).some(function (s) { return s.cecpDevType === 5; });
        return d.hdmiPlugIn !== false && !audioOnly;
      }).map(function (d) {
        // "PS5 Console de jeu": the device name first, the kind of device under it.
        var label = d.label || d.id, name = label.replace(/ Console de jeu$/, '');
        return { appId: d.appId, name: name, port: d.id.replace('_', ' '), console: name !== label };
      });
      var changed = JSON.stringify(fresh) !== JSON.stringify(inputs);
      inputs = fresh;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(inputs)); } catch (e) { /* no cache */ }
      if (changed) { focusCurrent(); render(); }
    });
    rootLuna('luna://com.webos.applicationManager/getForegroundAppInfo', function (reply) {
      // The picker itself is in front: the input under it is the last other app.
      if (reply.appId && reply.appId !== 'com.gathin.tvhome.inputs') current = reply.appId;
      focusCurrent();
      render();
    });
  }

  function focusCurrent() {
    for (var i = 0; i < inputs.length; i++) if (inputs[i].appId === current) focused = i;
  }

  // ---- open, choose, close -------------------------------------------------------------------

  function show() {
    closing = false;
    // It handles its own relaunch (to close on a second press), so it must come to the front itself.
    var webOS = window.webOSSystem || window.PalmSystem;
    if (webOS && webOS.activate) webOS.activate();
    try { inputs = JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch (e) { inputs = []; }
    render();
    requestAnimationFrame(function () { document.body.classList.add('shown'); });
    refresh();
  }

  function close() {
    if (closing) return;
    closing = true;
    document.body.classList.remove('shown');
    setTimeout(function () { window.close(); }, 220);
  }

  function choose(i) {
    var inp = inputs[i];
    if (!inp) return;
    luna('luna://com.webos.applicationManager/launch', { id: inp.appId }, function () { close(); });
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === KEY.LEFT && focused > 0) focus(focused - 1);
    else if (k === KEY.RIGHT && focused < cards.length - 1) focus(focused + 1);
    else if (k === KEY.OK) choose(focused);
    else if (k === KEY.BACK || k === KEY.ESC) close();
    else return;
    e.preventDefault();
  });

  // The key pressed again while open closes the picker.
  document.addEventListener('webOSRelaunch', function () {
    if (document.body.classList.contains('shown') && !closing) close();
    else show();
  });

  show();
})();
