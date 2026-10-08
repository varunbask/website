import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vercelCsp } from '../../tools/demo/serve-ai.mjs';

const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'));
const csp = vercelCsp(config);

describe('worksheet PDFs and the security policy', () => {
  test('the portal lets its own blob PDFs open and print (frame and viewer)', () => {
    const portal = csp('/portal/student.html');
    expect(portal).toContain("frame-src 'self' blob:");
    expect(portal).toContain("object-src 'self' blob:");
    expect(portal).toContain("frame-ancestors 'none'");
  });

  test('the public site keeps its stricter policy', () => {
    const site = csp('/index.html');
    expect(site).toContain("object-src 'none'");
    expect(site).not.toContain('frame-src');
  });

  test('the local demo server sends the policy for the path it serves', () => {
    expect(csp('/portal/staff.html')).toBe(csp('/portal/parent.html'));
    expect(csp('/portal/staff.html')).not.toBe(csp('/'));
  });
});
