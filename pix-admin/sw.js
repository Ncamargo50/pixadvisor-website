// PIX Admin - Service Worker for PWA
const CACHE_NAME = 'pix-admin-v7';

const STATIC_ASSETS = [
  '/pix-admin/',
  '/pix-admin/index.html',
  '/pix-admin/manifest.json',
  '/pix-admin/css/admin.css',
  '/pix-admin/js/crops-data.js',
  '/pix-admin/js/engine.js',
  '/pix-admin/js/interpolation.js',
  '/pix-admin/js/report-generator.js',
  '/pix-admin/js/kriging.js',
  '/pix-admin/js/zones-engine.js',
  '/pix-admin/js/sampling-engine.js',
  '/pix-admin/js/admin-app.js',
  '/pix-admin/js/agent-admin.js',
  '/pix-admin/img/Logo.png',
  '/pix-admin/img/LOGO-PIX.png',
  '/pix-admin/img/icon-192.png',
  '/pix-admin/img/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - cache first, network fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Map tiles - cache with network fallback
  if (url.hostname.includes('tile.openstreetmap.org') || (url.hostname.includes('mt') && url.hostname.includes('google'))) {
    event.respondWith(
      caches.open('pix-tiles-v1').then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => new Response('', { status: 404 }));
        })
      )
    );
    return;
  }

  // Static assets - cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/pix-admin/index.html'));
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
