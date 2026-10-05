/* ============================================================
   VP Education Group: write a review (review.html?t=TOKEN)

   A family opens their personal link, writes a review and sends it to
   /api/testimonials. The token comes from the address; it is checked
   first so a used or expired link says so at once. Every message shows
   in the visitor's language (translations.js through VB_I18N).
   ============================================================ */
(function () {
  const t = (text) => (window.VB_I18N ? VB_I18N.translate(text, VB_I18N.currentLang()) : text);
  const MESSAGES = {
    required: "Please fill this in.",
    too_long: "This is too long.",
    too_short: "Please write a little more (at least 20 characters).",
    consent: "Please confirm we may show your review.",
    check: "Please check the highlighted fields.",
    sending: "Sending...",
    failed: "Something went wrong. Please try again, or email us at vbmgroupsllc@gmail.com.",
    invalid: "This review link doesn't work. Please ask us for a new one.",
    used: "This review link has already been used. Thank you for your review!",
    expired: "This review link has expired. Please ask us for a new one.",
  };
  const FIELDS = { name: ["rw-name-error", "rw-name"], quote: ["rw-quote-error", "rw-quote"], consent: ["rw-consent-error", "rw-consent"] };

  const form = document.getElementById("review-form");
  const problemEl = document.getElementById("rw-problem");
  const statusEl = document.getElementById("rw-status");
  const submitBtn = document.getElementById("rw-submit");
  const token = new URLSearchParams(location.search).get("t") || "";
  const startedAt = Date.now();
  let errors = {};
  let status = null;     // { key, error }
  let problem = null;    // a key of MESSAGES for an unusable link
  let sending = false;

  // Keep the token out of the address bar and out of the history once read
  if (token && history.replaceState) history.replaceState(null, "", location.pathname);

  function draw() {
    for (const [field, [slotId, controlId]] of Object.entries(FIELDS)) {
      const code = errors[field];
      document.getElementById(slotId).textContent = code ? t(MESSAGES[field === "consent" ? "consent" : code] || MESSAGES.required) : "";
      const control = document.getElementById(controlId);
      if (code) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
    statusEl.textContent = status ? t(MESSAGES[status.key]) : "";
    statusEl.classList.toggle("is-error", Boolean(status && status.error));
    problemEl.textContent = problem ? t(MESSAGES[problem]) : "";
    problemEl.hidden = !problem;
  }

  function showProblem(key) {
    problem = key;
    form.hidden = true;
    draw();
  }

  function showDone() {
    const done = document.createElement("div");
    done.className = "refer-done";
    done.setAttribute("tabindex", "-1");
    const title = document.createElement("h2");
    const text = document.createElement("p");
    const paint = () => {
      title.textContent = t("Thank you!");
      text.textContent = t("We've received your review. It will appear on our website once we've had a look.");
    };
    paint();
    document.addEventListener("langchange", paint);
    done.append(title, text);
    form.replaceWith(done);
    done.focus();
  }

  function check(data) {
    const e = {};
    const name = String(data.name || "").trim();
    const quote = String(data.quote || "").trim();
    if (!name) e.name = "required";
    else if (name.length > 80) e.name = "too_long";
    if (!quote) e.quote = "required";
    else if (quote.length < 20) e.quote = "too_short";
    else if (quote.length > 2000) e.quote = "too_long";
    if (!data.consent) e.consent = "required";
    return e;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    const data = {
      action: "submit",
      t: token,
      name: document.getElementById("rw-name").value,
      quote: document.getElementById("rw-quote").value,
      consent: document.getElementById("rw-consent").checked,
      website: form.querySelector('input[name="website"]').value,
      started: String(startedAt),
    };
    errors = check(data);
    if (Object.keys(errors).length) {
      status = { key: "check", error: true };
      draw();
      const first = Object.keys(FIELDS).find((f) => errors[f]);
      document.getElementById(FIELDS[first][1]).focus();
      return;
    }
    sending = true;
    submitBtn.disabled = true;
    status = { key: "sending" };
    draw();
    try {
      const response = await fetch("/api/testimonials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        status = null;
        draw();
        showDone();
      } else if (response.status === 422 && body.errors) {
        errors = body.errors;
        status = { key: "check", error: true };
        draw();
      } else if (["used", "expired", "invalid"].includes(body.error)) {
        showProblem(body.error);
      } else {
        status = { key: "failed", error: true };
        draw();
      }
    } catch {
      status = { key: "failed", error: true };
      draw();
    } finally {
      sending = false;
      submitBtn.disabled = false;
    }
  });

  form.addEventListener("input", (event) => {
    const name = event.target.name;
    if (name && errors[name]) {
      delete errors[name];
      if (!Object.keys(errors).length && status && status.key === "check") status = null;
      draw();
    }
  });
  document.addEventListener("langchange", draw);

  // Check the link before showing the form
  if (!token) {
    showProblem("invalid");
    return;
  }
  fetch(`/api/testimonials?t=${encodeURIComponent(token)}`)
    .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
    .then(({ ok, body }) => {
      if (!ok) {
        showProblem(["used", "expired"].includes(body.error) ? body.error : "invalid");
        return;
      }
      const name = document.getElementById("rw-name");
      if (body.name && !name.value) name.value = body.name;
      form.hidden = false;
      draw();
    })
    .catch(() => showProblem("invalid"));
})();
