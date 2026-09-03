// PIX Admin - Service Worker for PWA
// IMPORTANT: Keep CACHE_NAME in sync with PIX_VERSION in js/utils.js
const CACHE_NAME = 'pix-admin-v3.5.0';

// Assets propios: DEBEN cachearse (addAll: si falla uno, se reintenta el install).
const CORE_ASSETS = [
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
  '/pix-admin/js/cloud-sync.js',
  '/pix-admin/js/client-report.js',
  '/pix-admin/js/admin-app.js',
  '/pix-admin/js/agent-admin.js',
  '/pix-admin/js/utils.js',
  '/pix-admin/data/ibra-norms.json',
  '/pix-admin/img/Logo.webp',
  '/pix-admin/img/LOGO-PIX.png',
  '/pix-admin/img/icon-192.png',
  '/pix-admin/img/icon-512.png',
  '/pix-admin/img/icon-192-maskable.png',
  '/pix-admin/img/icon-512-maskable.png'
];

// Assets externos (CDN): "best effort" — si un CDN está caído, el install NO
// debe fallar (antes: un solo 404 abortaba addAll y el SW nuevo no se instalaba).
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
];

// Hosts de API/datos vivos: NUNCA cachear (evita listas/estados congelados).
const NO_CACHE_HOSTS = ['supabase.co', 'api.qrserver.com', 'earthengine.googleapis.com'];

// Install
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);                        // propios: obligatorio
    await Promise.allSettled(EXTERNAL_ASSETS.map(u =>       // CDNs: tolerante a fallos
      cache.add(u).catch(() => null)));
  })());
  self.skipWaiting();
});

// Activate - clean OLD caches of THIS app only.
// El origen se comparte con pix-muestreo (pix-muestreo-v*, pix-tiles-v1 con
// los tiles offline del técnico, pix-dash-*) y con el sitio (pixadvisor-*).
// Antes se borraba todo lo que no fuera CACHE_NAME → un deploy de pix-admin
// destruía las caches offline de las otras PWAs. Ahora: solo `pix-admin-*`
// distinto de la versión actual, preservando la cache de tiles propia.
const CACHE_PREFIX = 'pix-admin-';
const TILE_CACHE = 'pix-admin-tiles-v1'; // antes 'pix-tiles-v1' (colisionaba con muestreo)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch - NETWORK FIRST for own assets, cache-first for external
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // APIs / datos vivos (Supabase, QR, Earth Engine): red directa, SIN cache.
  // Antes caían en "external cache-first" y quedaban congelados hasta el próximo
  // bump de versión (lista de campos, estados, etc.).
  if (NO_CACHE_HOSTS.some(h => url.hostname.includes(h))) {
    return; // deja pasar la request a la red tal cual
  }

  // Map tiles - cache with network fallback
  if (url.hostname.includes('tile.openstreetmap.org') || (url.hostname.includes('mt') && url.hostname.includes('google'))) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
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

  // Own assets (pixadvisor.network) - NETWORK FIRST so updates are always fresh
  if (url.hostname.includes('pixadvisor.network') || url.hostname === self.location.hostname) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback - serve from cache. index.html SOLO para navegaciones:
        // devolverlo para un .js/.json faltante rompía el parseo (MIME incorrecto).
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/pix-admin/index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // External assets (CDN, fonts) - cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => new Response('', { status: 404 }));
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
