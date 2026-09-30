/* ============================================================
   Homework app auth

   Needs app-config.js and supabase-js loaded first. requireSession()
   shows a sign-in form in place of the page's <main> until the viewer
   signs in, then resolves with the Supabase session. apiFetch() calls
   the Express API with the session's access token.
   ============================================================ */

const VP_AUTH = (() => {
  const config = window.VP_APP_CONFIG;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  function renderSignIn(main, onSignedIn) {
    const gate = document.createElement("section");
    gate.className = "section-inner";
    gate.style.cssText = "max-width: 600px; margin: 88px auto;";
    gate.innerHTML = `
      <div class="submission-card">
        <h2>Sign in</h2>
        <form id="sign-in-form">
          <div class="form-group">
            <label for="sign-in-email" class="mono">Email</label>
            <input type="email" id="sign-in-email" required autocomplete="email">
          </div>
          <div class="form-group">
            <label for="sign-in-password" class="mono">Password</label>
            <input type="password" id="sign-in-password" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary">Sign in</button>
        </form>
        <div class="form-message error" hidden></div>
      </div>
    `;
    main.hidden = true;
    main.before(gate);

    const message = gate.querySelector(".form-message");
    gate.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      message.hidden = true;
      const { data, error } = await client.auth.signInWithPassword({
        email: gate.querySelector("#sign-in-email").value,
        password: gate.querySelector("#sign-in-password").value,
      });
      if (error) {
        message.textContent = error.message;
        message.hidden = false;
        return;
      }
      gate.remove();
      main.hidden = false;
      onSignedIn(data.session);
    });
  }

  async function requireSession() {
    const { data } = await client.auth.getSession();
    if (data.session) return data.session;
    return new Promise((resolve) => renderSignIn(document.getElementById("main"), resolve));
  }

  async function apiFetch(path, options = {}) {
    const { data } = await client.auth.getSession();
    const headers = new Headers(options.headers);
    if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    return fetch(config.apiBase + path, { ...options, headers });
  }

  async function signOut() {
    await client.auth.signOut();
    window.location.reload();
  }

  return { requireSession, apiFetch, signOut };
})();
