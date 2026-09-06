# Plan: stable layout across languages, plus system-aware dark mode

Repo: static site, four files (`index.html`, `styles.css`, `i18n.js`, `script.js`). No build, no test framework. Preview server: `python3 -m http.server 4173` from the repo root (see `.claude/launch.json`).

## Context

Switching the site between English and Chinese (header toggle, `i18n.js`) moved the layout. Browser measurements at 1280px wide showed three root causes:

1. `html[lang^="zh"]` swapped every font token to Noto Sans SC, so Latin text that never changes ("Varun Baskaran" in the h1, the wordmark, tab labels) was re-rendered in a different face, weight, and line-height. The h1 grew from 124px to 147px.
2. The hero stat column (`.record`) was `align-self: end` and content-sized. Chinese copy is shorter, so the column shrank and its top rule slid down 77px.
3. `.hero-actions` wrapped by text width (English stacks, Chinese fits inline), and buttons used the browser's font-dependent `line-height: normal`.

Task 1 fixes those in `styles.css` (already applied by the controller before this plan was written; it is committed and reviewed as Task 1). Task 2 adds system-aware dark mode with a header toggle, built on the existing CSS custom properties.

## Global Constraints

- Latin glyphs must render in the same font, weight, and line-height in both languages. Noto Sans SC is a fallback in each font stack, never a replacement.
- Every box height that could be language-dependent uses an explicit numeric `line-height`; no `line-height: normal` on buttons, tabs, or toggles.
- The hero grid must have the same row heights in both languages (portrait column height is the driver: image plus `.hero-note`, whose line box is 28.16px in both languages).
- Theme storage key is `vb-theme` in `localStorage`, values `"light"` or `"dark"`; absent means follow the system.
- Theme is expressed as `data-theme="light"|"dark"` on `<html>`. CSS light tokens live on bare `:root`; dark tokens are defined twice: under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and under `:root[data-theme="dark"]`.
- The theme toggle button carries `data-no-translate` (so `i18n.js` leaves it alone) and manages its own bilingual `aria-label`, refreshing on the `langchange` event that `i18n.js` dispatches.
- No new dependencies, no build step. Vanilla HTML/CSS/JS only, matching the existing files' style (2-space indent, double quotes, section-banner comments).
- Do not touch `script.js` or `i18n.js` unless a task says so.

### Task 1: Stable layout across the language switch (styles.css)

Status: implemented by the controller before the plan; commit as-is, then review.

Changes in `styles.css`:
- `:root` font tokens gain a shared `--cjk` fallback list and every stack is `"<Latin face>", var(--cjk), <generic>`.
- `h1` keeps `line-height: 1.05`; `h2, h3, h4` use `line-height: 1.2` in both languages.
- `.btn` gets `line-height: 1.6`; `.lang-toggle`, `.theme-toggle`, and `.tabs [role="tab"]` get `line-height: 1.4`.
- `.hero-actions` is `flex-direction: column; align-items: flex-start; gap: 20px`.
- `.record` is `align-self: start`.
- The `html[lang^="zh"]` section no longer sets any `font-family`; it keeps `letter-spacing: 0` on h2-h4, and sets `.hero-note` to `font-size: 1.25rem; line-height: 1.76rem` (equal to the Latin 1.6rem x 1.1 box).
- Also introduced in this task (consumed by Task 2): `--btn-bg`, `--btn-bg-hover`, `--btn-fg` tokens used by `.btn-primary`; `color-scheme` on `:root`; the dark token blocks; `.theme-toggle` styles (shared rule with `.lang-toggle`, icon show/hide by `data-theme`, 44px hit area under 760px); `.skip-link` color `var(--paper)`; `.wordmark-text` hidden under 480px to make room for the extra header button.

Acceptance: at 1280px wide, toggling language changes only widths of text elements in the header and hero; `top` and `height` of `.site-header`, `.hero-inner`, `.hero h1`, `.hero-actions`, `.record`, and `.hero-note` are identical in both languages.

### Task 2: System-aware dark mode with a header toggle (index.html, theme.js)

Create `theme.js` and edit `index.html`. Do not edit `styles.css` (the styles already exist from Task 1) except to fix a defect you can name.

#### index.html edits

1. In `<head>`, directly after the viewport meta, add:

```html
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#FBF8F5">
```

2. In `<head>`, immediately BEFORE the `<link rel="stylesheet" href="styles.css">` line, add this inline script so the first paint already has the right theme (no flash):

