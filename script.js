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
  stars.setAttribute("role", "img");
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
    let next;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    else return;
    e.preventDefault();
    next.focus();
    selectTab(next);
  });
});

/* ------------------------------------------------------------
   Team photos: if one fails to load, remove it so the initials
   behind it show. Handles images that already failed before this
   script ran (complete, but with no width) as well as later ones.
   ------------------------------------------------------------ */
document.querySelectorAll(".member-photo img").forEach((img) => {
  if (img.complete && !img.naturalWidth) img.remove();
  else img.addEventListener("error", () => img.remove(), { once: true });
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
let bookVisible = false;    // and so does the booking form

function updateSticky() {
  const show = !heroVisible && !closingVisible && !referVisible && !bookVisible;
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

const bookSection = document.getElementById("book");
if (bookSection) {
  new IntersectionObserver(
    ([e]) => { bookVisible = e.isIntersecting; updateSticky(); },
    { threshold: 0 }
  ).observe(bookSection);
}

/* ------------------------------------------------------------
   Intake form link (appears once INTAKE_FORM_URL is set)
   ------------------------------------------------------------ */
const intakeLink = document.getElementById("intake-form-link");
if (INTAKE_FORM_URL) {
  intakeLink.href = INTAKE_FORM_URL;
  intakeLink.hidden = false;
}

/* The same rules the server applies (api/_lib/referral.js) */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+(). -]{7,30}$/;

/* The server drops a form sent faster than a person could fill it (a bot check).
   The page times itself from the first touch of the form, with a clock that
   cannot be wrong (performance.now), and sends the milliseconds as `elapsed`.
   A quick but real fill, such as autofill and then Enter, waits out the rest of
   the minimum before sending, so it is never mistaken for a bot. minMs matches
   the server's minimum for that form. */
function fillTimer(form, minMs) {
  let touched = null;
  const touch = () => { if (touched === null) touched = performance.now(); };
  form.addEventListener("focusin", touch);
  form.addEventListener("input", touch);
  return {
    reset() { touched = null; },
    async waitOut() {
      touch();
      const left = minMs + 100 - (performance.now() - touched);
      if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
      return Math.round(performance.now() - touched);
    },
  };
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
  const statusEl = document.getElementById("ref-status");
  const submitBtn = document.getElementById("ref-submit");
  let shownErrors = {};
  let shownStatus = null;     // { key, error }
  let sending = false;

  const timer = fillTimer(referForm, 3000);

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
      done.replaceWith(referForm);   // back in the page first, so its messages can be cleared
      referForm.reset();
      timer.reset();
      shownErrors = {};
      drawErrors();
      setStatus(null);
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
      data.elapsed = await timer.waitOut();
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

  // (while the thank-you shows, the form is out of the page)
  document.addEventListener("langchange", () => { if (referForm.isConnected) { drawErrors(); drawStatus(); } });

  // Coming back from a form post made without JavaScript
  const result = new URLSearchParams(location.search).get("referral");
  if (result === "sent") showDone();
  else if (result === "busy") setStatus("busy", true);
  else if (result === "error") setStatus("failed", true);
}

/* ------------------------------------------------------------
   Book a free consultation: the same approach as the referral form
   above (check, send as JSON to /api/referral with kind
   "consultation", every message in the visitor's language). Without
   JavaScript the form posts normally and the server redirects back
   with ?consultation=sent|error|busy.
   ------------------------------------------------------------ */
const bookForm = document.getElementById("book-form");
if (bookForm) {
  const t = (text) => (window.VB_I18N ? VB_I18N.translate(text, VB_I18N.currentLang()) : text);
  const MESSAGES = {
    required: "Please fill this in.",
    email: "Enter a valid email address.",
    phone: "Enter a valid phone number.",
    phone_needed: "Add a phone number so we can call or text you.",
    too_long: "This is too long.",
    check: "Please check the highlighted fields.",
    busy: "Too many requests right now. Please try again later.",
    failed: "Something went wrong. Please try again, or email us at vbmgroupsllc@gmail.com.",
    sending: "Sending...",
  };
  // field -> [the error slot, the control that gets aria-invalid]
  const FIELDS = {
    name: ["book-name-error", "book-name"],
    email: ["book-email-error", "book-email"],
    phone: ["book-phone-error", "book-phone"],
    grade: ["book-grade-error", "book-grade"],
    language: ["book-language-error", "book-language"],
    subjects: ["book-subjects-error", "book-subjects"],
    lessons: ["book-lessons-error", null],
    contact_pref: ["book-contact-error", "book-contact"],
    note: ["book-note-error", "book-note"],
  };
  const statusEl = document.getElementById("book-status");
  const submitBtn = document.getElementById("book-submit");
  const languageSelect = document.getElementById("book-language");
  let shownErrors = {};
  let shownStatus = null;     // { key, error }
  let sending = false;

  const timer = fillTimer(bookForm, 1500);

  // The preferred language starts as the language the page is in, and follows
  // it until the visitor picks one themselves
  let languagePicked = false;
  const followPageLanguage = () => {
    if (!languagePicked && window.VB_I18N) languageSelect.value = VB_I18N.currentLang();
  };
  followPageLanguage();
  languageSelect.addEventListener("change", () => { languagePicked = true; });

  function values() {
    return Object.fromEntries(new FormData(bookForm));
  }

  function check(data) {
    const v = (k) => String(data[k] ?? "").trim();
    const errors = {};
    if (!v("name")) errors.name = "required";
    if (!v("email")) errors.email = "required";
    else if (!EMAIL_RE.test(v("email"))) errors.email = "email";
    if (v("phone") && !PHONE_RE.test(v("phone"))) errors.phone = "phone";
    else if (!v("phone") && ["phone", "text"].includes(v("contact_pref"))) errors.phone = "phone_needed";
    if (!v("subjects")) errors.subjects = "required";
    return errors;
  }

  // A message is the control's description, read after its label when focus lands on it
  // (the lessons radios have no single control: their group carries it)
  function drawErrors() {
    for (const [field, [slotId, controlId]] of Object.entries(FIELDS)) {
      const code = shownErrors[field];
      const slot = document.getElementById(slotId);
      slot.textContent = code ? t(MESSAGES[code] ?? MESSAGES.required) : "";
      const control = document.getElementById(controlId ?? "book-lessons-group");
      if (code) {
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", slotId);
      } else {
        control.removeAttribute("aria-invalid");
        control.removeAttribute("aria-describedby");
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
      const target = controlId ? document.getElementById(controlId) : bookForm.querySelector('input[name="lessons"]');
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
    const paint = () => {
      title.textContent = t("Thank you!");
      text.textContent = t("We've received your request. We reply within one business day.");
    };
    paint();
    document.addEventListener("langchange", paint);
    done.append(title, text);
    bookForm.replaceWith(done);
    document.getElementById("book-alt").hidden = true;
    done.focus();
  }

  bookForm.addEventListener("submit", async (event) => {
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
      data.elapsed = await timer.waitOut();
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

  // A fixed field clears its own message (the phone's too, once the way to reach them changes)
  bookForm.addEventListener("input", (event) => {
    const name = event.target.name;
    if (!name) return;
    const changed = { ...shownErrors };
    delete changed[name];
    if (name === "contact_pref") delete changed.phone;
    if (Object.keys(changed).length !== Object.keys(shownErrors).length) {
      shownErrors = changed;
      drawErrors();
      if (!Object.keys(shownErrors).length && shownStatus?.key === "check") setStatus(null);
    }
  });

  // (the form is gone once the thank-you shows)
  document.addEventListener("langchange", () => {
    if (!bookForm.isConnected) return;
    followPageLanguage();
    drawErrors();
    drawStatus();
  });

  // Coming back from a form post made without JavaScript
  const result = new URLSearchParams(location.search).get("consultation");
  if (result === "sent") showDone();
  else if (result === "busy") setStatus("busy", true);
  else if (result === "error") setStatus("failed", true);
}
