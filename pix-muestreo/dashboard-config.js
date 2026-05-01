// PIX Muestreo Dashboard — Runtime Configuration
// Override these values for your Supabase project. Loaded BEFORE dashboard.js.
// To rotate Supabase keys without bumping dashboard.html: edit only this file.
// Notes:
//   • Anon key is safe to expose ONLY when RLS policies are correctly configured.
//   • For tighter security, leave SUPABASE_KEY empty here and set it via
//     `sessionStorage.setItem('pix_dash_key', '...')` in DevTools before login.
window.PIX_CONFIG = window.PIX_CONFIG || {
  SUPABASE_URL: 'https://fnoocboaupjmxpkhdnij.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZub29jYm9hdXBqbXhwa2hkbmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzA3MTYsImV4cCI6MjA5MTM0NjcxNn0.WCoLdveWAwpcwzWpvLFSgQeXeot6X263DTffdEWoCfg',
  // Tunables (override only if you know what you're doing)
  INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_BASE_MS: 60 * 1000,
  REALTIME_RECONNECT_MAX_S: 300
};