```html
  <script>
    /* Resolve the theme before the stylesheet paints: saved choice, else system. */
    (function () {
      var theme = null;
      try { theme = localStorage.getItem("vb-theme"); } catch (e) { /* storage blocked */ }
      if (theme !== "light" && theme !== "dark") {
        theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      document.documentElement.dataset.theme = theme;
    })();
  </script>
```

3. In the Google Fonts `<link>`, change `Noto+Sans+SC:wght@400;500;700;900` to `Noto+Sans+SC:wght@400;500;700` (the 900 weight was only used by the old Chinese h1 override, which Task 1 removed).

4. Give the wordmark link an accessible name, since its text is hidden on small screens: add `aria-label="Varun Baskaran Tutoring"` to `<a class="wordmark" href="#top">`. (`i18n.js` already has a translation for that exact string and translates `aria-label` attributes.)

5. Directly after the closing `</button>` of the `#lang-toggle` button, add the theme toggle:

```html
      <button class="theme-toggle" id="theme-toggle" type="button" data-no-translate
              aria-label="Switch to dark mode">
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
        </svg>
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
        </svg>
      </button>
```

6. At the bottom, after `<script src="script.js"></script>`, add `<script src="theme.js"></script>`. Order matters: `i18n.js` must have set `<html lang>` before `theme.js` reads it.

#### theme.js (new file, complete contents)

```js
/* ============================================================
   Varun Baskaran Tutoring: light / dark theme

   The inline script in <head> sets data-theme before first paint.
   This file owns the header toggle, follows the system preference
   while the viewer has not chosen, and keeps the toggle's label in
   the current language.
   ============================================================ */

const THEME_KEY = "vb-theme";
const THEME_COLORS = { light: "#FBF8F5", dark: "#1B1417" };
const THEME_LABELS = {
  en: { toDark: "Switch to dark mode", toLight: "Switch to light mode" },
  zh: { toDark: "切换到深色模式", toLight: "切换到浅色模式" }
};

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const themeButton = document.getElementById("theme-toggle");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

function systemTheme() {
  return systemDark.matches ? "dark" : "light";
}

function savedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch (e) {
    return null;
  }
}

function updateThemeLabel() {
  const lang = document.documentElement.lang.startsWith("zh") ? "zh" : "en";
  const dark = document.documentElement.dataset.theme === "dark";
  themeButton.setAttribute("aria-label", dark ? THEME_LABELS[lang].toLight : THEME_LABELS[lang].toDark);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (themeColorMeta) themeColorMeta.setAttribute("content", THEME_COLORS[theme]);
  updateThemeLabel();
}

themeButton.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try {
    /* Picking the theme the system already uses means "follow the system again". */
    if (next === systemTheme()) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    /* private browsing: the choice just will not persist */
  }
  applyTheme(next);
});

/* Follow the OS while no explicit choice is saved. */
systemDark.addEventListener("change", () => {
  if (!savedTheme()) applyTheme(systemTheme());
});

document.addEventListener("langchange", updateThemeLabel);

applyTheme(savedTheme() || systemTheme());
```

#### Verification for Task 2 (no test framework; verify in a browser)

Serve the repo (`python3 -m http.server 4173`) and check in a browser, or via a headless run if one is available:
- With no saved key and the OS in light mode, `<html data-theme="light">`; the moon icon shows; body background is `#FBF8F5`.
- Clicking the toggle sets `data-theme="dark"`, body background `#1B1417`, sun icon shows, `localStorage["vb-theme"] === "dark"`, the meta theme-color is `#1B1417`, and the button's aria-label reads "Switch to light mode".
- Clicking again returns to light and REMOVES the key (because light matches the system).
- Switching language to Chinese changes the toggle's aria-label to the Chinese string; the button's icon and `data-no-translate` are untouched by `i18n.js`.
- Reloading with `vb-theme=dark` saved shows dark on first paint (no light flash): the inline head script runs before the stylesheet.
- At 375px wide the header does not overflow horizontally: `document.documentElement.scrollWidth === window.innerWidth`.

Commit with a message describing the feature. Report the exact checks you ran and their results.

### Task 3: Whole-site browser verification (controller)

Run by the controller with the browser tools, not a subagent. Re-run the language-switch measurement at 1280px, 768px, and 375px; confirm the Task 1 acceptance criteria; screenshot light and dark at desktop and mobile.
