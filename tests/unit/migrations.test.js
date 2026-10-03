import { test, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Supabase CLI tracks migrations by the version before the first "_". Two
// files with one version means the second is never applied (or the push fails).
test('every migration has its own version', () => {
  const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  expect(files.length).toBeGreaterThan(0);
  const seen = new Map();
  for (const f of files) {
    const version = f.split('_')[0];
    expect(version, f).toMatch(/^\d{14}$/);
    expect(seen.get(version), `${f} reuses the version of ${seen.get(version)}`).toBeUndefined();
    seen.set(version, f);
  }
});
