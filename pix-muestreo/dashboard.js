// ═══════════════════════════════════════════════════
// PIX Muestreo Dashboard — Supabase Direct REST
// Full Admin Panel with Tabs — v2.0
// v2.0 (2026-05-01): +Per-admin accounts, +Audit log, +Salted pw,
//                    +TOTP 2FA, +Auto-logout, +Pagination all,
//                    +Search, +Bulk ops, +Tech detail, +Realtime v2,
//                    +Browser notifs, +Marker cluster, +A11y
// v1.1 (2026-04-19): +Charts, +Realtime, +Heatmap, +GPS tracks,
//                    +PDF export, +pagination, +date/client filters
// ═══════════════════════════════════════════════════

// ── CONSTANTS ──
const ONE_MINUTE = 60000;
const ONE_HOUR   = 3600000;
const ONE_DAY    = 86400000;
// Read tunables from runtime config (dashboard-config.js) with safe fallbacks
const _CFG = (typeof window !== 'undefined' && window.PIX_CONFIG) || {};
const INACTIVITY_TIMEOUT = _CFG.INACTIVITY_TIMEOUT_MS || (30 * ONE_MINUTE);
const MAX_LOGIN_ATTEMPTS = _CFG.MAX_LOGIN_ATTEMPTS || 5;
const LOGIN_LOCKOUT_BASE = _CFG.LOGIN_LOCKOUT_BASE_MS || 60000;
const REALTIME_RECONNECT_MAX_S = _CFG.REALTIME_RECONNECT_MAX_S || 300;

// ── CRYPTO HELPERS (unified — replaces _sha256 + sha256 duplicates) ──
async function pixHash(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { /* fall through */ }
  }
  // No fallback in dashboard context — modern browsers only
  throw new Error('crypto.subtle not available — use a modern browser');
}

function pixGenerateSalt() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pixHashSalted(plain) {
  const salt = pixGenerateSalt();
  const hash = await pixHash(salt + plain);
  return salt + ':' + hash;
}

async function pixVerify(plain, storedHash) {
  if (!storedHash) return false;
  if (storedHash.includes(':')) {
    const [salt, _hash] = storedHash.split(':');
    const computed = await pixHash(salt + plain);
    return (salt + ':' + computed) === storedHash;
  }
  // Legacy unsalted SHA-256 (backward compat)
  const computed = await pixHash(plain);
  return computed === storedHash;
}

// ── ADMIN AUTH STATE ──
let _adminUser = null;          // { id, username, full_name, role }
let _authAttempts = 0;
let _authLockUntil = 0;
let _pendingTotpUser = null;    // user pending TOTP verification

// ── INACTIVITY TIMER (auto-logout) ──
let _inactivityTimer = null;
function _resetInactivityTimer() {
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  if (!_adminUser) return;
  _inactivityTimer = setTimeout(() => {
    pixToast('Sesión expirada por inactividad', 'warn');
    setTimeout(dashLogout, 1500);
  }, INACTIVITY_TIMEOUT);
}
['mousemove','keydown','click','touchstart'].forEach(ev =>
  document.addEventListener(ev, _resetInactivityTimer, { passive: true })
);

// ── CUSTOM MODALS (replace native confirm/prompt/alert) ──
function pixConfirm(msg, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmModalMsg').textContent = msg;
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');
    okBtn.textContent = opts.okLabel || 'Confirmar';
    cancelBtn.textContent = opts.cancelLabel || 'Cancelar';
    okBtn.style.background = opts.danger === false ? 'var(--green)' : 'var(--red)';
    okBtn.style.color = opts.danger === false ? 'var(--bg)' : 'white';
    modal.style.display = 'flex';
    const close = (val) => { modal.style.display = 'none'; resolve(val); };
    okBtn.onclick = () => close(true);
    cancelBtn.onclick = () => close(false);
    setTimeout(() => okBtn.focus(), 50);
  });
}

function pixPrompt(msg, type) {
  return new Promise(resolve => {
    const modal = document.getElementById('inputModal');
    const field = document.getElementById('inputModalField');
    document.getElementById('inputModalMsg').textContent = msg;
    field.type = type || 'text';
    field.value = '';
    modal.style.display = 'flex';
    setTimeout(() => field.focus(), 50);
    const close = (val) => { modal.style.display = 'none'; resolve(val); };
    document.getElementById('inputModalOk').onclick = () => close(field.value);
    document.getElementById('inputModalCancel').onclick = () => close(null);
    field.onkeydown = (e) => { if (e.key === 'Enter') close(field.value); };
  });
}

function pixAlert(msg) {
  return pixConfirm(msg, { okLabel: 'OK', cancelLabel: '', danger: false }).then(() => undefined);
}

// Toast w/ optional Undo button (returns Promise that resolves true on undo, false on auto-dismiss)
function pixToast(msg, type, undoCb) {
  const el = document.getElementById('toast');
  const cls = type === 'err' || type === 'error' ? 'toast-err'
            : type === 'warning' || type === 'warn' ? 'toast-warn'
            : 'toast-ok';
  if (undoCb) {
    el.innerHTML = `<span>${esc(msg)}</span> <button onclick="window._pixUndo()" style="margin-left:10px;padding:2px 10px;border:1px solid currentColor;background:transparent;color:inherit;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">↶ Deshacer</button>`;
    let undone = false;
    window._pixUndo = () => { undone = true; el.classList.remove('show'); undoCb(); };
    el.className = 'toast ' + cls + ' show';
    setTimeout(() => {
      el.classList.remove('show');
      delete window._pixUndo;
    }, 5000);
  } else {
    el.textContent = msg;
    el.className = 'toast ' + cls + ' show';
    setTimeout(() => { el.classList.remove('show'); }, 3000);
  }
}
// Backward-compat alias used elsewhere in this file
const toast = pixToast;

// ── ADMIN LOGIN ──
async function dashAuthLogin() {
  // Rate limiting (per-browser)
  if (Date.now() < _authLockUntil) {
    const secs = Math.ceil((_authLockUntil - Date.now()) / 1000);
    document.getElementById('dashAuthError').textContent = `Demasiados intentos. Espere ${secs}s`;
    document.getElementById('dashAuthError').style.display = 'block';
    return;
  }
  const username = (document.getElementById('dashAuthUser').value || '').trim().toLowerCase();
  const pass = document.getElementById('dashAuthPass').value;
  if (!username || !pass || pass.length < 4) {
    document.getElementById('dashAuthError').textContent = 'Usuario o clave inválidos';
    document.getElementById('dashAuthError').style.display = 'block';
    return;
  }
  // Lookup admin via REST (uses anon key — RLS allows SELECT on active=true)
  try {
    const resp = await fetch(SUPA_URL + '/rest/v1/admin_users?username=eq.' + encodeURIComponent(username) + '&active=eq.true&select=id,username,full_name,role,password_hash,totp_enabled,totp_secret', {
      headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const rows = await resp.json();
    const user = rows && rows[0];
    if (!user || !(await pixVerify(pass, user.password_hash))) {
      _failedLogin(username);
      return;
    }
    // 2FA: if TOTP enabled, prompt for code instead of completing login
    if (user.totp_enabled && user.totp_secret) {
      _pendingTotpUser = user;
      document.getElementById('dashAuthStep1').style.display = 'none';
      document.getElementById('dashAuthStep2').style.display = 'block';
      document.getElementById('dashAuthError').style.display = 'none';
      setTimeout(() => document.getElementById('dashAuthTotp').focus(), 50);
      return;
    }
    await _completeLogin(user);
  } catch (e) {
    document.getElementById('dashAuthError').textContent = 'Error de conexión: ' + e.message;
    document.getElementById('dashAuthError').style.display = 'block';
  }
}

async function dashAuthVerifyTotp() {
  const code = (document.getElementById('dashAuthTotp').value || '').trim();
  if (!/^\d{6}$/.test(code)) {
    document.getElementById('dashAuthError').textContent = 'Código de 6 dígitos requerido';
    document.getElementById('dashAuthError').style.display = 'block';
    return;
  }
  if (!_pendingTotpUser) return;
  const ok = await pixTotpVerify(_pendingTotpUser.totp_secret, code);
  if (!ok) {
    _failedLogin(_pendingTotpUser.username);
    document.getElementById('dashAuthTotp').value = '';
    return;
  }
  await _completeLogin(_pendingTotpUser);
  _pendingTotpUser = null;
}

function _failedLogin(username) {
  _authAttempts++;
  document.getElementById('dashAuthPass').value = '';
  if (_authAttempts >= MAX_LOGIN_ATTEMPTS) {
    const factor = Math.pow(2, Math.floor(_authAttempts / MAX_LOGIN_ATTEMPTS) - 1);
    const lockSecs = Math.round(LOGIN_LOCKOUT_BASE * factor / 1000);
    _authLockUntil = Date.now() + lockSecs * 1000;
    document.getElementById('dashAuthError').textContent = `Bloqueado por ${lockSecs}s (demasiados intentos)`;
    // Best-effort audit log of failed login (no admin_id since unknown)
    _logAudit({ admin_user: username || 'unknown', action: 'login_failed', details: { attempts: _authAttempts } });
  } else {
    document.getElementById('dashAuthError').textContent = `Credenciales incorrectas (${MAX_LOGIN_ATTEMPTS - _authAttempts} intentos)`;
  }
  document.getElementById('dashAuthError').style.display = 'block';
}

async function _completeLogin(user) {
  _authAttempts = 0;
  _adminUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  // Persist minimal session data — never store password hash client-side beyond memory
  sessionStorage.setItem('pix_dash_admin', JSON.stringify(_adminUser));
  document.getElementById('dashAuthOverlay').style.display = 'none';
  // Audit log + bookkeeping (fire-and-forget)
  _logAudit({ action: 'login', target_type: 'admin_user', target_id: user.id, target_name: user.username });
  fetch(SUPA_URL + '/rest/v1/admin_users?id=eq.' + user.id, {
    method: 'PATCH',
    headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_login_at: new Date().toISOString() })
  }).catch(() => {});
  _resetInactivityTimer();
  initDashboard();
  _renderAdminBadge();
}

function _renderAdminBadge() {
  const el = document.getElementById('adminBadge');
  if (!el || !_adminUser) return;
  el.textContent = (_adminUser.full_name || _adminUser.username) + ' · ' + _adminUser.role;
  el.style.display = 'inline-flex';
}

function dashLogout() {
  if (_adminUser) {
    _logAudit({ action: 'logout', target_type: 'admin_user', target_id: _adminUser.id, target_name: _adminUser.username });
  }
  sessionStorage.removeItem('pix_dash_admin');
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  location.reload();
}

// ── AUDIT LOG (fire-and-forget; failures should not block UX) ──
async function _logAudit(entry) {
  try {
    const body = {
      admin_user: entry.admin_user || (_adminUser ? _adminUser.username : 'anonymous'),
      admin_id:   entry.admin_id   || (_adminUser ? _adminUser.id : null),
      action:     entry.action,
      target_type: entry.target_type || null,
      target_id:   entry.target_id   ? String(entry.target_id) : null,
      target_name: entry.target_name || null,
      details:     entry.details     || null,
      user_agent:  navigator.userAgent.slice(0, 200)
    };
    await fetch(SUPA_URL + '/rest/v1/audit_log', {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn('[Audit] failed to log:', e.message);
  }
}

// ── TOTP (RFC 6238 — SHA-1, 30s window, 6 digits) ──
function _base32Decode(b32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = b32.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = '';
  for (const c of cleaned) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) throw new Error('Invalid base32');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return new Uint8Array(bytes);
}

function _base32Encode(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substr(i, 5).padEnd(5, '0');
    out += alphabet[parseInt(chunk, 2)];
  }
  while (out.length % 8) out += '=';
  return out;
}

async function _hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return new Uint8Array(sig);
}

async function pixTotpGenerate(secret, time) {
  const t = Math.floor((time || Date.now()) / 1000 / 30);
  const counter = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { counter[i] = t & 0xff; /* shift */ }
  let v = t;
  for (let i = 7; i >= 0; i--) { counter[i] = v & 0xff; v = Math.floor(v / 256); }
  const key = _base32Decode(secret);
  const hmac = await _hmacSha1(key, counter);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset+1] & 0xff) << 16) | ((hmac[offset+2] & 0xff) << 8) | (hmac[offset+3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}

async function pixTotpVerify(secret, code) {
  // Accept current ± 1 window to tolerate clock drift
  const now = Date.now();
  for (const drift of [0, -30000, 30000]) {
    if (await pixTotpGenerate(secret, now + drift) === code) return true;
  }
  return false;
}

function pixTotpRandomSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return _base32Encode(bytes);
}

// ── Auth gate on load ──
(function() {
  document.addEventListener('DOMContentLoaded', () => {
    // Register SW for offline dashboard shell (best-effort)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('dashboard-sw.js').catch(e =>
        console.warn('[SW] register failed:', e.message));
    }
    // Restore persisted admin session
    try {
      const persisted = sessionStorage.getItem('pix_dash_admin');
      if (persisted) {
        _adminUser = JSON.parse(persisted);
        _renderAdminBadge();
        _resetInactivityTimer();
        initDashboard();
        return;
      }
    } catch (_) {}
    document.getElementById('dashAuthOverlay').style.display = 'flex';
    setTimeout(() => document.getElementById('dashAuthUser').focus(), 100);
  });
})();

// ── SUPABASE CONFIG ──
// Defaults come from dashboard-config.js (window.PIX_CONFIG). To rotate:
// edit dashboard-config.js only — never touch this file.
// Override per-browser: sessionStorage.setItem('pix_dash_url'/'pix_dash_key', ...)
const _DEFAULT_URL = (_CFG.SUPABASE_URL || '');
const _DEFAULT_KEY = (_CFG.SUPABASE_KEY || '');

// Migrate legacy localStorage creds (XSS hardening) — sessionStorage only from now on
(function migrateCreds() {
  try {
    const oldUrl = localStorage.getItem('pix_dash_url');
    const oldKey = localStorage.getItem('pix_dash_key');
    if (oldUrl && !sessionStorage.getItem('pix_dash_url')) sessionStorage.setItem('pix_dash_url', oldUrl);
    if (oldKey && !sessionStorage.getItem('pix_dash_key')) sessionStorage.setItem('pix_dash_key', oldKey);
    localStorage.removeItem('pix_dash_url');
    localStorage.removeItem('pix_dash_key');
  } catch (_) {}
})();
let SUPA_URL = sessionStorage.getItem('pix_dash_url') || _DEFAULT_URL;
let SUPA_KEY = sessionStorage.getItem('pix_dash_key') || _DEFAULT_KEY;
let dashMap = null;
let fieldLayers = [];
let techMarkers = [];  // GPS markers for online technicians
let _devicesCache = []; // Cached devices for cross-reference
let refreshTimer = null;
let activeTab = localStorage.getItem('pix_dash_tab') || 'tabPanel';
let orderGeoData = null; // Holds parsed GeoJSON for new order

// v1.1: charts + realtime + heatmap state
let _charts = {};                  // { samplesPerDay, topTechs, progressPerClient } Chart.js instances
let _heatLayer = null;             // Leaflet.heat layer
let _heatmapEnabled = false;
let _trackLayers = {};             // { fieldId: L.Polyline } — track GPS polylines
let _allTracksShown = false;
let _realtimeCh = null;            // Supabase Realtime channel
let _lastSyncedIds = new Set();    // to detect new rows for realtime
let _fieldsLastFetch = [];         // cache for filtering

// ═══════════════════════════════════════════════════
// TAB MANAGEMENT
// ═══════════════════════════════════════════════════

function showTab(tabId) {
  activeTab = tabId;
  localStorage.setItem('pix_dash_tab', tabId);

  // Update tab buttons + ARIA
  document.querySelectorAll('.nav-tab').forEach(btn => {
    const on = btn.dataset.tab === tabId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === tabId);
  });

  // Load data for the active tab
  if (tabId === 'tabPanel') {
    loadData();
    if (dashMap) setTimeout(() => dashMap.invalidateSize(), 100);
  } else if (tabId === 'tabOrdenes') {
    loadOrders();
  } else if (tabId === 'tabTecnicos') {
    loadTechnicians();
  } else if (tabId === 'tabDispositivos') {
    loadDevices();
  } else if (tabId === 'tabAdmins') {
    loadAdmins();
  } else if (tabId === 'tabAuditoria') {
    loadAudit();
  }
}

// ── INIT (called after auth) ──
function initDashboard() {
  if (SUPA_URL && SUPA_KEY) {
    showDashboard();
  } else {
    document.getElementById('setupPanel').style.display = 'block';
  }
}

