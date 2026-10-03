import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const hashOf = (code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`;

// The marketing page CSP allows its inline code by hash. A change to that code
// changes its hash, so the CSP must change with it.
test.each(['index.html', 'privacy.html'])('the site CSP has the hash of each inline script and event handler on %s', (page) => {
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find((h) => h.source === '/((?!portal).*)');
  const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy').value;
  const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src '));

  const html = read(page);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const handlers = [...html.matchAll(/\son\w+="([^"]*)"/g)].map((m) => m[1]);
  expect(inline.length).toBeGreaterThan(0);
  for (const code of [...inline, ...handlers]) {
    expect(scriptSrc).toContain(hashOf(code));
  }
  expect(scriptSrc).not.toContain("'unsafe-inline'");
});

// Every path gets exactly one CSP: the portal's for /portal, /portal/ and
// below, the site's for everything else. /portal/ is the sign-in page.
test('the site and portal CSP rules cover every path exactly once', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rules = vercel.headers
    .filter((h) => h.headers.some((x) => x.key === 'Content-Security-Policy'))
    .map((h) => ({ source: h.source, re: new RegExp(`^${h.source}$`) }));
  const portalRule = '/portal(.*)';
  const cases = {
    '/': false, '/index.html': false, '/styles.css': false, '/assets/logo.png': false,
    '/portal': true, '/portal/': true, '/portal/index.html': true, '/portal/js/app.js': true,
  };
  for (const [path, isPortal] of Object.entries(cases)) {
    const hits = rules.filter((r) => r.re.test(path)).map((r) => r.source);
    expect(hits, path).toEqual([isPortal ? portalRule : '/((?!portal).*)']);
  }
});
