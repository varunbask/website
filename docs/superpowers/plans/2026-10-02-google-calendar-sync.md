# Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tutors switch on two-way sync between their portal sessions and a "VP Education sessions" Google calendar (with student invites and a read-only overlay of their personal events). Students connect a Google address to receive invites.

**Architecture:** The portal stays the main record (Supabase `sessions`). A trigger marks rows changed by a signed-in user as `pending`. Server functions on Vercel push pending rows to Google, and pull Google changes in through push notifications, a daily backstop and "sync now". The Google code lives in `api/_lib/google/`, in small modules that take their dependencies (fetch, repo, clock) as parameters so they can be tested offline.

**Tech Stack:** Vanilla ES modules (no build), Supabase (Postgres RLS, supabase-js 2.117.2), Vercel functions (Node 24, Web `Request` handlers, `@vercel/functions` `waitUntil`), Google OAuth 2.0 and Calendar API v3 through plain `fetch`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-google-calendar-sync-design.md` (read it first). Background: `docs/superpowers/specs/2026-10-02-tutoring-schedules.md`.

## Global Constraints

- Work in `/Users/varunbaskaran/Desktop/varun website/.worktrees/client-portal` on branch `schedules`. Never push, deploy, run `supabase` against the remote, or call real Google APIs in tests.
- No new npm dependencies: use `fetch` and `node:crypto`.
- Portal code is CSP-safe. Build with `h()` from `portal/js/dom.js`, and never use `innerHTML`, inline `style=""` or inline handlers. CSSOM `el.style.setProperty` is allowed.
- No em dashes or en dashes in any portal or api file or comment (a test enforces this). Use ’ for apostrophes in UI copy.
- Times are business-zone (America/Los_Angeles), handled through `portal/js/dates.js` and `portal/js/sessions-model.js` in the browser. Google events use `timeZone: 'America/Los_Angeles'`.
- Logs never contain tokens, emails or event text: error names and ids only.
- Every new pure function gets vitest unit tests. Run `npm test` before each commit; it must pass.
- Copy rules: user-facing strings are short and plain, with no "Oops" and no exclamation marks.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261002120000_google_calendar.sql` | Tables `google_connections`, `google_oauth_states` and `google_deletions`; session columns; the pending and tombstone triggers; the `my_google_connection()` RPC |
| `tests/rls/google.rls.test.js` | Live RLS checks for the new objects, run after the migration is applied |
| `api/_lib/google/config.js` | Env parsing, scopes, constants |
| `api/_lib/google/crypto.js` | AES-256-GCM token encryption |
| `api/_lib/google/oauth.js` | State and PKCE, auth URL, code exchange, refresh, userinfo, revoke |
| `api/_lib/google/calendar.js` | Calendar API v3 client and typed errors |
| `api/_lib/google/mapping.js` | Pure session to event mapping, event to session mapping, student matching, conflict rule |
| `api/_lib/google/repo.js` | Service-role Supabase access for sync |
| `api/_lib/google/sync.js` | `pushPending`, `pullChanges`, `ensureCalendar`, `ensureChannel`, `stopSync`, `withGoogle` |
| `api/_lib/google/handlers.js` | Endpoint logic: start, callback, settings, disconnect, sync, personal, notify, `maintainAll` |
| `api/google/{start,callback,settings,disconnect,sync,personal,notify}.js` | Thin Vercel entry points |
| `api/_lib/http.js` and `api/cron/sweep.js` | The daily sweep also runs `maintainAll` |
| `vercel.json` | `maxDuration` for `api/google/*.js` |
| `portal/js/google.js` | Browser client: status RPC, connect, toggle, disconnect, sync, personal events |
| `portal/js/google-model.js` | Pure browser helpers: status words, personal blocks, return-param handling |
| `portal/js/views/calendar.js`, `portal/css/calendar.css` | Tutor switch and status, personal overlay, student connect button |
| `portal/js/session-form.js`, `portal/js/session-drawer.js` | Personal clash lines, "Open in Google Calendar", "Not synced" note |
| `portal/js/views/overview.js` | Student "Get Google Calendar invites" on the Your tutors card |
| `portal/js/store.js` | `SESSION_FIELDS` gains the Google columns |
| `docs/google-calendar-setup.md` | Owner setup guide |

Task order:
- Task 1 (DB) and Task 2 (Google library) are independent.
- Task 3 needs Task 2.
- Task 4 needs Tasks 2 and 3.
- Task 5 (portal) needs only the endpoint contract in this plan, and can run beside Tasks 3 and 4.
- Task 6 (demo stand-in) and Task 7 (docs) come last.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261002120000_google_calendar.sql`
- Create: `tests/rls/google.rls.test.js`
- Verify with: the PGlite harness at `/private/tmp/claude-501/-Users-varunbaskaran-Desktop-varun-website/6f6dfbeb-f003-4684-87a1-80ab2711555a/scratchpad/pg/run5.mjs`. Copy it to `run6.mjs` and add the checks below. It applies every file in `supabase/migrations` in order.

**Interfaces:**
- **Produces, for the server:**
  - tables `google_connections`, `google_oauth_states` and `google_deletions`;
  - new `sessions` columns `google_event_id`, `google_calendar_id`, `google_recurring_id`, `google_link`, `sync_state` and `google_synced_at`.
- **Produces, for the portal:** the RPC `my_google_connection()`, returning one row `{ connected boolean, purpose text, google_email text, sync_enabled boolean, last_synced_at timestamptz, last_error text }`. It returns zero rows when the caller has no connection.

- [ ] **Step 1: Write the migration**

```sql
-- Google Calendar sync (docs/superpowers/specs/2026-10-02-google-calendar-sync-design.md).
-- Tutors connect a Google account and may switch on two-way sync with a
-- "VP Education sessions" calendar; students connect an address for invites.
-- Tokens and sync bookkeeping are service-role only.

