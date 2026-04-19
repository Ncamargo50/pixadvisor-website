// ============================================================
// PIX Muestreo — Crash Reporting + Telemetry (Sentry)
// ============================================================
// Philosophy:
//   - **No-op by default.** If the Sentry DSN isn't configured, the whole
//     module stays silent so field builds without telemetry aren't broken.
//   - **User opt-out respected.** A setting `telemetry_opt_out` in pixDB
//     disables capture completely even if the DSN is present.
//   - **PII-safe.** We do NOT send user email, master key, sample data, GPS
//     coordinates or photos. Only: stack traces, APP_VERSION tag, anonymous
//     user id (hashed), breadcrumbs of UI actions.
//   - **Low volume.** `sampleRate: 1.0` for errors (we want every crash) but
//     `tracesSampleRate: 0.0` for performance (add later if needed — TWA's
//     WebView perf is already measurable from Play Console vitals).
//
// DSN lookup order (first non-empty wins):
//   1. window.PIX_SENTRY_DSN (injected via Android SharedPreferences bridge)
//   2. pixDB.settings row { key: 'sentry_dsn', value: '...' }
//   3. null → telemetry disabled
//
// SDK is loaded lazily via <script> injection only if a DSN is configured,
// so the ~70 KB Sentry bundle never ships to users who opt out.

(function () {
  'use strict';

  // Version tag — sync with cloud.js APP_VERSION bump.
  const APP_VERSION = 'pix-muestreo-v58';
  const SENTRY_CDN = 'https://browser.sentry-cdn.com/7.119.0/bundle.tracing.min.js';
  const SENTRY_INTEGRITY = ''; // Left blank — SRI would tie us to a specific SDK version;
                                // the CDN is pinned HTTPS and version is in the URL.

  let sentryReady = false;
  let sentryLoadPromise = null;

  async function resolveDsn() {
    // 1. Injected by Android (if the Java layer ever decides to ship a build
    //    with a baked DSN, it sets window.PIX_SENTRY_DSN at page load).
    if (typeof window.PIX_SENTRY_DSN === 'string' && window.PIX_SENTRY_DSN) {
      return window.PIX_SENTRY_DSN;
    }
    // 2. Persisted setting — loaded at runtime, can be toggled by admin.
    try {
      if (typeof pixDB !== 'undefined' && pixDB.getSetting) {
        const v = await pixDB.getSetting('sentry_dsn');
        if (typeof v === 'string' && v) return v;
      }
    } catch (_) {}
    return null;
  }

  async function isOptedOut() {
    try {
      if (typeof pixDB !== 'undefined' && pixDB.getSetting) {
        const v = await pixDB.getSetting('telemetry_opt_out');
        return v === 1 || v === true || v === '1';
      }
    } catch (_) {}
    return false;
  }

  async function hashedUserId() {
    // SHA-256 of the Supabase user id — Sentry gets a stable anonymous
    // correlation id without seeing the real UUID.
    try {
      const raw = (typeof pixAuth !== 'undefined' && pixAuth.getUserId) ? pixAuth.getUserId() : null;
      if (!raw) return null;
      const enc = new TextEncoder().encode(String(raw));
      const buf = await crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(buf.slice(0, 12)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return null; }
  }

  function loadSdk() {
    if (sentryLoadPromise) return sentryLoadPromise;
    sentryLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SENTRY_CDN;
      s.crossOrigin = 'anonymous';
      if (SENTRY_INTEGRITY) s.integrity = SENTRY_INTEGRITY;
      s.onload = () => resolve(window.Sentry);
      s.onerror = () => reject(new Error('Sentry CDN load failed'));
      document.head.appendChild(s);
    });
    return sentryLoadPromise;
  }

  // Strip anything that looks like a secret / PII from an event before send.
  function scrubEvent(event) {
    if (!event) return event;
    try {
      // Drop request body / query string — may contain master key, tokens.
      if (event.request) {
        delete event.request.data;
        delete event.request.query_string;
        delete event.request.cookies;
      }
      // Drop user email if something leaked it in.
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      // Scrub message strings.
      const SECRET_RE = /(eyJ[A-Za-z0-9_-]{20,}|sk_[A-Za-z0-9]{20,}|pixadvisor\d{4}!?|master[_ ]?key|password)/gi;
      if (event.message) event.message = String(event.message).replace(SECRET_RE, '[REDACTED]');
      if (event.exception && event.exception.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = String(ex.value).replace(SECRET_RE, '[REDACTED]');
        }
      }
      if (event.breadcrumbs) {
        for (const b of event.breadcrumbs) {
          if (b.message) b.message = String(b.message).replace(SECRET_RE, '[REDACTED]');
        }
      }
    } catch (_) {}
    return event;
  }

  const PixTelemetry = {
    enabled: false,
    _pending: [],   // captured before SDK loaded

    async init() {
      if (await isOptedOut()) {
        console.log('[Telemetry] User opted out — skipping Sentry');
        return;
      }
      const dsn = await resolveDsn();
      if (!dsn) {
        console.log('[Telemetry] No DSN configured — crash reporting disabled');
        return;
      }
      try {
        const Sentry = await loadSdk();
        const uid = await hashedUserId();
        Sentry.init({
          dsn,
          release: APP_VERSION,
          environment: 'production',
          sampleRate: 1.0,
          tracesSampleRate: 0.0,
          // Keep the fingerprinting tight — network errors group together.
          beforeSend: (event) => scrubEvent(event),
          beforeBreadcrumb: (breadcrumb) => {
            // Skip noisy fetch breadcrumbs to Supabase (they contain paths that
            // might include ids; we don't need them for crash triage).
            if (breadcrumb.category === 'fetch' && breadcrumb.data && breadcrumb.data.url) {
              try {
                const u = new URL(breadcrumb.data.url);
                breadcrumb.data.url = u.origin + u.pathname; // drop query
              } catch (_) {}
            }
            return breadcrumb;
          }
        });
        if (uid) Sentry.setUser({ id: uid });
        Sentry.setTag('platform', 'twa-android');
        Sentry.setTag('app_version', APP_VERSION);
        this.enabled = true;
        sentryReady = true;
        // Flush any pre-init captures.
        for (const { err, ctx } of this._pending) {
          try { Sentry.captureException(err, { extra: ctx }); } catch (_) {}
        }
        this._pending = [];
        console.log('[Telemetry] Sentry initialized:', APP_VERSION);
      } catch (e) {
        console.warn('[Telemetry] Sentry init failed:', e && e.message);
      }
    },

    captureException(err, ctx) {
      if (!this.enabled || !window.Sentry) {
        // Buffer up to 20 events for the SDK to drain on init.
        if (this._pending.length < 20) this._pending.push({ err, ctx: ctx || {} });
        return;
      }
      try { window.Sentry.captureException(err, { extra: ctx || {} }); } catch (_) {}
    },

    captureMessage(msg, level) {
      if (!this.enabled || !window.Sentry) return;
      try { window.Sentry.captureMessage(msg, level || 'info'); } catch (_) {}
    },

    // Call on logout to drop the user correlation id immediately.
    clearUser() {
      if (!this.enabled || !window.Sentry) return;
      try { window.Sentry.setUser(null); } catch (_) {}
    },

    // Admin opt-out toggle (exposed to the settings UI).
    async setOptOut(optOut) {
      try {
        if (typeof pixDB !== 'undefined' && pixDB.setSetting) {
          await pixDB.setSetting('telemetry_opt_out', optOut ? 1 : 0);
        }
      } catch (_) {}
    }
  };

  window.pixTelemetry = PixTelemetry;
})();
