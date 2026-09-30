import { test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL } from '../../portal/js/config.js';

// Integration checks for the redesigned portal shell (spec 11.3 step 2).
const PORTAL = fileURLToPath(new URL('../../portal', import.meta.url));
const GEIST_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
const APP_PAGES = ['student.html', 'parent.html', 'staff.html', 'people.html'];

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
test('the portal CSP covers fonts, supabase-js, the Supabase API and blob previews', () => {
  const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'));
  const rule = vercel.headers.find((h) => h.source === '/portal/:path*');
  expect(rule).toBeTruthy();
  const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy')?.value;
  expect(csp).toBeTruthy();
  const directives = new Map(csp.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...values] = part.split(/\s+/);
    return [name, values];
  }));
  expect(directives.get('script-src')).toContain('https://cdn.jsdelivr.net');
  expect(directives.get('style-src')).toContain('https://fonts.googleapis.com');
  expect(directives.get('font-src')).toContain('https://fonts.gstatic.com');
  expect(directives.get('img-src')).toEqual(expect.arrayContaining(['blob:', 'data:']));
  expect(directives.get('connect-src')).toContain(new URL(SUPABASE_URL).origin);
  expect(directives.get('object-src')).toEqual(["'none'"]);
  expect(directives.get('base-uri')).toEqual(["'none'"]);
  expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  for (const [name, values] of directives) {
    expect(values, name).not.toContain("'unsafe-inline'");
    expect(values, name).not.toContain("'unsafe-eval'");
  }
});
