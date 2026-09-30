/* ============================================================
   Homework app config

   The site is static on Vercel and the Express API runs elsewhere,
   so the pages need an absolute API base. The Supabase URL and anon
   key are public by design (the anon key only works within RLS).
   ============================================================ */

window.VP_APP_CONFIG = {
  apiBase: "http://localhost:3000",
  supabaseUrl: "https://placeholder.supabase.co",
  supabaseAnonKey: "placeholder-key",
};
