import { test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTAL = fileURLToPath(new URL('../../portal', import.meta.url));
const SUPABASE_TAG = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js" integrity="sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok" crossorigin="anonymous" defer></script>';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}

const all = files(PORTAL);
const pages = all.filter((file) => file.endsWith('.html'));

test('every portal page is CSP-clean, unindexed, and loads the pinned supabase-js', () => {
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    expect(html, page).not.toMatch(/<style[\s>]/i);
    expect(html, page).not.toMatch(/\sstyle\s*=/i);
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) expect(tag, page).toMatch(/\ssrc="/);
    expect(html, page).toContain(SUPABASE_TAG);
    expect(html, page).toContain('<meta name="robots" content="noindex">');
  }
});

test('no portal file uses an em dash, HTML injection, or inline styles', () => {
  for (const file of all) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toContain('\u2014');
    expect(text, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(text, file).not.toMatch(/setAttribute\(\s*['"]style/);
  }
});
