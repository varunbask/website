import { test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p) => readFileSync(path(p), 'utf8');

// The local demo (tools/demo) fakes Supabase with made-up data. It must never
// be uploaded to Vercel or loaded by a real portal page.
test('Vercel never uploads the demo or its builds', () => {
  const lines = read('.vercelignore').split('\n').map((l) => l.trim());
  expect(lines).toContain('tools');
  expect(lines).toContain('.demo');
});

test('no portal page or module refers to the demo client', () => {
  const files = [
    ...readdirSync(path('portal')).filter((f) => f.endsWith('.html')).map((f) => `portal/${f}`),
    ...readdirSync(path('portal/js'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `portal/js/${f}`),
  ];
  expect(files.length).toBeGreaterThan(10);
  for (const file of files) expect(read(file), file).not.toMatch(/tools\/demo|demo-supabase/);
});
