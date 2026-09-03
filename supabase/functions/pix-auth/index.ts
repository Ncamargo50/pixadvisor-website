// ============================================================================
// pix-auth v2 — Edge Function de autenticación y administración de cuentas
// (Supabase / Deno, sin dependencias externas: solo Web Crypto y fetch)
//
// Toda operación sensible corre aquí con el service_role, que NUNCA sale al
// cliente: password_hash y totp_secret jamás se devuelven ni se aceptan
// desde el navegador (las contraseñas llegan en claro por HTTPS y se
// hashean en servidor con PBKDF2).
//
// Deploy:  supabase functions deploy pix-auth --no-verify-jwt
// Secretos: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta la
//   plataforma. Conviene definir además:
//     supabase secrets set PIX_SESSION_SECRET="$(openssl rand -hex 32)"
//   Si no está definido, el secreto de sesión se deriva del service_role key
//   (funciona, pero rotar ese key invalida todas las sesiones abiertas).
//
// El cliente llama:  POST https://<proj>.supabase.co/functions/v1/pix-auth
//   headers: { apikey: <anon>, Authorization: Bearer <anon>,
//              Content-Type: application/json, x-pix-session: <token>? }
//   body:    { action, ...payload }
//
// Acciones públicas (rate-limited por usuario e IP con public.login_attempts):
//   admin-login {username, password, code?} → {ok, user, token, exp} | {ok:false, totp_required:true}
//   tech-login  {username, password}        → {ok, user:{id,username,full_name,role,phone,email}}
// Acciones autenticadas (header x-pix-session; token HMAC-SHA256, exp 12 h):
//   session-check                                   (cualquier rol)
//   admin-list                                      (admin)
//   admin-create {username, full_name, email, role, password}   (admin)
//   admin-update {id, full_name?, email?, role?, active?, username?} (admin)
//   admin-set-password {id, password}               (admin)
//   admin-set-totp {id, secret, enabled}            (admin)
//   tech-set-password {id, password}                (admin | supervisor)
//   audit-list {limit?, action_filter?}             (admin | supervisor | viewer)
//
// Respuestas de error: 400 datos inválidos, 401 credenciales/sesión inválidas
// (mensaje genérico, no revela si el usuario existe), 403 sin permisos,
// 409 conflicto (username duplicado), 429 bloqueado {retry_after_s}.
// ============================================================================

// Supabase inyecta estas variables automáticamente en toda Edge Function.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Opcional (recomendado). Ver comentario de cabecera.
const SESSION_SECRET_ENV = Deno.env.get("PIX_SESSION_SECRET") || "";

// CORS: se mantiene "*" porque el Panel se sirve desde el dominio del sitio y
// el APK desde file://; la protección real es la sesión firmada + el
// rate limiting, no el origen. Si se fija un dominio único para el Panel,
// reemplazar "*" por ese origen.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pix-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SESSION_TTL_S = 12 * 60 * 60;   // 12 h
const PBKDF2_ITER = 210000;           // OWASP 2023 para PBKDF2-HMAC-SHA256
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;
const MIN_PASSWORD_LEN = 8;
const RL_WINDOW_MS = 60 * 60 * 1000;  // ventana en la que se acumulan fallos
const ROLES = ["admin", "supervisor", "viewer"];
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

type Json = Record<string, unknown>;

const utf8 = new TextEncoder();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function str(v: unknown, max = 200): string {
  return v == null ? "" : String(v).trim().slice(0, max);
}

// ── Utilidades binarias ──────────────────────────────────────────────────
function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncode(bytes: Uint8Array): string {
  return b64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return b64Decode(t);
}
// Comparación en tiempo constante (no cortocircuita en la primera diferencia)
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  return diff === 0;
}
function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(utf8.encode(a), utf8.encode(b));
}

// ── Hash de contraseña ───────────────────────────────────────────────────
// Formato ACTUAL:  "pbkdf2$<iter>$<saltB64>$<hashB64>"  (PBKDF2-HMAC-SHA256)
// Formatos LEGACY: "<salt>:<sha256hex(salt+plain)>"  y  "sha256hex(plain)"
//   (los creaba el navegador; se re-hashean a PBKDF2 en el próximo login).
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", utf8.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(plain: string, salt: Uint8Array, iter: number, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8.encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, key, len * 8,
  );
  return new Uint8Array(bits);
}

