import { test, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORTAL = join(ROOT, 'portal');
const manifest = JSON.parse(readFileSync(join(PORTAL, 'manifest.webmanifest'), 'utf8'));
const pages = readdirSync(PORTAL).filter((f) => f.endsWith('.html'));
const css = readFileSync(join(PORTAL, 'css/app.css'), 'utf8');

// Opens the portal path "/portal/icons/x.png" on disk
const onDisk = (src) => join(ROOT, src.replace(/^\//, ''));
function pngSize(file) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('latin1'), file).toBe('PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}
// The value of a token in the light :root block of app.css
const token = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))[1].toUpperCase();

test('the manifest names the portal and installs it standalone inside /portal/', () => {
  expect(manifest).toMatchObject({
    name: 'VP Education Group portal',
    short_name: 'VP Portal',
    start_url: '/portal/',
    scope: '/portal/',
    display: 'standalone',
  });
  expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
});

test('manifest colours are the portal tokens, the same as the pages theme-color', () => {
  expect(manifest.theme_color.toUpperCase()).toBe(token('--frame'));
  expect(manifest.background_color.toUpperCase()).toBe(token('--frame'));
  for (const page of pages) {
    expect(readFileSync(join(PORTAL, page), 'utf8'), page).toContain(`<meta name="theme-color" content="${manifest.theme_color}">`);
  }
});

test('manifest icons exist, at the sizes they claim, under portal/', () => {
  const sizes = new Map();
  for (const icon of manifest.icons) {
    expect(icon.src.startsWith('/portal/icons/'), icon.src).toBe(true);
    expect(existsSync(onDisk(icon.src)), icon.src).toBe(true);
    if (icon.type === 'image/png') {
      expect(pngSize(onDisk(icon.src)), icon.src).toBe(icon.sizes);
      sizes.set(icon.sizes, icon.purpose);
    }
  }
  expect([...sizes.keys()]).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i) => i.type === 'image/svg+xml')).toBe(true);
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
});

test('the apple-touch-icon is a 180 pixel PNG, and the SVG is the teal VP monogram with no scripts', () => {
  expect(pngSize(join(PORTAL, 'icons/apple-touch-icon.png'))).toBe('180x180');
  const svg = readFileSync(join(PORTAL, 'icons/icon.svg'), 'utf8');
  expect(svg).toContain(`fill="${token('--accent')}"`);
  expect(svg.toUpperCase()).toContain(token('--on-accent'));
  expect(svg).not.toMatch(/<script|onload|href=/i);
});

test('every portal page links the manifest, the icons and the apple-touch-icon', () => {
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    const html = readFileSync(join(PORTAL, page), 'utf8');
    expect(html, page).toContain('<link rel="manifest" href="/portal/manifest.webmanifest">');
    expect(html, page).toContain('<link rel="icon" href="/portal/icons/icon.svg" type="image/svg+xml">');
    expect(html, page).toContain('<link rel="apple-touch-icon" href="/portal/icons/apple-touch-icon.png">');
    // Every icon the page links is a real file
    for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)) {
      expect(existsSync(onDisk(href)), `${page} ${href}`).toBe(true);
    }
  }
});

test('no service worker, and the portal CSP still lets the manifest and icons load', () => {
  const files = readdirSync(PORTAL, { recursive: true }).map(String);
  expect(files.filter((f) => /(^|\/)(sw|service-worker)[^/]*\.js$/.test(f))).toEqual([]);
  for (const file of files.filter((f) => f.endsWith('.js') || f.endsWith('.html'))) {
    expect(readFileSync(join(PORTAL, file), 'utf8'), file).not.toMatch(/serviceWorker\.register/);
  }
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const header = vercel.headers.find((h) => h.source === '/portal(.*)').headers.find((h) => h.key === 'Content-Security-Policy').value;
  const directive = (name) => header.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';
  // manifest-src falls back to default-src, which allows same-origin files
  const manifestSrc = directive('manifest-src') || directive('default-src');
  expect(manifestSrc).toContain("'self'");
  expect(directive('img-src')).toContain("'self'");
});
