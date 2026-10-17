/* ONION web app: keeps the screens on the phone so ONION opens without internet (the community still needs it).
   The build writes the version and the file list below; a new version replaces the old cache. */
const VERSION = '1.7.1';
const FILES = ["community-api.js", "community-config.js", "community.js", "figtree-latin-400-normal.woff2", "figtree-latin-500-normal.woff2", "figtree-latin-600-normal.woff2", "figtree-latin-700-normal.woff2", "fonts.css", "fredoka-latin-500-normal.woff2", "fredoka-latin-600-normal.woff2", "fredoka-latin-700-normal.woff2", "gifenc.js", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "icon.png", "index.html", "ios.css", "ios.js", "jetbrains-mono-latin-500-normal.woff2", "manifest.webmanifest", "mp4-muxer.js", "onion-cat.woff2", "renderer.js", "sample-ghost-background.jpg", "sample-ghost-cell-f1_ghost.png", "sample-ghost-cell-f2_ghost.png", "sample-ghost-cell-f3_ghost.png", "sample-ghost-cell-f4_ghost.png", "sample-ghost-cell-f5_ghost.png", "sample-ghost-cell-f6_ghost.png", "sample-ghost-cell-f7_ghost.png", "sample-ghost-cell-f8_ghost.png", "sample-ghost-project.json", "sample-ghost-thumb.jpg", "sample-manifest.json", "server-update.js", "stagekit.js", "supabase.js", "version.json"];
const CACHE = 'onion-' + VERSION;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('onion-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;          // the community server: always live
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(e.request); }
    catch (err) { return (await c.match('index.html')) || Response.error(); }
  }));
});
