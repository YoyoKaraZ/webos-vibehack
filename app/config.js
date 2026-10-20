// Launcher configuration. Edit this file, then run webos-launcher/install.sh.
// App ids: run `python3 sync-apps.py --list` (or look in app/apps.js after a sync).
window.CONFIG = {
  // Apps pinned to the dock row at the bottom, in this order. Missing apps are skipped.
  dockApps: ['netflix', 'amazon', 'youtube.leanback.v4', 'hotstar'],

  // Apps never shown as tiles (inputs and Live TV are already in the Inputs menu).
  hiddenApps: [
    'com.gathin.tvhome',
    'com.webos.app.livetv',
    'com.webos.app.hdmi1', 'com.webos.app.hdmi2', 'com.webos.app.hdmi3', 'com.webos.app.hdmi4',
    'com.webos.app.lgchannels',   // LG Channels
    'shortcutcopilot'             // Copilot
  ],

  // The Live TV app, offered at the end of the Inputs menu. Leave empty to omit.
  liveTvApp: '',

  // Tiles per row in the grid; the dock always has this many slots.
  columns: 5,

  // Backgrounds, cycled with the Thème button at the top; the first is the default. `bg` is any CSS
  // background (an image in app/ works too: "url(wallpaper.jpg) center / cover"). `glow` tints the
  // page in the focused app's colour. `blobs` adds soft halos that drift over the background and
  // fade in and out: colour as "r,g,b", alpha at the centre, centre x/y in % of the screen, diameter
  // in px, path (1 to 4: the drift-N keyframes in style.css), drift and fade cycles in seconds, and a
  // start offset so the halos never move in step.
  themes: [
    { name: 'Aurore', bg: '#04050a', glow: false, blobs: [
      { color: '40,170,150', alpha: 0.6, x: 15, y: 25, size: 900, path: 1, drift: 26, fade: 9, offset: 3 },
      { color: '110,70,200', alpha: 0.65, x: 80, y: 30, size: 1000, path: 2, drift: 31, fade: 12, offset: 11 },
      { color: '35,110,190', alpha: 0.55, x: 50, y: 85, size: 850, path: 3, drift: 22, fade: 10, offset: 7 },
      { color: '180,60,160', alpha: 0.45, x: 65, y: 60, size: 700, path: 4, drift: 28, fade: 14, offset: 17 },
      { color: '20,150,200', alpha: 0.45, x: 30, y: 75, size: 650, path: 2, drift: 24, fade: 8, offset: 5 },
      { color: '70,60,200', alpha: 0.5, x: 90, y: 85, size: 750, path: 1, drift: 34, fade: 13, offset: 21 }
    ] },
    { name: "Couleur de l'app", bg: '#000', glow: true },
    { name: 'Noir', bg: '#000', glow: false },
    { name: 'Graphite', bg: 'radial-gradient(circle at 30% 20%, #3a3a3e 0%, #1c1c1f 45%, #0b0b0c 100%)', glow: false },
    { name: 'Minuit', bg: 'radial-gradient(circle at 25% 15%, #1d3260 0%, #0d1730 45%, #04070f 100%)', glow: false }
  ]
};
