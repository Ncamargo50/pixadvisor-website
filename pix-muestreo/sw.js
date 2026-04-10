// PIX Muestreo - Service Worker for Offline Support
// v41b — Audit fixes: Kalman NaN guard, fetch timeout, DB init guard, XSS hardening, memory leaks
const CACHE_NAME = 'pix-muestreo-v42';
const TILE_CACHE = 'pix-tiles-v1';

// Derive base path dynamically — works in both web (/pix-muestreo/) and APK WebView
const SW_PATH = self.location.pathname; // e.g. "/pix-muestreo/sw.js" or "/assets/sw.js"
const BASE = SW_PATH.replace(/sw\.js$/, ''); // e.g. "/pix-muestreo/" or "/assets/"

const STATIC_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'css/app.css',
  // Local libs (what index.html actually loads)
  BASE + 'lib/leaflet.css',
  BASE + 'lib/leaflet.js',
  BASE + 'lib/html5-qrcode.min.js',
  // App JS modules
  BASE + 'js/app.js',
  BASE + 'js/db.js',
  BASE + 'js/map.js',
  BASE + 'js/gps.js',
  BASE + 'js/scanner.js',
  BASE + 'js/drive.js',
  BASE + 'js/auth.js',
  BASE + 'js/sync.js',
  BASE + 'js/cloud.js',
  BASE + 'js/orders.js',
  BASE + 'js/admin.js',
  BASE + 'js/agent-field.js',
  // Icons
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
];

// Install - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Use addAll but don't fail install if some assets are missing
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
        // Cache what we can individually
        return Promise.allSettled(
          STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
        );
      });
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - cache-first for static, network-first for API, cache tiles
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache map tiles (Google + OSM)
  if (url.hostname.includes('tile.openstreetmap.org') || (url.hostname.includes('mt') && url.hostname.includes('google'))) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => new Response('', { status: 404, statusText: 'Tile offline' }));
        })
      )
    );
    return;
  }

  // Google API calls - network only, with offline error handling
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Google Fonts - cache first (they never change)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // App files - network first, fallback to cache
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request).then(cached => {
        return cached || caches.match(BASE + 'index.html');
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
          if (existing) return;
          return fetch(event.data.url).then(response => {
            if (response.ok) return cache.put(event.data.url, response);
          }).catch(() => {});
        })
      )
    );
  }
});
