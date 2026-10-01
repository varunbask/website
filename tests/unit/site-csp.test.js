import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const hashOf = (code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`;

// The marketing page CSP allows its inline code by hash. A change to that code
// changes its hash, so the CSP must change with it.
test('the site CSP has the hash of each inline script and event handler on index.html', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find((h) => h.source === '/((?!portal/).*)');
  const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy').value;
  const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src '));

  const html = read('index.html');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const handlers = [...html.matchAll(/\son\w+="([^"]*)"/g)].map((m) => m[1]);
  expect(inline.length).toBeGreaterThan(0);
  for (const code of [...inline, ...handlers]) {
    expect(scriptSrc).toContain(hashOf(code));
  }
  expect(scriptSrc).not.toContain("'unsafe-inline'");
});
