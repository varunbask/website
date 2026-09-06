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
