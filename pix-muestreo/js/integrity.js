// ============================================================
// PIX Muestreo — Play Integrity client
// ============================================================
// Two-step flow (documented in docs/INTEGRITY.md):
//
//   1. Client asks server for a fresh nonce:
//         POST /functions/v1/integrity-nonce  → { nonce: "base64..." }
//   2. Client passes nonce to Play Integrity:
//         window.PixIntegrity.requestToken(nonce)
//         → CustomEvent 'pix:integrity' with { ok, token }
//   3. Client sends token to server for verdict:
//         POST /functions/v1/integrity-verify { nonce, token }
//         → { verdict: 'pass' | 'warn' | 'fail' }
//
// Without steps 1 + 3 wired on the backend, this module returns
// `{ ok: false, reason: 'server-not-configured' }` and the app continues.
// That's by design — rolling out Play Integrity without a server-side
// gate is theater, so we fail-open rather than block legitimate users.

(function () {
  'use strict';

  const PENDING = new Map();

  window.addEventListener('pix:integrity', (e) => {
    try {
      const { ok, token, error } = e.detail || {};
      // Only one request can be in flight per tag — we use a single slot.
      const entry = PENDING.get('current');
      if (!entry) return;
      PENDING.delete('current');
      if (ok) entry.resolve({ ok: true, token });
      else entry.resolve({ ok: false, reason: error || 'unknown' });
    } catch (_) {}
  });

  function hasBridge() {
    return typeof window.PixIntegrity !== 'undefined'
      && typeof window.PixIntegrity.requestToken === 'function';
  }

  async function fetchNonce() {
    // Server endpoint is configured in pixCloud — if absent, abort.
    if (typeof pixCloud === 'undefined' || !pixCloud.isEnabled || !pixCloud.isEnabled()) {
      return null;
    }
    try {
      const url = pixCloud._supabaseFunctionUrl
        ? pixCloud._supabaseFunctionUrl('integrity-nonce')
        : null;
      if (!url) return null;
      const resp = await fetch(url, {
        method: 'POST',
        headers: pixCloud._authHeaders ? pixCloud._authHeaders() : {}
      });
      if (!resp.ok) return null;
      const j = await resp.json();
      return (j && typeof j.nonce === 'string' && j.nonce.length >= 16) ? j.nonce : null;
    } catch (_) {
      return null;
    }
  }

  async function verifyToken(nonce, token) {
    try {
      const url = pixCloud._supabaseFunctionUrl
        ? pixCloud._supabaseFunctionUrl('integrity-verify')
        : null;
      if (!url) return { verdict: 'unknown' };
      const resp = await fetch(url, {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          pixCloud._authHeaders ? pixCloud._authHeaders() : {}
        ),
        body: JSON.stringify({ nonce, token })
      });
      if (!resp.ok) return { verdict: 'unknown' };
      return await resp.json();
    } catch (_) {
      return { verdict: 'unknown' };
    }
  }

  const PixIntegrityClient = {
    /**
     * Run the full 3-step verdict flow. Returns an object:
     *   { ok: true,  verdict: 'pass'|'warn' }
     *   { ok: false, reason: '<code>' }
     * Fails open on any infrastructure issue (network, missing server,
     * missing cloud project) so normal users never get locked out.
     */
    async check() {
      if (!hasBridge()) return { ok: false, reason: 'no-bridge' };
      const nonce = await fetchNonce();
      if (!nonce) return { ok: false, reason: 'server-not-configured' };

      const tokenResp = await new Promise((resolve) => {
        PENDING.set('current', { resolve });
        try {
          window.PixIntegrity.requestToken(nonce);
        } catch (e) {
          PENDING.delete('current');
          resolve({ ok: false, reason: 'bridge-throw' });
        }
        setTimeout(() => {
          if (PENDING.has('current')) {
            PENDING.delete('current');
            resolve({ ok: false, reason: 'timeout' });
          }
        }, 30000);
      });

      if (!tokenResp.ok || !tokenResp.token) {
        return { ok: false, reason: tokenResp.reason || 'token-fail' };
      }

      const verdict = await verifyToken(nonce, tokenResp.token);
      if (verdict && (verdict.verdict === 'pass' || verdict.verdict === 'warn')) {
        return { ok: true, verdict: verdict.verdict };
      }
      return { ok: false, reason: verdict && verdict.reason ? verdict.reason : 'bad-verdict' };
    }
  };

  window.pixIntegrity = PixIntegrityClient;
})();
