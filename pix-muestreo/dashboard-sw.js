// PIX Muestreo Dashboard — Service Worker (offline shell)
// Caches the dashboard HTML + assets; bypasses Supabase REST/Realtime
const CACHE = 'pix-dash-v1';
const ASSETS = [
  'dashboard.html',
  'lib/leaflet.css',
  'lib/leaflet.js',
  'lib/leaflet-heat.js',
  'lib/chart.min.js',
  'lib/html2pdf.bundle.min.js',
  'icons/icon-192.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE && k.startsWith('pix-dash-')).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache Supabase REST or Realtime — they must always go to network
  if (url.hostname.includes('supabase.co') || url.protocol === 'wss:' || url.protocol === 'ws:') return;
  // Tile servers — let browser cache, no SW caching
  if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.match(/mt\d\.google\.com/)) return;
  // Network-first for HTML; cache-first for static
  const isHTML = e.request.headers.get('accept')?.includes('text/html');
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      if (fresh && fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(e.request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (isHTML) {
        const shell = await caches.match('dashboard.html');
        if (shell) return shell;
      }
      throw new Error('offline and no cache');
    }
  })());
});
