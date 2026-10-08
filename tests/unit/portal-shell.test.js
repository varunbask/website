import { test, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL } from '../../portal/js/config.js';
// These tests read the portal's files from disk. The first full run after a
// checkout reads freshly written files slowly, which once pushed them past
// the 5 s default; give the whole file room.
vi.setConfig({ testTimeout: 30_000 });

// Integration checks for the redesigned portal shell (spec 11.3 step 2).
const PORTAL = fileURLToPath(new URL('../../portal', import.meta.url));
const GEIST_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
const APP_PAGES = ['student.html', 'parent.html', 'staff.html', 'people.html', 'account.html'];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}

const all = files(PORTAL);
const pages = all.filter((file) => file.endsWith('.html'));
const read = (file) => readFileSync(file, 'utf8');

test('no portal page loads the old site stylesheet, site theme script or portal.css', () => {
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    const html = read(page);
    expect(html, page).not.toMatch(/["']\/styles\.css/);
    expect(html, page).not.toMatch(/["']\/theme\.js/);
    expect(html, page).not.toContain('portal.css');
  }
});

test('every app page has the shell landmarks and live regions', () => {
  for (const name of APP_PAGES) {
    const page = pages.find((file) => basename(file) === name);
    expect(page, name).toBeTruthy();
    const html = read(page);
    expect(html, name).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/);
    expect(html, name).toMatch(/<main\b[^>]*\bid="main"/);
    expect(html, name).toMatch(/\bid="portal-nav"/);
    expect(html, name).toMatch(/\bid="toasts"/);
    expect(html, name).toMatch(/\bid="route-announcer"/);
    expect(html, name).toMatch(/<dialog\b[^>]*\bid="drawer"/);
  }
});

test('the only web font URL is the Geist request', () => {
  for (const file of all.filter((f) => /\.(html|css|js)$/.test(f))) {
    const text = read(file);
    const urls = text.match(/https:\/\/fonts\.googleapis\.com\/css2?[^"')\s]*/g) ?? [];
    for (const url of urls) expect(url.replaceAll('&amp;', '&'), file).toBe(GEIST_URL);
    expect(text, file).not.toMatch(/@import\s+url\(\s*['"]?https:\/\/fonts/);
  }
  for (const name of APP_PAGES.concat(['index.html', 'reset.html'])) {
    const page = pages.find((file) => basename(file) === name);
    expect(read(page), name).toContain(`href="${GEIST_URL}"`);
  }
});

test('no portal file contains an en dash', () => {
  for (const file of all) expect(read(file), file).not.toContain('\u2013');
});

// The CSP in vercel.json must allow exactly what the portal loads (spec 9)
test('the portal CSP covers fonts, supabase-js, the Supabase API, its Realtime socket, blob previews, profile photos and worksheet PDFs', () => {
  const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'));
  const rule = vercel.headers.find((h) => h.source === '/portal(.*)');
  expect(rule).toBeTruthy();
  const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy')?.value;
  expect(csp).toBeTruthy();
  const directives = new Map(csp.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...values] = part.split(/\s+/);
    return [name, values];
  }));
  // Only the one pinned supabase-js file, not all of jsdelivr
  expect(directives.get('script-src')).toEqual(["'self'", 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js']);
  expect(directives.get('style-src')).toContain('https://fonts.googleapis.com');
  expect(directives.get('font-src')).toContain('https://fonts.gstatic.com');
  expect(directives.get('img-src')).toEqual(expect.arrayContaining(['blob:', 'data:']));
  // Profile photos are signed Storage addresses on the Supabase origin, and nothing broader
  expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', new URL(SUPABASE_URL).origin]);
  // The API over https and Realtime over its websocket (live updates), nothing broader
  expect(directives.get('connect-src')).toEqual(["'self'", new URL(SUPABASE_URL).origin, new URL(SUPABASE_URL).origin.replace(/^https:/, 'wss:')]);
  // Worksheet PDFs are blobs the portal builds itself: Open shows them in the
  // browser's PDF viewer and Print in a hidden frame, nothing from elsewhere
  expect(directives.get('object-src')).toEqual(["'self'", 'blob:']);
  expect(directives.get('frame-src')).toEqual(["'self'", 'blob:']);
  expect(directives.get('base-uri')).toEqual(["'none'"]);
  expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  for (const [name, values] of directives) {
    expect(values, name).not.toContain("'unsafe-inline'");
    expect(values, name).not.toContain("'unsafe-eval'");
  }
});
