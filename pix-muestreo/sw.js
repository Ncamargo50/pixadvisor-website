// PIX Muestreo - Service Worker for Offline Support
// IMPORTANT: Keep CACHE_NAME in sync with APP_VERSION in js/cloud.js
// v57 — cache-first strategy for app shell + complete asset list.
// v58 — add crypto-vault.js + telemetry.js + biometric.js + integrity.js.
// v59 — v3.17.0 hardening: progressive proximity beep, GPS wake-lock, sync
//       status card, sample conflict detection, exponential backoff retries,
//       photo compression, track-to-cloud upload, persistent background sync.
// v60 — Dashboard v1.1: Chart.js + Leaflet.heat in pre-cache (offline dashboard
//       for admin techs) + dashboard.html with 8 new features.
// v61 — deleteTechnician fallback (silent-DELETE detection + soft-delete).
// v62 — v3.17.2: arrival alarm beeps continuously while inside 3m radius
//       (GPS jitter compensation) + dashboard fix synced from website.
// v63 — v3.17.3: auto cloud sync after each saveSample (3s debounced) +
//       immediate cloud push on lote completion in nextZone(). Fixes
//       supervisor not seeing samples until manual sync. Also wires
//       cloud.deleteFieldSync from deleteField/deleteProjectSilent.
// v64 — v3.17.4: P1 hardening — initial sync on app load if pending samples,
//       multi-técnico conflict toasts, 401/auth-expired user-facing alert,
//       APP_VERSION + SW cache aligned with versionCode bump.
// v65 — v3.17.5: P1 backlog — proactive old-cache cleanup in install handler
//       (prev: only on activate, leaving old caches lingering if app closed
//       before fetch event); cloud retry counter to bound infinite retries on
//       permanently-failing fields (4xx schema errors, etc.).
// v66 — v3.18.0: TILE_CACHE LRU cap (256 MB / 4096 tiles whichever first).
//       Prev: tile cache grew without bound — a técnico mapping multiple zones
//       at zoom 16-18 could push browser quota until IndexedDB writes started
//       failing silently. Now: fetch-time eviction trims oldest tiles when cap
//       is reached. + admin confirm() migrated to pixModal.confirm. + 403 also
//       treated as auth failure. + per-field 4xx auth detection broadened.
// v67 — v3.18.1: GPS offline robustness — watchPosition timeout 10s→30s +
//       auto-rearm with backoff on POSITION_UNAVAILABLE/TIMEOUT. Manual
//       sync resets stuck-field counters. Auto-sync errors now surface
//       via toast (was console.warn-only).
// v68 — v3.18.2: REVERT v3.18.1 auto-rearm — clearWatch+rearm on every
//       TIMEOUT was resetting OS GPS warm-up, making cold offline fix
//       impossible (each rearm started from scratch with 30s timeout, the
//       fix was never acquired). Now: timeout bumped to 60s, no rearm —
//       the browser's watchPosition stays alive across TIMEOUT errors and
//       the OS continues acquiring in background. + DATA-LOSS GUARD in
//       cloud.js: if local samples=[] but cloud has samples, abort the
//       upsert (prevents fresh-install / DB hiccup from wiping cloud data).
const CACHE_NAME = 'pix-muestreo-v69';
const TILE_CACHE = 'pix-tiles-v1';
// LRU cap: ~4096 tiles ≈ 250-400 MB depending on zoom mix. Trim runs on
// every cache write — drops to TRIM_TARGET so we don't churn on each write.
const TILE_CACHE_MAX = 4096;
const TILE_CACHE_TRIM_TARGET = 3500;
let _tileTrimInFlight = false;

// Derive base path dynamically — works in both web (/pix-muestreo/) and APK WebView
const SW_PATH = self.location.pathname; // e.g. "/pix-muestreo/sw.js" or "/assets/sw.js"
const BASE = SW_PATH.replace(/sw\.js$/, ''); // e.g. "/pix-muestreo/" or "/assets/"

const STATIC_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'dashboard.html',
  BASE + 'manifest.json',
  BASE + 'css/app.css',
  // Local libs (what index.html actually loads)
  BASE + 'lib/leaflet.css',
  BASE + 'lib/leaflet.js',
  BASE + 'lib/html5-qrcode.min.js',
  BASE + 'lib/html2pdf.bundle.min.js',
  BASE + 'lib/qrcode-gen.min.js',
  // v60 — dashboard v1.1 libs
  BASE + 'lib/chart.min.js',
  BASE + 'lib/leaflet-heat.js',
  // App JS modules (all 13)
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
  BASE + 'js/report-pro.js',
  // v3.16 security/observability additions
  BASE + 'js/crypto-vault.js',
  BASE + 'js/telemetry.js',
  BASE + 'js/biometric.js',
  BASE + 'js/integrity.js',
  // Leaflet marker images (required for offline map markers)
  BASE + 'lib/images/marker-icon.png',
  BASE + 'lib/images/marker-icon-2x.png',
  BASE + 'lib/images/marker-shadow.png',
  BASE + 'lib/images/layers.png',
  BASE + 'lib/images/layers-2x.png',
  // Icons (all sizes + SVG for A2HS)
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/globe-only-96.png',
  BASE + 'icons/globe-only-192.png',
  BASE + 'icons/globe-only-512.png',
  BASE + 'icons/globe-only-1024.png',
  BASE + 'icons/globe-pixadvisor.svg',
];

