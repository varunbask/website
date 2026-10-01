// Portal theme (spec 3.10). Replaces the landing page's /theme.js in the portal.
// theme-boot.js sets data-theme before first paint; this module owns the
// controls. `vb-theme` is shared with the landing page, so it is written exactly
// as /theme.js writes it: 'dark', or no key at all for light.

import { h } from './dom.js';
import { icon } from './icons.js';

export const THEME_KEY = 'vb-theme';
// meta[name=theme-color] per theme (the --frame token)
export const THEME_COLORS = Object.freeze({ light: '#EEEFF2', dark: '#0B0C0E' });

// Anything but 'dark' is light
export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

// What vb-theme should hold for a theme: 'dark', or null (remove the key)
export function storedValue(theme) {
  return normalizeTheme(theme) === 'dark' ? 'dark' : null;
}

export function getTheme() {
  return normalizeTheme(document.documentElement.dataset.theme);
}

// Applies a theme to this page only: data-theme, theme-color, every control
function apply(theme) {
  const t = normalizeTheme(theme);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[t]);
  syncControls(t);
  return t;
}

// setTheme('light' | 'dark'): applies it and remembers it for the portal and
// the landing page. Storage failures only mean the choice does not persist.
export function setTheme(theme) {
  const t = apply(theme);
  try {
    const value = storedValue(t);
    if (value) localStorage.setItem(THEME_KEY, value);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // private browsing or blocked storage
  }
  return t;
}

function syncControls(theme = getTheme()) {
  for (const btn of document.querySelectorAll('[data-theme-value]')) {
    btn.setAttribute('aria-pressed', btn.dataset.themeValue === theme ? 'true' : 'false');
  }
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) paintToggle(btn, theme);
}

// The segmented Light / Dark control (sidebar footer, rail popover, More sheet).
// Every control on the page stays in step through setTheme.
export function themeControl({ id, block = true } = {}) {
  const current = getTheme();
  const option = (value, label, iconName) => h('button', {
    type: 'button',
    'aria-pressed': value === current ? 'true' : 'false',
    dataset: { themeValue: value },
    onClick: () => setTheme(value),
  }, icon(iconName), h('span', {}, label));
  return h('div', {
    class: block ? 'segmented is-block theme-control' : 'segmented theme-control',
    id,
    role: 'group',
    'aria-label': 'Theme',
  }, option('light', 'Light', 'sun'), option('dark', 'Dark', 'moon'));
}

function paintToggle(btn, theme) {
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  btn.setAttribute('aria-label', label);
  btn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'), h('span', { class: 'tip tip-end', 'aria-hidden': 'true' }, label));
}

// A single icon button that flips the theme (auth pages)
export function themeToggle({ id } = {}) {
  const btn = h('button', {
    type: 'button',
    class: 'icon-btn has-tip theme-toggle',
    id,
    dataset: { themeToggle: '' },
    onClick: () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
  });
  paintToggle(btn, getTheme());
  return btn;
}

// Other open portal or landing tabs follow a change made here, and this tab
// follows theirs. Also corrects the static theme-color for dark visitors.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    apply(e.key === null ? 'light' : e.newValue);
  });
  apply(getTheme());
}
