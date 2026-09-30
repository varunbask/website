/* ============================================================
   Homework app auth

   Needs app-config.js and supabase-js loaded first. Signing in
   happens on the log in page (login/). The app pages call
   requireSession(), which sends a signed-out visitor there, and
   apiFetch(), which calls the Express API with the session's
   access token. Every app page sits one folder below the site root.
   ============================================================ */

const VP_AUTH = (() => {
  const config = window.VP_APP_CONFIG;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  const loginUrl = (role) => new URL(`../login/?as=${role}`, window.location.href).href;

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  const isTutor = (session) => session?.user?.app_metadata?.role === "tutor";

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    return { session: data.session, error };
  }

  /* Resolves with the session, or leaves for the log in page with the
     Student or Tutor side of its toggle already chosen. */
  async function requireSession(role = "student") {
    const session = await getSession();
    if (session) return session;
    window.location.replace(loginUrl(role));
    return new Promise(() => {});
  }

  async function apiFetch(path, options = {}) {
    const session = await getSession();
    const headers = new Headers(options.headers);
    if (session) headers.set("Authorization", `Bearer ${session.access_token}`);
    return fetch(config.apiBase + path, { ...options, headers });
  }

  async function signOut({ redirect = true } = {}) {
    await client.auth.signOut();
    if (redirect) window.location.href = loginUrl("student");
  }

  return { getSession, isTutor, signIn, requireSession, apiFetch, signOut };
})();
