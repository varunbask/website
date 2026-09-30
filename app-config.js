/* ============================================================
   Homework app config

   The site is static on Vercel and the Express API runs elsewhere,
   so the pages need an absolute API base. The Supabase URL and anon
   key are public by design (the anon key only works within RLS).
   ============================================================ */

window.VP_APP_CONFIG = {
  apiBase: "http://localhost:3000",
  supabaseUrl: "https://enwrankobjdivyxhmwus.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVud3JhbmtvYmpkaXZ5eGhtd3VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NTcyMzUsImV4cCI6MjEwNjAzMzIzNX0.3HfULIqHykg0In4uwOQ7JeWg4tWbvp9JV8Gn22sK660",
};
