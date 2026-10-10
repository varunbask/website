import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The demo can show the real converted SAT content (build.mjs --sat-content),
// but only from an output folder outside the repo: that content never goes in git
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BUILD = join(ROOT, 'tools/demo/build.mjs');
const build = (...args) => spawnSync(process.execPath, [BUILD, ...args], { cwd: ROOT, encoding: 'utf8' });

test('--sat-content refuses an output folder inside the checkout, before writing anything', () => {
  const bundle = mkdtempSync(join(tmpdir(), 'sat-bundle-'));
  try {
    writeFileSync(join(bundle, 'content.json'), '{"version":1,"sets":[],"items":[],"keys":[],"skills":[],"files":[]}');
    for (const out of ['.demo-sat-guard', join(ROOT, 'portal/sat-guard')]) {
      const r = build(out, '--sat-content', bundle);
      expect(r.status, out).not.toBe(0);
      expect(r.stderr).toMatch(/outside the repo/);
      expect(existsSync(join(ROOT, '.demo-sat-guard'))).toBe(false);
      expect(existsSync(join(ROOT, 'portal/sat-guard'))).toBe(false);
    }
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }
});

test('--sat-content needs a bundle with content.json', () => {
  const empty = mkdtempSync(join(tmpdir(), 'sat-empty-'));
  try {
    const r = build(join(empty, 'out'), '--sat-content', empty);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/No content\.json/);
    expect(existsSync(join(empty, 'out'))).toBe(false);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
