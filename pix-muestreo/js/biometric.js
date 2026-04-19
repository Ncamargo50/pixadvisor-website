// ============================================================
// PIX Muestreo — Biometric gate (JS wrapper)
// ============================================================
// Calls into the Android BiometricPrompt via the `PixBiometric` JS-interface
// exposed by OfflineActivity.java. Falls back to a benign allow when:
//   - Not running inside the TWA wrapper (plain web PWA) → no biometric
//     hardware exposed to the browser, so we don't gate UI we can't enforce.
//   - Device has no enrolled biometrics → we skip the prompt and allow.
//
// Contract with Android:
//   window.PixBiometric.isAvailable()    → "yes" | "no-hardware" | "no-enrolled"
//   window.PixBiometric.prompt(tag, title, subtitle)
//       → kicks off the prompt; result delivered async via
//          window.dispatchEvent(new CustomEvent('pix:biometric', { detail:{ tag, ok, error }}))
//
// Callers use `await pixBiometric.require(tag, opts)` — resolves true on
// success, rejects on user cancel / lockout. Keep tags short (< 32 chars).

(function () {
  'use strict';

  const PENDING = new Map();

  // Android pushes results here via a window event. We plumb them into the
  // promise map by tag.
  window.addEventListener('pix:biometric', (e) => {
    try {
      const { tag, ok, error } = e.detail || {};
      const entry = PENDING.get(tag);
      if (!entry) return;
      PENDING.delete(tag);
      if (ok) entry.resolve(true);
      else entry.reject(new Error(error || 'Biometric cancelled'));
    } catch (_) {}
  });

  function hasBridge() {
    return typeof window.PixBiometric !== 'undefined'
      && typeof window.PixBiometric.prompt === 'function';
  }

  const PixBiometricClient = {
    /**
     * @returns {'yes'|'no-hardware'|'no-enrolled'|'no-bridge'}
     */
    availability() {
      if (!hasBridge()) return 'no-bridge';
      try {
        const r = window.PixBiometric.isAvailable();
        return r || 'no-bridge';
      } catch (_) {
        return 'no-bridge';
      }
    },

    /**
     * Require a biometric confirmation for the given logical operation.
     * Resolves true if the user authenticated (or if there's no biometric
     * hardware — we don't block ops on devices without fingerprint/face).
     * Rejects only on explicit user cancel.
     *
     * @param {string} tag — short id, used to correlate the async result
     * @param {object} opts — { title, subtitle }
     */
    async require(tag, opts) {
      const avail = this.availability();
      if (avail === 'no-bridge' || avail === 'no-hardware') {
        // Graceful degrade: can't enforce, so allow. The non-biometric
        // protections (rate limit, master key, RLS) still apply.
        return true;
      }
      if (avail === 'no-enrolled') {
        // Device has a sensor but user never enrolled — also allow, but
        // surface a one-time warning via toast if we have it.
        try { if (typeof app !== 'undefined' && app.toast) app.toast('Activá la huella en Ajustes para más seguridad', 'warning'); } catch (_) {}
        return true;
      }
      return new Promise((resolve, reject) => {
        PENDING.set(tag, { resolve, reject });
        try {
          window.PixBiometric.prompt(
            tag,
            (opts && opts.title) || 'Confirmá tu identidad',
            (opts && opts.subtitle) || 'Usá tu huella o rostro para continuar'
          );
        } catch (e) {
          PENDING.delete(tag);
          reject(e);
        }
        // 60s safety timeout so a silent bridge failure doesn't hang the UI.
        setTimeout(() => {
          if (PENDING.has(tag)) {
            PENDING.delete(tag);
            reject(new Error('Biometric timeout'));
          }
        }, 60000);
      });
    }
  };

  window.pixBiometric = PixBiometricClient;
})();
