// ============================================================================
// pix-auth — Edge Function de login del lado SERVIDOR (Supabase / Deno)
//
// Reemplaza la verificación de contraseña que hoy ocurre en el navegador
// (donde el cliente baja password_hash/totp_secret con la clave anónima).
// Aquí la verificación corre con el service_role, que NUNCA sale al cliente:
// el hash y el secreto TOTP jamás se devuelven.
//
// Deploy: dashboard "Via Editor" o `supabase functions deploy pix-auth --no-verify-jwt`.
//   SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta la plataforma sola (sin secretos manuales).
//
// El cliente llama:  POST https://<proj>.supabase.co/functions/v1/pix-auth
//   body: { action: 'admin-login' | 'tech-login', username, password, code? }
//   headers: { apikey: <anon>, Authorization: Bearer <anon>, Content-Type: application/json }
// ============================================================================

// Supabase inyecta estas variables automáticamente en toda Edge Function.
// No hace falta configurar ningún secreto manual.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Hash de contraseña: replica pixHashSalted/pixVerify del cliente ──
// Formato almacenado: "<salt>:<sha256hex(salt+plain)>"  (o legacy: sha256hex(plain))
async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(plain: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) return false;
  if (storedHash.includes(":")) {
    const [salt, hash] = storedHash.split(":");
    return (await sha256Hex(salt + plain)) === hash;
  }
  // legacy sin sal
  return (await sha256Hex(plain)) === storedHash;
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
    "raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
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

// ── Acceso a la tabla con service_role (bypassa RLS, solo del lado servidor) ──
async function fetchOne(table: string, username: string, columns: string): Promise<Record<string, unknown> | null> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?username=eq.${encodeURIComponent(username)}&active=eq.true&select=${columns}`;
  const r = await fetch(url, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  let body: { action?: string; username?: string; password?: string; code?: string };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }

  const { action, username, password, code } = body;
  if (!action || !username || !password) return json({ error: "faltan credenciales" }, 400);

  // Respuesta genérica para no filtrar si el usuario existe
  const DENY = json({ ok: false, error: "credenciales inválidas" }, 401);

  if (action === "admin-login") {
    const u = await fetchOne("admin_users", username,
      "id,username,full_name,role,password_hash,totp_enabled,totp_secret");
    if (!u || !(await verifyPassword(password, u.password_hash as string))) return DENY;

    if (u.totp_enabled && u.totp_secret) {
      if (!code) return json({ ok: false, totp_required: true });
      if (!(await verifyTotp(u.totp_secret as string, String(code).trim()))) return DENY;
    }
    // last_login del lado servidor (el PATCH anónimo del cliente ya no aplica)
    await fetch(`${SUPABASE_URL}/rest/v1/admin_users?id=eq.${u.id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ last_login_at: new Date().toISOString() }),
    }).catch(() => {});
    // Devolver SOLO identidad, nunca hash ni secreto
    return json({
      ok: true,
      user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role },
    });
  }

  if (action === "tech-login") {
    const u = await fetchOne("technicians", username,
      "username,password_hash,full_name,role,phone,email");
    if (!u || !(await verifyPassword(password, u.password_hash as string))) return DENY;
    return json({
      ok: true,
      user: { username: u.username, full_name: u.full_name, role: u.role, phone: u.phone, email: u.email },
    });
  }

  return json({ error: "acción desconocida" }, 400);
});