create table public.google_connections (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  purpose             text not null check (purpose in ('tutor', 'student')),
  google_email        text not null check (char_length(google_email) <= 320),
  refresh_token_enc   text,
  scopes              text not null default '',
  sync_enabled        boolean not null default false,
  calendar_id         text,
  sync_token          text,
  channel_id          text unique,
  channel_resource_id text,
  channel_token       text,
  channel_expires_at  timestamptz,
  pull_started_at     timestamptz,
  last_synced_at      timestamptz,
  last_error          text check (last_error in ('reconnect', 'google_error')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tutor_has_token check (purpose <> 'tutor' or refresh_token_enc is not null)
);

create table public.google_oauth_states (
  nonce      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  purpose    text not null check (purpose in ('tutor', 'student')),
  verifier   text not null,
  return_to  text not null check (return_to like '/portal/%' and return_to not like '%//%'),
  expires_at timestamptz not null
);

create table public.google_deletions (
  id          bigint generated always as identity primary key,
  tutor_id    uuid not null references public.profiles (id) on delete cascade,
  calendar_id text not null,
  event_id    text not null,
  created_at  timestamptz not null default now()
);

alter table public.sessions
  add column google_event_id     text,
  add column google_calendar_id  text,
  add column google_recurring_id text,
  add column google_link         text check (google_link is null or google_link ~ '^https://'),
  add column sync_state          text check (sync_state in ('synced', 'pending', 'error')),
  add column google_synced_at    timestamptz;
create unique index sessions_google_event_idx on public.sessions (google_calendar_id, google_event_id)
  where google_event_id is not null;
create index sessions_sync_pending_idx on public.sessions (tutor_id) where sync_state in ('pending', 'error');

-- Service role only: no grants to anon or authenticated, RLS on with no policies
revoke all on public.google_connections, public.google_oauth_states, public.google_deletions from anon, authenticated;
grant all on public.google_connections, public.google_oauth_states, public.google_deletions to service_role;
alter table public.google_connections  enable row level security;
alter table public.google_oauth_states enable row level security;
alter table public.google_deletions    enable row level security;

-- The Google columns on sessions are written by the server only. Users keep
-- their existing column grants, which do not include these.

-- True when this statement comes from the service role (the sync itself)
create function private.is_service_request()
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;
revoke execute on function private.is_service_request() from public;
grant execute on function private.is_service_request() to authenticated, service_role;

-- A user's change to what Google shows marks the session for the next push
create function private.session_mark_pending()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.is_service_request() then
    return new;
  end if;
  if not exists (select 1 from public.google_connections c
                  where c.user_id = new.tutor_id and c.purpose = 'tutor' and c.sync_enabled) then
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.subject is distinct from old.subject
     or new.location is distinct from old.location
     or new.meeting_url is distinct from old.meeting_url
     or new.notes is distinct from old.notes
     or new.status is distinct from old.status then
    new.sync_state := 'pending';
  end if;
  return new;
end
$$;
revoke execute on function private.session_mark_pending() from public;

create trigger sessions_mark_pending
  before insert or update on public.sessions
  for each row execute function private.session_mark_pending();

-- A user's delete of a synced session leaves a tombstone, so the event goes too
create function private.session_tombstone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.google_event_id is not null and old.google_calendar_id is not null
     and not private.is_service_request() then
    insert into public.google_deletions (tutor_id, calendar_id, event_id)
    values (old.tutor_id, old.google_calendar_id, old.google_event_id);
  end if;
  return old;
end
$$;
revoke execute on function private.session_tombstone() from public;

create trigger sessions_tombstone
  after delete on public.sessions
  for each row execute function private.session_tombstone();

-- The caller's own connection, without tokens
create function public.my_google_connection()
returns table (connected boolean, purpose text, google_email text, sync_enabled boolean,
               last_synced_at timestamptz, last_error text)
language sql stable security definer set search_path = ''
as $$
  select true, c.purpose, c.google_email, c.sync_enabled, c.last_synced_at, c.last_error
    from public.google_connections c
   where c.user_id = auth.uid()
$$;
revoke execute on function public.my_google_connection() from public, anon;
grant execute on function public.my_google_connection() to authenticated;
```

Note: the existing trigger `sessions_touch` (from `20261001200000_sessions.sql`) already sets `updated_at`, `moved_from` and `changed_at`. Postgres runs before-triggers in name order, so `sessions_mark_pending` runs before `sessions_touch`. Both are compatible.

- [ ] **Step 2: Verify it in PGlite.** Copy `run5.mjs` to `run6.mjs`. After the existing checks, and before the unlink section, add:

```js
// --- google sync
await db.query(`insert into public.google_connections (user_id, purpose, google_email, refresh_token_enc, sync_enabled, calendar_id) values ($1,'tutor','ta@gmail.test','enc',true,'cal-a')`, [ids.tA]);
const g1 = await as('tA', `insert into public.sessions (student_id, subject, starts_at, ends_at) values ($1,'Algebra', ${t(200)}, ${t(201)}) returning id, sync_state`, [ids.sA]);
check('a user insert by a sync-on tutor is pending', g1.rows?.[0]?.sync_state === 'pending', g1);
const gid = g1.rows?.[0]?.id;
await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
await db.query(`update public.sessions set sync_state='synced', google_event_id='ev1', google_calendar_id='cal-a' where id=$1`, [gid]);
await db.exec(`select set_config('request.jwt.claims', '', false)`);
const g2 = (await db.query(`select sync_state from public.sessions where id=$1`, [gid])).rows[0];
check('a service write stays synced', g2.sync_state === 'synced', g2);
const g3 = await as('tA', `update public.sessions set recap='x' where id=$1 returning sync_state`, [gid]);
check('a recap edit is not pending', g3.rows?.[0]?.sync_state === 'synced', g3);
const g4 = await as('tA', `update public.sessions set notes='new plan' where id=$1 returning sync_state`, [gid]);
check('a plan edit is pending', g4.rows?.[0]?.sync_state === 'pending', g4);
await as('tA', `delete from public.sessions where id=$1`, [gid]);
const tomb = (await db.query(`select count(*)::int c from public.google_deletions where event_id='ev1'`)).rows[0];
check('a user delete leaves a tombstone', tomb.c === 1, tomb);
const readConn = await as('tA', `select * from public.google_connections`);
check('connections are not readable by users', Boolean(readConn.err), readConn);
const mine = await as('tA', `select * from public.my_google_connection()`);
check('my_google_connection returns my row only', mine.rows?.length === 1 && mine.rows[0].google_email === 'ta@gmail.test', mine);
const theirs = await as('tB', `select * from public.my_google_connection()`);
check('another user sees no row', theirs.rows?.length === 0, theirs);
const tokenless = await db.query(`insert into public.google_connections (user_id, purpose, google_email) values ($1,'tutor','x@y')`, [ids.tB]).then(() => 'ok', (e) => 'refused');
check('a tutor connection needs a token', tokenless === 'refused');
```

Run: `cd <scratchpad>/pg && node run6.mjs | grep -E "FAIL|google|pending|tombstone|connection"`
Expected: every line PASS, and all 9 migrations applied.

- [ ] **Step 3: Write `tests/rls/google.rls.test.js`.** It uses `buildWorld()` from `./world.js` and skips when `hasService` is false, like `tests/rls/sessions.rls.test.js`. Tests:
  1. `authenticated` users (studentA, tutorA, admin) get error code 42501 or an empty result on `select` from `google_connections`, `google_oauth_states` and `google_deletions`.
  2. `my_google_connection` returns no rows for a user without a connection. After the service client inserts a row for tutorA (`purpose 'tutor'`, `refresh_token_enc 'x'`), it returns exactly that row for tutorA and none for tutorB.
  3. With tutorA's `sync_enabled = true`:
     - tutorA inserting a session gives `sync_state 'pending'`;
     - the service client updating it to `'synced'` keeps it `'synced'`;
     - tutorA updating `recap` keeps it `'synced'`.
  4. With the session's `google_event_id` set by service, tutorA deleting it creates one `google_deletions` row (read with the service client).
  5. Cleanup: the service client deletes the `google_connections` and `google_deletions` rows it created. `buildWorld().cleanup()` removes the users.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261002120000_google_calendar.sql tests/rls/google.rls.test.js
git commit -m "Add the Google Calendar sync tables, triggers and status RPC" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Google library (config, crypto, OAuth, Calendar client, mapping)

**Files:**
- Create: `api/_lib/google/config.js`, `api/_lib/google/crypto.js`, `api/_lib/google/oauth.js`, `api/_lib/google/calendar.js`, `api/_lib/google/mapping.js`
- Test: `tests/unit/google-crypto.test.js`, `tests/unit/google-oauth.test.js`, `tests/unit/google-calendar.test.js`, `tests/unit/google-mapping.test.js`

**Interfaces (Produces, exact):**
- **config.js:** `googleConfig(env = process.env)`, `SCOPES`, `CALENDAR_NAME`, `TIME_ZONE`, `MAX_PERSONAL_DAYS`, `CHANNEL_TTL_SECONDS`, `RENEW_WITHIN_MS`.
- **crypto.js:** `encrypt(text, keyB64)` and `decrypt(blob, keyB64)`.
- **oauth.js:**
  - `newState(random?)` returns `{ nonce, verifier, challenge }`.
  - `authUrl({ clientId, redirectUri, scopes, state, challenge })` returns a string.
  - `exchangeCode({ code, verifier, clientId, clientSecret, redirectUri, fetchImpl })`.
  - `refreshAccess({ refreshToken, clientId, clientSecret, fetchImpl })`.
  - `fetchEmail(accessToken, { fetchImpl })` and `revoke(token, { fetchImpl })`.
  - `class GoogleAuthError extends Error`.
- **calendar.js:**
  - `calendarClient(accessToken, { fetchImpl })` returns `{ insertCalendar, insertEvent, patchEvent, deleteEvent, listEvents, listInstances, watchEvents, stopChannel }`.
  - Error classes `GoogleNotFound`, `GoogleGone`, `GoogleRateError` and `GoogleApiError`.
- **mapping.js:**
  - `sessionToEvent(session, { studentName, studentEmail, portalUrl })`.
  - `eventToSessionFields(event)` returns `object|null`.
  - `matchStudent(event, students)` returns `student|null`.
  - `resolveConflict(row, event)` returns `'google' | 'portal'`.
  - `personalItem(event)` returns `object|null`.
  - `PORTAL_LINE`.

- [ ] **Step 1: Write the tests first.** Required cases are listed under each module below. Run them and see them fail (`npx vitest run tests/unit/google-*.test.js`).

- [ ] **Step 2: Implement `config.js`**

```js
// Google Calendar settings from the environment. googleConfig() is null until
// the owner has set the Google variables (endpoints then answer 503).
export const TIME_ZONE = 'America/Los_Angeles';
export const CALENDAR_NAME = 'VP Education sessions';
export const MAX_PERSONAL_DAYS = 42;
export const CHANNEL_TTL_SECONDS = 7 * 24 * 3600;
export const RENEW_WITHIN_MS = 48 * 3600 * 1000;
export const SCOPES = Object.freeze({
  tutor: ['openid', 'email',
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.events.readonly'],
  student: ['openid', 'email'],
});

export function googleConfig(env = process.env) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_TOKEN_KEY: tokenKey } = env;
  if (!clientId || !clientSecret || !tokenKey) return null;
  const siteUrl = String(env.SITE_URL || 'https://www.varunbaskaran.com').replace(/\/+$/, '');
  return {
    clientId, clientSecret, tokenKey, siteUrl,
    redirectUri: `${siteUrl}/api/google/callback`,
    notifyUrl: `${siteUrl}/api/google/notify`,
    portalUrl: `${siteUrl}/portal/`,
  };
}
```

Tests:
- null when any of the three variables is missing;
- the trailing slash of `SITE_URL` is stripped;
- the default site URL is used;
- `redirectUri` and `notifyUrl` are correct.

- [ ] **Step 3: Implement `crypto.js`**

```js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM: 'v1.<iv>.<tag>.<ciphertext>', each base64url
function keyOf(keyB64) {
  const key = Buffer.from(String(keyB64 ?? ''), 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_KEY must be 32 bytes, base64');
  return key;
}

export function encrypt(text, keyB64) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(keyB64), iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(blob, keyB64) {
  const [v, iv, tag, ct] = String(blob ?? '').split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Not an encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(keyB64), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
```

Tests:
- round-trip;
- two encryptions of the same text differ;
- a changed ciphertext throws;
- the wrong key throws;
- a 16-byte key throws `/32 bytes/`.

- [ ] **Step 4: Implement `oauth.js`**

```js
import { randomBytes, createHash } from 'node:crypto';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export class GoogleAuthError extends Error {
  constructor(message = 'Google access was revoked or expired') { super(message); this.name = 'GoogleAuthError'; }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// A fresh nonce for the state table and a PKCE pair (RFC 7636, S256)
export function newState(random = randomBytes) {
  const verifier = b64url(random(32));
  return {
    nonce: b64url(random(32)),
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
  };
}

export function authUrl({ clientId, redirectUri, scopes, state, challenge }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(body, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new GoogleAuthError();
    throw new Error(`Google token request failed (${res.status})`);
  }
  return json;
}

export function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  return tokenRequest({
    code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  }, fetchImpl);
}

export function refreshAccess({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  return tokenRequest({
    refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
  }, fetchImpl);
}

// The verified, lowercased Google address of the account
export async function fetchEmail(accessToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.email || json.email_verified === false) throw new Error('Google did not share a verified email');
  return String(json.email).toLowerCase();
}

export async function revoke(token, { fetchImpl = fetch } = {}) {
  try {
    await fetchImpl(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: 'POST' });
  } catch {
    // revoking is best effort; the connection row is deleted anyway
  }
}
```

Tests (use `vi.fn` for fetch):
- `newState` lengths: nonce and verifier are 43 characters, and the challenge is the SHA-256 of the verifier;
- `authUrl` has every parameter, with the scope space-joined;
- `exchangeCode` posts a form with `code_verifier` and returns the json;
- `refreshAccess` with `{ error: 'invalid_grant' }` and a 400 throws `GoogleAuthError`;
- another 500 throws an `Error` whose message holds the status but not the body;
- `fetchEmail` lowercases, and throws when `email_verified` is false;
- `revoke` swallows a network error.

- [ ] **Step 5: Implement `calendar.js`**

```js
import { GoogleAuthError } from './oauth.js';

export const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleNotFound extends Error { constructor() { super('Google: not found'); this.name = 'GoogleNotFound'; } }
export class GoogleGone extends Error { constructor() { super('Google: gone'); this.name = 'GoogleGone'; } }
export class GoogleRateError extends Error { constructor() { super('Google: rate limited'); this.name = 'GoogleRateError'; } }
export class GoogleApiError extends Error {
  constructor(status) { super(`Google API error ${status}`); this.name = 'GoogleApiError'; this.status = status; }
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

export function calendarClient(accessToken, { fetchImpl = fetch } = {}) {
  async function call(method, path, { query, body } = {}) {
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))}` : '';
    const res = await fetchImpl(`${API}${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    if (res.status === 404) throw new GoogleNotFound();
    if (res.status === 410) throw new GoogleGone();
    if (res.status === 401) throw new GoogleAuthError();
    const reason = json?.error?.errors?.[0]?.reason;
    if (res.status === 429 || (res.status === 403 && RATE_REASONS.has(reason))) throw new GoogleRateError();
    throw new GoogleApiError(res.status);
  }
  const enc = encodeURIComponent;
  return {
    insertCalendar: ({ summary, timeZone }) => call('POST', '/calendars', { body: { summary, timeZone } }),
    insertEvent: (cal, event) => call('POST', `/calendars/${enc(cal)}/events`, { query: { sendUpdates: 'all' }, body: event }),
    patchEvent: (cal, id, patch) => call('PATCH', `/calendars/${enc(cal)}/events/${enc(id)}`, { query: { sendUpdates: 'all' }, body: patch }),
    async deleteEvent(cal, id) {
      try {
        await call('DELETE', `/calendars/${enc(cal)}/events/${enc(id)}`, { query: { sendUpdates: 'all' } });
      } catch (error) {
        if (!(error instanceof GoogleNotFound) && !(error instanceof GoogleGone)) throw error;
      }
    },
    listEvents: (cal, query = {}) => call('GET', `/calendars/${enc(cal)}/events`, { query }),
    listInstances: (cal, id, query = {}) => call('GET', `/calendars/${enc(cal)}/events/${enc(id)}/instances`, { query }),
    watchEvents: (cal, { id, token, address, ttlSeconds }) => call('POST', `/calendars/${enc(cal)}/events/watch`, {
      body: { id, token, type: 'web_hook', address, params: { ttl: String(ttlSeconds) } },
    }),
    stopChannel: ({ id, resourceId }) => call('POST', '/channels/stop', { body: { id, resourceId } }),
  };
}
```

Tests (fake `fetchImpl` returning `{ ok, status, json }`):
- request URLs and methods for each function, including `sendUpdates=all` on the insert, patch and delete calls;
- the bearer header is sent;
- the error mapping: 404, 410, 401, 429, a 403 with `rateLimitExceeded`, and a 500;
- `deleteEvent` resolves on 404 and on 410;
- a 204 returns null.

- [ ] **Step 6: Implement `mapping.js`**

```js
import { TIME_ZONE } from './config.js';

