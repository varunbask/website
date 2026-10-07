import { test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// These tests read the portal's files from disk (see portal-shell.test.js)
vi.setConfig({ testTimeout: 30_000 });

const PORTAL = fileURLToPath(new URL('../../portal', import.meta.url));
const read = (path) => readFileSync(`${PORTAL}/${path}`, 'utf8');
const APP_PAGES = ['staff.html', 'student.html', 'parent.html', 'people.html', 'account.html'];

test('every app page loads palette.css after app.css', () => {
  for (const name of APP_PAGES) {
    const html = read(name);
    const app = html.indexOf('/portal/css/app.css');
    const palette = html.indexOf('<link rel="stylesheet" href="/portal/css/palette.css?v=2">');
    expect(app, name).toBeGreaterThan(-1);
    expect(palette, name).toBeGreaterThan(app);
  }
});

test('the palette stylesheet uses tokens, not colours of its own', () => {
  const css = read('css/palette.css').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
});

test('the app mounts the palette and closes it with the other overlays', () => {
  const app = read('js/app.js');
  expect(app).toContain("import { mountPalette } from './palette.js';");
  expect(app).toMatch(/const palette = mountPalette\(\{/);
  expect(app).toMatch(/function closeAll\(\) \{\s*palette\.close\(\);/);
});

test('the palette view is built with h(), never markup strings, and keeps recents in try/catch', () => {
  const view = read('js/palette.js');
  expect(view).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  expect(view).toMatch(/try \{\s*return parseRecent\(/);
  expect(view).toMatch(/try \{\s*globalThis\.localStorage\?\.setItem\(/);
  // a labelled modal dialog with a combobox over a listbox
  expect(view).toContain("role: 'dialog'");
  expect(view).toContain("'aria-modal': 'true'");
  expect(view).toContain("role: 'combobox'");
  expect(view).toContain("role: 'listbox'");
  expect(view).toContain("role: 'option'");
  expect(view).toContain("'aria-activedescendant'");
});
