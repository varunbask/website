import { test, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// These tests read the portal's files from disk. The first full run after a
// checkout reads freshly written files slowly, which once pushed them past
// the 5 s default; give the whole file room.
vi.setConfig({ testTimeout: 30_000 });

const PORTAL = fileURLToPath(new URL('../../portal', import.meta.url));
const SUPABASE_TAG = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js" integrity="sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok" crossorigin="anonymous" defer></script>';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}

// portal/vendor holds third-party files copied verbatim (MathJax): checked on their own below
const VENDOR = join(PORTAL, 'vendor');
const all = files(PORTAL).filter((file) => !file.startsWith(VENDOR));
const pages = all.filter((file) => file.endsWith('.html'));

test('every portal page is CSP-clean, unindexed, and loads the pinned supabase-js', () => {
  expect(pages.length).toBeGreaterThan(0);
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    expect(html, page).not.toMatch(/<style[\s>]/i);
    expect(html, page).not.toMatch(/\sstyle\s*=/i);
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) expect(tag, page).toMatch(/\ssrc="/);
    // Inline handlers and javascript: URLs are blocked by the CSP (dead controls)
    for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) expect(tag, page).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html, page).not.toMatch(/javascript:/i);
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
    expect(text, file).not.toMatch(/javascript:/i);
  }
});

test('portal/vendor holds only MathJax, unchanged, with its license', () => {
  const vendored = files(VENDOR).map((f) => f.slice(VENDOR.length + 1)).sort();
  expect(vendored).toEqual(['mathjax/LICENSE', 'mathjax/README.txt', 'mathjax/tex-svg-full.js']);
  expect(readFileSync(join(VENDOR, 'mathjax/LICENSE'), 'utf8')).toContain('Apache License');
  const bundle = readFileSync(join(VENDOR, 'mathjax/tex-svg-full.js'));
  expect(createHash('sha256').update(bundle).digest('hex')).toBe('a4354ff94fd868aea0cc6eaaa79a57fda0588646fc46ee3700a349ee0a11cbe6');
  expect(readFileSync(join(VENDOR, 'mathjax/README.txt'), 'utf8')).toContain('a4354ff94fd868aea0cc6eaaa79a57fda0588646fc46ee3700a349ee0a11cbe6');
  // no portal page loads it up front: math.js adds it when a page shows math
  for (const page of pages) expect(readFileSync(page, 'utf8'), page).not.toContain('mathjax');
});