export const PORTAL_LINE = 'Open in the portal:';
const SUFFIX = / \(([^()]+)\)$/;

// The Google event for a portal session (insert body; also used as a patch)
export function sessionToEvent(s, { studentName, studentEmail, portalUrl }) {
  const subject = (s.subject ?? '').trim() || 'Tutoring session';
  const description = [s.notes?.trim() || null, `${PORTAL_LINE} ${portalUrl}`].filter(Boolean).join('\n\n');
  return {
    summary: studentName ? `${subject} (${studentName})` : subject,
    description,
    location: s.location || s.meeting_url || '',
    start: { dateTime: new Date(s.starts_at).toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: new Date(s.ends_at).toISOString(), timeZone: TIME_ZONE },
    attendees: studentEmail ? [{ email: studentEmail }] : [],
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    extendedProperties: { private: { vpSessionId: String(s.id), vpStudentId: String(s.student_id) } },
  };
}

// Session fields from a Google event; null for an all-day or timeless event
export function eventToSessionFields(e) {
  if (e.status === 'cancelled') return { status: 'cancelled' };
  const start = e.start?.dateTime;
  const end = e.end?.dateTime;
  if (!start || !end) return null;
  const summary = String(e.summary ?? '').trim();
  const subject = summary.replace(SUFFIX, '').trim() || null;
  const desc = String(e.description ?? '');
  const cut = desc.indexOf(PORTAL_LINE);
  const notes = (cut >= 0 ? desc.slice(0, cut) : desc).trim() || null;
  const loc = String(e.location ?? '').trim();
  const isUrl = /^https:\/\/\S+$/.test(loc);
  const meeting = e.hangoutLink && /^https:\/\//.test(e.hangoutLink) ? e.hangoutLink : (isUrl ? loc : null);
  return {
    subject: subject ? subject.slice(0, 60) : null,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    location: isUrl ? null : (loc ? loc.slice(0, 200) : null),
    meeting_url: meeting && meeting.length <= 500 ? meeting : null,
    notes: notes ? notes.slice(0, 2000) : null,
    status: 'scheduled',
    google_link: e.htmlLink && /^https:\/\//.test(e.htmlLink) ? e.htmlLink : null,
  };
}