async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const hash = await pbkdf2(plain, salt, PBKDF2_ITER, PBKDF2_HASH_BYTES);
  return `pbkdf2$${PBKDF2_ITER}$${b64Encode(salt)}$${b64Encode(hash)}`;
}

// Devuelve ok + si el hash almacenado debe migrarse a PBKDF2 actual.
async function verifyPassword(plain: string, stored: string | null): Promise<{ ok: boolean; rehash: boolean }> {
  if (!stored) return { ok: false, rehash: false };
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    const iter = parseInt(parts[1] || "", 10);
    if (parts.length !== 4 || !iter || !parts[2] || !parts[3]) return { ok: false, rehash: false };
    try {
      const expected = b64Decode(parts[3]);
      const got = await pbkdf2(plain, b64Decode(parts[2]), iter, expected.length);
      return { ok: timingSafeEqual(got, expected), rehash: iter < PBKDF2_ITER };
    } catch {
      return { ok: false, rehash: false };
    }
  }
  if (stored.includes(":")) {
    const [salt, hash] = stored.split(":");
    return { ok: timingSafeEqualStr(await sha256Hex(salt + plain), hash), rehash: true };
  }
  // legacy sin sal
  return { ok: timingSafeEqualStr(await sha256Hex(plain), stored), rehash: true };
}

// ── TOTP: replica pixTotpVerify/pixTotpGenerate (RFC 6238, HMAC-SHA1, 30s, 6 díg) ──
function base32Decode(b32: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = b32.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = "";
  for (const c of cleaned) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) throw new Error("base32 inválido");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return new Uint8Array(bytes);
}

async function totpGenerate(secret: string, timeMs: number): Promise<string> {
  let t = Math.floor(timeMs / 1000 / 30);
  const counter = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { counter[i] = t & 0xff; t = Math.floor(t / 256); }
  const key = await crypto.subtle.importKey(
    "raw", base32Decode(secret) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const now = Date.now();
  for (const drift of [0, -30000, 30000]) {
    if (await totpGenerate(secret, now + drift) === code) return true;
  }
  return false;
}

// ── Acceso a PostgREST con service_role (bypassa RLS; solo del lado servidor) ──
interface SbResult { ok: boolean; status: number; data: unknown }

async function sb(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<SbResult> {
  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (init.prefer) headers.Prefer = init.prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const txt = await r.text();
  let data: unknown = null;
  if (txt) { try { data = JSON.parse(txt); } catch { data = txt; } }
  return { ok: r.ok, status: r.status, data };
}

async function sbOne(path: string): Promise<Json | null> {
  const r = await sb(path);
  return r.ok && Array.isArray(r.data) && r.data.length ? r.data[0] as Json : null;
}

function isDuplicate(r: SbResult): boolean {
  const d = r.data as Json | null;
  return r.status === 409 || (!!d && typeof d === "object" && d.code === "23505");
}

async function fetchByUsername(table: string, username: string, columns: string): Promise<Json | null> {
  // El campo de login de la app acepta "usuario o email": se busca por ambos,
  // sin distinguir mayúsculas (ilike sin comodines = igualdad case-insensitive).
  const v = username.trim().toLowerCase().replace(/[%_,()]/g, "");
  if (!v) return null;
  const hasEmail = table === "technicians" || table === "admin_users";
  const or = hasEmail
    ? `or=(username.ilike.${encodeURIComponent(v)},email.ilike.${encodeURIComponent(v)})`
    : `username=ilike.${encodeURIComponent(v)}`;
  return await sbOne(`${table}?${or}&active=eq.true&select=${columns}`);
}

async function fetchAdminById(id: string, columns = "id,username,full_name,role,active"): Promise<Json | null> {
  return await sbOne(`admin_users?id=eq.${encodeURIComponent(id)}&select=${columns}`);
}

// ── Bitácora (service_role). details.source = 'pix-auth' distingue estas filas
//    de las que inserta el navegador con anon.
interface Actor { username: string; id: string | null }
async function logAudit(
  actor: Actor, action: string,
  target: { type?: string; id?: unknown; name?: unknown } = {},
  details: Json = {}, ip = "",
): Promise<void> {
  try {
    await sb("audit_log", {
      method: "POST", prefer: "return=minimal",
      body: {
        admin_user: actor.username || "unknown",
        admin_id: actor.id,
        action,
        target_type: target.type || null,
        target_id: target.id == null ? null : String(target.id),
        target_name: target.name == null ? null : String(target.name),
        details: { ...details, source: "pix-auth" },
        ip_address: ip || null,
      },
    });
  } catch (_) { /* la bitácora nunca bloquea la operación */ }
}

// ── Rate limiting con public.login_attempts (migración 011) ──────────────
// 5 fallos en la ventana → bloqueo 15 min; 10 fallos → 1 h. Éxito → limpia.
interface AttemptRow { key: string; fail_count: number; first_fail_at: string | null; locked_until: string | null }

function lockDurationMs(fails: number): number {
  if (fails >= 10) return 60 * 60 * 1000;
  if (fails >= 5) return 15 * 60 * 1000;
  return 0;
}

async function rlGet(key: string): Promise<AttemptRow | null> {
  return await sbOne(`login_attempts?key=eq.${encodeURIComponent(key)}&select=key,fail_count,first_fail_at,locked_until`) as AttemptRow | null;
}

// Segundos restantes de bloqueo (0 = puede intentar)
async function rlRetryAfter(keys: string[]): Promise<number> {
  const rows = await Promise.all(keys.map(rlGet));
  const now = Date.now();
  let max = 0;
  for (const r of rows) {
    if (r && r.locked_until) {
      const until = new Date(r.locked_until).getTime();
      if (until > now) max = Math.max(max, Math.ceil((until - now) / 1000));
    }
  }
  return max;
}

async function rlFail(keys: string[]): Promise<void> {
  const now = Date.now();
  await Promise.all(keys.map(async (key) => {
    const cur = await rlGet(key);
    let count = 0;
    let firstAt = new Date(now).toISOString();
    if (cur && cur.first_fail_at && now - new Date(cur.first_fail_at).getTime() < RL_WINDOW_MS) {
      count = cur.fail_count || 0;
      firstAt = cur.first_fail_at;
    }
    count += 1;
    const lockMs = lockDurationMs(count);
    await sb("login_attempts?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        key,
        fail_count: count,
        first_fail_at: firstAt,
        locked_until: lockMs ? new Date(now + lockMs).toISOString() : null,
        updated_at: new Date(now).toISOString(),
      },
    });
  }));
}

