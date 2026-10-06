import { test, expect, afterEach } from 'vitest';
import { ICON_NAMES, ICON_PATHS, icon } from '../../portal/js/icons.js';

// Section 6 "Icons" of the portal UI spec
const SPEC_NAMES = [
  'house', 'clipboard-text', 'check-square', 'calendar-blank', 'chat-circle-text', 'chart-line-up',
  'tray', 'users-three', 'identification-badge', 'sidebar-simple', 'list', 'caret-right', 'caret-left',
  'caret-down', 'caret-up-down', 'x', 'dots-three', 'plus', 'magnifying-glass', 'upload-simple',
  'pencil-simple', 'pencil-simple-line', 'note-pencil', 'trash', 'arrow-square-out',
  'arrow-counter-clockwise', 'sign-out', 'sun', 'moon', 'circle', 'clock', 'warning-circle',
  'hourglass-medium', 'x-circle', 'check-circle', 'check', 'archive', 'minus-circle', 'file-text',
  'file-pdf', 'image-square', 'eye', 'eye-slash', 'envelope-simple', 'trend-up', 'trend-down', 'info',
  // Lesson materials and homework (schedules spec)
  'presentation', 'paperclip', 'link-simple', 'book-open-text', 'corners-out', 'repeat',
  // Account view (billing spec)
  'currency-dollar', 'receipt', 'printer', 'copy', 'lock-simple',
];

test('ICON_NAMES lists exactly the icons in the spec', () => {
  expect([...ICON_NAMES].sort()).toEqual([...SPEC_NAMES].sort());
});

test('every icon has non-empty SVG path data', () => {
  for (const name of ICON_NAMES) {
    const d = ICON_PATHS[name];
    expect(typeof d, name).toBe('string');
    expect(d.length, name).toBeGreaterThan(10);
    expect(d, name).toMatch(/^M[\d.,\s\-MLHVCSQTAZmlhvcsqtaz]+$/);
  }
});

// A tiny stand-in for the DOM calls icon() makes
function fakeDocument() {
  const make = (ns, tag) => ({
    ns, tag, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append(...c) { this.children.push(...c); },
  });
  return { createElementNS: make };
}

afterEach(() => { delete globalThis.document; });

test('icon() builds a decorative 16px SVG by default', () => {
  globalThis.document = fakeDocument();
  const svg = icon('check');
  expect(svg.ns).toBe('http://www.w3.org/2000/svg');
  expect(svg.attrs).toMatchObject({ viewBox: '0 0 256 256', width: '16', height: '16', fill: 'currentColor', 'aria-hidden': 'true' });
  expect(svg.attrs.role).toBeUndefined();
  expect(svg.children[0].attrs.d).toBe(ICON_PATHS.check);
});

test('icon() with a label is an image with an accessible name', () => {
  globalThis.document = fakeDocument();
  const svg = icon('trash', { size: 20, label: 'Delete' });
  expect(svg.attrs).toMatchObject({ width: '20', role: 'img', 'aria-label': 'Delete' });
  expect(svg.attrs['aria-hidden']).toBeUndefined();
});

test('icon() rejects unknown names', () => {
  globalThis.document = fakeDocument();
  expect(() => icon('rocket')).toThrow(/Unknown icon/);
});

// icon() throws for a name it does not have, which takes the whole view down
test('every icon named in a portal script exists', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../portal/js', import.meta.url));
  const files = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
  const missing = [];
  for (const file of files(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b(?:icon|iconEnd)\s*:\s*'([a-z][a-z-]*)'|\bicon\(\s*'([a-z][a-z-]*)'/g)) {
      const name = m[1] ?? m[2];
      if (!ICON_NAMES.includes(name)) missing.push(`${file.slice(root.length + 1)}: ${name}`);
    }
  }
  expect(missing).toEqual([]);
});