// ── SETUP / CONNECT ──
async function connectSupabase() {
  const url = document.getElementById('setupUrl').value.trim().replace(/\/+$/, '');
  const key = document.getElementById('setupKey').value.trim();
  const errEl = document.getElementById('setupError');

  if (!url || !key) {
    errEl.textContent = 'Completa ambos campos';
    errEl.style.display = 'block';
    return;
  }

  try {
    const resp = await fetch(url + '/rest/v1/field_syncs?select=count', {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    // P0-5 fix: write to sessionStorage (matches read path on reload)
    sessionStorage.setItem('pix_dash_url', url);
    sessionStorage.setItem('pix_dash_key', key);
    SUPA_URL = url;
    SUPA_KEY = key;

    document.getElementById('setupPanel').style.display = 'none';
    showDashboard();
  } catch (e) {
    errEl.textContent = 'Error de conexion: ' + e.message;
    errEl.style.display = 'block';
  }
}

// ── SHOW DASHBOARD ──
function showDashboard() {
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('setupPanel').style.display = 'none';
  document.getElementById('navTabs').style.display = 'flex';

  // Init map
  if (!dashMap) {
    dashMap = L.map('dashMap', { zoomControl: true }).setView([-23.3, -51.1], 8);
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
      subdomains: '0123', maxZoom: 20, attribution: 'Google'
    }).addTo(dashMap);
  }

  // Restore active tab from localStorage
  showTab(activeTab);

  // v1.1: try realtime first; if it fails, poll as fallback
  enableRealtime();

  // Polling as safety net — realtime reloads are additive, not a replacement
  // (if WS drops, polling still kicks in; when WS recovers, it just debounces ahead)
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    // Skip polling if realtime is actively delivering events (WS open)
    if (_realtimeCh && _realtimeCh.readyState === 1) return;
    if (activeTab === 'tabPanel') loadData();
    else if (activeTab === 'tabOrdenes') loadOrders();
    else if (activeTab === 'tabDispositivos') loadDevices();
    else if (activeTab === 'tabTecnicos') loadTechnicians();
  }, 30000);

  setConnected(true);
}

// ═══════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════

async function supaFetch(path) {
  const resp = await fetch(SUPA_URL + '/rest/v1' + path, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

async function supaDelete(path) {
  const resp = await fetch(SUPA_URL + '/rest/v1' + path, {
    method: 'DELETE',
    headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
}

async function supaPost(path, body, method = 'POST') {
  const resp = await fetch(SUPA_URL + '/rest/v1' + path, {
    method,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + await resp.text());
  return resp.json();
}

// ═══════════════════════════════════════════════════
// PANEL TAB — Existing Dashboard Functions
// ═══════════════════════════════════════════════════

async function loadData() {
  try {
    const showAdmin = document.getElementById('activityShowAdmin')?.checked !== false;
    const [fields, activities, devices, auditEntries] = await Promise.all([
      supaFetch('/field_syncs?select=*&client=neq._ELIMINADO_&order=synced_at.desc'),
      supaFetch('/activity_log?select=*&order=created_at.desc&limit=30'),
      supaFetch('/devices?select=*&order=last_seen.desc'),
      showAdmin ? supaFetch('/audit_log?select=*&order=created_at.desc&limit=20').catch(() => []) : Promise.resolve([])
    ]);

    _devicesCache = devices || [];
    _fieldsLastFetch = fields || [];
    populateClientFilter(fields);
    renderStats(fields);
    renderTechs(fields);
    renderLeaderboard(fields);                          // v2.0
    renderFields(fields);
    renderMap(_fieldsFiltered.length ? _fieldsFiltered : fields);
    renderTechGPS(devices);
    renderActivity(activities, auditEntries);           // v2.0: merged
    renderCharts(_fieldsFiltered.length ? _fieldsFiltered : fields);
    updateFilterInfo();
    loadBoundaries();
    setConnected(true);

    const rtMode = _realtimeCh && _realtimeCh.readyState === 1 ? 'realtime' : 'polling 30s';
    document.getElementById('refreshBar').textContent =
      'Actualizado: ' + new Date().toLocaleTimeString('es') + ' — ' + rtMode;
  } catch (e) {
    console.error('[Dashboard] Load error:', e);
    setConnected(false);
    document.getElementById('refreshBar').textContent = 'Error: ' + e.message;
  }
}

// v2.0 — Full leaderboard
function renderLeaderboard(fields) {
  const el = document.getElementById('leaderboardList');
  if (!el) return;
  const byTech = {};
  for (const f of fields) {
    const t = f.technician || 'Sin nombre';
    if (!byTech[t]) byTech[t] = { samples: 0, fields: 0, conflicts: 0 };
    byTech[t].samples += f.samples?.length || 0;
    byTech[t].fields++;
    byTech[t].conflicts += f.conflicts_resolved || 0;
  }
  const ranked = Object.entries(byTech).sort((a, b) => b[1].samples - a[1].samples);
  if (ranked.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center">Sin datos</div>';
    return;
  }
  const max = ranked[0][1].samples || 1;
  el.innerHTML = ranked.map(([name, d], i) => {
    const pct = Math.round((d.samples / max) * 100);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
    return `<div class="leaderboard-row ${i===0?'top1':''}">
      <span class="leaderboard-rank">${medal}</span>
      <span><strong>${esc(name)}</strong> <small style="color:var(--muted)">· ${d.fields} campos${d.conflicts>0?' · ⚡'+d.conflicts:''}</small><div class="leaderboard-bar" style="margin-top:4px"><div class="leaderboard-bar-fill" style="width:${pct}%"></div></div></span>
      <span style="text-align:right;font-weight:700">${d.samples}</span>
      <span style="text-align:right;color:var(--muted);font-size:11px">muestras</span>
    </div>`;
  }).join('');
}

// ── RENDER STATS ──
function renderStats(fields) {
  const techs = [...new Set(fields.map(f => f.technician))];
  const totalSamples = fields.reduce((s, f) => s + (f.samples?.length || 0), 0);
  const totalPts = fields.reduce((s, f) => s + (f.total_points || 0), 0);
  const collPts = fields.reduce((s, f) => s + (f.collected_points || 0), 0);
  const pct = totalPts > 0 ? Math.round(collPts / totalPts * 100) : 0;
  // v1.1: sum of conflicts_resolved across all fields (from APK v3.17.1+)
  const totalConflicts = fields.reduce((s, f) => s + (f.conflicts_resolved || 0), 0);

  document.getElementById('statTechs').textContent = techs.length;
  document.getElementById('statFields').textContent = fields.length;
  document.getElementById('statSamples').textContent = totalSamples;
  document.getElementById('statProgress').textContent = pct + '%';
  // Conflict card — only visible when > 0
  const cCard = document.getElementById('statConflictsCard');
  if (cCard) {
    if (totalConflicts > 0) {
      cCard.style.display = '';
      document.getElementById('statConflicts').textContent = totalConflicts;
    } else {
      cCard.style.display = 'none';
    }
  }
}

// ── RENDER TECHNICIANS TABLE (Panel tab) ──
function renderTechs(fields) {
  const techMap = {};
  for (const f of fields) {
    const t = f.technician || 'Sin nombre';
    if (!techMap[t]) techMap[t] = { samples: 0, fields: 0, lastSync: null, conflicts: 0 };
    techMap[t].samples += f.samples?.length || 0;
    techMap[t].fields++;
    techMap[t].conflicts += f.conflicts_resolved || 0;  // v1.1
    const syncTime = f.synced_at ? new Date(f.synced_at) : null;
    if (syncTime && (!techMap[t].lastSync || syncTime > techMap[t].lastSync)) {
      techMap[t].lastSync = syncTime;
    }
  }

  const tbody = document.getElementById('techTable');
  tbody.innerHTML = Object.entries(techMap).map(([name, data]) => {
    const ago = data.lastSync ? timeAgo(data.lastSync) : 'Nunca';
    const recent = data.lastSync && (Date.now() - data.lastSync.getTime()) < 3600000;
    // v1.1: show conflict badge when a tech has had any conflict_resolved
    const conflict = data.conflicts > 0
      ? `<span class="conflict-badge" title="${data.conflicts} conflictos auto-resueltos en sync (otro tecnico trabajaba el mismo lote)">${data.conflicts}</span>`
      : '';
    return `<tr>
      <td><strong>${esc(name)}</strong>${conflict}</td>
      <td>${data.samples}</td>
      <td>${data.fields}</td>
      <td><span class="badge ${recent ? 'badge-green' : 'badge-yellow'}">${esc(ago)}</span></td>
    </tr>`;
  }).join('');
}

// ── RENDER FIELDS TABLE (with pagination + track button) ──
let _fieldsCache = [];
let _fieldsFiltered = [];
let _fieldsPage = 1;
const FIELDS_PER_PAGE = 10;

function renderFields(fields) {
  _fieldsCache = fields || [];
  _fieldsFiltered = applyFiltersToFields(_fieldsCache);
  _fieldsPage = 1;
  renderFieldsPage();
}

function renderFieldsPage() {
  const tbody = document.getElementById('fieldsTable');
  const start = (_fieldsPage - 1) * FIELDS_PER_PAGE;
  const pageItems = _fieldsFiltered.slice(start, start + FIELDS_PER_PAGE);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Sin campos con los filtros actuales</td></tr>';
    renderFieldsPagination();
    return;
  }

  tbody.innerHTML = pageItems.map(f => {
    const pct = f.progress_pct || 0;
    const color = pct >= 100 ? 'var(--green)' : pct > 50 ? 'var(--yellow)' : 'var(--red)';
    // v1.1: conflict badge + track button — aprovechan campos nuevos v3.17.1
    const conflictBadge = (f.conflicts_resolved && f.conflicts_resolved > 0)
      ? `<span class="conflict-badge" title="${f.conflicts_resolved} conflictos auto-resueltos en sync">${f.conflicts_resolved}</span>`
      : '';
    const hasTrack = f.track_count && f.track_count > 0;
    const trackBtn = hasTrack
      ? `<button class="track-btn" data-field-id="${esc(String(f.id))}" onclick="toggleFieldTrack('${esc(String(f.id))}')" title="Ver recorrido GPS del tecnico (${f.track_count} puntos)">🛰️ Track</button>`
      : '';
    return `<tr>
      <td><strong>${esc(f.field_name)}</strong>${conflictBadge}<br><small style="color:var(--muted)">${esc(f.project)}</small></td>
      <td>${esc(f.client || '—')}</td>
      <td>${f.area_ha ? f.area_ha + ' ha' : '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="progress-bar" style="flex:1"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
          <span style="font-size:12px;min-width:32px">${pct}%</span>
        </div>
        <small style="color:var(--muted)">${f.collected_points || 0}/${f.total_points || '?'} pts</small>
      </td>
      <td><small>${esc(f.technician)}</small></td>
      <td style="white-space:nowrap">${trackBtn} <button class="btn btn-sm btn-danger" onclick="deleteField('${esc(String(f.id))}', '${escJS(f.field_name)}')">X</button></td>
    </tr>`;
  }).join('');

  renderFieldsPagination();
}

function renderFieldsPagination() {
  const pagDiv = document.getElementById('fieldsPagination');
  if (!pagDiv) return;
  const total = _fieldsFiltered.length;
  const pages = Math.ceil(total / FIELDS_PER_PAGE) || 1;
  const from = total === 0 ? 0 : (_fieldsPage - 1) * FIELDS_PER_PAGE + 1;
  const to = Math.min(_fieldsPage * FIELDS_PER_PAGE, total);

  let html = `<span>Mostrando ${from}–${to} de ${total} campos</span><span>`;
  html += `<button onclick="changeFieldsPage(-1)" ${_fieldsPage === 1 ? 'disabled' : ''}>◄ Anterior</button>`;
  html += `<button class="active" disabled>${_fieldsPage} / ${pages}</button>`;
  html += `<button onclick="changeFieldsPage(1)" ${_fieldsPage === pages ? 'disabled' : ''}>Siguiente ►</button>`;
  html += `</span>`;
  pagDiv.innerHTML = html;
}

function changeFieldsPage(delta) {
  const pages = Math.ceil(_fieldsFiltered.length / FIELDS_PER_PAGE);
  _fieldsPage = Math.max(1, Math.min(pages, _fieldsPage + delta));
  renderFieldsPage();
}

function applyFiltersToFields(fields) {
  const fromEl = document.getElementById('filterDateFrom');
  const toEl = document.getElementById('filterDateTo');
  const clientEl = document.getElementById('filterClient');
  const from = fromEl && fromEl.value ? new Date(fromEl.value).getTime() : 0;
  const to = toEl && toEl.value ? new Date(toEl.value).getTime() + 86400000 : Infinity;
  const client = clientEl ? clientEl.value : '';
  return fields.filter(f => {
    const t = f.synced_at ? new Date(f.synced_at).getTime() : 0;
    if (t < from || t > to) return false;
    if (client && (f.client || '') !== client) return false;
    return true;
  });
}

async function deleteField(id, name) {
  if (!await pixConfirm('Eliminar campo "' + name + '" del dashboard?')) return;
  try {
    await supaPost('/field_syncs?id=eq.' + id, { client: '_ELIMINADO_' }, 'PATCH');
    toast('Campo "' + name + '" eliminado');
    loadData();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ── RENDER MAP ──
function renderMap(fields) {
  // Clear old layers
  fieldLayers.forEach(l => dashMap.removeLayer(l));
  fieldLayers = [];

  const bounds = [];

  for (const f of fields) {
    // Try to add boundary polygon
    if (f.boundary && f.boundary.features) {
      try {
        const pct = f.progress_pct || 0;
        const color = pct >= 100 ? '#7FD633' : pct > 50 ? '#F59E0B' : '#EF4444';
        const layer = L.geoJSON(f.boundary, {
          style: { color, weight: 2, fillColor: color, fillOpacity: 0.12 }
        }).bindPopup(`<b>${esc(f.field_name)}</b><br>${f.collected_points || 0} muestras<br>${pct}% completo<br><small>${esc(f.technician)}</small>`);
        layer.addTo(dashMap);
        fieldLayers.push(layer);
        bounds.push(layer.getBounds());
      } catch (e) { /* invalid geojson */ }
    }

    // Add sample points as small markers
    if (f.samples && f.samples.length > 0) {
      for (const s of f.samples) {
        if (s.lat && s.lng) {
          const marker = L.circleMarker([s.lat, s.lng], {
            radius: 4, color: '#7FD633', fillColor: '#7FD633', fillOpacity: 0.7, weight: 1
          }).bindPopup(`<b>${esc(s.pointName || '?')}</b><br>Zona ${s.zona || '?'}<br>${s.depth || '0-20'} cm<br><small>${esc(s.collector || '')}</small>`);
          marker.addTo(dashMap);
          fieldLayers.push(marker);
          bounds.push(L.latLng(s.lat, s.lng));
        }
      }
    }
  }

  // Fit bounds
  if (bounds.length > 0) {
    try {
      const group = L.featureGroup(fieldLayers.filter(l => l.getBounds));
      if (group.getLayers().length > 0) dashMap.fitBounds(group.getBounds().pad(0.1));
      else if (bounds[0].lat) dashMap.setView(bounds[0], 14);
    } catch (e) {
      // fallback: center on first sample
      const firstSample = fields.flatMap(f => f.samples || []).find(s => s.lat);
      if (firstSample) dashMap.setView([firstSample.lat, firstSample.lng], 14);
    }
  }
}

// ── RENDER TECH GPS MARKERS ON MAP (with proximity clustering) ──
function renderTechGPS(devices) {
  // Clear old tech markers
  techMarkers.forEach(m => dashMap.removeLayer(m));
  techMarkers = [];
  if (!devices || !dashMap) return;

  const onlineBounds = [];

  // Collect all tech points first
  const points = [];
  for (const d of devices) {
    let lat = null, lng = null;
    if (d.last_location && typeof d.last_location === 'object' && d.last_location.lat) {
      lat = d.last_location.lat; lng = d.last_location.lng;
    } else if (d.last_lat && d.last_lng) {
      lat = d.last_lat; lng = d.last_lng;
    }
    if (!lat || !lng) continue;
    const lastSeen = d.last_seen ? new Date(d.last_seen) : null;
    const isOnline = lastSeen && (Date.now() - lastSeen.getTime()) < ONE_HOUR;
    points.push({
      lat, lng,
      name: d.technician_name || d.technician || 'Sin nombre',
      isOnline, lastSeen,
      model: d.phone_model || '—', version: d.app_version || '?'
    });
  }

  // P2-23: simple proximity clustering — if zoom < 12 and 2+ points within ~80px,
  // render a single cluster marker showing the count
  const zoom = dashMap.getZoom();
  const clusterThresholdPx = 50;
  const clusters = [];
  const used = new Set();
  if (zoom < 12 && points.length > 1) {
    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      const group = [i];
      const pi = dashMap.latLngToContainerPoint([points[i].lat, points[i].lng]);
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;
        const pj = dashMap.latLngToContainerPoint([points[j].lat, points[j].lng]);
        if (pi.distanceTo(pj) < clusterThresholdPx) {
          group.push(j);
          used.add(j);
        }
      }
      used.add(i);
      clusters.push(group);
    }
  } else {
    for (let i = 0; i < points.length; i++) clusters.push([i]);
  }

  for (const grp of clusters) {
    if (grp.length === 1) {
      const p = points[grp[0]];
      const color = p.isOnline ? '#3B82F6' : '#64748B';
      const ago = p.lastSeen ? timeAgo(p.lastSeen) : 'Desconocido';
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: p.isOnline ? 9 : 6,
        color: '#fff', weight: 2,
        fillColor: color, fillOpacity: p.isOnline ? 0.9 : 0.5
      }).bindPopup(
        `<b>${esc(p.name)}</b><br>` +
        `<span style="color:${p.isOnline ? '#22C55E' : '#EF4444'}">${p.isOnline ? '🟢 Online' : '🔴 Offline'}</span><br>` +
        `📱 ${esc(p.model)}<br>📡 v${esc(p.version)}<br>🕐 ${ago}<br>` +
        `📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
      ).bindTooltip(p.name, { permanent: p.isOnline, direction: 'top', offset: [0, -10], className: 'tech-tooltip' });
      marker.addTo(dashMap);
      techMarkers.push(marker);
      if (p.isOnline) onlineBounds.push(L.latLng(p.lat, p.lng));
    } else {
      // Cluster: average position, badge with count
      const avgLat = grp.reduce((s, idx) => s + points[idx].lat, 0) / grp.length;
      const avgLng = grp.reduce((s, idx) => s + points[idx].lng, 0) / grp.length;
      const onlineCount = grp.filter(idx => points[idx].isOnline).length;
      const names = grp.map(idx => points[idx].name).join('<br>');
      const cluster = L.marker([avgLat, avgLng], {
        icon: L.divIcon({
          className: 'tech-cluster',
          html: `<div style="background:${onlineCount>0?'#3B82F6':'#64748B'};color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:13px">${grp.length}</div>`,
          iconSize: [36, 36], iconAnchor: [18, 18]
        })
      }).bindPopup(`<b>${grp.length} técnicos</b> (${onlineCount} online)<br><small>${names}</small><br><small style="color:#666">Acercá zoom para separar</small>`);
      cluster.on('click', () => {
        dashMap.setView([avgLat, avgLng], Math.min(16, dashMap.getZoom() + 3));
      });
      cluster.addTo(dashMap);
      techMarkers.push(cluster);
      if (onlineCount > 0) onlineBounds.push(L.latLng(avgLat, avgLng));
    }
  }
  // Re-cluster on zoom change
  if (!dashMap._techGPSZoomHook) {
    dashMap._techGPSZoomHook = true;
    dashMap.on('zoomend', () => { if (_devicesCache) renderTechGPS(_devicesCache); });
  }

  // Extend map view to include online technicians
  if (onlineBounds.length > 0) {
    try {
      // Combine with existing field layers
      const allBounds = L.latLngBounds(onlineBounds);
      fieldLayers.forEach(l => {
        try { if (l.getBounds) allBounds.extend(l.getBounds()); } catch(_){}
      });
      dashMap.fitBounds(allBounds.pad(0.1));
    } catch (e) {
      // Fallback: center on first online tech
      dashMap.setView(onlineBounds[0], 15);
    }
  }
}

// ── RENDER ACTIVITY (merged: tech sync events + admin audit log) ──
function renderActivity(activities, auditEntries) {
  const el = document.getElementById('activityList');
  // Normalize both into common shape: { ts, who, kind, text, isAdmin }
  const normalized = [];
  for (const a of (activities || [])) {
    const d = a.details || {};
    const text = a.action === 'sync'
      ? `<strong>${esc(a.technician)}</strong> sincronizó <strong>${esc(d.field || '?')}</strong> (${d.samples || 0} muestras)`
      : `<strong>${esc(a.technician)}</strong>: ${esc(a.action)}`;
    normalized.push({ ts: new Date(a.created_at), who: a.technician || '?', text, isAdmin: false });
  }
  for (const a of (auditEntries || [])) {
    const tgt = a.target_name || a.target_id || '';
    const text = `<strong style="color:var(--yellow)">🛡️ ${esc(a.admin_user)}</strong> · ${esc(a.action)}${tgt ? ' → ' + esc(tgt) : ''}`;
    normalized.push({ ts: new Date(a.created_at), who: a.admin_user, text, isAdmin: true });
  }
  normalized.sort((a, b) => b.ts - a.ts);
  const top = normalized.slice(0, 50);
  if (top.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px;text-align:center">Sin actividad registrada</div>';
    return;
  }
  el.innerHTML = top.map(a => `<div class="activity-item" ${a.isAdmin ? 'style="background:rgba(245,158,11,0.04)"' : ''}>
    <span class="activity-time">${a.ts.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'})}</span>
    <span class="activity-text">${a.text}</span>
  </div>`).join('');
}

// ═══════════════════════════════════════════════════
// PERIMETROS — Independent Boundary Management
// ═══════════════════════════════════════════════════

let _boundariesCache = [];

async function loadBoundaries() {
  try {
    const data = await supaFetch('/field_syncs?select=project,field_name,area_ha,boundary,technician,synced_at&boundary=not.is.null&order=synced_at.desc');
    _boundariesCache = data || [];
    renderBoundaries(_boundariesCache);
  } catch (e) {
    console.warn('[Dashboard] Load boundaries:', e.message);
  }
}

function renderBoundaries(boundaries) {
  const tbody = document.getElementById('boundariesTable');
  if (!tbody) return;
  if (!boundaries || boundaries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Sin perimetros registrados</td></tr>';
    return;
  }
  tbody.innerHTML = boundaries.map((b, i) => {
    const date = b.synced_at ? new Date(b.synced_at).toLocaleDateString('es') : '—';
    const area = b.area_ha ? Number(b.area_ha).toFixed(2) : '—';
    return `<tr>
      <td><strong>${esc(b.field_name)}</strong></td>
      <td>${esc(b.project)}</td>
      <td>${area}</td>
      <td>${esc(b.technician || '—')}</td>
      <td><small>${date}</small></td>
      <td>
        <button class="btn btn-outline" onclick="downloadBoundary(${i})" style="padding:2px 8px;font-size:11px">📐 GeoJSON</button>
      </td>
    </tr>`;
  }).join('');
}

function downloadBoundary(index) {
  const b = _boundariesCache[index];
  if (!b || !b.boundary) return;
  const geojson = typeof b.boundary === 'string' ? b.boundary : JSON.stringify(b.boundary, null, 2);
  const name = `perimetro_${b.project}_${b.field_name}.geojson`.replace(/\s+/g, '_');
  const blob = new Blob([geojson], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  toast('Descargado: ' + name, 'success');
}

function downloadAllBoundaries() {
  if (!_boundariesCache || _boundariesCache.length === 0) {
    toast('No hay perimetros para descargar', 'warning');
    return;
  }
  // Merge all boundaries into a single FeatureCollection
  const allFeatures = [];
  for (const b of _boundariesCache) {
    if (!b.boundary) continue;
    const geo = typeof b.boundary === 'string' ? JSON.parse(b.boundary) : b.boundary;
    if (geo.type === 'FeatureCollection' && geo.features) {
      for (const f of geo.features) {
        f.properties = {
          ...(f.properties || {}),
          project: b.project,
          field: b.field_name,
          area_ha: b.area_ha,
          technician: b.technician,
          synced_at: b.synced_at
        };
        allFeatures.push(f);
      }
    } else if (geo.type === 'Feature') {
      geo.properties = { ...(geo.properties || {}), project: b.project, field: b.field_name, area_ha: b.area_ha };
      allFeatures.push(geo);
    }
  }
  const merged = { type: 'FeatureCollection', features: allFeatures };
  const content = JSON.stringify(merged, null, 2);
  const today = new Date().toISOString().slice(0, 10);
  const name = `perimetros_todos_${today}.geojson`;
  const blob = new Blob([content], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  toast(`${allFeatures.length} perimetros descargados: ${name}`, 'success');
}

// ═══════════════════════════════════════════════════
// v1.1 — FILTERS + CHARTS + REALTIME + HEATMAP + TRACKS + PDF
// ═══════════════════════════════════════════════════

function applyFilters() {
  if (!_fieldsCache || _fieldsCache.length === 0) return;
  _fieldsFiltered = applyFiltersToFields(_fieldsCache);
  _fieldsPage = 1;
  renderFieldsPage();
  renderCharts(_fieldsFiltered);
  renderMap(_fieldsFiltered);
  updateFilterInfo();
}

function clearFilters() {
  const f = document.getElementById('filterDateFrom');
  const t = document.getElementById('filterDateTo');
  const c = document.getElementById('filterClient');
  if (f) f.value = '';
  if (t) t.value = '';
  if (c) c.value = '';
  applyFilters();
}

function updateFilterInfo() {
  const info = document.getElementById('filterInfo');
  if (!info) return;
  const total = _fieldsCache.length, filt = _fieldsFiltered.length;
  if (total === filt) info.textContent = `${total} campos`;
  else info.textContent = `${filt} de ${total} campos (filtrado)`;
}

function populateClientFilter(fields) {
  const sel = document.getElementById('filterClient');
  if (!sel) return;
  const current = sel.value;
  const clients = [...new Set(fields.map(f => f.client).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos</option>' +
    clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (current && clients.includes(current)) sel.value = current;
}

// ── CHARTS (Chart.js) ──────────────────────────────
function renderCharts(fields) {
  if (typeof Chart === 'undefined') return;
  renderChartSamplesPerDay(fields);
  renderChartTopTechs(fields);
  renderChartProgressPerClient(fields);
}

const _chartBaseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#94A3B8', font: { size: 10 } } }
  },
  scales: {
    x: { ticks: { color: '#94A3B8', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
    y: { ticks: { color: '#94A3B8', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
  }
};

function renderChartSamplesPerDay(fields) {
  const byDay = {};
  const today = new Date();
  today.setHours(0,0,0,0);
  // last 30 days — zero-fill
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    byDay[k] = 0;
  }
  for (const f of fields) {
    if (!f.samples || !Array.isArray(f.samples)) continue;
    for (const s of f.samples) {
      const k = (s.collectedAt || f.synced_at || '').slice(0, 10);
      if (byDay[k] !== undefined) byDay[k]++;
    }
  }
  const labels = Object.keys(byDay).map(d => d.slice(5)); // MM-DD
  const data = Object.values(byDay);

  const ctx = document.getElementById('chartSamplesPerDay');
  if (!ctx) return;
  if (_charts.samplesPerDay) _charts.samplesPerDay.destroy();
  _charts.samplesPerDay = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Muestras',
        data,
        borderColor: '#7FD633',
        backgroundColor: 'rgba(127,214,51,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointBackgroundColor: '#7FD633',
        borderWidth: 2
      }]
    },
    options: _chartBaseOpts
  });
}

function renderChartTopTechs(fields) {
  const byTech = {};
  for (const f of fields) {
    const t = f.technician || 'Sin nombre';
    byTech[t] = (byTech[t] || 0) + (f.samples?.length || 0);
  }
  const sorted = Object.entries(byTech).sort((a,b) => b[1]-a[1]).slice(0, 5);
  const labels = sorted.map(e => e[0].length > 14 ? e[0].slice(0,13)+'…' : e[0]);
  const data = sorted.map(e => e[1]);
  const colors = ['#7FD633','#0D9488','#3B82F6','#F59E0B','#EF4444'];

  const ctx = document.getElementById('chartTopTechs');
  if (!ctx) return;
  if (_charts.topTechs) _charts.topTechs.destroy();
  _charts.topTechs = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, data.length), borderRadius: 4 }] },
    options: { ..._chartBaseOpts, indexAxis: 'y', plugins: { legend: { display: false } } }
  });
}

function renderChartProgressPerClient(fields) {
  const byClient = {};
  for (const f of fields) {
    const c = f.client || 'Sin cliente';
    if (!byClient[c]) byClient[c] = { collected: 0, total: 0 };
    byClient[c].collected += f.collected_points || 0;
    byClient[c].total += f.total_points || 0;
  }
  const entries = Object.entries(byClient).sort((a,b) => b[1].total - a[1].total).slice(0, 6);
  const labels = entries.map(e => e[0].length > 16 ? e[0].slice(0,15)+'…' : e[0]);
  const pct = entries.map(e => e[1].total > 0 ? Math.round(e[1].collected / e[1].total * 100) : 0);

  const ctx = document.getElementById('chartProgressPerClient');
  if (!ctx) return;
  if (_charts.progressPerClient) _charts.progressPerClient.destroy();
  _charts.progressPerClient = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: pct,
        backgroundColor: ['#7FD633','#0D9488','#3B82F6','#F59E0B','#EF4444','#8B5CF6'],
        borderColor: '#162236',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94A3B8', font: { size: 10 }, boxWidth: 10 } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${c.parsed}%` } }
      }
    }
  });
}

