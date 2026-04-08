// PIX Muestreo - Service Worker for Offline Support
const CACHE_NAME = 'pix-muestreo-v13';
const TILE_CACHE = 'pix-tiles-v1';
const DATA_CACHE = 'pix-data-v1';

const STATIC_ASSETS = [
  '/pix-muestreo/',
  '/pix-muestreo/index.html',
  '/pix-muestreo/manifest.json',
  '/pix-muestreo/css/app.css',
  '/pix-muestreo/js/app.js',
  '/pix-muestreo/js/db.js',
  '/pix-muestreo/js/map.js',
  '/pix-muestreo/js/gps.js',
  '/pix-muestreo/js/scanner.js',
  '/pix-muestreo/js/sync.js',
  '/pix-muestreo/js/drive.js',
  '/pix-muestreo/js/auth.js',
  '/pix-muestreo/js/orders.js',
  '/pix-muestreo/js/admin.js',
  '/pix-muestreo/js/agent-field.js',
  '/pix-muestreo/icons/icon-192.png',
  '/pix-muestreo/icons/icon-512.png',
  '/pix-muestreo/icons/globe-only-192.png',
  '/pix-muestreo/icons/globe-only-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install - cache static assets
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
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE && k !== DATA_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - cache-first for static, network-first for API, cache tiles
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache map tiles
  if (url.hostname.includes('tile.openstreetmap.org') || (url.hostname.includes('mt') && url.hostname.includes('google'))) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          }).catch(() => new Response('', { status: 404 }));
        })
      )
    );
    return;
  }

  // Google API calls - network only
  if (url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App files - network first (ensures updates are loaded immediately)
  // Falls back to cache only when offline
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request).then(cached => {
        return cached || caches.match('/pix-muestreo/index.html');
      });
    })
  );
});

// Background sync
self.addEventListener('sync', event => {
  if (event.tag === 'sync-samples') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'sync-samples' });
        });
      })
    );
  }
});

// Listen for messages from main thread
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();

  // Cache a specific tile URL (used by tile pre-loader)
  if (event.data && event.data.type === 'cache-tile' && event.data.url) {
    event.waitUntil(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.data.url).then(existing => {
          if (existing) return; // already cached
          return fetch(event.data.url).then(response => {
            if (response.ok) {
              return cache.put(event.data.url, response);
            }
          });
        })
      )
    );
  }
});