// Install - cache static assets
// v65: proactively delete old `pix-muestreo-v*` caches BEFORE caching new
// assets. Previously cleanup only ran in `activate`, which is fine in the
// happy path but can leave stale caches taking up storage if the user closes
// the app before the new SW activates (or activate fails partially). Doing it
// in install closes that gap — old caches are reaped as soon as the new SW
// downloads, even before it takes control.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      // Clean any pix-muestreo-* cache that isn't the current one. Keep the
      // tile cache (it's versioned separately and is expensive to rebuild).
      const stale = keys.filter(k =>
        k.startsWith('pix-muestreo-') && k !== CACHE_NAME && k !== TILE_CACHE
      );
      if (stale.length > 0) {
        console.log('[SW] Proactive cleanup of old caches:', stale);
      }
      return Promise.all(stale.map(k => caches.delete(k).catch(() => false)));
    }).then(() => caches.open(CACHE_NAME)).then(cache => {
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

// Activate - second-pass cleanup (covers anything install missed) + claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// LRU trim for the tile cache (v3.18.0).
// `caches.keys()` returns matches in insertion order, so the oldest entries
// are at the front. We delete from the front until we're under the target.
// Runs at most once at a time (`_tileTrimInFlight`) to avoid pile-up when
// many tiles fetch in parallel.
async function trimTileCache() {
  if (_tileTrimInFlight) return;
  _tileTrimInFlight = true;
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length <= TILE_CACHE_MAX) return;
    const toDelete = keys.length - TILE_CACHE_TRIM_TARGET;
    const slice = keys.slice(0, toDelete);
    await Promise.all(slice.map(req => cache.delete(req).catch(() => false)));
    console.log(`[SW] Tile cache LRU: trimmed ${slice.length} tiles (${keys.length} → ${keys.length - slice.length})`);
  } catch (e) {
    console.warn('[SW] Tile trim failed:', e && e.message);
  } finally {
    _tileTrimInFlight = false;
  }
}

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
            if (response.ok) {
              cache.put(event.request, response.clone());
              // Fire-and-forget LRU trim — don't block tile delivery on it.
              trimTileCache();
            }
            return response;
          }).catch(() => new Response('', { status: 404, statusText: 'Tile offline' }));
        })
      )
    );
    return;
  }

  // Supabase API calls - network only, proper offline JSON response
  if (url.hostname.includes('supabase.co')) {
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

  // App shell — cache-first with background revalidate (stale-while-revalidate).
  // Why: this is a FIELD app; rural 2G/3G is normal. Network-first meant users
  // waited 10s+ for every page load before falling back to cache. Cache-first
  // gives instant load; a background fetch refreshes the cache silently so the
  // NEXT reload picks up any shipped update.
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
            .catch(() => {});
        }
        return response;
      }).catch(() => null);

      if (cached) {
        // Serve cached immediately; let revalidate run in background
        networkFetch.catch(() => {});
        return cached;
      }

      // No cache — go to network, then fall back to index.html for navigations
      return networkFetch.then(response => {
        if (response) return response;
        if (event.request.mode === 'navigate') return caches.match(BASE + 'index.html');
        return new Response('', { status: 404, statusText: 'Offline & not cached' });
      });
    })
  );
});

// Background sync — v3.17 hardened version.
// If there are open clients, ping them to run their own sync flow (fastest
// path, full access to IndexedDB + Drive/Cloud creds). If there are NO
// clients open (e.g. user closed the app), open a hidden client so Chrome
// can re-register the sync task for next time the app is opened. This makes
// background sync actually deliver "eventually consistent" — the event won't
// just silently disappear.
self.addEventListener('sync', event => {
  if (event.tag !== 'sync-samples' && event.tag !== 'pix-sync-queue') return;
  event.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      if (clients.length > 0) {
        // Live client present — delegate to the full app sync
        for (const client of clients) {
          client.postMessage({ type: 'sync-samples', source: 'sw-bg', tag: event.tag });
        }
        return;
      }
      // No open client. We can't run IndexedDB-backed sync from the SW
      // directly (requires the full app context). Ask the browser to retry
      // this sync tag next time network is available so it fires once the
      // user re-opens the app or it gets foregrounded.
      if (self.registration && self.registration.sync) {
        try { await self.registration.sync.register('pix-sync-queue'); } catch (_) {}
      }
    } catch (e) {
      console.warn('[SW] sync handler error:', e && e.message);
    }
  })());
});

// Periodic sync (opportunistic — only fires on browsers that grant
// periodic-background-sync permission; harmless no-op elsewhere).
self.addEventListener('periodicsync', event => {
  if (event.tag === 'pix-daily-sync') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'sync-samples', source: 'sw-periodic' }));
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
            if (response.ok) return cache.put(event.data.url, response).then(() => trimTileCache());
          }).catch(() => {});
        })
      )
    );
  }

  // v3.18.0: explicit tile-cache wipe — wired to a "Limpiar tiles" button in
  // Ajustes so a técnico can recover storage manually if quota gets tight.
  if (event.data && event.data.type === 'clear-tile-cache') {
    event.waitUntil(
      caches.delete(TILE_CACHE).then(ok => {
        // postMessage back so the UI can confirm + show new size
        if (event.source) event.source.postMessage({ type: 'tile-cache-cleared', ok });
      }).catch(() => {})
    );
  }
});