// The one linked student invited to an event, by connected Google address
// first, then portal email; null when none or more than one match
export function matchStudent(e, students) {
  const emails = new Set((e.attendees ?? []).map((a) => String(a.email ?? '').toLowerCase()).filter(Boolean));
  const hits = (students ?? []).filter((st) => [st.google_email, st.email]
    .some((m) => m && emails.has(String(m).toLowerCase())));
  return hits.length === 1 ? hits[0] : null;
}

// Who wins when both changed: Google, unless the portal row is waiting to be
// pushed and was changed after the event
export function resolveConflict(row, e) {
  if (row.sync_state === 'pending' && Date.parse(row.updated_at) > Date.parse(e.updated ?? 0)) return 'portal';
  return 'google';
}

// A personal event for the tutor's overlay; private ones only say Busy
export function personalItem(e) {
  if (e.status === 'cancelled') return null;
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const start = e.start?.dateTime ?? e.start?.date;
  const end = e.end?.dateTime ?? e.end?.date;
  if (!start || !end) return null;
  const hidden = e.visibility === 'private' || e.visibility === 'confidential';
  return { id: String(e.id), title: hidden ? 'Busy' : (String(e.summary ?? '').trim() || 'Busy'), start, end, all_day: allDay };
}
```

Tests:
- **`sessionToEvent`:**
  - summary with and without a student name;
  - the plan notes, then the portal line;
  - the meeting URL used as location when there is no location;
  - attendees only with an email;
  - extendedProperties;
  - the time zone.
- **`eventToSessionFields`:**
  - the ` (Maya Lin)` suffix is stripped;
  - the portal line is cut from the description;
  - `hangoutLink` becomes `meeting_url`;
  - an https location becomes `meeting_url` with a null location;
  - all-day gives null;
  - cancelled gives `{ status: 'cancelled' }`;
  - long strings are clipped.
- **Round trip:** `eventToSessionFields(sessionToEvent(s))` keeps subject, notes, location and times.
- **`matchStudent`:**
  - a match on the Google address;
  - a match on the portal email;
  - case-insensitive;
  - two matches give null;
  - none gives null.
- **`resolveConflict`:**
  - pending and newer gives portal;
  - pending and older gives google;
  - synced gives google.
- **`personalItem`:**
  - private gives Busy;
  - all-day;
  - cancelled gives null.

- [ ] **Step 7: Run the tests.** `npm test` passes.
- [ ] **Step 8: Commit.** Use the message "Add the Google OAuth, Calendar client and mapping library".

---

### Task 3: Sync engine (repo and sync)

**Files:**
- Create: `api/_lib/google/repo.js`, `api/_lib/google/sync.js`
- Test: `tests/unit/google-sync.test.js`, using an in-memory fake repo and a fake calendar client (both written in the test file)

**Interfaces:**
- **Consumes, from Task 2:**
  - `calendarClient`;
  - the error classes;
  - `sessionToEvent`, `eventToSessionFields`, `matchStudent` and `resolveConflict`;
  - `refreshAccess`, `GoogleAuthError`, `decrypt`;
  - `googleConfig`'s `{ clientId, clientSecret, tokenKey, notifyUrl, portalUrl }`;
  - `CALENDAR_NAME`, `TIME_ZONE`, `CHANNEL_TTL_SECONDS` and `RENEW_WITHIN_MS`.
- **Produces, `createGoogleRepo(db)`.** Every method throws `Error('<name>: <message>')` on a Supabase error, like `api/_lib/repo.js`.
  - **Connections:**
    - `getConnection(userId)` returns the row or null;
    - `getConnectionByChannel(channelId)`;
    - `listSyncTutors()` returns the connections with `purpose = 'tutor'` and `sync_enabled`;
    - `upsertConnection(row)`, `updateConnection(userId, fields)` and `deleteConnection(userId)`.
  - **OAuth states:** `saveState(row)`, and `takeState(nonce, now)`, which selects the row, deletes it, and returns it, or null when it is missing or expired.
  - **People:** `getProfile(userId)` returns `{ id, role, full_name, email }`.
  - **Sessions to push:**
    - `pendingSessions(tutorId, limit)`: sessions with `tutor_id`, `sync_state in ('pending','error')` and `starts_at > now() - 30 days`, ordered by `starts_at`.
    - `tombstones(tutorId)` and `removeTombstone(id)`.
  - **Session lookup:** `sessionById(id)` and `sessionByEvent(calendarId, eventId)`.
  - **Session writes:**
    - `updateSession(id, fields)` updates through the service role and returns the row;
    - `insertSession(row)` returns `{ id }`.
  - **Students:**
    - `linkedStudents(tutorId)` returns `[{ id, full_name, email, google_email }]`. It joins `tutor_students` to `profiles`, plus `google_connections` where `purpose = 'student'`.
    - `studentGoogleEmail(studentId)` returns the address or null.
    - `tutorsWithSyncFor(studentId)` returns the connections of sync-on tutors linked to the student.
  - **Marking upcoming sessions pending:**
    - `markUpcomingPending({ tutorId, studentId, now })` sets `sync_state = 'pending'` for scheduled sessions with `starts_at > now`.
    - It filters by `tutor_id` when `tutorId` is given, and by `student_id` when `studentId` is given.
  - **Pull lock:** `claimPull(userId, now)` sets `pull_started_at = now` only if it is null or older than 60 seconds. It returns true when it took the lock: an update, then `.select()`, where a row coming back means taken.
- **Produces, in `sync.js`:**
  - `async withGoogle(conn, deps, fn)`:
    - decrypts the token with `deps.config.tokenKey` and refreshes it, using `refreshAccess` with `deps.fetchImpl`;
    - calls `fn(calendarClient(access, { fetchImpl }))`;
    - on `GoogleAuthError`, does `updateConnection(conn.user_id, { last_error: 'reconnect' })` and returns `{ ok: false, error: 'reconnect' }`;
    - on another error, sets `last_error: 'google_error'`, logs `error.name`, and returns `{ ok: false, error: 'google_error' }`;
    - on success, returns `{ ok: true, value }`.
  - `async ensureCalendar(conn, google, repo)` returns `calendar_id`. If it is missing, it calls `google.insertCalendar({ summary: CALENDAR_NAME, timeZone: TIME_ZONE })` and saves it.
  - `async ensureChannel(conn, google, repo, { config, now, random })`:
    - **Keeps** the channel when `channel_expires_at` is more than `RENEW_WITHIN_MS` away.
    - **Otherwise:**
      - stops the old channel if there is one, ignoring errors;
      - watches with `id = randomUUID()` and `token = base64url(32 random bytes)`, using `address: config.notifyUrl` and `ttlSeconds: CHANNEL_TTL_SECONDS`;
      - saves `channel_id`, `channel_resource_id`, `channel_token` and `channel_expires_at` (from `Number(expiration)`).
  - `async stopSync(conn, google, repo)` stops the channel (ignoring errors) and clears the channel fields.
  - `async pushPending(conn, google, { repo, config, now })` returns `{ pushed, deleted, failed, stopped }`. Behavior:
    1. For each tombstone, run `google.deleteEvent(t.calendar_id, t.event_id)`, then `removeTombstone(t.id)`.
    2. Read the rows with `pendingSessions(conn.user_id, 50)`.
    3. For each row:
       - Look up the student with `getProfile(row.student_id)` and `studentGoogleEmail(row.student_id)`.
       - **Cancelled with `google_event_id`:** delete the event, then update `{ google_event_id: null, google_link: null, sync_state: 'synced', google_synced_at: now }`.
       - **Cancelled without one:** update `{ sync_state: 'synced', google_synced_at: now }`.
       - **With `google_event_id`:** run `patchEvent(row.google_calendar_id, row.google_event_id, sessionToEvent(...))`. On `GoogleNotFound`, insert instead.
       - **Otherwise:** run `insertEvent(conn.calendar_id, sessionToEvent(...))`.
       - **After an insert or patch:** update `{ google_event_id: ev.id, google_calendar_id: conn.calendar_id or the row's calendar, google_link: ev.htmlLink, sync_state: 'synced', google_synced_at: now }`.
    4. **On `GoogleRateError`:** stop the loop and return `stopped: true`.
    5. **On any other error for a row:** update `{ sync_state: 'error' }`, increase `failed`, and continue.
    6. **On `GoogleAuthError`:** rethrow, so `withGoogle` handles it.
  - `async pullChanges(conn, google, { repo, now })` returns `{ updated, inserted, cancelled, skipped }`. Behavior:
    1. If `!(await repo.claimPull(conn.user_id, now))`, return `{ skipped: true }`.
    2. Page through `google.listEvents(conn.calendar_id, conn.sync_token ? { syncToken, singleEvents: false, showDeleted: true } : { singleEvents: false, showDeleted: true, maxResults: 250 })`, following `nextPageToken`. On `GoogleGone`, clear the token in memory and restart once without it.
    3. Each item `e`:
       - **A recurring master (`e.recurrence` is set):**
         - list its instances with `listInstances(cal, e.id, { timeMin: now - 56 days, timeMax: now + 182 days, showDeleted: true })`, paging;
         - apply each instance with `recurringId = e.id`;
         - if the master itself is cancelled, the cancellation reaches each instance as `status 'cancelled'`.
       - **Otherwise,** apply `e` with `recurringId = e.recurringEventId ?? null`.
    4. **Applying an event:**
       - **Finding the row:**
         - First, `extendedProperties.private.vpSessionId` gives `sessionById`, and the row is used only if `row.tutor_id === conn.user_id`.
         - Otherwise, `sessionByEvent(conn.calendar_id, e.id)`.
       - **Mapping:** `fields = eventToSessionFields(e)`. If `fields` is null (all-day), skip.
       - **A row exists:**
         - If `resolveConflict(row, e) === 'portal'`, skip; the next push wins.
         - If `fields.status === 'cancelled'` and the row is not already cancelled, update `{ status: 'cancelled', sync_state: 'synced', google_synced_at: now }` (counts as cancelled).
         - Otherwise, update `{ ...fields, google_event_id: e.id, google_calendar_id: conn.calendar_id, google_recurring_id: recurringId, sync_state: 'synced', google_synced_at: now }`, leaving out the keys whose values are unchanged.
       - **No row, and the event is not cancelled:**
         - Load the students once with `linkedStudents(conn.user_id)`, then `st = matchStudent(e, students)`.
         - With a match, insert `{ student_id: st.id, tutor_id: conn.user_id, ...fields, google_event_id: e.id, google_calendar_id: conn.calendar_id, google_recurring_id: recurringId, sync_state: 'synced', google_synced_at: now }`.
         - Without a match, skip.
    5. Finally, `updateConnection(conn.user_id, { sync_token: nextSyncToken ?? conn.sync_token, last_synced_at: now, last_error: null, pull_started_at: null })`.
  - The service role writes rows, so the pending trigger does not fire on them (Task 1).

- [ ] **Step 1: Write `tests/unit/google-sync.test.js`.**
  - **Fakes:**
    - **`fakeGoogle()`:** an in-memory event store keyed by calendar and id, with the `calendarClient` method shapes. It records calls, and can be told to throw a given error on the next call of a method.
    - **`fakeRepo()`:** arrays for sessions, connections and tombstones, implementing the repo methods above.
  - **Cases:**
    1. An insert of a pending session creates an event (attendee set from `studentGoogleEmail`) and stores the event id, link and synced state.
    2. A patch on an existing event; a 404 on the patch falls back to an insert.
    3. A cancelled synced session deletes the event and clears the id.
    4. A tombstone deletes the event and is removed.
    5. A rate error stops after the first row and leaves the rest pending.
    6. A generic error marks that row `error` and the others still push.
    7. `GoogleAuthError` propagates.
    8. Pull: an event with `vpSessionId` moves the session (times updated, `sync_state` synced).
    9. Pull: an event with a `vpSessionId` belonging to another tutor's session is ignored.
    10. Pull: a new event inviting `maya@gmail.test` (Maya's `google_email`) inserts a session for Maya, with the subject from the summary.
    11. Pull: a new event with no linked student is skipped.
    12. Pull: a cancelled event cancels the row.
    13. Pull: a recurring master yields instance rows with `google_recurring_id` set.
    14. Pull: `resolveConflict` portal-wins keeps the pending row unchanged.
    15. Pull: a 410 on the sync token does a full list and stores the new token.
    16. Pull: `claimPull` false returns `skipped`.
    17. `ensureChannel` keeps a fresh channel and renews one expiring in 1 hour (old stopped, new saved).
    18. `withGoogle` turns `invalid_grant` into `last_error 'reconnect'`.
- [ ] **Step 2: Implement `repo.js` and `sync.js`** to the interfaces above, using `check()` like `api/_lib/repo.js`.
- [ ] **Step 3: Run the tests.** `npm test` passes.
- [ ] **Step 4: Commit.** Use the message "Add the Google Calendar push and pull sync".

---

### Task 4: Endpoints, cron and config

**Files:**
- Create: `api/_lib/google/handlers.js`, and `api/google/start.js`, `api/google/callback.js`, `api/google/settings.js`, `api/google/disconnect.js`, `api/google/sync.js`, `api/google/personal.js`, `api/google/notify.js`
- Modify: `api/_lib/http.js` (`handleSweep` runs `maintainAll`), `api/cron/sweep.js`, `vercel.json` (add `"api/google/*.js": { "maxDuration": 60 }` under `functions`)
- Test: `tests/unit/google-handlers.test.js`; extend `tests/unit/http.test.js` for the sweep

**Interfaces:**
- **Consumes:** Tasks 2 and 3, and `verifyBearer` and `adminClient` from `api/_lib/supabase.js`.
- **Produces:** the HTTP contract below, which the portal (Task 5) relies on.

| Method and path | Auth | Request | Success | Errors |
|---|---|---|---|---|
| POST `/api/google/start` | Bearer | `{ purpose: 'tutor'\|'student', return_to: string }` | 200 `{ url }` | 401 sign in; 403 when the role does not match the purpose (a tutor may only use `tutor`, a student only `student`); 400 bad `return_to` (must start `/portal/` and not contain `//`); 503 not configured |
| GET `/api/google/callback?code&state` (or `?error=`) | none (the state ties it to the user) | none | 302 to `return_to` with `google=connected` merged into the hash query | 302 to `return_to` with `google=error`, or to `/portal/` when the state is unknown |
| POST `/api/google/settings` | Bearer, tutor | `{ sync_enabled: boolean }` | 200 status (below) | 401; 403 not a tutor; 409 `{ error: 'Connect Google Calendar first.' }` when there is no connection; 503 |
| POST `/api/google/disconnect` | Bearer | none | 200 `{ connected: false }` | 401; 503 |
| POST `/api/google/sync` | Bearer, tutor | none | 200 status | 401; 403; 409 not connected or sync off; 503 |
| GET `/api/google/personal?from=ISO&to=ISO` | Bearer, tutor, sync on | none | 200 `{ events: [{ id, title, start, end, all_day }] }` with `cache-control: private, max-age=60` | 400 bad or too long a range (at most 42 days); 401; 403; 409; 503 |
| POST `/api/google/notify` | channel headers | Google headers | 200 empty, always, even for unknown channels | none |

- **Status body:** `{ connected, purpose, google_email, sync_enabled, last_synced_at, last_error }`.
- **Hash merging in the callback:**
  - `return_to` is like `/portal/staff.html#/calendar?view=week`.
  - Add `google=connected` (or `google=error&reason=<code>`) to the query part after `#`. Create it when there is no `?`.
- **Callback steps:**
  1. `takeState(state, now)`. If it is null (unknown or expired), redirect to `/portal/`, which sends a signed-in person to their home page.
  2. `exchangeCode`, then `fetchEmail`.
  3. **Tutor:**
     - Requires `refresh_token`; without one, redirect with `reason=no_refresh`.
     - `upsertConnection({ user_id, purpose: 'tutor', google_email, refresh_token_enc: encrypt(refresh_token), scopes: scope, sync_enabled: true, last_error: null, updated_at: now })`.
     - Then, best effort, inside `withGoogle`: `ensureCalendar`, `ensureChannel`, `markUpcomingPending({ tutorId: user_id, now })`, `pushPending`, `pullChanges`.
  4. **Student:**
     - `upsertConnection({ user_id, purpose: 'student', google_email, refresh_token_enc: null, scopes })`.
     - Then revoke the access token, because the portal keeps no student tokens.
     - Then `markUpcomingPending({ studentId: user_id, now })`.
     - For each `tutorsWithSyncFor(user_id)`, run `withGoogle(c, ..., g => pushPending(c, g, ...))`, sequentially, at most 5 tutors.
  5. Steps 3 and 4 run in `waitUntil` after the redirect is built, so the browser is not kept waiting. The redirect still says connected.
- **Settings:**
  - **On:** run `ensureCalendar` and `ensureChannel` within `withGoogle`, and `markUpcomingPending` for the tutor. Then `push` and `pull` in `waitUntil`.
  - **Off:** `updateConnection({ sync_enabled: false })`, then `withGoogle(stopSync)`.
  - Returns the status.
- **Disconnect:**
  - **Tutor:** `withGoogle(stopSync)` (best effort), `revoke(refresh)`, `deleteConnection`.
  - **Student:** `deleteConnection`, `markUpcomingPending({ studentId })`, and pushes for their sync-on tutors in `waitUntil`.
- **Sync:** `withGoogle(conn, g => pushPending then pullChanges)`, then return the status.
- **Personal:**
  - Calls `withGoogle(conn, g => g.listEvents('primary', { singleEvents: true, orderBy: 'startTime', timeMin: from, timeMax: to, maxResults: 250 }))`.
  - Maps the items through `personalItem` and filters out nulls.
  - On a failure from `withGoogle`, answers 502 `{ error: 'Google Calendar did not answer. Try again.' }`.
- **Notify:**
  - Reads `X-Goog-Channel-ID`, `X-Goog-Channel-Token` and `X-Goog-Resource-State`.
  - Looks up the connection with `getConnectionByChannel`.
  - Compares the token with `timingSafeEqual`, checking the lengths first.
  - Unless the resource state is `sync` (or the connection is unknown, the token is wrong, or sync is off), runs `waitUntil(withGoogle(conn, g => pullChanges(...)))`.
  - Always returns 200.
- **`maintainAll(deps, { budgetMs = 120000 })`:**
  - For each `listSyncTutors()`, while time remains, runs `withGoogle(c, async g => { await ensureChannel(...); await pushPending(...); await pullChanges(...); })`.
  - Returns `{ tutors, ok, failed }`.
  - `handleSweep` calls it after grading, only when `googleConfig(env)` is set, and adds `google: summary` to its JSON.
- **Entry file pattern** (each `api/google/*.js`):

```js
import { waitUntil } from '@vercel/functions';
import { adminClient, verifyBearer } from '../_lib/supabase.js';
import { createGoogleRepo } from '../_lib/google/repo.js';
import { googleConfig } from '../_lib/google/config.js';
import { handleStart } from '../_lib/google/handlers.js';

export async function POST(request) {
  const config = googleConfig();
  if (!config) return Response.json({ error: 'Google Calendar is not set up yet.' }, { status: 503 });
  const db = adminClient();
  return handleStart(request, { repo: createGoogleRepo(db), verify: (r) => verifyBearer(r, db), config, waitUntil, fetchImpl: fetch, now: () => new Date() });
}
```

- **Methods:** `callback.js` and `personal.js` export `GET`; the others export `POST`.

- [ ] **Step 1: Write `tests/unit/google-handlers.test.js`,** with fake deps as in `tests/unit/http.test.js`:
  - **start:**
    - 401 without a caller;
    - 403 for a student asking for tutor;
    - 400 for `return_to` `https://evil` and for `/portal//x`;
    - 200 with a URL containing `code_challenge` and the tutor scopes;
    - a state row is saved with `expires_at` now plus 10 minutes.
  - **callback:**
    - an unknown state redirects with `google=error`;
    - a tutor success upserts an encrypted token (decryptable with the test key), and the redirect hash has `google=connected` merged into the existing query;
    - a tutor without a `refresh_token` gives `reason=no_refresh`;
    - a student success stores no token, and revoke is called.
  - **settings:**
    - 403 for a student;
    - 409 without a connection;
    - on and off both update `sync_enabled`;
    - off stops the channel.
  - **disconnect:** a tutor revokes and deletes; a student deletes and marks pending.
  - **personal:**
    - a 43-day range gives 400;
    - private events come back as Busy;
    - the cache header is set.
  - **notify:**
    - a wrong token never pulls;
    - the right token pulls in `waitUntil`;
    - state `sync` does not pull;
    - an unknown channel gives 200.
  - **sweep:** with Google configured, `maintainAll` runs and the JSON has `google`; without it, there is no Google call.
- [ ] **Step 2: Implement the handlers and entry files, and update `vercel.json`, `http.js` and `sweep.js`.**
- [ ] **Step 3: Run the tests.** `npm test` passes. Also run `node --check` on every new `api/` file.
- [ ] **Step 4: Commit.** Use the message "Add the Google Calendar endpoints and daily maintenance".

---

### Task 5: Portal UI

**Files:**
- Create: `portal/js/google.js`, `portal/js/google-model.js`, `tests/unit/google-model.test.js`
- Modify:
  - `portal/js/views/calendar.js`, `portal/css/calendar.css`;
  - `portal/js/session-form.js`, `portal/js/session-drawer.js`, `portal/css/sessions.css`;
  - `portal/js/views/overview.js`, `portal/css/overview.css`;
  - `portal/js/store.js` (`SESSION_FIELDS` adds `google_event_id, google_link, sync_state`);
  - the `?v=` of each changed CSS file in `portal/student.html`, `parent.html` and `staff.html`.

**Interfaces:**
- **Consumes:** the HTTP contract in Task 4, and the RPC `my_google_connection` from Task 1.
- **Produces, `google.js`** (browser; uses `sb` from `./supabase.js` for the session token and the RPC):
  - `getGoogleStatus()` returns `Promise<{ connected, purpose, google_email, sync_enabled, last_synced_at, last_error }>`. When the RPC returns no row, it resolves to `{ connected: false, ... }`; when the RPC errors, it resolves to `{ connected: false, unavailable: true }`. The result is cached until `invalidateGoogle()`.
  - `connectGoogle(purpose, returnTo = location.pathname + location.hash)` POSTs `/api/google/start`, then runs `location.assign(url)`. It rejects with a user-safe `Error(message)`.
  - `setGoogleSync(on)`, `disconnectGoogle()` and `syncNow()` POST to their endpoints and resolve to the status. They call `invalidateGoogle()`.
  - `personalEvents(fromIso, toIso)` returns `Promise<Array>`, cached for 60 seconds per range.
  - **Every fetch** sends `Authorization: Bearer <session.access_token>` from `sb.auth.getSession()`. On a 503, it rejects with `Error('Google Calendar is not set up yet.')`.
- **Produces, `google-model.js`** (pure):
  - `syncStatusText(status, now)`:
    - not connected or sync off gives `'Off'`;
    - `last_error === 'reconnect'` gives `'Reconnect needed'`;
    - `last_error === 'google_error'` gives `'Sync paused, retrying'`;
    - otherwise it gives `'Synced just now'`, `'Synced 5 minutes ago'`, `'Synced 2 hours ago'`, or `'Synced Oct 3'` for older (use `relativeTime` from `dates.js`; lowercase its first letter after "Synced ").
  - `personalBlocks(events)`: the timed events become `{ id: 'g:'+id, starts_at, ends_at, personal: true, title }`, which `layoutDay` accepts. All-day ones are returned separately: `{ timed, allDay }`.
  - `readGoogleReturn(hash)` returns `{ result: 'connected' | 'error' | null, reason, cleanHash }`, where `cleanHash` drops the `google` and `reason` params.
  - `googleDayUrl(dayKey)` returns `https://calendar.google.com/calendar/r/day/YYYY/M/D` with no zero padding.
  - `personalClashes(candidate, events)` returns the timed personal events that overlap `[candidate.starts_at, candidate.ends_at)`.
- **Calendar view (`views/calendar.js`):**
  - **Tutor, `ctx.me.role === 'tutor'`:**
    - **The switch:** add a `.cal-google` control to the toolbar. It is a switch button with `role="switch"`, `aria-checked` and the label "Google Calendar", plus a status text from `syncStatusText`, and a small `menu()` holding "Sync now" and "Disconnect" when connected.
    - **Clicking the switch:**
      - not connected: `connectGoogle('tutor')`;
      - connected: `setGoogleSync(!on)`, then `ctx.store.invalidate(null)` and a toast ("Google Calendar sync is on" / "Google Calendar sync is off").
    - **"Reconnect needed":** shows a danger-link button "Reconnect Google Calendar", which calls `connectGoogle('tutor')`.
    - **On mount with sync on:** call `syncNow()` once per page load (a module-level flag), then `ctx.store.invalidate(null)` when it resolves.
    - **Week view, sync on** (any scope; personal events are only ever the viewer's own): fetch `personalEvents(weekStart 00:00 PT, weekEnd + 1 day 00:00 PT)`.
      - Merge `personalBlocks(...).timed` into each day's `layoutDay` input.
      - Render `personal: true` items as `div.cal-personal`: grey hatched, with time and title, `aria-label` "Personal: Dentist, 3:00 to 4:00 pm", and `tabindex="0"`.
      - Enter or click opens a small popover (use `menu`-like markup or a `details`) with the title, the time, and a link "Open in Google Calendar" (`googleDayUrl`) that opens in a new tab with `rel="noopener noreferrer"`.
      - All-day personal events go in the "Due" row as grey chips.
      - Add a legend item "Personal (Google)".
      - If the fetch fails, show nothing extra. Do not break the calendar.
  - **Students, `ctx.me.role === 'student'`:** the toolbar gets a "Get Google Calendar invites" button, which calls `connectGoogle('student')`. When connected, it becomes the text "Invites go to {email}" with a "Stop invites" ghost button (`disconnectGoogle()`, then a toast).
  - **Parents and admins:** nothing new.
  - **On mount, every role:** `readGoogleReturn(location.hash)`. If there is a result, toast "Google Calendar connected" or "Google Calendar could not connect. Try again.", then `history.replaceState(null, '', location.pathname + location.search + cleanHash)`.
- **Session form (`session-form.js`):** when `dctx.me.role === 'tutor'`, the session's tutor is the viewer, and `getGoogleStatus().sync_enabled`:
  - fetch `personalEvents` for the chosen day, in Pacific;
  - add one clash line per overlap, using the existing clash callout: `You have “Dentist” in your Google Calendar then.`;
  - debounce to one fetch per day key.
- **Session drawer (`session-drawer.js`), staff:**
  - When `session.google_link` is set, add the button "Open in Google Calendar" (an `a`, new tab) beside "Add to calendar".
  - When the viewer is the session's tutor with sync on and `sync_state` is `'pending'` or `'error'`, add a small note "Not synced to Google yet. It will sync shortly."
- **Overview (`views/overview.js`):** for students, the "Your tutors" card footer gets the same student connect or status control as the calendar toolbar. Reuse one helper exported from `google.js`: `studentInviteControl(dctx-like { toast, store })` returns an element.
- **CSS:** `.cal-google`, `.cal-switch` (a 44px touch target, with `aria-checked` styling using `var(--accent)`), `.cal-personal` (a `repeating-linear-gradient` hatch using `var(--surface-2)` and `var(--line)`, text `var(--text-3)`) and `.google-invite`. Use the existing tokens, so dark mode works.

- [ ] **Step 1: Write the `tests/unit/google-model.test.js` tests** for every `google-model.js` function, including:
  - DST weeks for the `personalBlocks` input;
  - the hash with and without other params;
  - `googleDayUrl('2026-10-06')` gives `.../2026/10/6`.
- [ ] **Step 2: Implement `google-model.js`, then `google.js`, then the view changes.**
- [ ] **Step 3:** `npm test` passes, including `portal-pages.test.js` (no dashes, no `innerHTML`, no inline styles).
- [ ] **Step 4: Commit.** Use the message "Show Google Calendar sync and personal events in the portal".

---

### Task 6: Demo stand-in (controller)

- **What it fakes:** extend `scratchpad/demo-src/demo-supabase.js`:
  - `client.rpc('my_google_connection')` returns the fake connection for the persona. Daniel (`u-tutor`) starts connected with sync on; Maya starts not connected.
  - Patch `window.fetch` for paths starting with `/api/google/`:
    - **start:** returns `{ url: location.pathname + location.hash.replace(...) + '&google=connected' }` (simulated), and marks the persona connected;
    - **settings:** toggles the switch;
    - **disconnect:** disconnects;
    - **sync:** returns the status;
    - **personal:** returns 4 fake personal events in the requested week, one private;
    - **notify:** not needed.
  - The demo `sessions` rows get `google_link: 'https://calendar.google.com/'` and `sync_state: 'synced'` for Daniel's sessions.
- **Check:** rebuild the demo and screenshot it:
  - the tutor week view with the switch on and personal events;
  - the switch off;
  - the student calendar with "Get Google Calendar invites";
  - the session drawer with "Open in Google Calendar";
  - the clash line for a personal event.

### Task 7: Docs and PR (controller)

- **`docs/google-calendar-setup.md`:** the owner steps from the spec (Google Cloud project, consent screen, client, environment variables, test users and publishing, migrations in order).
- **Spec:** update `docs/superpowers/specs/2026-10-02-tutoring-schedules.md` with a "Google Calendar sync" pointer.
- **Review and push:**
  - Run a final whole-branch review with a fresh agent.
  - Fix its findings.
  - Run `npm test` and the PGlite run.
  - Push `schedules` and update the PR #5 description.
  - **Do not merge.** Report to the owner first.

## Self-review notes

- **Spec coverage:**
  - Decisions: the switch, invites and overlay are in Task 5; two-way sync is in Task 3; students have email only, in Tasks 2 and 4.
  - Data: Task 1. Server modules: Tasks 2 and 3. Endpoints and cron: Task 4.
  - Portal: Task 5. Errors and security: Tasks 2 to 4 (crypto, states, token compare, logging rule). Testing: in every task. Setup: Task 7.
- **Names consistent across tasks:**
  - Task 3 functions: `withGoogle`, `ensureCalendar`, `ensureChannel`, `stopSync`, `pushPending`, `pullChanges`.
  - Task 3 repo methods: `markUpcomingPending`, `tutorsWithSyncFor`, `linkedStudents`, `studentGoogleEmail`, `claimPull`.
  - Task 2 mapping functions: `sessionToEvent`, `eventToSessionFields`, `matchStudent`, `resolveConflict`, `personalItem`.
