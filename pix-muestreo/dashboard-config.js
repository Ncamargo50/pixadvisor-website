// PIX Muestreo Dashboard — Runtime Configuration
// Override these values for your Supabase project. Loaded BEFORE dashboard.js.
// To rotate Supabase keys without bumping dashboard.html: edit only this file.
// Notas:
//   • La anon key es PÚBLICA por diseño (viaja en cada request del navegador y
//     del APK); ocultarla aquí no aporta seguridad. Lo que protege los datos
//     son las políticas RLS y los GRANT por columna (sql/011_security_hardening.sql)
//     y la Edge Function pix-auth (sesión firmada + service_role del lado servidor).
//   • NUNCA poner aquí la service_role key.
window.PIX_CONFIG = window.PIX_CONFIG || {
  SUPABASE_URL: 'https://fnoocboaupjmxpkhdnij.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZub29jYm9hdXBqbXhwa2hkbmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzA3MTYsImV4cCI6MjA5MTM0NjcxNn0.WCoLdveWAwpcwzWpvLFSgQeXeot6X263DTffdEWoCfg',
  // Tunables (override only if you know what you're doing)
  INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_BASE_MS: 60 * 1000,
  REALTIME_RECONNECT_MAX_S: 300
};