// ── TRACKS (GPS breadcrumbs per field) ────────────
function toggleFieldTrack(fieldId) {
  if (!dashMap) return;
  if (_trackLayers[fieldId]) {
    dashMap.removeLayer(_trackLayers[fieldId]);
    delete _trackLayers[fieldId];
    document.querySelectorAll(`[data-field-id="${fieldId}"]`).forEach(b => b.classList.remove('active'));
    return;
  }
  const f = _fieldsCache.find(x => String(x.id) === String(fieldId));
  if (!f || !f.track_positions || !Array.isArray(f.track_positions) || f.track_positions.length === 0) {
    toast('Este campo no tiene track GPS registrado', 'warn');
    return;
  }
  const latlngs = f.track_positions
    .filter(p => p && isFinite(p.lat) && isFinite(p.lng))
    .map(p => [p.lat, p.lng]);
  if (latlngs.length < 2) { toast('Track insuficiente para dibujar', 'warn'); return; }

  const poly = L.polyline(latlngs, {
    color: '#F59E0B',
    weight: 3,
    opacity: 0.85,
    dashArray: '6 4'
  }).addTo(dashMap);
  const startM = L.circleMarker(latlngs[0], { radius: 5, color: '#22C55E', fillColor: '#22C55E', fillOpacity: 1 }).bindTooltip('Inicio').addTo(dashMap);
  const endM = L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#EF4444', fillColor: '#EF4444', fillOpacity: 1 }).bindTooltip('Fin').addTo(dashMap);

  _trackLayers[fieldId] = L.layerGroup([poly, startM, endM]).addTo(dashMap);
  try { dashMap.fitBounds(poly.getBounds().pad(0.1)); } catch(_){}
  document.querySelectorAll(`[data-field-id="${fieldId}"]`).forEach(b => b.classList.add('active'));
  toast(`Track GPS de ${esc(f.field_name)} mostrado (${latlngs.length} puntos)`, 'success');
}

function toggleAllTracks() {
  if (!_fieldsCache || _fieldsCache.length === 0) return;
  if (_allTracksShown) {
    Object.keys(_trackLayers).forEach(id => {
      if (_trackLayers[id]) dashMap.removeLayer(_trackLayers[id]);
      delete _trackLayers[id];
    });
    document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('active'));
    _allTracksShown = false;
    toast('Tracks ocultos', 'info');
  } else {
    let shown = 0;
    for (const f of _fieldsCache) {
      if (f.track_positions && Array.isArray(f.track_positions) && f.track_positions.length >= 2) {
        toggleFieldTrack(String(f.id));
        shown++;
      }
    }
    _allTracksShown = true;
    toast(shown > 0 ? `${shown} tracks GPS mostrados` : 'No hay tracks en los campos cargados', shown > 0 ? 'success' : 'warn');
  }
}

// ── HEATMAP (Leaflet.heat) ────────────────────────
function toggleHeatmap() {
  if (!dashMap || typeof L.heatLayer !== 'function') return;
  if (_heatmapEnabled) {
    if (_heatLayer) dashMap.removeLayer(_heatLayer);
    _heatmapEnabled = false;
    document.getElementById('toggleHeatBtn')?.classList.remove('active');
    toast('Heatmap oculto', 'info');
    return;
  }
  const points = [];
  for (const f of (_fieldsFiltered.length ? _fieldsFiltered : _fieldsCache)) {
    if (!f.samples) continue;
    for (const s of f.samples) {
      if (s.lat && s.lng) points.push([s.lat, s.lng, 0.5]);
    }
  }
  if (points.length === 0) { toast('Sin puntos para el heatmap', 'warn'); return; }
  _heatLayer = L.heatLayer(points, { radius: 25, blur: 20, maxZoom: 17 }).addTo(dashMap);
  _heatmapEnabled = true;
  document.getElementById('toggleHeatBtn')?.classList.add('active');
  toast(`Heatmap activo (${points.length} puntos)`, 'success');
}

