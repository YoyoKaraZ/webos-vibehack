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
  // page in the focused app's colour.
  themes: [
    { name: 'Aurore', bg: 'radial-gradient(circle at 15% 20%, rgba(40,170,150,0.45) 0%, rgba(40,170,150,0) 45%), ' +
      'radial-gradient(circle at 85% 30%, rgba(110,70,200,0.5) 0%, rgba(110,70,200,0) 50%), #05060c', glow: false },
    { name: "Couleur de l'app", bg: '#000', glow: true },
    { name: 'Noir', bg: '#000', glow: false },
    { name: 'Graphite', bg: 'radial-gradient(circle at 30% 20%, #3a3a3e 0%, #1c1c1f 45%, #0b0b0c 100%)', glow: false },
    { name: 'Minuit', bg: 'radial-gradient(circle at 25% 15%, #1d3260 0%, #0d1730 45%, #04070f 100%)', glow: false }
  ]
};
