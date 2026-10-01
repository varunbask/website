import { test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', '.vercel', '.worktrees', 'tests', 'docs', 'supabase']);
const EXTENSIONS = new Set(['.js', '.html', '.css', '.json']);

// Every file a browser could be served, plus server code
function servedFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.env')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...servedFiles(full));
    else if (EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

// Roles of any JWTs embedded in the text
function jwtRoles(text) {
  const roles = [];
  for (const match of text.matchAll(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g)) {
    try {
      roles.push(JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')).role);
    } catch {
      /* not a JWT payload */
    }
  }
  return roles;
}

test('no served file carries a Supabase secret key', () => {
  const files = servedFiles(ROOT);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toMatch(/sb_secret_/);
    expect(jwtRoles(text), file).not.toContain('service_role');
  }
});