// ── REALTIME (Supabase WebSocket) ──────────────────
function enableRealtime() {
  if (!SUPA_URL || !SUPA_KEY) return;
  if (_realtimeCh) return;
  try {
    const wsUrl = SUPA_URL.replace(/^https/, 'wss') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(SUPA_KEY) + '&vsn=1.0.0';
    const ws = new WebSocket(wsUrl);
    let heartbeat = null;

    ws.onopen = () => {
      console.log('[Realtime] connected');
      // Subscribe to field_syncs + activity_log + devices
      ws.send(JSON.stringify({
        topic: 'realtime:public:field_syncs', event: 'phx_join', payload: {}, ref: '1'
      }));
      ws.send(JSON.stringify({
        topic: 'realtime:public:activity_log', event: 'phx_join', payload: {}, ref: '2'
      }));
      ws.send(JSON.stringify({
        topic: 'realtime:public:devices', event: 'phx_join', payload: {}, ref: '3'
      }));
      heartbeat = setInterval(() => {
        try { ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '0' })); } catch(_){}
      }, 25000);
      const ind = document.getElementById('rtIndicator');
      if (ind) { ind.classList.add('on'); document.getElementById('rtLabel').textContent = 'Realtime'; }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') {
          // Debounce: reload after 500ms of quiescence
          if (_realtimeReloadTimer) clearTimeout(_realtimeReloadTimer);
          _realtimeReloadTimer = setTimeout(() => {
            if (activeTab === 'tabPanel') loadData();
            else if (activeTab === 'tabOrdenes') loadOrders();
            else if (activeTab === 'tabDispositivos') loadDevices();
            else if (activeTab === 'tabTecnicos') loadTechnicians();
          }, 500);
        }
      } catch(_){}
    };

    ws.onerror = (e) => console.warn('[Realtime] error:', e);
    ws.onclose = () => {
      console.log('[Realtime] disconnected — falling back to polling');
      if (heartbeat) clearInterval(heartbeat);
      _realtimeCh = null;
      const ind = document.getElementById('rtIndicator');
      if (ind) { ind.classList.remove('on'); document.getElementById('rtLabel').textContent = 'Polling'; }
      // auto-retry in 10s
      setTimeout(enableRealtime, 10000);
    };

    _realtimeCh = ws;
  } catch (e) {
    console.warn('[Realtime] setup failed, keeping polling:', e.message);
  }
}
let _realtimeReloadTimer = null;

// ── PDF EXPORT (html2pdf.js) ─────────────────────
function exportDashboardPDF() {
  if (typeof html2pdf === 'undefined') { toast('html2pdf no cargado', 'err'); return; }
  const panel = document.getElementById('tabPanel');
  if (!panel || !panel.classList.contains('active')) {
    toast('Cambia al tab Panel primero', 'warn');
    return;
  }
  document.body.classList.add('pdf-exporting');
  const today = new Date().toISOString().slice(0, 10);
  const opt = {
    margin: [10, 8, 10, 8],
    filename: `PIX-Muestreo-Dashboard-${today}.pdf`,
    image: { type: 'jpeg', quality: 0.92 },
    html2canvas: { scale: 2, backgroundColor: '#0F1B2D', useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
    pagebreak: { mode: ['avoid-all', 'css'] }
  };
  toast('Generando PDF...', 'info');
  html2pdf().set(opt).from(panel).save().then(() => {
    document.body.classList.remove('pdf-exporting');
    toast('PDF exportado', 'success');
  }).catch(err => {
    document.body.classList.remove('pdf-exporting');
    console.error('[PDF] export error:', err);
    toast('Error exportando PDF: ' + err.message, 'err');
  });
}

// ═══════════════════════════════════════════════════
// ORDENES TAB — Service Orders
// ═══════════════════════════════════════════════════

function toggleOrderForm(reset) {
  const panel = document.getElementById('orderFormPanel');
  const isOpen = panel.classList.contains('show');
  if (isOpen || reset === false) {
    panel.classList.remove('show');
    clearOrderForm();
  } else {
    panel.classList.add('show');
    populateOrderTechDropdown();
  }
}

function clearOrderForm() {
  document.getElementById('orderEditId').value = '';
  document.getElementById('orderTitle').value = '';
  document.getElementById('orderProject').value = '';
  document.getElementById('orderClient').value = '';
  document.getElementById('orderDesc').value = '';
  document.getElementById('orderTechnician').value = '';
  document.getElementById('orderPriority').value = 'normal';
  document.getElementById('orderDeadline').value = '';
  document.getElementById('orderNotes').value = '';
  document.getElementById('orderFile').value = '';
  document.getElementById('orderFilePreview').textContent = '';
  document.getElementById('orderFileZone').classList.remove('has-file');
  document.getElementById('orderFormTitle').textContent = 'Nueva Orden de Servicio';
  document.getElementById('orderSubmitBtn').textContent = 'Crear Orden';
  orderGeoData = null;
}

async function populateOrderTechDropdown() {
  try {
    const techs = await supaFetch('/technicians?select=id,full_name&active=eq.true&order=full_name.asc');
    const sel = document.getElementById('orderTechnician');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Seleccionar --</option>' +
      techs.map(t => `<option value="${esc(t.id)}">${esc(t.full_name)}</option>`).join('');
    if (currentVal) sel.value = currentVal;
  } catch (e) {
    console.warn('[Orders] Could not load technicians for dropdown:', e.message);
  }
}

function handleGeoFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let data;
      const text = e.target.result;

      if (file.name.endsWith('.kml')) {
        // Basic KML parsing: extract coordinates
        const parser = new DOMParser();
        const kml = parser.parseFromString(text, 'text/xml');
        const placemarks = kml.querySelectorAll('Placemark');
        const features = [];
        placemarks.forEach(pm => {
          const name = pm.querySelector('name')?.textContent || '';
          const coords = pm.querySelector('coordinates');
          if (coords) {
            const pts = coords.textContent.trim().split(/\s+/).map(c => {
              const [lng, lat, alt] = c.split(',').map(Number);
              return [lng, lat];
            }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
            if (pts.length === 1) {
              features.push({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: pts[0] } });
            } else if (pts.length > 2) {
              // Close polygon ring if not already closed (RFC 7946)
              const first = pts[0], last = pts[pts.length - 1];
              if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
              features.push({ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [pts] } });
            }
          }
        });
        data = { type: 'FeatureCollection', features };
      } else {
        data = JSON.parse(text);
      }

      // Validate GeoJSON structure
      if (!data || !data.features) {
        if (data.type === 'Feature') {
          data = { type: 'FeatureCollection', features: [data] };
        } else {
          throw new Error('No es un GeoJSON valido');
        }
      }

      orderGeoData = data;

      // Compute stats
      let points = 0, polygons = 0, totalArea = 0;
      for (const feat of data.features) {
        const gType = feat.geometry?.type;
        if (gType === 'Point' || gType === 'MultiPoint') points++;
        else if (gType === 'Polygon' || gType === 'MultiPolygon') {
          polygons++;
          if (feat.properties?.area_ha) totalArea += parseFloat(feat.properties.area_ha);
        }
      }

      const zone = document.getElementById('orderFileZone');
      zone.classList.add('has-file');
      const preview = document.getElementById('orderFilePreview');
      let info = `${file.name} — ${data.features.length} features`;
      if (polygons > 0) info += `, ${polygons} poligonos`;
      if (points > 0) info += `, ${points} puntos`;
      if (totalArea > 0) info += `, ${totalArea.toFixed(1)} ha`;
      preview.textContent = info;

    } catch (err) {
      orderGeoData = null;
      document.getElementById('orderFileZone').classList.remove('has-file');
      document.getElementById('orderFilePreview').textContent = 'Error: ' + err.message;
      document.getElementById('orderFilePreview').style.color = 'var(--red)';
      setTimeout(() => {
        document.getElementById('orderFilePreview').style.color = '';
        document.getElementById('orderFilePreview').textContent = '';
      }, 3000);
    }
  };
  reader.readAsText(file);
}

// Transform raw GeoJSON FeatureCollection into APK-compatible field_data
// APK expects: { fields: [{ name, boundary, points, zones, area_ha }] }
function transformGeoToFieldData(geoFC) {
  if (!geoFC || !geoFC.features || geoFC.features.length === 0) return null;

  const polygons = geoFC.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
  const pointFeats = geoFC.features.filter(f => f.geometry && f.geometry.type === 'Point');

  // Helper: check if point is roughly inside polygon bbox (simplified containment)
  function pointInBBox(pt, poly) {
    const coords = poly.geometry.type === 'Polygon' ? poly.geometry.coordinates[0] : poly.geometry.coordinates[0][0];
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of coords) { minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]); minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]); }
    return pt[0] >= minLng && pt[0] <= maxLng && pt[1] >= minLat && pt[1] <= maxLat;
  }

  // Helper: approx area in ha from polygon coordinates using Shoelace formula
  function approxAreaHa(coords) {
    const ring = coords[0] || [];
    if (ring.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      area += ring[i][0] * ring[j][1];
      area -= ring[j][0] * ring[i][1];
    }
    area = Math.abs(area) / 2;
    // Convert degree² to m² (rough at equator: 1 deg ≈ 111320 m)
    const midLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    const mPerDegLat = 110540;
    const areaM2 = area * mPerDegLng * mPerDegLat;
    return Math.round(areaM2 / 10000 * 100) / 100; // ha with 2 decimals
  }

  const fields = [];

  if (polygons.length > 0) {
    // Each polygon is a field; assign points by zona property first, then bbox fallback
    const usedPoints = new Set();
    // Check if polygons have zona properties (management zones GeoJSON)
    const hasZonaProp = polygons.some(p => p.properties?.zona != null || p.properties?.zone != null);

    polygons.forEach((poly, idx) => {
      const name = poly.properties?.name || poly.properties?.Name || `Campo ${idx + 1}`;
      const polyZona = poly.properties?.zona ?? poly.properties?.zone ?? null;
      const areaHa = poly.properties?.area_ha || approxAreaHa(
        poly.geometry.type === 'Polygon' ? poly.geometry.coordinates : poly.geometry.coordinates[0]
      );
      const fieldPoints = [];
      pointFeats.forEach((pf, pi) => {
        if (usedPoints.has(pi)) return;
        const ptZona = pf.properties?.zona ?? pf.properties?.zone ?? null;
        // Priority: match by zona property when both polygon and point have it
        if (hasZonaProp && polyZona != null && ptZona != null) {
          if (String(ptZona) === String(polyZona)) {
            fieldPoints.push(pf);
            usedPoints.add(pi);
          }
        } else if (pointInBBox(pf.geometry.coordinates, poly)) {
          // Fallback: bbox containment when no zona properties
          fieldPoints.push(pf);
          usedPoints.add(pi);
        }
      });
      const zonesSet = new Set(fieldPoints.map(p => p.properties?.zona || p.properties?.zone || 1));
      fields.push({
        name,
        boundary: poly.geometry,
        area_ha: areaHa,
        zones: zonesSet.size || 1,
        zona: polyZona,
        clase: poly.properties?.clase || poly.properties?.class || '',
        color: poly.properties?.color || poly.properties?.fill || null,
        points: { type: 'FeatureCollection', features: fieldPoints }
      });
    });
    // Remaining unassigned points go to last field
    const remainingPts = pointFeats.filter((_, i) => !usedPoints.has(i));
    if (remainingPts.length > 0 && fields.length > 0) {
      fields[fields.length - 1].points.features.push(...remainingPts);
    }
  } else if (pointFeats.length > 0) {
    // No polygons — all points become one field
    const zonesSet = new Set(pointFeats.map(p => p.properties?.zona || p.properties?.zone || 1));
    fields.push({
      name: 'Campo 1',
      boundary: null,
      area_ha: 0,
      zones: zonesSet.size || 1,
      points: { type: 'FeatureCollection', features: pointFeats }
    });
  }

  if (fields.length === 0) return null;
  return { fields };
}

async function submitOrder() {
  const title = document.getElementById('orderTitle').value.trim();
  if (!title) { toast('El titulo es obligatorio', 'err'); return; }

  const editId = document.getElementById('orderEditId').value;

  // Resolve technician name from dropdown (BUG FIX: APK needs assigned_to_name)
  const techSelect = document.getElementById('orderTechnician');
  const techId = techSelect.value || null;
  const techName = techId && techSelect.selectedIndex > 0
    ? techSelect.options[techSelect.selectedIndex].text : null;

  // Transform GeoJSON to APK-compatible { fields: [...] } format
  // If editing, data may already be in { fields: [...] } format — don't re-transform
  const fieldData = orderGeoData
    ? (orderGeoData.fields ? orderGeoData : transformGeoToFieldData(orderGeoData))
    : null;

  const body = {
    title: title,
    project: document.getElementById('orderProject').value.trim() || null,
    client: document.getElementById('orderClient').value.trim() || null,
    description: document.getElementById('orderDesc').value.trim() || null,
    assigned_to: techId,
    assigned_to_name: techName,
    priority: document.getElementById('orderPriority').value,
    deadline: document.getElementById('orderDeadline').value || null,
    notes: document.getElementById('orderNotes').value.trim() || null,
    field_data: fieldData,
    total_fields: fieldData ? fieldData.fields.length : 0,
    total_points: fieldData ? fieldData.fields.reduce((s, f) => s + (f.points?.features?.length || 0), 0) : 0
  };

  const btn = document.getElementById('orderSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  // P1-16: validate technician is active before assigning
  if (techId) {
    try {
      const techCheck = await supaFetch('/technicians?id=eq.' + techId + '&select=active,full_name');
      if (!techCheck || techCheck.length === 0) {
        toast('El técnico seleccionado no existe', 'err');
        btn.disabled = false; btn.textContent = editId ? 'Actualizar Orden' : 'Crear Orden';
        return;
      }
      if (!techCheck[0].active) {
        const ok = await pixConfirm(`El técnico "${techCheck[0].full_name}" está inactivo.\n\n¿Asignar igualmente?`);
        if (!ok) {
          btn.disabled = false; btn.textContent = editId ? 'Actualizar Orden' : 'Crear Orden';
          return;
        }
      }
    } catch (_) { /* non-fatal */ }
  }

  try {
    if (editId) {
      body.updated_at = new Date().toISOString();
      await supaPost('/service_orders?id=eq.' + editId, body, 'PATCH');
      _logAudit({ action: 'update_order', target_type: 'order', target_id: editId, target_name: title });
      toast('Orden actualizada');
    } else {
      // If a technician is assigned at creation, mark as 'asignada' (not 'pendiente')
      body.status = techId ? 'asignada' : 'pendiente';
      body.created_at = new Date().toISOString();
      const created = await supaPost('/service_orders', body);
      const newId = created && created[0] && created[0].id;
      _logAudit({ action: 'create_order', target_type: 'order', target_id: newId, target_name: title, details: { tech_id: techId, priority: body.priority } });
      toast(techId ? 'Orden creada y asignada' : 'Orden creada');
    }
    toggleOrderForm(false);
    loadOrders();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = editId ? 'Actualizar Orden' : 'Crear Orden';
  }
}

let _ordersAll = [];
let _ordersPage = 1;
const ORDERS_PER_PAGE = 15;

async function loadOrders() {
  try {
    const orders = await supaFetch('/service_orders?select=*&status=neq.cancelada&order=created_at.desc');
    _ordersAll = orders || [];
    _ordersPage = 1;
    renderOrdersPage();
  } catch (e) {
    console.error('[Orders] Load error:', e);
    document.getElementById('ordersTableBody').innerHTML =
      `<tr><td colspan="9" style="text-align:center;color:var(--red);padding:20px">Error: ${esc(e.message)}</td></tr>`;
  }
}

function renderOrdersPage() {
  const start = (_ordersPage - 1) * ORDERS_PER_PAGE;
  const slice = _ordersAll.slice(start, start + ORDERS_PER_PAGE);
  renderOrders(slice);
  const total = _ordersAll.length;
  const pages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));
  const pag = document.getElementById('ordersPagination');
  if (pag) {
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(start + ORDERS_PER_PAGE, total);
    pag.innerHTML = `<span>Mostrando ${from}–${to} de ${total}</span>` +
      `<span><button onclick="changeOrdersPage(-1)" ${_ordersPage===1?'disabled':''}>◄</button>` +
      `<button class="active" disabled>${_ordersPage} / ${pages}</button>` +
      `<button onclick="changeOrdersPage(1)" ${_ordersPage===pages?'disabled':''}>►</button></span>`;
  }
}

function changeOrdersPage(delta) {
  const pages = Math.max(1, Math.ceil(_ordersAll.length / ORDERS_PER_PAGE));
  _ordersPage = Math.max(1, Math.min(pages, _ordersPage + delta));
  renderOrdersPage();
}