async function rlClear(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) =>
    sb(`login_attempts?key=eq.${encodeURIComponent(k)}`, { method: "DELETE", prefer: "return=minimal" })
  ));
}

// ── Sesión firmada: base64url(header).base64url(payload).base64url(HMAC-SHA256) ──
interface Session { sub: string; id: string; username: string; role: string; iat: number; exp: number }

let _sessionKey: CryptoKey | null = null;
async function sessionKey(): Promise<CryptoKey> {
  if (_sessionKey) return _sessionKey;
  let raw: Uint8Array;
  if (SESSION_SECRET_ENV) {
    raw = utf8.encode(SESSION_SECRET_ENV);
  } else {
    // Sin PIX_SESSION_SECRET: derivar del service_role key. Conviene definir
    // el secreto propio (ver cabecera) para poder rotar cada uno por separado.
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode("pix-session:" + SERVICE_ROLE_KEY)));
  }
  _sessionKey = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return _sessionKey;
}

async function signSession(payload: Session): Promise<string> {
  const head = b64urlEncode(utf8.encode(JSON.stringify({ alg: "HS256", typ: "PIX" })));
  const body = b64urlEncode(utf8.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(), utf8.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64urlEncode(sig)}`;
}

async function verifySessionToken(token: string | null): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const sig = b64urlDecode(parts[2]);
    // crypto.subtle.verify compara en tiempo constante
    const ok = await crypto.subtle.verify("HMAC", await sessionKey(), sig as BufferSource, utf8.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as Session;
    if (!payload || typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (!payload.id || !payload.username || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

// Verifica el token del header x-pix-session, que la cuenta siga activa
// (desactivar un admin revoca sus sesiones) y que el rol ACTUAL en la base
// esté entre los permitidos.
async function requireSession(req: Request, roles: string[]): Promise<{ sess: Session | null; deny: Response | null }> {
  const invalid = () => json({ ok: false, error: "sesión inválida o expirada" }, 401);
  const sess = await verifySessionToken(req.headers.get("x-pix-session"));
  if (!sess) return { sess: null, deny: invalid() };
  const u = await fetchAdminById(sess.id);
  if (!u || u.active !== true) return { sess: null, deny: invalid() };
  const role = String(u.role);
  if (!roles.includes(role)) return { sess: null, deny: json({ ok: false, error: "sin permisos para esta acción" }, 403) };
  return { sess: { ...sess, role, username: String(u.username) }, deny: null };
}

function actorOf(s: Session): Actor {
  return { username: s.username, id: s.id };
}

// ── Login (admin y técnico) ──────────────────────────────────────────────
async function handleLogin(action: string, body: Json, ip: string): Promise<Response> {
  const username = str(body.username, 80);
  const password = String(body.password ?? "");
  const code = str(body.code, 12);
  if (!username || !password) return json({ error: "faltan credenciales" }, 400);

  const keys = [`${action}:${username.toLowerCase()}`];
  // Clave por IP separada por tipo de login: técnicos equivocándose detrás de
  // una misma NAT no bloquean el Panel (y viceversa).
  if (ip) keys.push(`ip:${action}:${ip}`);

  const retry = await rlRetryAfter(keys);
  if (retry > 0) {
    return json({ ok: false, error: "demasiados intentos, espere", retry_after_s: retry }, 429);
  }

  // Respuesta genérica para no filtrar si el usuario existe
  const deny = async (reason: string): Promise<Response> => {
    await rlFail(keys);
    await logAudit({ username, id: null }, action === "admin-login" ? "login_failed" : "tech_login_failed",
      { type: action === "admin-login" ? "admin_user" : "technician", name: username }, { reason }, ip);
    return json({ ok: false, error: "credenciales inválidas" }, 401);
  };

  const table = action === "admin-login" ? "admin_users" : "technicians";
  const columns = action === "admin-login"
    ? "id,username,full_name,role,password_hash,totp_enabled,totp_secret"
    : "id,username,full_name,role,phone,email,password_hash";
  const u = await fetchByUsername(table, username, columns);
  if (!u) return await deny("user");

  const pw = await verifyPassword(password, u.password_hash as string | null);
  if (!pw.ok) return await deny("password");

  if (action === "admin-login" && u.totp_enabled && u.totp_secret) {
    if (!code) return json({ ok: false, totp_required: true });
    if (!(await verifyTotp(u.totp_secret as string, code))) return await deny("totp");
  }

  // Éxito: limpiar contadores y, si el hash es legacy, migrar a PBKDF2.
  await rlClear(keys);
  const patch: Json = { updated_at: new Date().toISOString() };
  if (pw.rehash) patch.password_hash = await hashPassword(password);
  if (action === "admin-login") patch.last_login_at = new Date().toISOString();
  if (pw.rehash || action === "admin-login") {
    await sb(`${table}?id=eq.${encodeURIComponent(String(u.id))}`, { method: "PATCH", prefer: "return=minimal", body: patch });
  }

  if (action === "tech-login") {
    await logAudit({ username, id: null }, "tech_login", { type: "technician", id: u.id, name: u.username }, { rehashed: pw.rehash }, ip);
    return json({
      ok: true,
      user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, phone: u.phone, email: u.email },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const sess: Session = {
    sub: String(u.id), id: String(u.id), username: String(u.username), role: String(u.role),
    iat: now, exp: now + SESSION_TTL_S,
  };
  const token = await signSession(sess);
  await logAudit(actorOf(sess), "login", { type: "admin_user", id: u.id, name: u.username },
    { rehashed: pw.rehash, totp: !!(u.totp_enabled && u.totp_secret) }, ip);
  // Devolver SOLO identidad, nunca hash ni secreto
  return json({
    ok: true,
    user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role },
    token,
    exp: sess.exp,
  });
}

// ── Acciones autenticadas ────────────────────────────────────────────────
async function handleAdminAction(action: string, req: Request, body: Json, ip: string): Promise<Response> {
  const ADMIN_ONLY = ["admin"];
  const ADMIN_SUP = ["admin", "supervisor"];
  const ANY = ["admin", "supervisor", "viewer"];

  if (action === "session-check") {
    const { sess, deny } = await requireSession(req, ANY);
    if (deny) return deny;
    const u = await fetchAdminById(sess!.id);
    return json({ ok: true, user: { id: u!.id, username: u!.username, full_name: u!.full_name, role: u!.role }, exp: sess!.exp });
  }

  if (action === "audit-list") {
    const { deny } = await requireSession(req, ANY);
    if (deny) return deny;
    const limit = Math.min(500, Math.max(1, parseInt(str(body.limit, 5) || "100", 10) || 100));
    const filter = str(body.action_filter, 40);
    if (filter && !/^[a-z0-9_]+$/.test(filter)) return json({ ok: false, error: "filtro inválido" }, 400);
    const r = await sb(`audit_log?select=*&order=created_at.desc&limit=${limit}` + (filter ? `&action=eq.${filter}` : ""));
    if (!r.ok) return json({ ok: false, error: "no se pudo leer la bitácora" }, 500);
    return json({ ok: true, rows: r.data });
  }

  if (action === "admin-list") {
    const { deny } = await requireSession(req, ADMIN_ONLY);
    if (deny) return deny;
    // Sin password_hash ni totp_secret
    const r = await sb("admin_users?select=id,username,full_name,email,role,active,totp_enabled,created_at,last_login_at&order=created_at.desc");
    if (!r.ok) return json({ ok: false, error: "no se pudo listar" }, 500);
    return json({ ok: true, rows: r.data });
  }

  if (action === "admin-create") {
    const { sess, deny } = await requireSession(req, ADMIN_ONLY);
    if (deny) return deny;
    const username = str(body.username, 40).toLowerCase();
    const full_name = str(body.full_name, 120);
    const email = str(body.email, 160) || null;
    const role = str(body.role, 20) || "admin";
    const password = String(body.password ?? "");
    if (!USERNAME_RE.test(username)) return json({ ok: false, error: "usuario inválido (3-40: a-z 0-9 . _ -)" }, 400);
    if (!full_name) return json({ ok: false, error: "nombre requerido" }, 400);
    if (!ROLES.includes(role)) return json({ ok: false, error: "rol inválido" }, 400);
    if (password.length < MIN_PASSWORD_LEN) return json({ ok: false, error: `contraseña mínima ${MIN_PASSWORD_LEN} caracteres` }, 400);
    const r = await sb("admin_users?select=id,username", {
      method: "POST", prefer: "return=representation",
      body: { username, full_name, email, role, active: true, password_hash: await hashPassword(password) },
    });
    if (isDuplicate(r)) return json({ ok: false, error: "el usuario ya existe" }, 409);
    if (!r.ok) return json({ ok: false, error: "no se pudo crear" }, 500);
    const created = Array.isArray(r.data) ? r.data[0] as Json : null;
    await logAudit(actorOf(sess!), "create_admin", { type: "admin_user", id: created?.id, name: username }, { role }, ip);
    return json({ ok: true, id: created?.id ?? null });
  }

  if (action === "admin-update") {
    const { sess, deny } = await requireSession(req, ADMIN_ONLY);
    if (deny) return deny;
    const id = str(body.id, 60);
    if (!id) return json({ ok: false, error: "id requerido" }, 400);
    const patch: Json = { updated_at: new Date().toISOString() };
    if (body.username !== undefined) {
      const username = str(body.username, 40).toLowerCase();
      if (!USERNAME_RE.test(username)) return json({ ok: false, error: "usuario inválido (3-40: a-z 0-9 . _ -)" }, 400);
      patch.username = username;
    }
    if (body.full_name !== undefined) {
      const full_name = str(body.full_name, 120);
      if (!full_name) return json({ ok: false, error: "nombre requerido" }, 400);
      patch.full_name = full_name;
    }
    if (body.email !== undefined) patch.email = str(body.email, 160) || null;
    if (body.role !== undefined) {
      const role = str(body.role, 20);
      if (!ROLES.includes(role)) return json({ ok: false, error: "rol inválido" }, 400);
      if (id === sess!.id && role !== "admin") return json({ ok: false, error: "no podés quitarte el rol admin a vos mismo" }, 400);
      patch.role = role;
    }
    if (body.active !== undefined) {
      const active = body.active === true || body.active === "true";
      if (id === sess!.id && !active) return json({ ok: false, error: "no podés desactivarte a vos mismo" }, 400);
      patch.active = active;
    }
    const r = await sb(`admin_users?id=eq.${encodeURIComponent(id)}&select=id,username`, {
      method: "PATCH", prefer: "return=representation", body: patch,
    });
    if (isDuplicate(r)) return json({ ok: false, error: "el usuario ya existe" }, 409);
    if (!r.ok) return json({ ok: false, error: "no se pudo actualizar" }, 500);
    const row = Array.isArray(r.data) ? r.data[0] as Json : null;
    if (!row) return json({ ok: false, error: "admin no encontrado" }, 404);
    const { updated_at: _u, ...changed } = patch;
    await logAudit(actorOf(sess!), patch.active === false ? "delete_admin" : "update_admin",
      { type: "admin_user", id, name: row.username }, { fields: Object.keys(changed) }, ip);
    return json({ ok: true });
  }

  if (action === "admin-set-password" || action === "tech-set-password") {
    const isAdminTarget = action === "admin-set-password";
    const { sess, deny } = await requireSession(req, isAdminTarget ? ADMIN_ONLY : ADMIN_SUP);
    if (deny) return deny;
    const id = str(body.id, 60);
    const password = String(body.password ?? "");
    if (!id) return json({ ok: false, error: "id requerido" }, 400);
    if (password.length < MIN_PASSWORD_LEN) return json({ ok: false, error: `contraseña mínima ${MIN_PASSWORD_LEN} caracteres` }, 400);
    const table = isAdminTarget ? "admin_users" : "technicians";
    const r = await sb(`${table}?id=eq.${encodeURIComponent(id)}&select=id,username`, {
      method: "PATCH", prefer: "return=representation",
      body: { password_hash: await hashPassword(password), updated_at: new Date().toISOString() },
    });
    if (!r.ok) return json({ ok: false, error: "no se pudo actualizar" }, 500);
    const row = Array.isArray(r.data) ? r.data[0] as Json : null;
    if (!row) return json({ ok: false, error: "no encontrado" }, 404);
    await logAudit(actorOf(sess!), isAdminTarget ? "reset_admin_pw" : "reset_pw",
      { type: isAdminTarget ? "admin_user" : "technician", id, name: row.username }, {}, ip);
    return json({ ok: true });
  }

  if (action === "admin-set-totp") {
    const { sess, deny } = await requireSession(req, ADMIN_ONLY);
    if (deny) return deny;
    const id = str(body.id, 60);
    const enabled = body.enabled === true || body.enabled === "true";
    const secret = str(body.secret, 128).toUpperCase();
    if (!id) return json({ ok: false, error: "id requerido" }, 400);
    let patch: Json;
    if (enabled) {
      // El secreto lo genera el cliente (para mostrar el QR) y viaja SOLO por
      // esta función; se valida que sea base32 de al menos 80 bits.
      let bytes: Uint8Array;
      try { bytes = base32Decode(secret); } catch { return json({ ok: false, error: "secreto inválido" }, 400); }
      if (bytes.length < 10) return json({ ok: false, error: "secreto demasiado corto" }, 400);
      patch = { totp_secret: secret, totp_enabled: true, updated_at: new Date().toISOString() };
    } else {
      patch = { totp_secret: null, totp_enabled: false, updated_at: new Date().toISOString() };
    }
    const r = await sb(`admin_users?id=eq.${encodeURIComponent(id)}&select=id,username`, {
      method: "PATCH", prefer: "return=representation", body: patch,
    });
    if (!r.ok) return json({ ok: false, error: "no se pudo actualizar" }, 500);
    const row = Array.isArray(r.data) ? r.data[0] as Json : null;
    if (!row) return json({ ok: false, error: "admin no encontrado" }, 404);
    await logAudit(actorOf(sess!), enabled ? "enable_2fa" : "disable_2fa", { type: "admin_user", id, name: row.username }, {}, ip);
    return json({ ok: true });
  }

  return json({ error: "acción desconocida" }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  let body: Json;
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "json inválido" }, 400);

  const action = str(body.action, 40);
  if (!action) return json({ error: "acción requerida" }, 400);
  // Primer salto de x-forwarded-for (lo fija el gateway de Supabase)
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64);

  try {
    if (action === "admin-login" || action === "tech-login") return await handleLogin(action, body, ip);
    return await handleAdminAction(action, req, body, ip);
  } catch (e) {
    console.error("[pix-auth]", action, e instanceof Error ? e.message : e);
    return json({ ok: false, error: "error interno" }, 500);
  }
});
