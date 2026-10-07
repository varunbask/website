import { test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL } from '../../portal/js/config.js';
import { liveTables, NEVER_LIVE, BILLING_TABLES } from '../../portal/js/live-model.js';

// The real publication is exercised against Supabase. These guard the shape of
// the migration and that it agrees with what the portal subscribes to.
const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const sql = readFileSync(`${dir}20261020120000_realtime.sql`, 'utf8');
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`${dir}${f}`, 'utf8'));
const everything = migrations.join('\n');

// The tables the migration adds: the array literal in its DO block
const wanted = [...sql.match(/wanted text\[\] := array\[([\s\S]*?)\];/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);

// Code only, without the explaining comments
const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

test('the migration adds tables to supabase_realtime inside a guarded block', () => {
  expect(wanted.length).toBeGreaterThan(10);
  expect(new Set(wanted).size).toBe(wanted.length);
  expect(code).toMatch(/^do \$\$/m);
  expect(code).toContain('alter publication supabase_realtime add table public.%I');
  // already published tables and missing tables are skipped, not errors
  expect(code).toContain('pg_publication_tables');
  expect(code).toMatch(/pubname = 'supabase_realtime'/);
  expect(code).toMatch(/tablename = t/);
  expect(code).toContain('to_regclass');
  // a missing publication is created rather than failing
  expect(code).toMatch(/not exists \(select 1 from pg_publication where pubname = 'supabase_realtime'\)/);
  expect(code).toContain('create publication supabase_realtime;');
  // no unguarded statement outside the block
  expect(code.replace(/do \$\$[\s\S]*?\n\$\$;?/, '').trim()).toBe('');
});

test('no table with secrets, invites, drafts or private contact details is published', () => {
  for (const table of NEVER_LIVE) expect(wanted, table).not.toContain(table);
  for (const table of ['google_connections', 'google_oauth_states', 'google_deletions', 'portal_invites', 'review_invites', 'site_reviews', 'referrals', 'submission_drafts']) {
    expect(wanted, table).not.toContain(table);
  }
  // nothing is added by wildcard
  expect(code).not.toMatch(/for all tables|add tables in schema/i);
});

test('replica identity is left alone, so a delete carries only the primary key', () => {
  expect(code).not.toMatch(/replica identity/i);
});

test('every published table has row level security on and a primary key', () => {
  for (const table of wanted) {
    expect(everything, `${table} is created`).toMatch(new RegExp(`create table public\\.${table}\\s*\\(`));
    expect(everything, `${table} has RLS`).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security`));
    const block = everything.match(new RegExp(`create table public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`));
    expect(block, `${table} definition`).toBeTruthy();
    expect(block[1], `${table} primary key`).toMatch(/primary key/i);
    // and never switched back off
    expect(everything, `${table} RLS stays on`).not.toMatch(new RegExp(`alter table public\\.${table}\\s+disable row level security`, 'i'));
  }
});

test('the billing tables are admin only: a select policy for the admin and no other read', () => {
  for (const table of BILLING_TABLES) {
    const reads = [...everything.matchAll(new RegExp(`create policy [^\\n]*on public\\.${table}\\s+for select[^;]*;`, 'g'))].map((m) => m[0]);
    expect(reads.length, `${table} select policies`).toBe(1);
    expect(reads[0], table).toContain('private.is_admin()');
  }
});

test('the portal subscribes to exactly the tables the migration publishes', () => {
  const subscribed = new Set(['student', 'parent', 'tutor', 'admin'].flatMap((role) => liveTables(role)));
  expect([...subscribed].sort()).toEqual([...wanted].sort());
});

test('the migration has no em or en dashes', () => {
  expect(sql).not.toMatch(/[–—]/);
});

// ---------------------------------------------------------------------------
// The portal's CSP must let the page open the websocket

const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'));
const cspOf = (source) => vercel.headers.find((h) => h.source === source).headers.find((h) => h.key === 'Content-Security-Policy').value;
const directive = (csp, name) => csp.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name} `))?.split(/\s+/).slice(1);

test('the portal CSP allows the Supabase API and its Realtime websocket, and nothing broader', () => {
  const origin = new URL(SUPABASE_URL).origin;
  const socket = origin.replace(/^https:/, 'wss:');
  expect(socket).toMatch(/^wss:\/\/[\w-]+\.supabase\.co$/);
  expect(directive(cspOf('/portal(.*)'), 'connect-src')).toEqual(["'self'", origin, socket]);
});

test('the public site CSP does not gain a websocket', () => {
  const csp = cspOf('/((?!portal).*)');
  expect(csp).not.toMatch(/wss?:/);
  expect(csp).not.toContain('supabase.co');
});