async function updateOrderStatus(id, status) {
  if (!_requireRole('admin','supervisor')) return;
  try {
    const body = { status, updated_at: new Date().toISOString() };
    // Match APK: set timestamps for lifecycle transitions
    if (status === 'en_progreso') body.started_at = new Date().toISOString();
    if (status === 'completada') body.completed_at = new Date().toISOString();
    await supaPost('/service_orders?id=eq.' + id, body, 'PATCH');
    _logAudit({ action: 'change_status', target_type: 'order', target_id: id, details: { new_status: status } });
    toast('Estado actualizado: ' + status);
    loadOrders();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function deleteOrder(id, title) {
  if (!_requireRole('admin','supervisor')) return;
  if (!await pixConfirm('Eliminar la orden "' + title + '"?')) return;
  try {
    // Try real DELETE first (requires RLS DELETE policy)
    await supaDelete('/service_orders?id=eq.' + id);
    // Verify it was actually deleted (RLS may silently skip)
    const check = await supaFetch('/service_orders?id=eq.' + id + '&select=id');
    if (check.length > 0) {
      // DELETE policy not applied — fallback to status change
      await supaPost('/service_orders?id=eq.' + id, { status: 'cancelada', updated_at: new Date().toISOString() }, 'PATCH');
      _logAudit({ action: 'delete_order', target_type: 'order', target_id: id, target_name: title, details: { soft: true } });
    } else {
      _logAudit({ action: 'delete_order', target_type: 'order', target_id: id, target_name: title, details: { hard: true } });
    }
    toast('Orden eliminada: ' + title);
    loadOrders();
  } catch (e) {
    toast('Error al eliminar: ' + e.message, 'err');
  }
}

function editOrder(order) {
  document.getElementById('orderEditId').value = order.id;
  document.getElementById('orderTitle').value = order.title || '';
  document.getElementById('orderProject').value = order.project || '';
  document.getElementById('orderClient').value = order.client || '';
  document.getElementById('orderDesc').value = order.description || '';
  document.getElementById('orderPriority').value = order.priority || 'normal';
  document.getElementById('orderDeadline').value = order.deadline || '';
  document.getElementById('orderNotes').value = order.notes || '';
  document.getElementById('orderFormTitle').textContent = 'Editar Orden';
  document.getElementById('orderSubmitBtn').textContent = 'Actualizar Orden';
  if (order.field_data) {
    orderGeoData = order.field_data;
    document.getElementById('orderFileZone').classList.add('has-file');
    const fc = order.field_data.fields?.length || order.field_data.features?.length || 0;
    const tp = order.field_data.fields ? order.field_data.fields.reduce((s, f) => s + (f.points?.features?.length || 0), 0) : 0;
    document.getElementById('orderFilePreview').textContent = `Datos cargados: ${fc} campos, ${tp} puntos`;
  }
  const panel = document.getElementById('orderFormPanel');
  panel.classList.add('show');
  populateOrderTechDropdown().then(() => {
    document.getElementById('orderTechnician').value = order.assigned_to || '';
  });
  panel.scrollIntoView({ behavior: 'smooth' });
}

function toggleOrderDetail(id) {
  const row = document.getElementById('detail-' + id);
  if (row) row.classList.toggle('show');
}

// Store orders for editing
let _ordersCache = [];

function renderOrders(orders) {
  _ordersCache = orders;
  const tbody = document.getElementById('ordersTableBody');

  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:30px">No hay ordenes de servicio</td></tr>';
    return;
  }

  const statusMap = {
    pendiente: 'badge-yellow',
    asignada: 'badge-teal',
    en_progreso: 'badge-green',
    completada: 'badge-green-solid',
    cancelada: 'badge-red'
  };
  const priorityMap = {
    baja: 'badge-muted',
    normal: 'badge-teal',
    alta: 'badge-yellow',
    urgente: 'badge-red'
  };
  const statusOptions = ['pendiente', 'asignada', 'en_progreso', 'completada', 'cancelada'];

  tbody.innerHTML = orders.map((o, idx) => {
    const sBadge = statusMap[o.status] || 'badge-muted';
    const pBadge = priorityMap[o.priority] || 'badge-teal';
    const created = o.created_at ? new Date(o.created_at).toLocaleDateString('es') : '—';
    const deadline = o.deadline ? new Date(o.deadline).toLocaleDateString('es') : '—';
    const hasGeo = o.field_data && (o.field_data.fields || o.field_data.features) ? ' 🗺️' : '';

    const statusSelect = `<select class="status-select" onchange="updateOrderStatus('${o.id}', this.value)">`
      + statusOptions.map(s => `<option value="${s}"${s === o.status ? ' selected' : ''}>${s}</option>`).join('')
      + '</select>';

    // Detail row
    const desc = esc(o.description || 'Sin descripcion');
    const notes = esc(o.notes || '—');
    const geoFields = o.field_data?.fields || o.field_data?.features || [];
    const geoInfo = geoFields.length ? `${geoFields.length} campos cargados` : 'Sin datos GeoJSON';

    return `<tr style="cursor:pointer" onclick="toggleOrderDetail('${o.id}')">
      <td><strong>${esc(o.title)}</strong>${hasGeo}</td>
      <td>${esc(o.project || '—')}</td>
      <td>${esc(o.client || '—')}</td>
      <td>${esc(o.assigned_to_name || o.assigned_to || '—')}</td>
      <td><span class="badge ${sBadge}">${o.status}</span></td>
      <td><span class="badge ${pBadge}">${o.priority || 'normal'}</span></td>
      <td>${deadline}</td>
      <td>${created}</td>
      <td onclick="event.stopPropagation()">
        ${statusSelect}
        <button class="btn btn-sm btn-secondary" style="margin-left:4px" onclick="editOrder(_ordersCache[${idx}])">Editar</button>
        <button class="btn btn-sm btn-danger" style="margin-left:4px" onclick="deleteOrder('${o.id}', '${escJS(o.title)}')">Eliminar</button>
      </td>
    </tr>
    <tr class="order-detail" id="detail-${o.id}">
      <td colspan="9">
        <div class="detail-grid">
          <div><span class="label">Descripcion:</span><br>${desc}</div>
          <div><span class="label">Notas:</span><br>${notes}</div>
          <div><span class="label">GeoJSON:</span><br>${geoInfo}</div>
          <div><span class="label">Actualizada:</span><br>${o.updated_at ? new Date(o.updated_at).toLocaleString('es') : '—'}</div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// TECNICOS TAB — Technician Management
// ═══════════════════════════════════════════════════

function toggleTechForm(reset) {
  const panel = document.getElementById('techFormPanel');
  const isOpen = panel.classList.contains('show');
  if (isOpen || reset === false) {
    panel.classList.remove('show');
    clearTechForm();
  } else {
    panel.classList.add('show');
  }
}

function clearTechForm() {
  document.getElementById('techEditId').value = '';
  document.getElementById('techFullName').value = '';
  document.getElementById('techUsername').value = '';
  document.getElementById('techPassword').value = '';
  document.getElementById('techPhone').value = '';
  document.getElementById('techEmail').value = '';
  document.getElementById('techRole').value = 'tecnico';
  document.getElementById('techFormTitle').textContent = 'Nuevo Tecnico';
  document.getElementById('techSubmitBtn').textContent = 'Crear Tecnico';
  document.getElementById('techPasswordLabel').textContent = 'Password *';
  document.getElementById('techPassword').required = true;
}

// (sha256 helper removed — use pixHash / pixHashSalted from top of file)

async function submitTechnician() {
  if (!_requireRole('admin','supervisor')) return;
  const fullName = document.getElementById('techFullName').value.trim();
  const username = document.getElementById('techUsername').value.trim();
  const password = document.getElementById('techPassword').value;
  const editId = document.getElementById('techEditId').value;

  if (!fullName || !username) {
    toast('Nombre y username son obligatorios', 'err');
    return;
  }
  if (!editId && !password) {
    toast('El password es obligatorio para nuevos tecnicos', 'err');
    return;
  }
  if (password && password.length < 6) {
    toast('Clave mínima 6 caracteres', 'err');
    return;
  }

  const body = {
    full_name: fullName,
    username: username,
    phone: document.getElementById('techPhone').value.trim() || null,
    email: document.getElementById('techEmail').value.trim() || null,
    role: document.getElementById('techRole').value
  };

  if (password) {
    // P0-1: salted SHA-256 — auth.js verifyPassword supports salt:hash format
    body.password_hash = await pixHashSalted(password);
  }

  const btn = document.getElementById('techSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    if (editId) {
      body.updated_at = new Date().toISOString();
      await supaPost('/technicians?id=eq.' + editId, body, 'PATCH');
      _logAudit({ action: 'update_tech', target_type: 'technician', target_id: editId, target_name: fullName, details: { fields: Object.keys(body), pw_changed: !!password } });
      toast('Tecnico actualizado');
    } else {
      // Check if username already exists (active or inactive)
      const existingInactive = await supaFetch('/technicians?username=eq.' + encodeURIComponent(username) + '&active=eq.false&select=id');
      if (existingInactive && existingInactive.length > 0) {
        // Delete old inactive record, then create fresh
        await supaDelete('/technicians?id=eq.' + existingInactive[0].id);
      } else {
        // Check if username is in use by an active technician
        const existingActive = await supaFetch('/technicians?username=eq.' + encodeURIComponent(username) + '&active=eq.true&select=id,full_name');
        if (existingActive && existingActive.length > 0) {
          toast('El username "' + username + '" ya esta en uso por ' + (existingActive[0].full_name || 'otro tecnico'), 'err');
          btn.disabled = false;
          btn.textContent = 'Crear Tecnico';
          return;
        }
      }
      body.active = true;
      body.created_at = new Date().toISOString();
      const created = await supaPost('/technicians', body);
      const newId = (created && created[0] && created[0].id) || null;
      _logAudit({ action: 'create_tech', target_type: 'technician', target_id: newId, target_name: fullName, details: { username, role: body.role } });
      toast('Tecnico creado');
    }
    toggleTechForm(false);
    loadTechnicians();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = editId ? 'Actualizar Tecnico' : 'Crear Tecnico';
  }
}

// Role gate — viewers can only read; supervisors can edit but not delete admins
function _requireRole(...allowed) {
  if (!_adminUser) { pixAlert('Sesión expirada'); dashLogout(); return false; }
  if (!allowed.includes(_adminUser.role)) {
    toast('No tenés permisos para esta acción (rol: ' + _adminUser.role + ')', 'err');
    return false;
  }
  return true;
}

// ── Tech state for search/pagination/bulk ──
let _techsAll = [];                  // raw fetch
let _techsFiltered = [];
let _techsPage = 1;
const TECHS_PER_PAGE = 15;
let _techsShowInactive = false;
let _techsSearch = '';
let _techsSelected = new Set();      // bulk selection

async function loadTechnicians() {
  try {
    // Load active + inactive when toggle on
    const filter = _techsShowInactive ? '' : '&active=eq.true';
    const [techs, devices] = await Promise.all([
      supaFetch('/technicians?select=*' + filter + '&order=created_at.desc'),
      supaFetch('/devices?select=*&order=last_seen.desc')
    ]);
    _devicesCache = devices || [];
    _techsAll = techs || [];
    applyTechFilters();
  } catch (e) {
    console.error('[Technicians] Load error:', e);
    document.getElementById('techsTableBody').innerHTML =
      `<tr><td colspan="10" style="text-align:center;color:var(--red);padding:20px">Error: ${esc(e.message)}</td></tr>`;
  }
}

function applyTechFilters() {
  const q = (_techsSearch || '').toLowerCase().trim();
  _techsFiltered = !q ? _techsAll.slice() : _techsAll.filter(t => {
    const hay = [t.full_name, t.username, t.email, t.phone, t.role].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  _techsPage = 1;
  renderTechniciansPage();
}

function changeTechsPage(delta) {
  const pages = Math.max(1, Math.ceil(_techsFiltered.length / TECHS_PER_PAGE));
  _techsPage = Math.max(1, Math.min(pages, _techsPage + delta));
  renderTechniciansPage();
}

function renderTechniciansPage() {
  const start = (_techsPage - 1) * TECHS_PER_PAGE;
  const slice = _techsFiltered.slice(start, start + TECHS_PER_PAGE);
  renderTechnicians(slice, _devicesCache);
  // pagination footer
  const total = _techsFiltered.length;
  const pages = Math.max(1, Math.ceil(total / TECHS_PER_PAGE));
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + TECHS_PER_PAGE, total);
  const pag = document.getElementById('techsPagination');
  if (pag) {
    pag.innerHTML = `<span>Mostrando ${from}–${to} de ${total} ${_techsShowInactive ? '(incluye inactivos)' : ''}</span>` +
      `<span><button onclick="changeTechsPage(-1)" ${_techsPage===1?'disabled':''}>◄</button>` +
      `<button class="active" disabled>${_techsPage} / ${pages}</button>` +
      `<button onclick="changeTechsPage(1)" ${_techsPage===pages?'disabled':''}>►</button></span>`;
  }
}

async function toggleTechnicianActive(id, currentActive) {
  if (!_requireRole('admin','supervisor')) return;
  // P2-22 undo: optimistic toggle with 5s revert window
  const prev = currentActive;
  const next = !currentActive;
  const t = (_techsCache || []).find(x => x.id === id);
  const techName = t ? t.full_name : id;
  try {
    await supaPost('/technicians?id=eq.' + id, { active: next, updated_at: new Date().toISOString() }, 'PATCH');
    _logAudit({ action: 'toggle_active', target_type: 'technician', target_id: id, target_name: techName, details: { from: prev, to: next } });
    toast(next ? 'Técnico activado' : 'Técnico desactivado', 'ok', async () => {
      try {
        await supaPost('/technicians?id=eq.' + id, { active: prev, updated_at: new Date().toISOString() }, 'PATCH');
        _logAudit({ action: 'toggle_active', target_type: 'technician', target_id: id, target_name: techName, details: { from: next, to: prev, undo: true } });
        loadTechnicians();
      } catch(_){}
    });
    loadTechnicians();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function editTechnician(tech) {
  document.getElementById('techEditId').value = tech.id;
  document.getElementById('techFullName').value = tech.full_name || '';
  document.getElementById('techUsername').value = tech.username || '';
  document.getElementById('techPassword').value = '';
  document.getElementById('techPhone').value = tech.phone || '';
  document.getElementById('techEmail').value = tech.email || '';
  document.getElementById('techRole').value = tech.role || 'tecnico';
  document.getElementById('techFormTitle').textContent = 'Editar Tecnico';
  document.getElementById('techSubmitBtn').textContent = 'Actualizar Tecnico';
  document.getElementById('techPasswordLabel').textContent = 'Password (dejar vacio para no cambiar)';
  document.getElementById('techPassword').required = false;
  const panel = document.getElementById('techFormPanel');
  panel.classList.add('show');
  panel.scrollIntoView({ behavior: 'smooth' });
}

async function resetTechPassword(id, name) {
  if (!_requireRole('admin','supervisor')) return;
  const newPw = await pixPrompt('Nueva contraseña para ' + name + ' (mín 6):', 'password');
  if (newPw == null) return;                     // cancelled
  const trimmed = newPw.trim();
  if (trimmed.length < 6) { toast('Mínimo 6 caracteres', 'warn'); return; }

  try {
    // P0-1 salted hash
    const hash = await pixHashSalted(trimmed);
    await supaPost('/technicians?id=eq.' + id, { password_hash: hash, updated_at: new Date().toISOString() }, 'PATCH');
    _logAudit({ action: 'reset_pw', target_type: 'technician', target_id: id, target_name: name });
    toast('Contraseña actualizada para ' + name);
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function deleteTechnician(id, name) {
  if (!_requireRole('admin','supervisor')) return;
  // P0-7: soft-delete by default (preserves FK + history). Admin can opt-in to hard delete.
  if (!await pixConfirm('Desactivar técnico "' + name + '"?\n\nEl técnico ya no aparecerá ni podrá iniciar sesión. Sus datos históricos se conservan. Para eliminar definitivamente usá "Borrar permanente".')) return;
  try {
    const now = new Date().toISOString();
    await supaPost('/technicians?id=eq.' + id, { active: false, deleted_at: now, updated_at: now }, 'PATCH');
    _logAudit({ action: 'delete_tech', target_type: 'technician', target_id: id, target_name: name, details: { soft: true } });
    toast('Técnico "' + name + '" desactivado', 'ok', async () => {
      try {
        await supaPost('/technicians?id=eq.' + id, { active: true, deleted_at: null, updated_at: new Date().toISOString() }, 'PATCH');
        _logAudit({ action: 'restore_tech', target_type: 'technician', target_id: id, target_name: name });
        loadTechnicians();
      } catch(_){}
    });
    loadTechnicians();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// Hard delete — only admin role, requires double confirmation, only on already-soft-deleted techs
async function purgeTechnician(id, name) {
  if (!_requireRole('admin')) return;
  const typed = await pixPrompt('BORRAR PERMANENTE "' + name + '"\n\nEsta acción NO se puede deshacer. Escribí el username del técnico para confirmar:');
  if (typed == null) return;
  const tech = (_techsCache || []).find(x => x.id === id);
  if (!tech || typed.trim() !== tech.username) {
    toast('Username no coincide — abortado', 'warn');
    return;
  }
  try {
    await supaDelete('/technicians?id=eq.' + id);
    const check = await supaFetch('/technicians?id=eq.' + id + '&select=id');
    if (check.length > 0) {
      toast('No se pudo eliminar (RLS); permanece desactivado', 'warn');
    } else {
      _logAudit({ action: 'purge_tech', target_type: 'technician', target_id: id, target_name: name, details: { hard: true } });
      toast('Técnico "' + name + '" borrado permanentemente');
    }
    loadTechnicians();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// Store technicians for editing
let _techsCache = [];

function renderTechnicians(techs, devices) {
  _techsCache = techs;
  const tbody = document.getElementById('techsTableBody');

  if (!techs || techs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:30px">No hay técnicos con los filtros actuales</td></tr>';
    return;
  }

  // Build device lookup by technician_name for session info
  const devByName = {};
  if (devices) {
    for (const d of devices) {
      const key = (d.technician_name || d.technician || '').toLowerCase().trim();
      if (key && (!devByName[key] || new Date(d.last_seen) > new Date(devByName[key].last_seen))) {
        devByName[key] = d;
      }
    }
  }

  const roleMap = { admin: 'badge-red', supervisor: 'badge-yellow', tecnico: 'badge-teal' };

  tbody.innerHTML = techs.map((t, idx) => {
    const rBadge = roleMap[t.role] || 'badge-teal';
    const activeClass = t.active ? 'badge-green' : 'badge-red';
    const activeText = t.active ? 'Activo' : 'Inactivo';

    // Cross-reference with devices for session/online status
    const nameKey = (t.full_name || '').toLowerCase().trim();
    const dev = devByName[nameKey];
    const lastSeen = dev && dev.last_seen ? new Date(dev.last_seen) : null;
    const isOnline = lastSeen && (Date.now() - lastSeen.getTime()) < ONE_HOUR;
    const sessionHTML = isOnline
      ? `<span class="tech-online-badge"><span class="pulse-dot"></span><span class="badge badge-green">Online</span></span> <small style="color:var(--muted)">${timeAgo(lastSeen)}</small>`
      : lastSeen
        ? `<span class="badge badge-muted">Offline</span> <small style="color:var(--muted)">${timeAgo(lastSeen)}</small>`
        : `<span class="badge badge-muted">Sin conexion</span>`;
    const deviceInfo = dev ? `${esc(dev.phone_model || '?')} v${esc(dev.app_version || '?')}` : '—';
    const checked = _techsSelected.has(t.id) ? 'checked' : '';
    const isInactive = !t.active;
    const purgeBtn = isInactive
      ? `<button class="btn btn-sm btn-danger" style="margin-left:4px;background:rgba(239,68,68,0.3)" onclick="event.stopPropagation();purgeTechnician('${t.id}', '${escJS(t.full_name)}')" title="Borrar permanente">🗑</button>`
      : '';

    return `<tr style="cursor:pointer;${isInactive?'opacity:0.55':''}" onclick="openTechDetail('${t.id}')">
      <td onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleTechSelected('${t.id}',this.checked)" aria-label="Seleccionar ${esc(t.full_name)}"></td>
      <td><strong>${esc(t.full_name)}</strong></td>
      <td>${esc(t.username)}</td>
      <td><span class="badge ${rBadge}">${t.role || 'tecnico'}</span></td>
      <td>${esc(t.phone || '—')}</td>
      <td>${esc(t.email || '—')}</td>
      <td onclick="event.stopPropagation()">
        <span class="badge ${activeClass}" style="cursor:pointer" onclick="toggleTechnicianActive('${t.id}', ${t.active})" title="Clic para cambiar">${activeText}</span>
      </td>
      <td>${sessionHTML}</td>
      <td><small style="color:var(--muted)">${deviceInfo}</small></td>
      <td onclick="event.stopPropagation()">
        <button class="btn btn-sm btn-secondary" onclick="editTechnician(_techsCache[${idx}])">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="resetTechPassword('${t.id}', '${escJS(t.full_name)}')">Reset PW</button>
        <button class="btn btn-sm btn-danger" style="margin-left:4px" onclick="deleteTechnician('${t.id}', '${escJS(t.full_name)}')">${isInactive ? 'Reactivar' : 'Desactivar'}</button>
        ${purgeBtn}
      </td>
    </tr>`;
  }).join('');
}

function toggleTechSelected(id, checked) {
  if (checked) _techsSelected.add(id); else _techsSelected.delete(id);
  const bar = document.getElementById('techsBulkBar');
  if (bar) bar.style.display = _techsSelected.size > 0 ? 'flex' : 'none';
  const ct = document.getElementById('techsBulkCount');
  if (ct) ct.textContent = _techsSelected.size + ' seleccionados';
}

function clearTechSelection() {
  _techsSelected.clear();
  document.querySelectorAll('#techsTableBody input[type=checkbox]').forEach(cb => cb.checked = false);
  toggleTechSelected();
}

async function bulkDeactivateTechs() {
  if (!_requireRole('admin','supervisor')) return;
  if (_techsSelected.size === 0) return;
  if (!await pixConfirm('Desactivar ' + _techsSelected.size + ' técnicos seleccionados?')) return;
  const ids = Array.from(_techsSelected);
  const now = new Date().toISOString();
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await supaPost('/technicians?id=eq.' + id, { active: false, deleted_at: now, updated_at: now }, 'PATCH');
      ok++;
    } catch (_) { fail++; }
  }
  _logAudit({ action: 'bulk_deactivate', target_type: 'technician', details: { ok, fail, ids } });
  toast(`${ok} desactivados${fail ? ', ' + fail + ' fallaron' : ''}`);
  clearTechSelection();
  loadTechnicians();
}

function exportTechsCSV() {
  if (_techsAll.length === 0) { toast('Nada que exportar', 'warn'); return; }
  const header = 'Username,Nombre,Rol,Email,Telefono,Activo,Creado,Actualizado';
  const rows = _techsAll.map(t => [
    t.username, t.full_name, t.role, t.email || '', t.phone || '',
    t.active ? 'si' : 'no',
    t.created_at || '', t.updated_at || ''
  ].map(v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"')) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(','));
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `tecnicos_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  _logAudit({ action: 'export_techs', details: { count: _techsAll.length } });
  toast(`${_techsAll.length} técnicos exportados`);
}

function exportTechsJSON() {
  if (_techsAll.length === 0) { toast('Nada que exportar', 'warn'); return; }
  const blob = new Blob([JSON.stringify(_techsAll, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `tecnicos_${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url);
  _logAudit({ action: 'export_techs_json', details: { count: _techsAll.length } });
  toast('Exportado JSON');
}

// ═══════════════════════════════════════════════════
// DISPOSITIVOS TAB — Device Management
// ═══════════════════════════════════════════════════

let _devicesAll = [];
let _devicesPage = 1;
const DEVICES_PER_PAGE = 15;

async function loadDevices() {
  try {
    const devices = await supaFetch('/devices?select=*&active=eq.true&order=last_seen.desc');
    _devicesAll = devices || [];
    _devicesPage = 1;
    renderDevicesPage();
    document.getElementById('devicesRefreshInfo').textContent =
      'Actualizado: ' + new Date().toLocaleTimeString('es') + ' — auto-refresh cada 30s';
  } catch (e) {
    console.error('[Devices] Load error:', e);
    document.getElementById('devicesTableBody').innerHTML =
      `<tr><td colspan="9" style="text-align:center;color:var(--red);padding:20px">Error: ${esc(e.message)}</td></tr>`;
  }
}

function renderDevicesPage() {
  const start = (_devicesPage - 1) * DEVICES_PER_PAGE;
  const slice = _devicesAll.slice(start, start + DEVICES_PER_PAGE);
  renderDevices(slice);
  const total = _devicesAll.length;
  const pages = Math.max(1, Math.ceil(total / DEVICES_PER_PAGE));
  const pag = document.getElementById('devicesPagination');
  if (pag) {
    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(start + DEVICES_PER_PAGE, total);
    pag.innerHTML = `<span>Mostrando ${from}–${to} de ${total}</span>` +
      `<span><button onclick="changeDevicesPage(-1)" ${_devicesPage===1?'disabled':''}>◄</button>` +
      `<button class="active" disabled>${_devicesPage} / ${pages}</button>` +
      `<button onclick="changeDevicesPage(1)" ${_devicesPage===pages?'disabled':''}>►</button></span>`;
  }
}

function changeDevicesPage(delta) {
  const pages = Math.max(1, Math.ceil(_devicesAll.length / DEVICES_PER_PAGE));
  _devicesPage = Math.max(1, Math.min(pages, _devicesPage + delta));
  renderDevicesPage();
}

function renderDevices(devices) {
  const tbody = document.getElementById('devicesTableBody');

  if (!devices || devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:30px">No hay dispositivos registrados</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(d => {
    const lastSeen = d.last_seen ? new Date(d.last_seen) : null;
    const isOnline = lastSeen && (Date.now() - lastSeen.getTime()) < ONE_HOUR;
    const dotClass = isOnline ? 'on' : 'off';
    const statusText = isOnline ? 'Online' : 'Offline';
    const statusBadge = isOnline ? 'badge-green' : 'badge-red';
    const ago = lastSeen ? timeAgo(lastSeen) : 'Nunca';

    // Truncate device_id for display
    const devId = d.device_id || d.id || '—';
    const shortId = devId.length > 12 ? devId.substring(0, 12) + '...' : devId;

    // Format location
    let loc = '—';
    if (d.last_location) {
      if (typeof d.last_location === 'object' && d.last_location.lat) {
        loc = `${d.last_location.lat.toFixed(4)}, ${d.last_location.lng.toFixed(4)}`;
      } else if (typeof d.last_location === 'string') {
        loc = d.last_location;
      }
    } else if (d.last_lat && d.last_lng) {
      loc = `${d.last_lat.toFixed(4)}, ${d.last_lng.toFixed(4)}`;
    }

    const techLabel = esc(d.technician_name || d.technician || '—');

    return `<tr>
      <td title="${esc(devId)}"><code style="font-size:11px">${esc(shortId)}</code></td>
      <td>${techLabel}</td>
      <td>${esc(d.phone_model || '—')}</td>
      <td>${esc(d.app_version || '—')}</td>
      <td>${esc(d.sw_cache_version || '—')}</td>
      <td><span class="online-dot ${dotClass}"></span><span class="badge ${statusBadge}">${statusText}</span> <small style="color:var(--muted)">${ago}</small></td>
      <td><small>${loc}</small></td>
      <td>${lastSeen ? lastSeen.toLocaleString('es') : '—'}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteDevice('${d.id}', '${escJS(techLabel)}')">Eliminar</button></td>
    </tr>`;
  }).join('');
}

async function deleteDevice(id, label) {
  if (!_requireRole('admin','supervisor')) return;
  if (!await pixConfirm('Eliminar dispositivo "' + label + '"?')) return;
  try {
    await supaPost('/devices?id=eq.' + id, { active: false }, 'PATCH');
    _logAudit({ action: 'delete_device', target_type: 'device', target_id: id, target_name: label });
    toast('Dispositivo eliminado', 'ok', async () => {
      try {
        await supaPost('/devices?id=eq.' + id, { active: true }, 'PATCH');
        loadDevices();
      } catch(_){}
    });
    loadDevices();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════
// ADMINS TAB — Per-admin user accounts
// ═══════════════════════════════════════════════════

let _adminsCache = [];

async function loadAdmins() {
  if (!_requireRole('admin')) {
    document.getElementById('adminsTableBody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:30px">Solo el rol admin puede ver esta sección.</td></tr>';
    return;
  }
  try {
    const admins = await supaFetch('/admin_users?select=*&order=created_at.desc');
    _adminsCache = admins || [];
    renderAdmins(admins);
  } catch (e) {
    console.error('[Admins] Load error:', e);
    document.getElementById('adminsTableBody').innerHTML =
      `<tr><td colspan="8" style="text-align:center;color:var(--red);padding:20px">Error: ${esc(e.message)}</td></tr>`;
  }
}

function renderAdmins(admins) {
  const tbody = document.getElementById('adminsTableBody');
  if (!admins || admins.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:30px">No hay administradores</td></tr>';
    return;
  }
  const roleMap = { admin: 'badge-red', supervisor: 'badge-yellow', viewer: 'badge-teal' };
  tbody.innerHTML = admins.map((a, i) => {
    const last = a.last_login_at ? timeAgo(new Date(a.last_login_at)) : 'Nunca';
    const tfa = a.totp_enabled ? `<span class="badge badge-green">✓ Activo</span>` : `<span class="badge badge-muted">No</span>`;
    const activeBadge = a.active ? 'badge-green' : 'badge-red';
    const isSelf = _adminUser && _adminUser.id === a.id;
    return `<tr>
      <td><strong>${esc(a.username)}</strong>${isSelf ? ' <small style="color:var(--green)">(vos)</small>' : ''}</td>
      <td>${esc(a.full_name || '—')}</td>
      <td>${esc(a.email || '—')}</td>
      <td><span class="badge ${roleMap[a.role] || 'badge-teal'}">${a.role}</span></td>
      <td>${tfa} ${a.totp_enabled ? '' : `<button class="btn btn-sm btn-outline" onclick="setupTotp('${a.id}','${escJS(a.username)}')">Activar 2FA</button>`}</td>
      <td><span class="badge ${activeBadge}">${a.active ? 'Activo' : 'Inactivo'}</span></td>
      <td><small>${last}</small></td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editAdmin(_adminsCache[${i}])">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="resetAdminPw('${a.id}','${escJS(a.username)}')">Reset PW</button>
        ${!isSelf ? `<button class="btn btn-sm btn-danger" style="margin-left:4px" onclick="deleteAdmin('${a.id}','${escJS(a.username)}')">Desactivar</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function toggleAdminForm() {
  const p = document.getElementById('adminFormPanel');
  if (p.classList.contains('show')) {
    p.classList.remove('show');
    clearAdminForm();
  } else {
    clearAdminForm();
    p.classList.add('show');
  }
}

function clearAdminForm() {
  ['adminEditId','adminUsername','adminFullName','adminEmail','adminPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('adminRole').value = 'admin';
  document.getElementById('adminFormTitle').textContent = 'Nuevo Administrador';
  document.getElementById('adminSubmitBtn').textContent = 'Crear Admin';
  document.getElementById('adminPwLabel').textContent = 'Clave * (mín 8 caracteres)';
}

function editAdmin(a) {
  if (!_requireRole('admin')) return;
  document.getElementById('adminEditId').value = a.id;
  document.getElementById('adminUsername').value = a.username || '';
  document.getElementById('adminFullName').value = a.full_name || '';
  document.getElementById('adminEmail').value = a.email || '';
  document.getElementById('adminRole').value = a.role || 'admin';
  document.getElementById('adminPassword').value = '';
  document.getElementById('adminPwLabel').textContent = 'Clave (vacío = no cambiar)';
  document.getElementById('adminFormTitle').textContent = 'Editar Administrador';
  document.getElementById('adminSubmitBtn').textContent = 'Actualizar';
  document.getElementById('adminFormPanel').classList.add('show');
}

async function submitAdmin() {
  if (!_requireRole('admin')) return;
  const editId   = document.getElementById('adminEditId').value;
  const username = document.getElementById('adminUsername').value.trim().toLowerCase();
  const fullName = document.getElementById('adminFullName').value.trim();
  const email    = document.getElementById('adminEmail').value.trim() || null;
  const role     = document.getElementById('adminRole').value;
  const password = document.getElementById('adminPassword').value;
  if (!username || !fullName) { toast('Usuario y nombre son obligatorios', 'err'); return; }
  if (!editId && (!password || password.length < 8)) { toast('Clave mínima 8 caracteres', 'err'); return; }
  if (password && password.length < 8) { toast('Clave mínima 8 caracteres', 'err'); return; }

  const body = { username, full_name: fullName, email, role, updated_at: new Date().toISOString() };
  if (password) body.password_hash = await pixHashSalted(password);
  try {
    if (editId) {
      await supaPost('/admin_users?id=eq.' + editId, body, 'PATCH');
      _logAudit({ action: 'update_admin', target_type: 'admin_user', target_id: editId, target_name: username });
      toast('Admin actualizado');
    } else {
      body.active = true;
      const created = await supaPost('/admin_users', body);
      const newId = created && created[0] && created[0].id;
      _logAudit({ action: 'create_admin', target_type: 'admin_user', target_id: newId, target_name: username });
      toast('Admin creado');
    }
    toggleAdminForm();
    loadAdmins();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function deleteAdmin(id, username) {
  if (!_requireRole('admin')) return;
  if (!await pixConfirm('Desactivar admin "' + username + '"?')) return;
  try {
    await supaPost('/admin_users?id=eq.' + id, { active: false, updated_at: new Date().toISOString() }, 'PATCH');
    _logAudit({ action: 'delete_admin', target_type: 'admin_user', target_id: id, target_name: username });
    toast('Admin desactivado');
    loadAdmins();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function resetAdminPw(id, username) {
  if (!_requireRole('admin')) return;
  const pw = await pixPrompt('Nueva clave para ' + username + ' (mín 8):', 'password');
  if (pw == null) return;
  if (pw.length < 8) { toast('Mínimo 8 caracteres', 'err'); return; }
  try {
    const hash = await pixHashSalted(pw);
    await supaPost('/admin_users?id=eq.' + id, { password_hash: hash, updated_at: new Date().toISOString() }, 'PATCH');
    _logAudit({ action: 'reset_admin_pw', target_type: 'admin_user', target_id: id, target_name: username });
    toast('Clave actualizada');
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

// 2FA setup — generate TOTP secret + show QR + verify before enabling
async function setupTotp(id, username) {
  if (!_requireRole('admin')) return;
  const secret = pixTotpRandomSecret();
  const issuer = encodeURIComponent('PIX Muestreo Admin');
  const label  = encodeURIComponent('PIX:' + username);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(otpauth);
  // Modal-like flow using a custom dialog
  const html = `<div style="text-align:center"><h3 style="margin:0 0 8px">Configurar 2FA</h3><p style="font-size:12px;color:var(--muted);margin-bottom:12px">Escaneá este QR con Google Authenticator o Authy, luego ingresá el código de 6 dígitos.</p><img src="${qrUrl}" alt="QR" style="display:block;margin:0 auto 12px;border:8px solid white;border-radius:8px"><div style="font-size:11px;color:var(--muted);margin-bottom:8px;word-break:break-all">Secret: <code>${secret}</code></div></div>`;
  // Show in inputModal with override
  const code = await _customDialog(html, 'numeric');
  if (!code) return;
  if (!(await pixTotpVerify(secret, code.trim()))) {
    toast('Código incorrecto. Intentá de nuevo.', 'err');
    return;
  }
  try {
    await supaPost('/admin_users?id=eq.' + id, { totp_secret: secret, totp_enabled: true, updated_at: new Date().toISOString() }, 'PATCH');
    _logAudit({ action: 'enable_2fa', target_type: 'admin_user', target_id: id, target_name: username });
    toast('2FA activado para ' + username);
    loadAdmins();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}

function _customDialog(htmlContent, fieldType) {
  return new Promise(resolve => {
    const modal = document.getElementById('inputModal');
    const msg = document.getElementById('inputModalMsg');
    const field = document.getElementById('inputModalField');
    msg.innerHTML = htmlContent;          // intentional innerHTML — controlled content only
    field.type = 'text';
    field.inputMode = fieldType === 'numeric' ? 'numeric' : 'text';
    field.placeholder = '000000';
    field.value = '';
    modal.style.display = 'flex';
    setTimeout(() => field.focus(), 50);
    const close = (val) => {
      modal.style.display = 'none';
      msg.textContent = '';
      field.removeAttribute('inputmode');
      field.placeholder = '';
      resolve(val);
    };
    document.getElementById('inputModalOk').onclick = () => close(field.value);
    document.getElementById('inputModalCancel').onclick = () => close(null);
    field.onkeydown = (e) => { if (e.key === 'Enter') close(field.value); };
  });
}

// ═══════════════════════════════════════════════════
// AUDITORÍA TAB
// ═══════════════════════════════════════════════════

let _auditAll = [];
let _auditPage = 1;
const AUDIT_PER_PAGE = 30;

async function loadAudit() {
  try {
    const filter = document.getElementById('auditFilterAction')?.value || '';
    const path = '/audit_log?select=*&order=created_at.desc&limit=500' + (filter ? '&action=eq.' + filter : '');
    _auditAll = await supaFetch(path);
    _auditPage = 1;
    renderAuditPage();
  } catch (e) {
    document.getElementById('auditTableBody').innerHTML =
      `<tr><td colspan="5" style="text-align:center;color:var(--red);padding:20px">Error: ${esc(e.message)}</td></tr>`;
  }
}

function renderAuditPage() {
  const tbody = document.getElementById('auditTableBody');
  const start = (_auditPage - 1) * AUDIT_PER_PAGE;
  const slice = _auditAll.slice(start, start + AUDIT_PER_PAGE);
  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:30px">Sin entradas</td></tr>';
  } else {
    tbody.innerHTML = slice.map(a => {
      const dt = new Date(a.created_at);
      const target = a.target_name ? `${esc(a.target_name)}` : (a.target_id ? `<code>${esc(a.target_id.substr(0,8))}</code>` : '—');
      const detail = a.details ? `<code style="font-size:10px">${esc(JSON.stringify(a.details).slice(0,80))}</code>` : '—';
      const actBadge = a.action.includes('failed') ? 'badge-red'
                     : a.action.startsWith('delete') || a.action.startsWith('purge') ? 'badge-yellow'
                     : 'badge-teal';
      return `<tr>
        <td><small>${dt.toLocaleString('es')}</small></td>
        <td><strong>${esc(a.admin_user)}</strong></td>
        <td><span class="badge ${actBadge}">${esc(a.action)}</span></td>
        <td>${esc(a.target_type || '')} ${target}</td>
        <td>${detail}</td>
      </tr>`;
    }).join('');
  }
  const total = _auditAll.length;
  const pages = Math.max(1, Math.ceil(total / AUDIT_PER_PAGE));
  const pag = document.getElementById('auditPagination');
  if (pag) {
    pag.innerHTML = `<span>${total} entradas (últimas 500)</span><span>` +
      `<button onclick="changeAuditPage(-1)" ${_auditPage===1?'disabled':''}>◄</button>` +
      `<button class="active" disabled>${_auditPage} / ${pages}</button>` +
      `<button onclick="changeAuditPage(1)" ${_auditPage===pages?'disabled':''}>►</button></span>`;
  }
}

function changeAuditPage(delta) {
  const pages = Math.max(1, Math.ceil(_auditAll.length / AUDIT_PER_PAGE));
  _auditPage = Math.max(1, Math.min(pages, _auditPage + delta));
  renderAuditPage();
}

function exportAuditCSV() {
  if (!_auditAll || _auditAll.length === 0) { toast('Sin datos', 'warn'); return; }
  const header = 'Fecha,Admin,Accion,Tipo,ID,Nombre,Detalle';
  const csvField = (v) => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = _auditAll.map(a => [
    a.created_at, a.admin_user, a.action, a.target_type || '', a.target_id || '',
    a.target_name || '', a.details ? JSON.stringify(a.details) : ''
  ].map(csvField).join(','));
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `auditoria_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Auditoría exportada');
}

// ═══════════════════════════════════════════════════
// TECHNICIAN DETAIL DRAWER
// ═══════════════════════════════════════════════════

async function openTechDetail(id) {
  const drawer = document.getElementById('techDetailDrawer');
  const content = document.getElementById('techDetailContent');
  content.innerHTML = 'Cargando…';
  drawer.style.display = 'block';
  try {
    const t = (_techsAll || []).find(x => x.id === id);
    if (!t) { content.innerHTML = 'Técnico no encontrado'; return; }
    // Load samples + activity for this technician (by full_name match — same lookup as panel)
    const [fields, activity] = await Promise.all([
      supaFetch('/field_syncs?select=field_name,project,client,samples,collected_points,total_points,progress_pct,synced_at,conflicts_resolved&technician=eq.' + encodeURIComponent(t.full_name) + '&order=synced_at.desc&limit=20'),
      supaFetch('/activity_log?select=action,details,created_at&technician=eq.' + encodeURIComponent(t.full_name) + '&order=created_at.desc&limit=30')
    ]);
    const totalSamples = fields.reduce((s, f) => s + (f.samples?.length || 0), 0);
    const totalConflicts = fields.reduce((s, f) => s + (f.conflicts_resolved || 0), 0);
    content.innerHTML = `
      <h2 style="margin:0 0 4px">${esc(t.full_name)}</h2>
      <div style="color:var(--muted);font-size:12px;margin-bottom:16px">@${esc(t.username)} · ${esc(t.role)} · ${t.active ? 'activo' : 'inactivo'}</div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
        <div class="stat-card"><div class="stat-value" style="font-size:20px">${fields.length}</div><div class="stat-label">Campos</div></div>
        <div class="stat-card"><div class="stat-value" style="font-size:20px">${totalSamples}</div><div class="stat-label">Muestras</div></div>
        <div class="stat-card"><div class="stat-value" style="font-size:20px;color:${totalConflicts>0?'var(--yellow)':''};-webkit-text-fill-color:${totalConflicts>0?'var(--yellow)':''};${totalConflicts>0?'background:none':''}">${totalConflicts}</div><div class="stat-label">Conflictos</div></div>
      </div>
      <h3 style="font-size:13px;margin:16px 0 8px;color:var(--muted)">Últimos campos</h3>
      <div style="max-height:200px;overflow-y:auto">
        ${fields.length === 0 ? '<div style="color:var(--muted);font-size:12px">Sin campos sincronizados</div>' : fields.map(f => `
          <div style="padding:8px 10px;background:var(--bg3);border-radius:8px;margin-bottom:6px;font-size:12px">
            <strong>${esc(f.field_name)}</strong> · ${esc(f.client || '')}<br>
            <small style="color:var(--muted)">${f.collected_points || 0}/${f.total_points || '?'} pts · ${f.progress_pct || 0}% · ${timeAgo(new Date(f.synced_at))}</small>
          </div>`).join('')}
      </div>
      <h3 style="font-size:13px;margin:16px 0 8px;color:var(--muted)">Actividad reciente</h3>
      <div style="max-height:200px;overflow-y:auto">
        ${activity.length === 0 ? '<div style="color:var(--muted);font-size:12px">Sin actividad</div>' : activity.map(a => `
          <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px">
            <small style="color:var(--muted)">${new Date(a.created_at).toLocaleString('es')}</small> ·
            ${esc(a.action)}
          </div>`).join('')}
      </div>
      <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="editTechnician(_techsAll.find(x=>x.id==='${t.id}'))">Editar</button>
        <button class="btn btn-secondary" onclick="resetTechPassword('${t.id}','${escJS(t.full_name)}')">Reset PW</button>
      </div>
    `;
  } catch (e) {
    content.innerHTML = 'Error: ' + esc(e.message);
  }
}

function closeTechDetail() {
  document.getElementById('techDetailDrawer').style.display = 'none';
}

// ═══════════════════════════════════════════════════
// REALTIME v2 (postgres_changes — Supabase Realtime current protocol)
// Replaces v1 phx_join "realtime:public:*" syntax — not delivered by current Supabase
// ═══════════════════════════════════════════════════

let _realtimeBackoff = 0;     // seconds to wait before next reconnect

// Override the v1 enableRealtime() defined earlier
window.enableRealtime = function() {
  if (!SUPA_URL || !SUPA_KEY) return;
  if (_realtimeCh && _realtimeCh.readyState === 1) return;
  try {
    const wsUrl = SUPA_URL.replace(/^https/, 'wss') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(SUPA_KEY) + '&vsn=1.0.0';
    const ws = new WebSocket(wsUrl);
    let heartbeat = null;
    let joinRef = 0;

    ws.onopen = () => {
      console.log('[Realtime v2] connected');
      _realtimeBackoff = 0;
      // postgres_changes — current Supabase Realtime protocol
      const subs = ['field_syncs','activity_log','devices','service_orders','technicians','audit_log'];
      subs.forEach(table => {
        joinRef++;
        ws.send(JSON.stringify({
          topic: 'realtime:public:' + table,
          event: 'phx_join',
          payload: {
            config: {
              postgres_changes: [{ event: '*', schema: 'public', table }]
            }
          },
          ref: String(joinRef)
        }));
      });
      heartbeat = setInterval(() => {
        try { ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '0' })); } catch(_){}
      }, 25000);
      const ind = document.getElementById('rtIndicator');
      if (ind) { ind.classList.add('on'); document.getElementById('rtLabel').textContent = 'Realtime v2'; }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        // Ignore phx_reply / heartbeat
        if (msg.event === 'phx_reply' || msg.event === 'heartbeat' || msg.event === 'presence_state') return;
        // postgres_changes: payload.data.type ∈ INSERT|UPDATE|DELETE
        const evType = (msg.payload && msg.payload.data && msg.payload.data.type) || msg.event;
        if (evType === 'INSERT' || evType === 'UPDATE' || evType === 'DELETE') {
          if (_realtimeReloadTimer) clearTimeout(_realtimeReloadTimer);
          _realtimeReloadTimer = setTimeout(() => {
            if (activeTab === 'tabPanel') loadData();
            else if (activeTab === 'tabOrdenes') loadOrders();
            else if (activeTab === 'tabDispositivos') loadDevices();
            else if (activeTab === 'tabTecnicos') loadTechnicians();
            else if (activeTab === 'tabAdmins') loadAdmins();
            else if (activeTab === 'tabAuditoria') loadAudit();
          }, 500);
          // Browser notification for urgent priority orders + new audit alerts
          if (evType === 'INSERT' && msg.topic && msg.topic.includes(':service_orders')) {
            const rec = msg.payload.data && msg.payload.data.record;
            if (rec && rec.priority === 'urgente') _browserNotify('Orden urgente', `${rec.title || 'Nueva'}: cliente ${rec.client || '—'}`);
          }
        }
      } catch(_){}
    };

    ws.onerror = (e) => console.warn('[Realtime v2] error:', e);
    ws.onclose = () => {
      console.log('[Realtime v2] disconnected');
      if (heartbeat) clearInterval(heartbeat);
      _realtimeCh = null;
      const ind = document.getElementById('rtIndicator');
      if (ind) { ind.classList.remove('on'); document.getElementById('rtLabel').textContent = 'Polling'; }
      // Exponential backoff: 5,10,20,40,80,160 (cap 300s)
      _realtimeBackoff = Math.min(REALTIME_RECONNECT_MAX_S, _realtimeBackoff ? _realtimeBackoff * 2 : 5);
      setTimeout(enableRealtime, _realtimeBackoff * 1000);
    };

    _realtimeCh = ws;
  } catch (e) {
    console.warn('[Realtime v2] setup failed:', e.message);
  }
};

// ═══════════════════════════════════════════════════
// BROWSER NOTIFICATIONS
// ═══════════════════════════════════════════════════

function _browserNotify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icons/icon-192.png', tag: 'pix-' + Date.now() }); } catch(_){}
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') _browserNotify(title, body);
    });
  }
}

