/* ============================================================
   VP Education Group: interactions
   ============================================================ */

/* ------------------------------------------------------------
   CONFIG: paste your Google Form link between the quotes below
   and the "fill out the intake form" link will appear.
   ------------------------------------------------------------ */
const INTAKE_FORM_URL = "";

/* ------------------------------------------------------------
   Reviews: a Parents tab and a Students tab
   The reviews written into the site (TESTIMONIALS) live in
   translations.js, one entry per family, with every language for
   each quote. Reviews families send through a personal link are
   added after the owner approves them: /api/testimonials returns
   them, already translated. Review text is only ever set as text
   (textContent), never as HTML.
   ------------------------------------------------------------ */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* Each figure carries the other languages' text invisibly (see
   styles.css .i18n-h) so the tile is the same height in every one. */
function reviewFigure(voice, kind, lang) {
  const labelKey = kind === "parent" ? "Parent" : "Student";
  const shown = voice.quote[lang] || voice.quote.en;
  const fig = el("figure", "review");

  const stars = el("div", "stars", "★★★★★");
  stars.setAttribute("aria-label", VB_I18N.translate("5 out of 5 stars", lang));

  const quoteBox = el("p", "i18n-h");
  quoteBox.append(el("span", undefined, shown));
  const blockquote = el("blockquote");
  blockquote.append(quoteBox);

  const label = el("span", "i18n-h");
  label.append(el("span", undefined, VB_I18N.translate(labelKey, lang)));
  const caption = el("figcaption");
  caption.append(el("strong", undefined, voice.name), label);

  fig.append(stars, blockquote, caption);
  VB_I18N.setGhosts(
    quoteBox,
    VB_I18N.LANG_CODES.filter((l) => l !== lang).map((l) => ({ lang: l, text: voice.quote[l] || voice.quote.en })),
    shown
  );
  VB_I18N.setGhosts(label, VB_I18N.ghostsFor(labelKey, lang), VB_I18N.translate(labelKey, lang));
  return fig;
}

/* Approved reviews from families, added after the ones in the code */
let familyReviews = [];

/* Rebuilt whenever the language changes, and once family reviews arrive. */
function buildReviews() {
  const lang = VB_I18N.currentLang();
  const parents = document.getElementById("panel-parents");
  const students = document.getElementById("panel-students");

  parents.textContent = "";
  students.textContent = "";
  TESTIMONIALS.forEach((t) => {
    if (t.parent) parents.appendChild(reviewFigure(t.parent, "parent", lang));
    if (t.student) students.appendChild(reviewFigure(t.student, "student", lang));
  });
  familyReviews.forEach((r) => {
    (r.kind === "student" ? students : parents).appendChild(reviewFigure(r, r.kind, lang));
  });

  document.getElementById("count-parents").textContent = parents.children.length;
  document.getElementById("count-students").textContent = students.children.length;
}

buildReviews();
document.addEventListener("langchange", buildReviews);

fetch("/api/testimonials")
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => {
    const list = Array.isArray(data?.reviews) ? data.reviews : [];
    familyReviews = list.filter((r) => r && typeof r.name === "string" && r.quote && typeof r.quote.en === "string"
      && (r.kind === "parent" || r.kind === "student"));
    if (familyReviews.length) buildReviews();
  })
  .catch(() => { /* the reviews written into the site still show */ });

const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];

function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
}

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    selectTab(next);
  });
});

/* ------------------------------------------------------------
   Mobile nav
   ------------------------------------------------------------ */
const navToggle = document.getElementById("nav-toggle");
const siteNav = document.getElementById("site-nav");

navToggle.addEventListener("click", () => {
  const open = siteNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});
siteNav.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    siteNav.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  })
);

/* ------------------------------------------------------------
   Sticky mobile CTA: shows after the hero, hides once the
   closing consultation note or the referral form is on screen
   ------------------------------------------------------------ */
const stickyCta = document.getElementById("sticky-cta");
const hero = document.querySelector(".hero");
const closingNote = document.getElementById("svc-more");

let heroVisible = true;
let closingVisible = false;
let referVisible = false;   // the referral form needs the whole screen

