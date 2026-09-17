/* ============================================================
   VP Education Group: light / dark theme

   The inline script in <head> sets data-theme before first paint.
   Light is the default. This file owns the header toggle, remembers
   the viewer's choice, and keeps the toggle's label in the current
   language.
   ============================================================ */

const THEME_KEY = "vb-theme";
const THEME_COLORS = { light: "#FBF8F5", dark: "#1B1417" };
const THEME_LABELS = {
  en: { toDark: "Switch to dark mode", toLight: "Switch to light mode" },
  zh: { toDark: "切换到深色模式", toLight: "切换到浅色模式" }
};

const themeButton = document.getElementById("theme-toggle");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

function savedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch (e) {
    return "light";
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
    /* Light is the default, so only a dark choice needs remembering. */
    if (next === "dark") localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch (e) {
    /* private browsing: the choice just will not persist */
  }
  applyTheme(next);
});

document.addEventListener("langchange", updateThemeLabel);

applyTheme(savedTheme());