// Request permission once on first interaction (user gesture required for some browsers)
document.addEventListener('click', function _onceNotifReq() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  document.removeEventListener('click', _onceNotifReq);
}, { once: true });

// ═══════════════════════════════════════════════════
// TELEMETRY (lightweight — non-blocking)
// ═══════════════════════════════════════════════════

const _telemetry = {
  sessionStart: Date.now(),
  pageLoadMs: null,
  actions: 0,
  errors: 0,
  lastError: null
};

window.addEventListener('load', () => {
  if (window.performance && performance.timing) {
    _telemetry.pageLoadMs = performance.timing.domComplete - performance.timing.navigationStart;
  } else if (window.performance && performance.getEntriesByType) {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) _telemetry.pageLoadMs = Math.round(nav.duration);
  }
});

window.addEventListener('error', (e) => {
  _telemetry.errors++;
  _telemetry.lastError = { msg: e.message, file: e.filename, line: e.lineno, ts: Date.now() };
});
window.addEventListener('unhandledrejection', (e) => {
  _telemetry.errors++;
  _telemetry.lastError = { msg: String(e.reason), ts: Date.now() };
});

// Wrap supaPost / supaFetch / supaDelete to count actions + measure time
(function() {
  const origSupaPost = window.supaPost;
  window.supaPost = async function() {
    _telemetry.actions++;
    const t0 = performance.now();
    try { return await origSupaPost.apply(null, arguments); }
    finally {
      const dt = Math.round(performance.now() - t0);
      if (dt > 2000) console.warn(`[telemetry] slow supaPost: ${dt}ms`, arguments[0]);
    }
  };
})();