function updateSticky() {
  const show = !heroVisible && !closingVisible && !referVisible;
  stickyCta.hidden = !show;
  stickyCta.classList.toggle("visible", show);
}

new IntersectionObserver(
  ([e]) => { heroVisible = e.isIntersecting; updateSticky(); },
  { threshold: 0.05 }
).observe(hero);

new IntersectionObserver(
  ([e]) => { closingVisible = e.isIntersecting; updateSticky(); },
  { threshold: 0.05 }
).observe(closingNote);

const referSection = document.getElementById("refer");
if (referSection) {
  new IntersectionObserver(
    ([e]) => { referVisible = e.isIntersecting; updateSticky(); },
    { threshold: 0 }
  ).observe(referSection);
}

/* ------------------------------------------------------------
   Intake form link (appears once INTAKE_FORM_URL is set)
   ------------------------------------------------------------ */
const intakeLink = document.getElementById("intake-form-link");
if (INTAKE_FORM_URL) {
  intakeLink.href = INTAKE_FORM_URL;
  intakeLink.hidden = false;
}

/* ------------------------------------------------------------
   Refer a family: checks the form, sends it to /api/referral as
   JSON, and shows every message in the visitor's language. Without
   JavaScript the form posts normally and the server redirects back
   with ?referral=sent|error|busy.
   ------------------------------------------------------------ */
