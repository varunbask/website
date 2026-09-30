/* ============================================================
   Log in page

   One form with a Student / Tutor toggle. The toggle decides where
   a successful sign-in lands, and the Tutor side only accepts an
   account that has the tutor role. "?as=tutor" preselects Tutor.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const DESTINATION = { student: "../submissions/", tutor: "../dashboard/" };
  const HINT = {
    student: "Sign in to submit your homework.",
    tutor: "Sign in to review and grade submissions."
  };

  const radios = [...document.querySelectorAll('input[name="role"]')];
  const hint = document.getElementById("login-hint");
  const form = document.getElementById("login-form");
  const button = document.getElementById("login-btn");
  const message = document.getElementById("login-message");

  const currentRole = () => radios.find((r) => r.checked).value;

  function showRole() {
    const role = currentRole();
    hint.textContent = HINT[role];
    button.textContent = `Sign in as ${role}`;
    message.hidden = true;
  }

  function fail(text) {
    message.textContent = text;
    message.hidden = false;
    button.disabled = false;
    button.textContent = `Sign in as ${currentRole()}`;
  }

  function showSignedIn(session) {
    const tutor = VP_AUTH.isTutor(session);
    document.getElementById("login-panel").hidden = true;
    document.getElementById("signed-in-panel").hidden = false;
    document.getElementById("signed-in-email").textContent = session.user.email;
    const go = document.getElementById("continue-btn");
    go.href = DESTINATION[tutor ? "tutor" : "student"];
    go.textContent = tutor ? "Go to the tutor dashboard" : "Go to homework submission";
  }

  if (new URLSearchParams(window.location.search).get("as") === "tutor") {
    radios.find((r) => r.value === "tutor").checked = true;
  }
  radios.forEach((r) => r.addEventListener("change", showRole));
  showRole();

  document.getElementById("sign-out-btn").addEventListener("click", async () => {
    await VP_AUTH.signOut({ redirect: false });
    window.location.reload();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = currentRole();
    message.hidden = true;
    button.disabled = true;
    button.textContent = "Signing in...";

    const { session, error } = await VP_AUTH.signIn(
      document.getElementById("login-email").value,
      document.getElementById("login-password").value
    );

    if (error) {
      fail(error.message);
    } else if (role === "tutor" && !VP_AUTH.isTutor(session)) {
      await VP_AUTH.signOut({ redirect: false });
      fail("This account does not have tutor access. Choose Student to sign in with it.");
    } else {
      window.location.href = DESTINATION[role];
    }
  });

  const session = await VP_AUTH.getSession();
  if (session) showSignedIn(session);
});