window.pixTelemetry = () => ({ ..._telemetry, uptimeMs: Date.now() - _telemetry.sessionStart });

// ═══════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  // Esc closes modals + drawer
  if (e.key === 'Escape') {
    ['confirmModal','inputModal'].forEach(id => {
      const m = document.getElementById(id);
      if (m && m.style.display === 'flex') m.style.display = 'none';
    });
    const drawer = document.getElementById('techDetailDrawer');
    if (drawer && drawer.style.display === 'block') closeTechDetail();
  }
  // Ctrl/Cmd + K → focus search on tabTecnicos
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && activeTab === 'tabTecnicos') {
    e.preventDefault();
    const inp = document.getElementById('techsSearchInput');
    if (inp) inp.focus();
  }
});

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// JS-safe escaper for use inside onclick="fn('${escJS(val)}')" — prevents XSS via quote injection
function escJS(s) { return s == null ? '' : String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/</g,'\\x3c').replace(/>/g,'\\x3e').replace(/\n/g,'\\n'); }

function timeAgo(date) {
  const ms = Date.now() - date.getTime();
  if (ms < 60000) return 'Ahora';
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min';
  if (ms < 86400000) return Math.floor(ms / 3600000) + ' hrs';
  return Math.floor(ms / 86400000) + ' dias';
}