const referForm = document.getElementById("refer-form");
if (referForm) {
  const t = (text) => (window.VB_I18N ? VB_I18N.translate(text, VB_I18N.currentLang()) : text);
  const MESSAGES = {
    required: "Please fill this in.",
    email: "Enter a valid email address.",
    phone: "Enter a valid phone number.",
    too_long: "This is too long.",
    role: "Choose parent or student.",
    contact: "Add their email or phone number.",
    consent: "Please confirm they know you're sharing their details.",
    check: "Please check the highlighted fields.",
    busy: "Too many referrals right now. Please try again later.",
    failed: "Something went wrong. Please try again, or email us at vbmgroupsllc@gmail.com.",
    sending: "Sending...",
  };
  // field -> [the error slot, the control that gets aria-invalid]
  const FIELDS = {
    referrer_name: ["ref-name-error", "ref-name"],
    referrer_email: ["ref-email-error", "ref-email"],
    referrer_role: ["ref-role-error", null],
    family_name: ["ref-family-error", "ref-family"],
    family_email: ["ref-family-email-error", "ref-family-email"],
    family_phone: ["ref-family-phone-error", "ref-family-phone"],
    family_contact: ["ref-contact-error", null],
    grade: ["ref-grade-error", "ref-grade"],
    subjects: ["ref-subjects-error", "ref-subjects"],
    note: ["ref-note-error", "ref-note"],
    consent: ["ref-consent-error", "ref-consent"],
  };
  const MESSAGE_FOR = { referrer_role: "role", family_contact: "contact", consent: "consent" };
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const PHONE_RE = /^[0-9+(). -]{7,30}$/;
  const statusEl = document.getElementById("ref-status");
  const submitBtn = document.getElementById("ref-submit");
  let shownErrors = {};
  let shownStatus = null;     // { key, error }
  let sending = false;

  const startedInput = document.getElementById("ref-started");
  const resetStarted = () => { startedInput.value = String(Date.now()); };
  resetStarted();

  function values() {
    const data = Object.fromEntries(new FormData(referForm));
    data.consent = document.getElementById("ref-consent").checked;
    data.language = window.VB_I18N ? VB_I18N.currentLang() : "en";
    return data;
  }

  // The same rules the server applies, so most mistakes show at once
  function check(data) {
    const v = (k) => String(data[k] ?? "").trim();
    const errors = {};
    if (!v("referrer_name")) errors.referrer_name = "required";
    if (!v("referrer_email")) errors.referrer_email = "required";
    else if (!EMAIL_RE.test(v("referrer_email"))) errors.referrer_email = "email";
    if (!["parent", "student"].includes(v("referrer_role"))) errors.referrer_role = "required";
    if (!v("family_name")) errors.family_name = "required";
    if (v("family_email") && !EMAIL_RE.test(v("family_email"))) errors.family_email = "email";
    if (v("family_phone") && !PHONE_RE.test(v("family_phone"))) errors.family_phone = "phone";
    if (!v("family_email") && !v("family_phone")) errors.family_contact = "required";
    if (!data.consent) errors.consent = "required";
    return errors;
  }

  function drawErrors() {
    for (const [field, [slotId, controlId]] of Object.entries(FIELDS)) {
      const code = shownErrors[field];
      const slot = document.getElementById(slotId);
      slot.textContent = code ? t(MESSAGES[MESSAGE_FOR[field] ?? code] ?? MESSAGES.required) : "";
      const control = controlId ? document.getElementById(controlId) : null;
      if (control) {
        if (code) {
          control.setAttribute("aria-invalid", "true");
          control.setAttribute("aria-errormessage", slotId);
        } else {
          control.removeAttribute("aria-invalid");
          control.removeAttribute("aria-errormessage");
        }
      }
    }
  }

  function drawStatus() {
    statusEl.textContent = shownStatus ? t(MESSAGES[shownStatus.key]) : "";
    statusEl.classList.toggle("is-error", Boolean(shownStatus?.error));
  }

  function setStatus(key, error = false) {
    shownStatus = key ? { key, error } : null;
    drawStatus();
  }

  function focusFirstError() {
    for (const [field, [, controlId]] of Object.entries(FIELDS)) {
      if (!shownErrors[field]) continue;
      const target = controlId ? document.getElementById(controlId)
        : field === "referrer_role" ? referForm.querySelector('input[name="referrer_role"]')
        : document.getElementById("ref-family-email");
      target?.focus();
      return;
    }
  }

  function showDone() {
    const done = document.createElement("div");
    done.className = "refer-done";
    done.setAttribute("tabindex", "-1");
    const title = document.createElement("h3");
    const text = document.createElement("p");
    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn-primary";
    const paint = () => {
      title.textContent = t("Thank you!");
      text.textContent = t("We'll reach out to them soon. Thanks for thinking of us.");
      again.textContent = t("Refer another family");
    };
    paint();
    document.addEventListener("langchange", paint);
    again.addEventListener("click", () => {
      document.removeEventListener("langchange", paint);
      referForm.reset();
      resetStarted();
      shownErrors = {};
      drawErrors();
      setStatus(null);
      done.replaceWith(referForm);
      document.getElementById("ref-name").focus();
    });
    done.append(title, text, again);
    referForm.replaceWith(done);
    done.focus();
  }

  referForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    const data = values();
    shownErrors = check(data);
    drawErrors();
    if (Object.keys(shownErrors).length) {
      setStatus("check", true);
      focusFirstError();
      return;
    }
    sending = true;
    submitBtn.disabled = true;
    setStatus("sending");
    try {
      const response = await fetch("/api/referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setStatus(null);
        showDone();
      } else if (response.status === 422 && body.errors) {
        shownErrors = body.errors;
        drawErrors();
        setStatus("check", true);
        focusFirstError();
      } else {
        setStatus(response.status === 429 ? "busy" : "failed", true);
      }
    } catch {
      setStatus("failed", true);
    } finally {
      sending = false;
      submitBtn.disabled = false;
    }
  });

  // A fixed field clears its own message
  referForm.addEventListener("input", (event) => {
    const name = event.target.name;
    if (!name) return;
    const changed = { ...shownErrors };
    delete changed[name];
    if (name === "family_email" || name === "family_phone") delete changed.family_contact;
    if (Object.keys(changed).length !== Object.keys(shownErrors).length) {
      shownErrors = changed;
      drawErrors();
      if (!Object.keys(shownErrors).length && shownStatus?.key === "check") setStatus(null);
    }
  });

  document.addEventListener("langchange", () => { drawErrors(); drawStatus(); });

  // Coming back from a form post made without JavaScript
  const result = new URLSearchParams(location.search).get("referral");
  if (result === "sent") showDone();
  else if (result === "busy") setStatus("busy", true);
  else if (result === "error") setStatus("failed", true);
}
