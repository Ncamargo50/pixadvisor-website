const CACHE_NAME = 'pixadvisor-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/manifest.json',
  '/img/logo.webp',
  '/img/logo-negro.webp',
  '/img/favicon.png',
  '/img/apple-touch-icon.png',
  '/vista_aerea_ap_hd.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Prefijo propio de este SW. Este origen también aloja las PWAs de campo
// (/pix-muestreo/, /pix-admin/) con sus propias caches (pix-muestreo-v*,
// pix-tiles-v1 con cientos de MB de tiles offline, pix-dash-*, pix-admin-*).
// Antes se borraba TODO lo que no fuera CACHE_NAME → cada deploy del sitio
// destruía las caches offline del técnico. Ahora solo se limpian las propias.
const CACHE_PREFIX = 'pixadvisor-';

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Las sub-apps /pix-*/ tienen su propio SW (scope más específico). Si este
  // SW raíz (scope "/") llega a interceptar una request de esas rutas (p. ej.
  // antes de que el SW hijo tome control), NO la cacheamos ni devolvemos la
  // landing pública como fallback offline: dejar que la red / SW hijo la manejen.
  if (url.pathname.startsWith('/pix-')) return;

  if (req.mode === 'navigate' || (req.destination === 'document')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Solo cachear respuestas OK: nunca persistir un 404/500 como fallback offline.
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
