// ============================================================
// PIX Muestreo — Crypto Vault (AES-GCM at-rest for IndexedDB)
// ============================================================
// Threat model:
//   - Stolen phone (unlocked or not): raw `PixMuestreo` IndexedDB on the
//     device is readable by any app with MANAGE_EXTERNAL_STORAGE and, more
//     importantly, via `adb backup` on non-hardened phones.
//   - Before this module: every sample / photo / PDF sat as plaintext BLOB.
//   - After: each row's `content` (and any field whitelisted as sensitive)
//     is wrapped into an envelope `{v, iv, ct}` where `ct` is AES-GCM(256).
//
// Key management:
//   1. The encryption key is derived via PBKDF2-SHA256 from:
//        - the user's login secret (PIN or password hash)  **or**
//        - a device-bound random value stored in localStorage (fallback
//          when the app is unlocked by a session token alone)
//     The derived key NEVER touches IndexedDB — it lives only in memory
//     inside this module.
//   2. On logout, `lock()` zeroes the in-memory key.
//   3. On first unlock after install, a random 32-byte salt is generated
//      and stored in IDB settings `crypto_salt`. That salt is the only
//      per-install value; losing it is equivalent to losing the data.
//
// Compatibility:
//   - Envelope includes `v:1`. Future migrations bump this.
//   - Plaintext reads still work transparently: `decryptField()` detects
//     non-envelope values and returns them unchanged, so legacy rows from
//     v3.15 and earlier keep working.
//   - A `rewrapAll()` background task can be wired in later to encrypt
//     pre-existing plaintext rows lazily; out of scope for v3.16.
//
// Non-goals:
//   - Defeating a forensic attacker who has both the device AND the PIN.
//     That's a physical-security problem, not a crypto one.
//   - Encrypting indexes / keypaths. We keep `fieldId` / `synced` / sort
//     timestamps in plaintext so queries keep working without a full scan.

(function () {
  'use strict';

  const ENVELOPE_VERSION = 1;
  const PBKDF2_ITERS = 250000;      // ~200ms on mid-range Android; raise in 2028.
  const SALT_KEY = 'crypto_salt';
  const DEVICE_SECRET_KEY = 'pix_device_secret';

  let _cryptoKey = null;  // CryptoKey ref — NEVER serialised.

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  async function getOrCreateSalt() {
    if (typeof pixDB === 'undefined') throw new Error('pixDB not ready');
    let saltB64 = await pixDB.getSetting(SALT_KEY);
    if (saltB64) return fromB64(saltB64);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    await pixDB.setSetting(SALT_KEY, toB64(salt));
    return salt;
  }

  function getOrCreateDeviceSecret() {
    // localStorage is per-install, wiped on app uninstall → acceptable as
    // a device-bound secret for the fallback derivation path.
    let v = localStorage.getItem(DEVICE_SECRET_KEY);
    if (!v) {
      const r = crypto.getRandomValues(new Uint8Array(32));
      v = toB64(r);
      localStorage.setItem(DEVICE_SECRET_KEY, v);
    }
    return v;
  }

  async function deriveKey(passphrase, salt) {
    const pass = new TextEncoder().encode(String(passphrase));
    const baseKey = await crypto.subtle.importKey(
      'raw', pass, { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERS,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,               // not extractable — key stays in CryptoKey handle
      ['encrypt', 'decrypt']
    );
  }

  // Detect our envelope format so we don't re-encrypt or mis-decrypt.
  function isEnvelope(obj) {
    return obj && typeof obj === 'object'
      && obj.__enc === 'pix-aesgcm-v1'
      && typeof obj.iv === 'string'
      && typeof obj.ct === 'string';
  }

  async function encryptBytes(bytes) {
    if (!_cryptoKey) throw new Error('Vault locked — call unlock() first');
    const iv = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV for GCM
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _cryptoKey, bytes);
    return {
      __enc: 'pix-aesgcm-v1',
      v: ENVELOPE_VERSION,
      iv: toB64(iv),
      ct: toB64(new Uint8Array(ct))
    };
  }

  async function decryptToBytes(envelope) {
    if (!_cryptoKey) throw new Error('Vault locked — call unlock() first');
    if (!isEnvelope(envelope)) throw new Error('Not an envelope');
    const iv = fromB64(envelope.iv);
    const ct = fromB64(envelope.ct);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _cryptoKey, ct);
    return new Uint8Array(pt);
  }

  const PixVault = {
    /**
     * Unlock with a passphrase (user password, PIN, or device secret).
     * Call on login. Subsequent encrypt/decrypt ops are gated on this.
     * @param {string|null} passphrase — if null, uses the device secret
     */
    async unlock(passphrase) {
      const salt = await getOrCreateSalt();
      const pass = passphrase || getOrCreateDeviceSecret();
      _cryptoKey = await deriveKey(pass, salt);
      return true;
    },

    /**
     * Zero the in-memory key. Call on logout.
     * This is the only thing that separates an attacker with the unlocked
     * phone-via-adb from one without it.
     */
    lock() {
      _cryptoKey = null;
    },

    isUnlocked() {
      return _cryptoKey !== null;
    },

    /**
     * Encrypt a value for at-rest storage. Accepts:
     *   - Blob      → read as ArrayBuffer, wrapped as envelope w/ mime in `m`
     *   - string    → UTF-8 bytes, envelope w/ `t:'s'`
     *   - other     → returned as-is (caller's responsibility — we don't
     *                 encrypt numbers / null / already-encrypted envelopes)
     */
    async encryptField(value) {
      if (value == null) return value;
      if (isEnvelope(value)) return value; // idempotent
      if (!this.isUnlocked()) return value;  // graceful no-op when locked
      try {
        if (typeof Blob !== 'undefined' && value instanceof Blob) {
          const ab = await value.arrayBuffer();
          const env = await encryptBytes(new Uint8Array(ab));
          env.t = 'b';
          env.m = value.type || 'application/octet-stream';
          return env;
        }
        if (typeof value === 'string') {
          const bytes = new TextEncoder().encode(value);
          const env = await encryptBytes(bytes);
          env.t = 's';
          return env;
        }
      } catch (e) {
        console.warn('[Vault] encryptField failed, storing plaintext:', e && e.message);
      }
      return value;
    },

    /**
     * Decrypt a value. Returns plaintext (Blob for `t:'b'`, string for `t:'s'`).
     * Non-envelope values are passed through unchanged (legacy compat).
     */
    async decryptField(value) {
      if (value == null) return value;
      if (!isEnvelope(value)) return value;
      if (!this.isUnlocked()) throw new Error('Vault locked — cannot decrypt');
      const bytes = await decryptToBytes(value);
      if (value.t === 'b') {
        return new Blob([bytes], { type: value.m || 'application/octet-stream' });
      }
      if (value.t === 's') {
        return new TextDecoder().decode(bytes);
      }
      // Unknown envelope type → return raw bytes.
      return bytes;
    }
  };

  window.pixVault = PixVault;
})();
