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
   The reviews themselves (TESTIMONIALS) live in translations.js,
   one entry per family, with every language for each quote.
   ------------------------------------------------------------ */

/* Each figure carries the other languages' text invisibly (see
   styles.css .i18n-h) so the tile is the same height in every one. */
function reviewFigure(voice, kind, lang) {
  const labelKey = kind === "parent" ? "Parent" : "Student";
  const fig = document.createElement("figure");
  fig.className = "review";
  fig.innerHTML = `
    <div class="stars" aria-label="${VB_I18N.translate("5 out of 5 stars", lang)}">★★★★★</div>
    <blockquote><p class="i18n-h"><span>${voice.quote[lang] || voice.quote.en}</span></p></blockquote>
    <figcaption>
      <strong>${voice.name}</strong>
      <span class="i18n-h"><span>${VB_I18N.translate(labelKey, lang)}</span></span>
    </figcaption>
  `;
  const shown = voice.quote[lang] || voice.quote.en;
  VB_I18N.setGhosts(
    fig.querySelector("blockquote p"),
    VB_I18N.LANG_CODES.filter((l) => l !== lang).map((l) => ({ lang: l, text: voice.quote[l] || voice.quote.en })),
    shown
  );
  VB_I18N.setGhosts(fig.querySelector("figcaption .i18n-h"), VB_I18N.ghostsFor(labelKey, lang), VB_I18N.translate(labelKey, lang));
  return fig;
}

/* Rebuilt whenever the language changes. */
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

  document.getElementById("count-parents").textContent = parents.children.length;
  document.getElementById("count-students").textContent = students.children.length;
}

buildReviews();
document.addEventListener("langchange", buildReviews);

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
   closing consultation note is on screen
   ------------------------------------------------------------ */
const stickyCta = document.getElementById("sticky-cta");
const hero = document.querySelector(".hero");
const closingNote = document.getElementById("svc-more");

let heroVisible = true;
let closingVisible = false;

function updateSticky() {
  const show = !heroVisible && !closingVisible;
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

/* ------------------------------------------------------------
   Intake form link (appears once INTAKE_FORM_URL is set)
   ------------------------------------------------------------ */
const intakeLink = document.getElementById("intake-form-link");
if (INTAKE_FORM_URL) {
  intakeLink.href = INTAKE_FORM_URL;
  intakeLink.hidden = false;
}