function setConnected(ok) {
  document.getElementById('connDot').className = 'dot ' + (ok ? 'dot-on' : 'dot-off');
  document.getElementById('connText').textContent = ok ? 'Conectado' : 'Sin conexion';
  // Show export button when connected
  const eb = document.getElementById('exportBtn');
  if (eb) eb.style.display = ok ? '' : 'none';
}

// (legacy toast() removed — pixToast aliased as `toast` at top of script)

// ═══════════════════════════════════════════════════
// EXPORT REPORTS TO LOCAL FOLDER
// File System Access API (Chrome 86+)
// ═══════════════════════════════════════════════════

// Cadastro IBRA Megalab — Pixadvisor Agricultura de Precision
const IBRA_CADASTRO = {
  solicitante: 'PIXADVISOR AGRICULTURA DE PRECISAO',
  responsavel: 'NILTON LUIZ CAMARGO',
  telefone: '43 999819554',
  endereco: 'RUA ELIEZER MARTINS BANDEIRA 44',
  cep: '86200536',
  bairro: 'CINQUENTENARIO',
  municipio: 'IBIPORA',
  uf: 'PR',
  cpfCnpj: '41.196.481/0001-30',
  emailLaudos: 'nilton.camargo@pixadvisor.network, gis.agronomico@gmail.com'
};

function safeName(name) {
  return (name || 'Sin-nombre').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 80);
}

async function writeFile(dir, filename, content) {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

async function exportReports() {
  if (!window.showDirectoryPicker) {
    await pixAlert('Tu navegador no soporta File System Access API. Usá Google Chrome actualizado.');
    return;
  }

  const btn = document.getElementById('exportBtn');
  const origText = btn.textContent;
  btn.textContent = '⏳ Selecciona carpeta...';
  btn.disabled = true;

  try {
    const rootDir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'desktop' });
    const fields = await supaFetch('/field_syncs?select=*&client=neq._ELIMINADO_&order=synced_at.desc');
    const activities = await supaFetch('/activity_log?select=*&order=created_at.desc&limit=100');

    if (!fields || fields.length === 0) {
      await pixAlert('No hay datos de campo para exportar.');
      btn.textContent = origText; btn.disabled = false;
      return;
    }

    // Create base folder: PIX-Reportes
    const baseDir = await rootDir.getDirectoryHandle('PIX-Reportes', { create: true });
    const today = new Date().toISOString().slice(0, 10);
    let exported = 0;

    for (const field of fields) {
      const projName = safeName((field.project || 'Sin-Proyecto') + ' - ' + (field.client || 'Sin-Cliente'));
      const projDir = await baseDir.getDirectoryHandle(projName, { create: true });

      const fName = safeName(field.field_name || 'Sin-Campo');
      const fieldDir = await projDir.getDirectoryHandle(fName, { create: true });

      // 1. Ficha IBRA (HTML print-ready)
      await writeFile(fieldDir, `Ficha_IBRA_${fName}_${today}.html`, genIBRA(field));

      // 2. GPS Points (GeoJSON)
      await writeFile(fieldDir, `Puntos_GPS_${fName}.geojson`, genGeoJSON(field));

      // 3. Resumen de Campo (HTML)
      await writeFile(fieldDir, `Resumen_${fName}_${today}.html`, genSummary(field));

      // 4. Datos crudos (JSON)
      await writeFile(fieldDir, `Datos_${fName}.json`, JSON.stringify(field, null, 2));

      // 5. Puntos CSV
      await writeFile(fieldDir, `Puntos_${fName}.csv`, genCSV(field));

      exported++;
      btn.textContent = `⏳ ${exported}/${fields.length}...`;
    }

    // Global activity log
    await writeFile(baseDir, `Actividad_${today}.json`, JSON.stringify(activities, null, 2));

    // Export manifest
    const manifest = {
      exportDate: new Date().toISOString(),
      exportedBy: 'PIX Muestreo Dashboard',
      totalFields: fields.length,
      totalSamples: fields.reduce((s, f) => s + (f.samples?.length || 0), 0),
      fields: fields.map(f => ({
        project: f.project, field: f.field_name, client: f.client,
        samples: f.samples?.length || 0, progress: f.progress_pct + '%'
      }))
    };
    await writeFile(baseDir, `_manifiesto_${today}.json`, JSON.stringify(manifest, null, 2));

    btn.textContent = `✅ ${exported} campos exportados!`;
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 4000);

  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('[Export]', e);
      toast('Error al exportar: ' + e.message, 'err');
    }
    btn.textContent = origText;
    btn.disabled = false;
  }
}

// ── IBRA REPORT (Ficha de Envio) ──
function genIBRA(field) {
  const d = field.synced_at ? new Date(field.synced_at).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  const samples = field.samples || [];

  // Build zones
  const zones = {};
  for (const s of samples) {
    const z = s.zona || 1;
    if (!zones[z]) zones[z] = { zona: z, count: 0, barcode: '', clase: '', depth: s.depth || '0-20', points: [] };
    zones[z].count++;
    if (s.barcode) zones[z].barcode = s.barcode;
    zones[z].points.push(s);
  }
  const zonesArr = Object.values(zones).sort((a, b) => a.zona - b.zona);
  const totalPts = samples.length;
  const totalZones = zonesArr.length;

  let zonesTableRows = zonesArr.map(z =>
    `<tr>
      <td style="text-align:center">${z.zona}</td>
      <td>${esc(z.barcode) || '—'}</td>
      <td>${esc(z.clase) || '—'}</td>
      <td style="text-align:center">${z.count}</td>
      <td>${z.depth} cm</td>
      <td>Quimico</td>
    </tr>`
  ).join('');

  // Page 2: detail points per zone
  let zoneDetails = zonesArr.map(z => {
    let rows = z.points.map(p =>
      `<tr>
        <td>${esc(p.pointName || '?')}</td>
        <td>${p.lat ? p.lat.toFixed(6) : '—'}</td>
        <td>${p.lng ? p.lng.toFixed(6) : '—'}</td>
        <td>${p.depth || '0-20'} cm</td>
        <td>${p.collectedAt ? new Date(p.collectedAt).toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}) : '—'}</td>
      </tr>`
    ).join('');
    return `
      <h3 style="margin:16px 0 6px;color:#0D9488">ZONA ${z.zona} ${z.clase ? '(' + esc(z.clase) + ')' : ''} — QR: ${esc(z.barcode) || 'Sin codigo'}</h3>
      <table>
        <thead><tr><th>Punto</th><th>Latitud</th><th>Longitud</th><th>Prof.</th><th>Hora</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<title>Ficha IBRA — ${esc(field.field_name)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  @media print { .no-print { display: none !important; } .page-break { page-break-before: always; } }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; max-width: 210mm; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; color: #0D9488; }
  h2 { font-size: 14px; background: #f0f9f4; padding: 6px 10px; margin: 16px 0 8px; border-left: 3px solid #0D9488; }
  h3 { font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; font-size: 11px; }
  th { background: #e8f5e9; font-weight: 600; text-align: left; }
  .info-grid { display: grid; grid-template-columns: 140px 1fr; gap: 2px 8px; margin-bottom: 8px; }
  .info-grid .label { font-weight: 600; color: #555; }
  .btn-print { display: block; margin: 16px auto; padding: 10px 30px; background: #0D9488; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">Imprimir / Guardar PDF</button>

  <h1>IBRA megalab — FICHA PARA ENVIO DE AMOSTRAS</h1>
  <p style="text-align:center;color:#666;font-size:11px;margin-bottom:16px">Generado por PIX Muestreo — ${d}</p>

  <h2>1. SOLICITANTE</h2>
  <div class="info-grid">
    <span class="label">Solicitante:</span><span>${IBRA_CADASTRO.solicitante}</span>
    <span class="label">Responsavel:</span><span>${IBRA_CADASTRO.responsavel}</span>
    <span class="label">Telefone:</span><span>${IBRA_CADASTRO.telefone}</span>
    <span class="label">Endereco:</span><span>${IBRA_CADASTRO.endereco}</span>
    <span class="label">CEP:</span><span>${IBRA_CADASTRO.cep}</span>
    <span class="label">Bairro:</span><span>${IBRA_CADASTRO.bairro}</span>
    <span class="label">Municipio:</span><span>${IBRA_CADASTRO.municipio} / ${IBRA_CADASTRO.uf}</span>
    <span class="label">CPF/CNPJ:</span><span>${IBRA_CADASTRO.cpfCnpj}</span>
    <span class="label">E-mail laudos:</span><span>${IBRA_CADASTRO.emailLaudos}</span>
  </div>

  <h2>2. CLIENTE / PROPRIEDADE</h2>
  <div class="info-grid">
    <span class="label">Cliente:</span><span>${esc(field.client) || '—'}</span>
    <span class="label">Hacienda/Proyecto:</span><span>${esc(field.project)}</span>
    <span class="label">Lote/Campo:</span><span>${esc(field.field_name)}</span>
    <span class="label">Area:</span><span>${field.area_ha ? field.area_ha + ' ha' : '—'}</span>
    <span class="label">Fecha colecta:</span><span>${d}</span>
    <span class="label">Tecnico:</span><span>${esc(field.technician)}</span>
  </div>

  <h2>3. AMOSTRAS POR ZONA</h2>
  <table>
    <thead><tr><th>Zona</th><th>QR / Codigo IBRA</th><th>Clase</th><th>Puntos</th><th>Profundidad</th><th>Analisis</th></tr></thead>
    <tbody>${zonesTableRows}</tbody>
  </table>
  <p style="font-size:11px;color:#555"><strong>Total:</strong> ${totalZones} muestra(s) compuesta(s), ${totalPts} puntos GPS</p>

  <div class="page-break"></div>
  <h2>4. DETALLE DE PUNTOS POR ZONA</h2>
  ${zoneDetails}

  <div style="margin-top:30px;border-top:1px solid #ccc;padding-top:10px">
    <div class="info-grid" style="grid-template-columns:1fr 1fr">
      <div style="border-bottom:1px solid #999;padding-bottom:30px;text-align:center">
        <br><small>Assinatura do Solicitante</small>
      </div>
      <div style="border-bottom:1px solid #999;padding-bottom:30px;text-align:center">
        <br><small>Assinatura do Tecnico</small>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── GEOJSON EXPORT ──
function genGeoJSON(field) {
  const features = [];

  // Add boundary if exists
  if (field.boundary && field.boundary.features) {
    for (const feat of field.boundary.features) {
      features.push({
        ...feat,
        properties: {
          ...feat.properties,
          name: field.field_name,
          type: 'boundary',
          area_ha: field.area_ha
        }
      });
    }
  }

  // Add sample points
  for (const s of (field.samples || [])) {
    if (s.lat && s.lng) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: {
          name: s.pointName || '?',
          zona: s.zona,
          depth: s.depth || '0-20',
          barcode: s.barcode || '',
          collector: s.collector || '',
          collectedAt: s.collectedAt || '',
          accuracy: s.accuracy || null,
          sampleType: s.sampleType || ''
        }
      });
    }
  }

  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

// ── FIELD SUMMARY REPORT ──
function genSummary(field) {
  const d = field.synced_at ? new Date(field.synced_at).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  const samples = field.samples || [];
  const pct = field.progress_pct || 0;
  const color = pct >= 100 ? '#4CAF50' : pct > 50 ? '#FF9800' : '#F44336';

  // Zone summary
  const zones = {};
  for (const s of samples) {
    const z = s.zona || 1;
    if (!zones[z]) zones[z] = { zona: z, count: 0 };
    zones[z].count++;
  }

  let sampleRows = samples.map((s, i) =>
    `<tr>
      <td>${i + 1}</td>
      <td>${esc(s.pointName || '?')}</td>
      <td>${s.zona || '?'}</td>
      <td>${s.lat ? s.lat.toFixed(6) : '—'}</td>
      <td>${s.lng ? s.lng.toFixed(6) : '—'}</td>
      <td>${s.accuracy ? s.accuracy.toFixed(1) + 'm' : '—'}</td>
      <td>${s.depth || '0-20'}</td>
      <td>${esc(s.barcode || '')}</td>
      <td>${s.collectedAt ? new Date(s.collectedAt).toLocaleString('es') : '—'}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Resumen — ${esc(field.field_name)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  @media print { .no-print { display: none !important; } }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; max-width: 290mm; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; color: #1B5E20; margin-bottom: 4px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 16px; }
  .cards { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .card { background: #f5f5f5; border-radius: 8px; padding: 12px 16px; min-width: 120px; text-align: center; }
  .card-val { font-size: 22px; font-weight: 800; color: #0D9488; }
  .card-lbl { font-size: 10px; color: #777; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; }
  th { background: #e8f5e9; font-weight: 600; }
  .progress { height: 8px; background: #eee; border-radius: 4px; overflow: hidden; width: 200px; display: inline-block; }
  .progress-inner { height: 100%; border-radius: 4px; }
  .btn-print { display: inline-block; margin: 10px 0; padding: 8px 24px; background: #0D9488; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
</style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">Imprimir / PDF</button>
  <h1>${esc(field.field_name)}</h1>
  <div class="meta">${esc(field.project)} — ${esc(field.client || 'Sin cliente')} — Tecnico: ${esc(field.technician)} — ${d}</div>

  <div class="cards">
    <div class="card"><div class="card-val">${field.area_ha || '—'}</div><div class="card-lbl">Hectareas</div></div>
    <div class="card"><div class="card-val">${field.total_points || '?'}</div><div class="card-lbl">Puntos totales</div></div>
    <div class="card"><div class="card-val">${field.collected_points || 0}</div><div class="card-lbl">Colectados</div></div>
    <div class="card"><div class="card-val" style="color:${color}">${pct}%</div><div class="card-lbl">Avance</div></div>
    <div class="card"><div class="card-val">${Object.keys(zones).length}</div><div class="card-lbl">Zonas</div></div>
  </div>

  <div style="margin-bottom:16px">
    <strong>Progreso:</strong>
    <div class="progress"><div class="progress-inner" style="width:${pct}%;background:${color}"></div></div>
    <span>${field.collected_points || 0} / ${field.total_points || '?'} puntos</span>
  </div>

  <h2 style="font-size:14px;color:#1B5E20">Detalle de Muestras</h2>
  <table>
    <thead><tr><th>#</th><th>Punto</th><th>Zona</th><th>Latitud</th><th>Longitud</th><th>Precision</th><th>Prof.</th><th>Codigo</th><th>Fecha/Hora</th></tr></thead>
    <tbody>${sampleRows}</tbody>
  </table>

  <p style="font-size:10px;color:#999;margin-top:20px;text-align:center">PIX Muestreo — Reporte generado automaticamente el ${new Date().toLocaleString('es')}</p>
</body>
</html>`;
}

// ── CSV EXPORT ──
function genCSV(field) {
  const samples = field.samples || [];
  const header = 'Punto,Zona,Latitud,Longitud,Precision_m,Profundidad,Codigo_Barras,Tipo,Colector,Fecha_Hora,Notas';
  // RFC 4180: fields containing commas, quotes, or newlines must be quoted
  const csvField = (v) => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = samples.map(s => {
    return [
      csvField(s.pointName),
      csvField(s.zona),
      s.lat || '',
      s.lng || '',
      s.accuracy || '',
      csvField(s.depth || '0-20'),
      csvField(s.barcode),
      csvField(s.sampleType),
      csvField(s.collector),
      s.collectedAt || '',
      csvField(s.notes)
    ].join(',');
  });
  return header + '\n' + rows.join('\n');
}
