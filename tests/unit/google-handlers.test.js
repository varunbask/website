import { describe, test, expect, vi, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
  handleStart, handleCallback, handleSettings, handleDisconnect, handleSync, handlePersonal, handleNotify,
  maintainAll, mergeReturn, isSafeReturnTo, statusOf,
} from '../../api/_lib/google/handlers.js';
import { googleEndpoint } from '../../api/_lib/google/endpoint.js';
import { encrypt, decrypt } from '../../api/_lib/google/crypto.js';
import { SCOPES } from '../../api/_lib/google/config.js';
import { TOKEN_URL, USERINFO_URL, REVOKE_URL } from '../../api/_lib/google/oauth.js';
import * as startEntry from '../../api/google/start.js';
import * as callbackEntry from '../../api/google/callback.js';
import * as settingsEntry from '../../api/google/settings.js';
import * as disconnectEntry from '../../api/google/disconnect.js';
import * as syncEntry from '../../api/google/sync.js';
import * as personalEntry from '../../api/google/personal.js';
import * as notifyEntry from '../../api/google/notify.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const now = () => NOW;
const DAY = 24 * 3600 * 1000;
const KEY = randomBytes(32).toString('base64');
const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const API = 'https://www.googleapis.com/calendar/v3';
const TUTOR_SCOPE = SCOPES.tutor.join(' ');
const NOT_SET_UP = 'Google Calendar is not set up yet.';

const CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  tokenKey: KEY,
  siteUrl: 'https://site.test',
  redirectUri: 'https://site.test/api/google/callback',
  notifyUrl: 'https://site.test/api/google/notify',
  portalUrl: 'https://site.test/portal/',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------- fakes

// A stand-in for Google over fetch: the token, userinfo and revoke endpoints
// and the few Calendar routes the handlers reach. Every request is recorded.
function fakeFetch(options = {}) {
  const o = {
    email: 'tutor@gmail.com', personal: [], calendarStatus: 200, refresh: 'ok', exchange: 'ok', userinfo: 'ok',
    hold: null, grant: {}, ...options,
  };
  const calls = [];
  let inserted = 0;
  const json = (body, status = 200) => Response.json(body, { status });

  const fn = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const isToken = url.origin + url.pathname === TOKEN_URL;
    const raw = typeof init.body === 'string' ? init.body : null;
    const body = raw ? (isToken ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw)) : null;
    calls.push({ method, url, body, auth: init.headers?.Authorization ?? null });

    if (isToken) {
      if (body.grant_type === 'authorization_code') {
        if (o.exchange !== 'ok') return json({ error: 'invalid_grant' }, 400);
        return json({ access_token: 'access-1', refresh_token: 'refresh-1', scope: TUTOR_SCOPE, expires_in: 3599, ...o.grant });
      }
      return o.refresh === 'ok' ? json({ access_token: 'access-2', expires_in: 3599 }) : json({ error: 'invalid_grant' }, 400);
    }
    if (url.href.startsWith(USERINFO_URL)) {
      return o.userinfo === 'ok' ? json({ email: o.email, email_verified: true }) : json({ error: 'nope' }, 401);
    }
    if (url.href.startsWith(REVOKE_URL)) return json({});
    if (url.href.startsWith(API)) {
      if (o.hold) await o.hold;
      if (o.calendarStatus !== 200) return json({ error: { errors: [{ reason: 'backendError' }] } }, o.calendarStatus);
      const path = url.pathname.replace('/calendar/v3', '');
      if (method === 'POST' && path === '/calendars') return json({ id: 'cal-new' });
      if (method === 'POST' && /\/events\/watch$/.test(path)) return json({ resourceId: 'res-new', expiration: String(NOW.getTime() + 7 * DAY) });
      if (method === 'POST' && path === '/channels/stop') return new Response(null, { status: 204 });
      if (method === 'GET' && path === '/calendars/primary/events') return json({ items: o.personal });
      if (method === 'GET' && /\/events$/.test(path)) return json({ items: [], nextSyncToken: 'sync-1' });
      if (method === 'POST' && /\/events$/.test(path)) {
        inserted += 1;
        return json({ id: `ev-${inserted}`, htmlLink: `https://calendar.google.com/event?eid=${inserted}` });
      }
    }
    return json({}, 404);
  });
  fn.calls = calls;
  fn.api = () => calls.filter((c) => c.url.href.startsWith(API));
  fn.token = (grant) => calls.filter((c) => c.url.origin + c.url.pathname === TOKEN_URL && c.body.grant_type === grant);
  fn.revokes = () => calls.filter((c) => c.url.href.startsWith(REVOKE_URL)).map((c) => c.url.searchParams.get('token'));
  return fn;
}

const tutorConn = (over = {}) => ({
  user_id: TUTOR,
  purpose: 'tutor',
  google_email: 'tutor@gmail.com',
  refresh_token_enc: encrypt('refresh-tutor', KEY),
  scopes: TUTOR_SCOPE,
  sync_enabled: true,
  calendar_id: 'cal-1',
  sync_token: null,
  channel_id: null,
  channel_resource_id: null,
  channel_token: null,
  channel_expires_at: null,
  pull_started_at: null,
  last_synced_at: null,
  last_error: null,
  ...over,
});

const studentConn = (over = {}) => ({
  user_id: STUDENT, purpose: 'student', google_email: 'maya@gmail.com', refresh_token_enc: null, scopes: 'openid email',
  sync_enabled: false, calendar_id: null, last_synced_at: null, last_error: null, ...over,
});

const PROFILES = {
  [TUTOR]: { id: TUTOR, role: 'tutor' },
  [STUDENT]: { id: STUDENT, role: 'student' },
  admin: { id: 'admin', role: 'admin' },
  parent: { id: 'parent', role: 'parent' },
};

// In-memory repo with the methods the handlers and the sync engine reach
function fakeRepo({ profiles = PROFILES, connections = [], states = [], tutorsFor = {} } = {}) {
  const conns = new Map(connections.map((c) => [c.user_id, { ...c }]));
  const stateRows = new Map(states.map((s) => [s.nonce, { ...s }]));
  const copy = (c) => (c ? { ...c } : null);
  return {
    conns,
    stateRows,
    getProfile: vi.fn(async (id) => profiles[id] ?? null),
    getConnection: vi.fn(async (id) => copy(conns.get(id))),
    getConnectionByChannel: vi.fn(async (channel) => copy([...conns.values()].find((c) => c.channel_id === channel))),
    listSyncTutors: vi.fn(async () => [...conns.values()].filter((c) => c.purpose === 'tutor' && c.sync_enabled).map(copy)),
    upsertConnection: vi.fn(async (row) => {
      const merged = { ...(conns.get(row.user_id) ?? {}), ...row };
      conns.set(row.user_id, merged);
      return copy(merged);
    }),
    updateConnection: vi.fn(async (id, fields) => { if (conns.has(id)) Object.assign(conns.get(id), fields); }),
    deleteConnection: vi.fn(async (id) => { conns.delete(id); }),
    saveState: vi.fn(async (row) => { stateRows.set(row.nonce, row); }),
    takeState: vi.fn(async (nonce, at) => {
      const row = stateRows.get(nonce);
      stateRows.delete(nonce);
      return row && new Date(row.expires_at).getTime() > at.getTime() ? row : null;
    }),
    markUpcomingPending: vi.fn(async () => {}),
    tutorsWithSyncFor: vi.fn(async (studentId) => (tutorsFor[studentId] ?? []).map((id) => copy(conns.get(id)))),
    pendingSessions: vi.fn(async () => []),
    tombstones: vi.fn(async () => []),
    claimPull: vi.fn(async () => true),
    claimPush: vi.fn(async () => true),
  };
}

function setup({ repo = fakeRepo(), caller = { id: TUTOR }, fetch = fakeFetch() } = {}) {
  const background = [];
  const deps = {
    repo,
    verify: vi.fn(async () => caller),
    config: CONFIG,
    waitUntil: vi.fn((p) => background.push(p)),
    fetchImpl: fetch,
    now,
  };
  return { deps, repo, fetch, background, settle: () => Promise.all(background) };
}

const post = (body) => new Request('https://site.test/api/google/x', {
  method: 'POST',
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});
const get = (path) => new Request(`https://site.test${path}`, { headers: { Authorization: 'Bearer token' } });
const callbackRequest = (query) => new Request(`https://site.test/api/google/callback?${new URLSearchParams(query)}`);

const stateRow = (over = {}) => ({
  nonce: 'nonce-1',
  user_id: TUTOR,
  purpose: 'tutor',
  verifier: 'verifier-1',
  return_to: '/portal/staff.html#/calendar?view=week',
  expires_at: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
  ...over,
});

const RETURN_TO = '/portal/staff.html#/calendar?view=week';

// ---------------------------------------------------------------- pure helpers

describe('isSafeReturnTo', () => {
  test('accepts portal paths with a query and a hash', () => {
    for (const ok of ['/portal/', '/portal/staff.html', '/portal/staff.html?student=5#/calendar?view=week', '/portal/student.html#/overview']) {
      expect(isSafeReturnTo(ok), ok).toBe(true);
    }
  });

  test('refuses anything else', () => {
    const bad = [
      'https://evil.test/portal/', '//evil.test/portal/', '/portal', '/portalx/', '/other/portal/', '/portal//x', '/portal/a//b',
      '/portal/\\evil', '/portal/a\nb', '/portal/a b', '/portal/é', `/portal/${'a'.repeat(1100)}`, '', null, undefined, 42, {},
    ];
    for (const value of bad) expect(isSafeReturnTo(value), String(value)).toBe(false);
  });
});

describe('mergeReturn', () => {
  test('adds google=connected to the query after the hash', () => {
    expect(mergeReturn('/portal/staff.html#/calendar?view=week', 'connected'))
      .toBe('/portal/staff.html#/calendar?view=week&google=connected');
  });

  test('creates the query when the hash has none', () => {
    expect(mergeReturn('/portal/staff.html#/calendar', 'connected')).toBe('/portal/staff.html#/calendar?google=connected');
  });

  test('creates a route hash when there is none, so the router leaves it a route', () => {
    expect(mergeReturn('/portal/staff.html', 'connected')).toBe('/portal/staff.html#/?google=connected');
    expect(mergeReturn('/portal/staff.html?student=5', 'connected')).toBe('/portal/staff.html?student=5#/?google=connected');
    expect(mergeReturn('/portal/staff.html#', 'connected')).toBe('/portal/staff.html#/?google=connected');
  });

  test('keeps the search part of the page address in front of the hash', () => {
    expect(mergeReturn('/portal/staff.html?student=5#/calendar?view=week', 'error', 'denied'))
      .toBe('/portal/staff.html?student=5#/calendar?view=week&google=error&reason=denied');
  });

  test('replaces google and reason params left over from an earlier round trip', () => {
    expect(mergeReturn('/portal/staff.html#/calendar?google=error&view=week&reason=failed', 'connected'))
      .toBe('/portal/staff.html#/calendar?view=week&google=connected');
  });
});

describe('statusOf', () => {
  test('is the status body, and says nothing is connected for no row', () => {
    expect(statusOf(tutorConn({ last_synced_at: '2026-10-02T11:00:00Z', last_error: 'google_error' }))).toEqual({
      connected: true, purpose: 'tutor', google_email: 'tutor@gmail.com', sync_enabled: true,
      last_synced_at: '2026-10-02T11:00:00Z', last_error: 'google_error',
    });
    expect(statusOf(null)).toEqual({
      connected: false, purpose: null, google_email: null, sync_enabled: false, last_synced_at: null, last_error: null,
    });
  });

  test('never carries a token or a calendar id', () => {
    const body = statusOf(tutorConn({ channel_token: 'secret' }));
    expect(Object.keys(body).sort()).toEqual(['connected', 'google_email', 'last_error', 'last_synced_at', 'purpose', 'sync_enabled']);
  });
});

// ---------------------------------------------------------------- start

describe('handleStart', () => {
  const start = (body = { purpose: 'tutor', return_to: RETURN_TO }, options) => {
    const ctx = setup(options);
    return handleStart(post(body), ctx.deps).then(async (res) => ({ res, json: await res.json(), ...ctx }));
  };

  test('401 without a caller', async () => {
    const { res, repo } = await start(undefined, { caller: null });
    expect(res.status).toBe(401);
    expect(repo.saveState).not.toHaveBeenCalled();
  });

  test('400 for a body that is not JSON or has no valid purpose', async () => {
    for (const body of ['not json', {}, { purpose: 'admin', return_to: RETURN_TO }, { return_to: RETURN_TO }]) {
      const { res } = await start(body);
      expect(res.status).toBe(400);
    }
  });

  test('403 when the role does not match the purpose', async () => {
    expect((await start({ purpose: 'tutor', return_to: RETURN_TO }, { caller: { id: STUDENT } })).res.status).toBe(403);
    expect((await start({ purpose: 'student', return_to: RETURN_TO }, { caller: { id: TUTOR } })).res.status).toBe(403);
    expect((await start({ purpose: 'tutor', return_to: RETURN_TO }, { caller: { id: 'admin' } })).res.status).toBe(403);
    expect((await start({ purpose: 'student', return_to: RETURN_TO }, { caller: { id: 'parent' } })).res.status).toBe(403);
    expect((await start({ purpose: 'tutor', return_to: RETURN_TO }, { caller: { id: 'nobody' } })).res.status).toBe(403);
  });

  test('a refused request saves no state', async () => {
    const { repo } = await start({ purpose: 'tutor', return_to: RETURN_TO }, { caller: { id: STUDENT } });
    expect(repo.saveState).not.toHaveBeenCalled();
  });

  test('400 for a return_to outside the portal', async () => {
    for (const return_to of ['https://evil', '/portal//x', '//evil.test/portal/', '/elsewhere', undefined, 7]) {
      const { res, repo } = await start({ purpose: 'tutor', return_to });
      expect(res.status, String(return_to)).toBe(400);
      expect(repo.saveState).not.toHaveBeenCalled();
    }
  });

  test('200 with the Google URL: PKCE challenge, tutor scopes, offline access, the callback address', async () => {
    const { res, json } = await start();
    expect(res.status).toBe(200);
    const url = new URL(json.url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope').split(' ')).toEqual(SCOPES.tutor);
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://site.test/api/google/callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
  });

  test('a student asks for the identity scopes only', async () => {
    const { json } = await start({ purpose: 'student', return_to: '/portal/student.html#/overview' }, { caller: { id: STUDENT } });
    expect(new URL(json.url).searchParams.get('scope').split(' ')).toEqual(['openid', 'email']);
  });

  test('saves a state row that lasts ten minutes and ties the nonce, user, purpose and verifier together', async () => {
    const { json, repo } = await start();
    expect(repo.saveState).toHaveBeenCalledTimes(1);
    const row = repo.saveState.mock.calls[0][0];
    const url = new URL(json.url);
    expect(row).toEqual({
      nonce: url.searchParams.get('state'),
      user_id: TUTOR,
      purpose: 'tutor',
      verifier: expect.any(String),
      return_to: RETURN_TO,
      expires_at: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    });
    expect(createHash('sha256').update(row.verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(json.url).not.toContain(row.verifier);
  });
});

// ---------------------------------------------------------------- callback

describe('handleCallback', () => {
  const run = async ({ query = { code: 'code-1', state: 'nonce-1' }, state = stateRow(), connections = [], fetch, tutorsFor } = {}) => {
    const ctx = setup({ repo: fakeRepo({ states: state ? [state] : [], connections, tutorsFor }), fetch });
    const res = await handleCallback(callbackRequest(query), ctx.deps);
    return { res, location: res.headers.get('location'), ...ctx };
  };

  test('an unknown state goes to /portal/ without touching Google', async () => {
    const { res, location, fetch, repo } = await run({ query: { code: 'c', state: 'unknown' } });
    expect(res.status).toBe(302);
    expect(location).toBe('/portal/');
    expect(fetch).not.toHaveBeenCalled();
    expect(repo.upsertConnection).not.toHaveBeenCalled();
  });

  test('so does an expired state, a missing state, and a state that was already used', async () => {
    const expired = await run({ state: stateRow({ expires_at: new Date(NOW.getTime() - 1000).toISOString() }) });
    expect(expired.location).toBe('/portal/');
    expect((await run({ query: { code: 'c' } })).location).toBe('/portal/');

    const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }) });
    expect((await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps)).headers.get('location')).toContain('google=connected');
    expect((await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps)).headers.get('location')).toBe('/portal/');
    expect(ctx.repo.takeState).toHaveBeenCalledWith('nonce-1', NOW);
  });

  test('a state the database cannot read goes to /portal/ as well', async () => {
    const ctx = setup();
    ctx.repo.takeState.mockRejectedValueOnce(new Error('takeState: down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
    expect(res.headers.get('location')).toBe('/portal/');
  });

  test('Google sending the person back with an error (they said no) comes back as google=error', async () => {
    const { res, location, fetch, repo } = await run({ query: { error: 'access_denied', state: 'nonce-1' } });
    expect(res.status).toBe(302);
    expect(location).toBe('/portal/staff.html#/calendar?view=week&google=error&reason=denied');
    expect(fetch).not.toHaveBeenCalled();
    expect(repo.upsertConnection).not.toHaveBeenCalled();
  });

  test('a callback with no code comes back as google=error', async () => {
    const { location } = await run({ query: { state: 'nonce-1' } });
    expect(location).toBe('/portal/staff.html#/calendar?view=week&google=error&reason=failed');
  });

  describe('a tutor', () => {
    test('upserts the connection with an encrypted refresh token, and the redirect says connected', async () => {
      const { res, location, repo, fetch } = await run();
      expect(res.status).toBe(302);
      expect(location).toBe('/portal/staff.html#/calendar?view=week&google=connected');
      expect(repo.upsertConnection).toHaveBeenCalledTimes(1);
      const row = repo.upsertConnection.mock.calls[0][0];
      expect(row).toMatchObject({
        user_id: TUTOR, purpose: 'tutor', google_email: 'tutor@gmail.com', scopes: TUTOR_SCOPE,
        sync_enabled: true, last_error: null, updated_at: NOW.toISOString(),
      });
      expect(row.refresh_token_enc).not.toContain('refresh-1');
      expect(decrypt(row.refresh_token_enc, KEY)).toBe('refresh-1');

      const exchange = fetch.token('authorization_code')[0].body;
      expect(exchange).toMatchObject({ code: 'code-1', code_verifier: 'verifier-1', redirect_uri: CONFIG.redirectUri });
    });

    test('the email is stored as Google reports it, lowercased', async () => {
      const { repo } = await run({ fetch: fakeFetch({ email: 'Tutor@Gmail.COM' }) });
      expect(repo.upsertConnection.mock.calls[0][0].google_email).toBe('tutor@gmail.com');
    });

    test('the connection and its calendar exist before the redirect is returned, and the rest runs in waitUntil', async () => {
      let release;
      const hold = new Promise((resolve) => { release = resolve; });
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }), fetch: fakeFetch({ hold }) });
      const pending = handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(ctx.deps.waitUntil).not.toHaveBeenCalled(); // still waiting on Google for the calendar
      expect(ctx.repo.upsertConnection).toHaveBeenCalledTimes(1);

      release();
      const res = await pending;
      expect(res.headers.get('location')).toContain('google=connected');
      expect(ctx.repo.conns.get(TUTOR).calendar_id).toBe('cal-new');
      expect(ctx.repo.conns.get(TUTOR).channel_id).toBeFalsy(); // the channel is made after the redirect
      expect(ctx.deps.waitUntil).toHaveBeenCalledTimes(1);

      await ctx.settle();
      expect(ctx.repo.conns.get(TUTOR)).toMatchObject({ calendar_id: 'cal-new', channel_id: expect.any(String) });
      expect(ctx.fetch.api().filter((c) => c.method === 'POST' && c.url.pathname === '/calendar/v3/calendars')).toHaveLength(1);
    });

    test('a Google failure while making the calendar is recorded, and the redirect still says connected', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }), fetch: fakeFetch({ calendarStatus: 500 }) });
      const res = await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      expect(res.headers.get('location')).toContain('google=connected');
      expect(ctx.repo.conns.get(TUTOR).last_error).toBe('google_error');
      expect(ctx.repo.conns.get(TUTOR).calendar_id).toBeFalsy();
      expect(ctx.deps.waitUntil).toHaveBeenCalledTimes(1);
    });

    test('a connection that already has its calendar does not make another', async () => {
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()], connections: [tutorConn({ calendar_id: 'cal-1' })] }) });
      await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      await ctx.settle();
      expect(ctx.fetch.api().some((c) => c.method === 'POST' && c.url.pathname === '/calendar/v3/calendars')).toBe(false);
      expect(ctx.repo.conns.get(TUTOR).calendar_id).toBe('cal-1');
    });

    test('the follow-up marks upcoming sessions, makes the calendar and channel, pushes and pulls', async () => {
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }) });
      await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      await ctx.settle();

      expect(ctx.repo.markUpcomingPending).toHaveBeenCalledWith({ tutorId: TUTOR, now: NOW });
      const conn = ctx.repo.conns.get(TUTOR);
      expect(conn.calendar_id).toBe('cal-new');
      expect(conn.channel_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(conn.channel_token).toBeTruthy();
      const watch = ctx.fetch.api().find((c) => c.url.pathname.endsWith('/events/watch'));
      expect(watch.body).toMatchObject({ type: 'web_hook', address: CONFIG.notifyUrl });
      expect(ctx.repo.pendingSessions).toHaveBeenCalledWith(TUTOR, expect.any(Number), NOW);
      expect(conn.last_synced_at).toBe(NOW.toISOString());
      expect(ctx.fetch.token('refresh_token')[0].body.refresh_token).toBe('refresh-1');
    });

    test('a refresh token that never arrives is reason=no_refresh and stores nothing', async () => {
      const { location, repo, fetch } = await run({ fetch: fakeFetch({ grant: { refresh_token: undefined } }) });
      expect(location).toBe('/portal/staff.html#/calendar?view=week&google=error&reason=no_refresh');
      expect(repo.upsertConnection).not.toHaveBeenCalled();
      expect(fetch.calls.some((c) => c.url.href.startsWith(API))).toBe(false);
    });

    test('a person who left the calendar boxes unticked is reason=scope, and the token is revoked', async () => {
      const { location, repo, fetch } = await run({ fetch: fakeFetch({ grant: { scope: 'openid email https://www.googleapis.com/auth/calendar.events.readonly' } }) });
      expect(location).toBe('/portal/staff.html#/calendar?view=week&google=error&reason=scope');
      expect(repo.upsertConnection).not.toHaveBeenCalled();
      expect(fetch.revokes()).toEqual(['refresh-1']);
    });

    test('a failed code exchange or email lookup is reason=failed and stores nothing', async () => {
      for (const options of [{ exchange: 'fail' }, { userinfo: 'fail' }]) {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { location, repo } = await run({ fetch: fakeFetch(options) });
        expect(location, JSON.stringify(options)).toBe('/portal/staff.html#/calendar?view=week&google=error&reason=failed');
        expect(repo.upsertConnection).not.toHaveBeenCalled();
      }
    });

    test('a database failure while saving is reason=failed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }) });
      ctx.repo.upsertConnection.mockRejectedValueOnce(new Error('upsertConnection: down'));
      const res = await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      expect(res.headers.get('location')).toContain('reason=failed');
      expect(ctx.deps.waitUntil).not.toHaveBeenCalled();
    });

    test('Google failing after the connection is saved still says connected, and records the error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }), fetch: fakeFetch({ calendarStatus: 500 }) });
      const res = await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      await ctx.settle();
      expect(res.headers.get('location')).toContain('google=connected');
      expect(ctx.repo.conns.get(TUTOR).last_error).toBe('google_error');
      // marking comes first so the sessions still go out once Google answers again
      expect(ctx.repo.markUpcomingPending).toHaveBeenCalledWith({ tutorId: TUTOR, now: NOW });
    });

    test('a push channel that cannot be made does not stop the push and pull', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetch = fakeFetch();
      const original = fetch.getMockImplementation();
      fetch.mockImplementation(async (url, init) => {
        if (String(url).endsWith('/events/watch')) return Response.json({ error: { errors: [{ reason: 'pushNotAllowed' }] } }, { status: 401 });
        return original(url, init);
      });
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }), fetch });
      await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      await ctx.settle();
      expect(ctx.repo.conns.get(TUTOR).last_synced_at).toBe(NOW.toISOString());
      expect(ctx.repo.conns.get(TUTOR).last_error).toBeNull();
    });

    test('connecting again with another Google account forgets the old calendar and channel', async () => {
      const old = tutorConn({
        google_email: 'old@gmail.com', calendar_id: 'cal-old', sync_token: 'tok', channel_id: 'chan-old',
        channel_resource_id: 'res-old', channel_token: 'secret', channel_expires_at: '2026-10-05T00:00:00Z', last_synced_at: '2026-10-01T00:00:00Z',
      });
      const { repo } = await run({ connections: [old] });
      const row = repo.upsertConnection.mock.calls[0][0];
      expect(row).toMatchObject({
        calendar_id: null, sync_token: null, channel_id: null, channel_resource_id: null,
        channel_token: null, channel_expires_at: null, last_synced_at: null,
      });
    });

    test('connecting again with the same account keeps the calendar, the channel and the sync token', async () => {
      const { repo } = await run({ connections: [tutorConn({ calendar_id: 'cal-1', sync_token: 'tok', channel_id: 'chan-1' })] });
      const row = repo.upsertConnection.mock.calls[0][0];
      for (const key of ['calendar_id', 'sync_token', 'channel_id', 'channel_token', 'last_synced_at']) expect(row, key).not.toHaveProperty(key);
    });

    test('logs carry no token, no email and no code', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = setup({ repo: fakeRepo({ states: [stateRow()] }), fetch: fakeFetch({ calendarStatus: 500 }) });
      await handleCallback(callbackRequest({ code: 'code-secret', state: 'nonce-1' }), ctx.deps);
      await ctx.settle();
      expect(spy).toHaveBeenCalled();
      const logged = JSON.stringify(spy.mock.calls);
      for (const secret of ['refresh-1', 'access-1', 'access-2', 'tutor@gmail.com', 'code-secret', 'verifier-1']) expect(logged).not.toContain(secret);
    });
  });

  describe('a student', () => {
    const studentState = () => stateRow({ purpose: 'student', user_id: STUDENT, return_to: '/portal/student.html#/overview' });

    test('stores the address and no token, and the redirect says connected', async () => {
      const { location, repo } = await run({ state: studentState(), fetch: fakeFetch({ email: 'Maya@Gmail.com', grant: { scope: 'openid email' } }) });
      expect(location).toBe('/portal/student.html#/overview?google=connected');
      const row = repo.upsertConnection.mock.calls[0][0];
      expect(row).toMatchObject({ user_id: STUDENT, purpose: 'student', google_email: 'maya@gmail.com', refresh_token_enc: null, scopes: 'openid email' });
      expect(JSON.stringify(row)).not.toMatch(/refresh-1|access-1/);
    });

    test('revokes the access token, marks their upcoming sessions and pushes for tutors with sync on', async () => {
      const ctx = setup({
        repo: fakeRepo({ states: [studentState()], connections: [tutorConn()], tutorsFor: { [STUDENT]: [TUTOR] } }),
        fetch: fakeFetch({ grant: { scope: 'openid email' } }),
      });
      const res = await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      expect(res.status).toBe(302);
      expect(ctx.deps.waitUntil).toHaveBeenCalledTimes(1);
      await ctx.settle();

      expect(ctx.fetch.revokes()).toEqual(['access-1']);
      expect(ctx.repo.markUpcomingPending).toHaveBeenCalledWith({ studentId: STUDENT, now: NOW });
      expect(ctx.repo.tutorsWithSyncFor).toHaveBeenCalledWith(STUDENT);
      expect(ctx.repo.pendingSessions).toHaveBeenCalledWith(TUTOR, expect.any(Number), NOW);
      expect(ctx.fetch.token('refresh_token')[0].body.refresh_token).toBe('refresh-tutor');
    });

    test('pushes for at most five tutors, one after another', async () => {
      const ids = Array.from({ length: 7 }, (_, i) => `tutor-${i + 1}`);
      let active = 0;
      let peak = 0;
      const ctx = setup({
        repo: fakeRepo({
          states: [studentState()],
          connections: ids.map((id) => tutorConn({ user_id: id })),
          tutorsFor: { [STUDENT]: ids },
        }),
      });
      ctx.repo.pendingSessions.mockImplementation(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return [];
      });
      await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      await ctx.settle();
      expect(ctx.repo.pendingSessions.mock.calls.map((c) => c[0])).toEqual(ids.slice(0, 5));
      expect(peak).toBe(1);
    });

    test('a failing push for one tutor does not stop the rest, or change the redirect', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const second = 'tutor-2';
      const ctx = setup({
        repo: fakeRepo({
          states: [studentState()],
          connections: [tutorConn(), tutorConn({ user_id: second })],
          tutorsFor: { [STUDENT]: [TUTOR, second] },
        }),
      });
      ctx.repo.pendingSessions.mockRejectedValueOnce(new Error('pendingSessions: down'));
      const res = await handleCallback(callbackRequest({ code: 'c', state: 'nonce-1' }), ctx.deps);
      await ctx.settle();
      expect(res.headers.get('location')).toContain('google=connected');
      expect(ctx.repo.pendingSessions.mock.calls.map((c) => c[0])).toEqual([TUTOR, second]);
    });
  });
});


// ---------------------------------------------------------------- settings

describe('handleSettings', () => {
  const run = async ({ body = { sync_enabled: true }, connections = [tutorConn({ sync_enabled: false })], caller, fetch } = {}) => {
    const ctx = setup({ repo: fakeRepo({ connections }), caller, fetch });
    const res = await handleSettings(post(body), ctx.deps);
    return { res, json: await res.json(), ...ctx };
  };

  test('401 without a caller', async () => {
    const { res, repo } = await run({ caller: null });
    expect(res.status).toBe(401);
    expect(repo.updateConnection).not.toHaveBeenCalled();
  });

  test('403 for a student, a parent and an admin', async () => {
    for (const id of [STUDENT, 'parent', 'admin']) {
      const { res, repo } = await run({ caller: { id } });
      expect(res.status, id).toBe(403);
      expect(repo.updateConnection).not.toHaveBeenCalled();
    }
  });

  test('400 when sync_enabled is not a boolean', async () => {
    for (const body of ['nope', {}, { sync_enabled: 'yes' }, { sync_enabled: 1 }]) {
      expect((await run({ body })).res.status).toBe(400);
    }
  });

  test('409 without a connection, and for a tutor row that is not a tutor connection', async () => {
    const { res, json } = await run({ connections: [] });
    expect(res.status).toBe(409);
    expect(json).toEqual({ error: 'Connect Google Calendar first.' });
  });

  describe('turning on', () => {
    test('saves sync_enabled, marks upcoming sessions, makes the calendar and channel, and answers the status', async () => {
      const { res, json, repo, fetch } = await run({ connections: [tutorConn({ sync_enabled: false, calendar_id: null })] });
      expect(res.status).toBe(200);
      expect(repo.updateConnection).toHaveBeenCalledWith(TUTOR, { sync_enabled: true });
      expect(repo.markUpcomingPending).toHaveBeenCalledWith({ tutorId: TUTOR, now: NOW });
      expect(json).toMatchObject({ connected: true, purpose: 'tutor', google_email: 'tutor@gmail.com', sync_enabled: true, last_error: null });
      expect(repo.conns.get(TUTOR)).toMatchObject({ calendar_id: 'cal-new', channel_id: expect.any(String), channel_resource_id: 'res-new' });
      expect(fetch.api().some((c) => c.method === 'POST' && c.url.pathname === '/calendar/v3/calendars')).toBe(true);
    });

    test('pushes and pulls in waitUntil, after the answer', async () => {
      const { repo, deps, settle } = await run();
      expect(deps.waitUntil).toHaveBeenCalledTimes(1);
      await settle();
      expect(repo.pendingSessions).toHaveBeenCalledWith(TUTOR, expect.any(Number), NOW);
      expect(repo.conns.get(TUTOR).last_synced_at).toBe(NOW.toISOString());
    });

    test('a Google failure still answers 200 with the status and records the error, and nothing is pushed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { res, json, repo, deps } = await run({ fetch: fakeFetch({ refresh: 'fail' }) });
      expect(res.status).toBe(200);
      expect(json).toMatchObject({ sync_enabled: true, last_error: 'reconnect' });
      expect(deps.waitUntil).not.toHaveBeenCalled();
      expect(repo.pendingSessions).not.toHaveBeenCalled();
    });
  });

  describe('turning off', () => {
    const withChannel = () => tutorConn({ channel_id: 'chan-1', channel_resource_id: 'res-9', channel_token: 'secret', channel_expires_at: '2026-10-05T00:00:00Z' });

    test('saves sync_enabled false, stops the channel, clears it, and answers the status', async () => {
      const { res, json, repo, fetch, deps } = await run({ body: { sync_enabled: false }, connections: [withChannel()] });
      expect(res.status).toBe(200);
      expect(repo.updateConnection).toHaveBeenCalledWith(TUTOR, { sync_enabled: false });
      expect(json).toMatchObject({ connected: true, sync_enabled: false });
      const stop = fetch.api().find((c) => c.url.pathname === '/calendar/v3/channels/stop');
      expect(stop.body).toEqual({ id: 'chan-1', resourceId: 'res-9' });
      expect(repo.conns.get(TUTOR)).toMatchObject({ channel_id: null, channel_resource_id: null, channel_token: null, channel_expires_at: null });
      expect(repo.markUpcomingPending).not.toHaveBeenCalled();
      expect(deps.waitUntil).not.toHaveBeenCalled();
    });

    test('still clears the channel when Google cannot be reached', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { res, json, repo } = await run({ body: { sync_enabled: false }, connections: [withChannel()], fetch: fakeFetch({ refresh: 'fail' }) });
      expect(res.status).toBe(200);
      expect(json.sync_enabled).toBe(false);
      expect(repo.conns.get(TUTOR)).toMatchObject({ sync_enabled: false, channel_id: null, channel_token: null });
    });

    test('with no channel there is nothing to ask Google', async () => {
      const { res, fetch } = await run({ body: { sync_enabled: false }, connections: [tutorConn()] });
      expect(res.status).toBe(200);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------- disconnect

describe('handleDisconnect', () => {
  const run = async ({ connections = [], caller, fetch, tutorsFor } = {}) => {
    const ctx = setup({ repo: fakeRepo({ connections, tutorsFor }), caller, fetch });
    const res = await handleDisconnect(post(), ctx.deps);
    return { res, json: await res.json(), ...ctx };
  };

  test('401 without a caller', async () => {
    const { res, repo } = await run({ caller: null });
    expect(res.status).toBe(401);
    expect(repo.deleteConnection).not.toHaveBeenCalled();
  });

  test('a person with no connection gets { connected: false } and nothing happens', async () => {
    const { res, json, repo, fetch } = await run();
    expect(res.status).toBe(200);
    expect(json).toEqual({ connected: false });
    expect(repo.deleteConnection).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('a tutor', () => {
    const connected = () => tutorConn({ channel_id: 'chan-1', channel_resource_id: 'res-9', channel_token: 'secret' });

    test('stops the channel, revokes the refresh token and deletes the connection', async () => {
      const { res, json, repo, fetch } = await run({ connections: [connected()] });
      expect(res.status).toBe(200);
      expect(json).toEqual({ connected: false });
      expect(fetch.api().find((c) => c.url.pathname === '/calendar/v3/channels/stop').body).toEqual({ id: 'chan-1', resourceId: 'res-9' });
      expect(fetch.revokes()).toEqual(['refresh-tutor']);
      expect(repo.deleteConnection).toHaveBeenCalledWith(TUTOR);
      expect(repo.conns.has(TUTOR)).toBe(false);
      expect(repo.markUpcomingPending).not.toHaveBeenCalled();
    });

    test('deletes the connection even when Google cannot be reached or the token cannot be read', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const unreachable = await run({ connections: [connected()], fetch: fakeFetch({ refresh: 'fail' }) });
      expect(unreachable.res.status).toBe(200);
      expect(unreachable.repo.conns.has(TUTOR)).toBe(false);

      const unreadable = await run({ connections: [{ ...connected(), refresh_token_enc: 'garbage' }] });
      expect(unreadable.res.status).toBe(200);
      expect(unreadable.repo.conns.has(TUTOR)).toBe(false);
    });

    test('a connection that never had a channel skips the stop call', async () => {
      const { fetch } = await run({ connections: [tutorConn()] });
      expect(fetch.api()).toEqual([]);
      expect(fetch.revokes()).toEqual(['refresh-tutor']);
    });
  });

  describe('a student', () => {
    test('deletes the connection, then marks their sessions, and pushes for sync-on tutors in waitUntil', async () => {
      const { res, json, repo, deps, settle, fetch } = await run({
        caller: { id: STUDENT },
        connections: [studentConn(), tutorConn()],
        tutorsFor: { [STUDENT]: [TUTOR] },
      });
      expect(res.status).toBe(200);
      expect(json).toEqual({ connected: false });
      expect(repo.deleteConnection).toHaveBeenCalledWith(STUDENT);
      expect(repo.markUpcomingPending).toHaveBeenCalledWith({ studentId: STUDENT, now: NOW });
      expect(repo.deleteConnection.mock.invocationCallOrder[0]).toBeLessThan(repo.markUpcomingPending.mock.invocationCallOrder[0]);
      expect(deps.waitUntil).toHaveBeenCalledTimes(1);
      await settle();
      expect(repo.pendingSessions).toHaveBeenCalledWith(TUTOR, expect.any(Number), NOW);
      expect(fetch.revokes()).toEqual([]); // the portal holds no student token to revoke
    });

    test('a failing push is logged and does not change the answer', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = setup({ repo: fakeRepo({ connections: [studentConn(), tutorConn()], tutorsFor: { [STUDENT]: [TUTOR] } }), caller: { id: STUDENT } });
      ctx.repo.tutorsWithSyncFor.mockRejectedValueOnce(new Error('tutorsWithSyncFor: down'));
      const res = await handleDisconnect(post(), ctx.deps);
      await ctx.settle();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ connected: false });
    });
  });
});

// ---------------------------------------------------------------- sync

describe('handleSync', () => {
  const run = async ({ connections = [tutorConn()], caller, fetch } = {}) => {
    const ctx = setup({ repo: fakeRepo({ connections }), caller, fetch });
    const res = await handleSync(post(), ctx.deps);
    return { res, json: await res.json(), ...ctx };
  };

  test('401 without a caller', async () => {
    expect((await run({ caller: null })).res.status).toBe(401);
  });

  test('403 for a student', async () => {
    expect((await run({ caller: { id: STUDENT }, connections: [studentConn()] })).res.status).toBe(403);
  });

  test('409 when the tutor is not connected, or has sync off', async () => {
    const none = await run({ connections: [] });
    expect(none.res.status).toBe(409);
    expect(none.json).toEqual({ error: 'Connect Google Calendar first.' });
    const off = await run({ connections: [tutorConn({ sync_enabled: false })] });
    expect(off.res.status).toBe(409);
    expect(off.fetch).not.toHaveBeenCalled();
  });

  test('pushes then pulls, and answers the status with the new sync time', async () => {
    const { res, json, repo, fetch } = await run();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      connected: true, purpose: 'tutor', google_email: 'tutor@gmail.com', sync_enabled: true,
      last_synced_at: NOW.toISOString(), last_error: null,
    });
    expect(repo.pendingSessions).toHaveBeenCalledWith(TUTOR, expect.any(Number), NOW);
    expect(repo.claimPull).toHaveBeenCalledWith(TUTOR, NOW);
    expect(repo.pendingSessions.mock.invocationCallOrder[0]).toBeLessThan(repo.claimPull.mock.invocationCallOrder[0]);
    expect(fetch.api().some((c) => c.method === 'GET' && c.url.pathname === '/calendar/v3/calendars/cal-1/events')).toBe(true);
  });

  test('another pull already running is not an error', async () => {
    const ctx = setup({ repo: fakeRepo({ connections: [tutorConn()] }) });
    ctx.repo.claimPull.mockResolvedValueOnce(false);
    const res = await handleSync(post(), ctx.deps);
    expect(res.status).toBe(200);
  });

  test('when Google fails the answer is still the status, carrying last_error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, json } = await run({ fetch: fakeFetch({ refresh: 'fail' }) });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ connected: true, last_error: 'reconnect', last_synced_at: null });
  });
});

// ---------------------------------------------------------------- personal

describe('handlePersonal', () => {
  const FROM = '2026-10-05T07:00:00.000Z';
  const TO = '2026-10-12T07:00:00.000Z';
  const events = [
    { id: 'e1', summary: 'Dentist', start: { dateTime: '2026-10-05T16:00:00-07:00' }, end: { dateTime: '2026-10-05T17:00:00-07:00' } },
    { id: 'e2', summary: 'Therapy with Dr. Lee', visibility: 'private', start: { dateTime: '2026-10-06T10:00:00-07:00' }, end: { dateTime: '2026-10-06T11:00:00-07:00' } },
    { id: 'e3', summary: 'Trip', start: { date: '2026-10-07' }, end: { date: '2026-10-09' } },
    { id: 'e4', summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-10-08T10:00:00-07:00' }, end: { dateTime: '2026-10-08T11:00:00-07:00' } },
    { id: 'e5', summary: 'Hush', visibility: 'confidential', start: { dateTime: '2026-10-09T10:00:00-07:00' }, end: { dateTime: '2026-10-09T11:00:00-07:00' } },
  ];

  const run = async ({ query = { from: FROM, to: TO }, connections = [tutorConn()], caller, fetch = fakeFetch({ personal: events }) } = {}) => {
    const ctx = setup({ repo: fakeRepo({ connections }), caller, fetch });
    const res = await handlePersonal(get(`/api/google/personal?${new URLSearchParams(query)}`), ctx.deps);
    return { res, json: await res.json(), ...ctx };
  };

  test('401 without a caller', async () => {
    expect((await run({ caller: null })).res.status).toBe(401);
  });

  test('403 for a student', async () => {
    expect((await run({ caller: { id: STUDENT }, connections: [studentConn()] })).res.status).toBe(403);
  });

  test('400 for a missing, unreadable, backwards or too long range', async () => {
    const day = (n) => new Date(Date.parse(FROM) + n * DAY).toISOString();
    const bad = [
      {}, { from: FROM }, { to: TO }, { from: 'tomorrow', to: TO }, { from: FROM, to: 'next week' },
      { from: '2026-10-05', to: '2026-10-12' }, { from: TO, to: FROM }, { from: FROM, to: FROM },
      { from: FROM, to: day(43) }, { from: FROM, to: new Date(Date.parse(FROM) + 42 * DAY + 1).toISOString() },
    ];
    for (const query of bad) {
      const { res, fetch } = await run({ query });
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  test('a range of exactly 42 days is allowed', async () => {
    const { res } = await run({ query: { from: FROM, to: new Date(Date.parse(FROM) + 42 * DAY).toISOString() } });
    expect(res.status).toBe(200);
  });

  test('offsets are fine', async () => {
    const { res, fetch } = await run({ query: { from: '2026-10-05T00:00:00-07:00', to: '2026-10-12T00:00:00-07:00' } });
    expect(res.status).toBe(200);
    const list = fetch.api().find((c) => c.url.pathname.endsWith('/calendars/primary/events'));
    expect(list.url.searchParams.get('timeMin')).toBe('2026-10-05T07:00:00.000Z');
    expect(list.url.searchParams.get('timeMax')).toBe('2026-10-12T07:00:00.000Z');
  });

  test('409 when the tutor is not connected, or has sync off', async () => {
    expect((await run({ connections: [] })).res.status).toBe(409);
    const off = await run({ connections: [tutorConn({ sync_enabled: false })] });
    expect(off.res.status).toBe(409);
    expect(off.fetch).not.toHaveBeenCalled();
  });

  test('lists the primary calendar for the range, expanded and in time order', async () => {
    const { fetch } = await run();
    const list = fetch.api().find((c) => c.url.pathname.endsWith('/calendars/primary/events'));
    expect(list.method).toBe('GET');
    expect(Object.fromEntries(list.url.searchParams)).toEqual({
      singleEvents: 'true', orderBy: 'startTime', timeMin: FROM, timeMax: TO, maxResults: '250',
    });
    expect(list.auth).toBe('Bearer access-2');
  });

  test('answers the events, with private and confidential ones as Busy and cancelled ones left out', async () => {
    const { res, json } = await run();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      events: [
        { id: 'e1', title: 'Dentist', start: '2026-10-05T16:00:00-07:00', end: '2026-10-05T17:00:00-07:00', all_day: false },
        { id: 'e2', title: 'Busy', start: '2026-10-06T10:00:00-07:00', end: '2026-10-06T11:00:00-07:00', all_day: false },
        { id: 'e3', title: 'Trip', start: '2026-10-07', end: '2026-10-09', all_day: true },
        { id: 'e5', title: 'Busy', start: '2026-10-09T10:00:00-07:00', end: '2026-10-09T11:00:00-07:00', all_day: false },
      ],
    });
    expect(JSON.stringify(json)).not.toContain('Dr. Lee');
  });

  test('the answer is cached privately for a minute', async () => {
    const { res } = await run();
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });

  test('502 when Google does not answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const options of [{ calendarStatus: 500 }, { refresh: 'fail' }]) {
      const { res, json } = await run({ fetch: fakeFetch(options) });
      expect(res.status).toBe(502);
      expect(json).toEqual({ error: 'Google Calendar did not answer. Try again.' });
      expect(res.headers.get('cache-control')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------- notify

describe('handleNotify', () => {
  const channelConn = (over = {}) => tutorConn({ channel_id: 'chan-1', channel_resource_id: 'res-1', channel_token: 'secret-token-123', ...over });
  const notify = (headers = {}) => new Request('https://site.test/api/google/notify', {
    method: 'POST',
    headers: { 'X-Goog-Channel-ID': 'chan-1', 'X-Goog-Channel-Token': 'secret-token-123', 'X-Goog-Resource-State': 'exists', ...headers },
  });
  const run = async (headers, { connections = [channelConn()] } = {}) => {
    const ctx = setup({ repo: fakeRepo({ connections }) });
    const res = await handleNotify(notify(headers), ctx.deps);
    return { res, ...ctx };
  };

  test('the right token pulls in waitUntil and answers 200 with no body', async () => {
    const { res, deps, repo, fetch, settle } = await run();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(deps.waitUntil).toHaveBeenCalledTimes(1);
    expect(repo.getConnectionByChannel).toHaveBeenCalledWith('chan-1');
    await settle();
    expect(repo.claimPull).toHaveBeenCalledWith(TUTOR, NOW);
    expect(repo.conns.get(TUTOR).last_synced_at).toBe(NOW.toISOString());
    expect(fetch.api().some((c) => c.method === 'GET' && c.url.pathname === '/calendar/v3/calendars/cal-1/events')).toBe(true);
    expect(repo.pendingSessions).not.toHaveBeenCalled(); // a notification pulls only
  });

  test('a wrong token never pulls', async () => {
    for (const token of ['wrong', 'secret-token-124', 'secret-token-12', 'secret-token-1234', '']) {
      const { res, deps, repo, fetch } = await run({ 'X-Goog-Channel-Token': token });
      expect(res.status, token).toBe(200);
      expect(deps.waitUntil).not.toHaveBeenCalled();
      expect(repo.claimPull).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  test('a missing token header never pulls', async () => {
    const req = new Request('https://site.test/api/google/notify', { method: 'POST', headers: { 'X-Goog-Channel-ID': 'chan-1', 'X-Goog-Resource-State': 'exists' } });
    const ctx = setup({ repo: fakeRepo({ connections: [channelConn()] }) });
    expect((await handleNotify(req, ctx.deps)).status).toBe(200);
    expect(ctx.deps.waitUntil).not.toHaveBeenCalled();
  });

  test('the first "sync" message after a channel is made does not pull', async () => {
    const { res, deps } = await run({ 'X-Goog-Resource-State': 'sync' });
    expect(res.status).toBe(200);
    expect(deps.waitUntil).not.toHaveBeenCalled();
  });

  test('"exists" and "not_exists" both pull', async () => {
    for (const state of ['exists', 'not_exists']) {
      const { deps } = await run({ 'X-Goog-Resource-State': state });
      expect(deps.waitUntil, state).toHaveBeenCalledTimes(1);
    }
  });

  test('an unknown channel answers 200 and does nothing', async () => {
    const { res, deps, fetch } = await run({ 'X-Goog-Channel-ID': 'old-channel' });
    expect(res.status).toBe(200);
    expect(deps.waitUntil).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a request with no channel headers answers 200 without a lookup', async () => {
    const ctx = setup();
    const res = await handleNotify(new Request('https://site.test/api/google/notify', { method: 'POST' }), ctx.deps);
    expect(res.status).toBe(200);
    expect(ctx.repo.getConnectionByChannel).not.toHaveBeenCalled();
  });

  test('a connection with sync off does not pull', async () => {
    const { res, deps } = await run({}, { connections: [channelConn({ sync_enabled: false })] });
    expect(res.status).toBe(200);
    expect(deps.waitUntil).not.toHaveBeenCalled();
  });

  test('a database failure still answers 200', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = setup();
    ctx.repo.getConnectionByChannel.mockRejectedValueOnce(new Error('getConnectionByChannel: down'));
    expect((await handleNotify(notify(), ctx.deps)).status).toBe(200);
  });

  test('a failing pull is logged by name only', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = setup({ repo: fakeRepo({ connections: [channelConn()] }), fetch: fakeFetch({ calendarStatus: 500 }) });
    await handleNotify(notify(), ctx.deps);
    await ctx.settle();
    expect(ctx.repo.conns.get(TUTOR).last_error).toBe('google_error');
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/secret-token|tutor@gmail|refresh-tutor/);
  });
});

// ---------------------------------------------------------------- maintainAll

describe('maintainAll', () => {
  const tutors = (n) => Array.from({ length: n }, (_, i) => tutorConn({ user_id: `tutor-${i + 1}`, calendar_id: null }));
  const maintain = (ctx, options, extra = {}) => maintainAll({
    repo: ctx.repo, config: CONFIG, fetchImpl: ctx.fetch, now, ...extra,
  }, options);

  test('makes the calendar and channel, pushes and pulls for each tutor with sync on', async () => {
    const ctx = setup({ repo: fakeRepo({ connections: tutors(3) }) });
    const summary = await maintain(ctx);
    expect(summary).toEqual({ tutors: 3, ok: 3, failed: 0 });
    for (const id of ['tutor-1', 'tutor-2', 'tutor-3']) {
      expect(ctx.repo.conns.get(id), id).toMatchObject({
        calendar_id: 'cal-new', channel_id: expect.any(String), last_synced_at: NOW.toISOString(), last_error: null,
      });
      expect(ctx.repo.pendingSessions).toHaveBeenCalledWith(id, expect.any(Number), NOW);
    }
  });

  test('does nothing, and says so, when no tutor has sync on', async () => {
    const ctx = setup({ repo: fakeRepo({ connections: [tutorConn({ sync_enabled: false }), studentConn()] }) });
    expect(await maintain(ctx)).toEqual({ tutors: 0, ok: 0, failed: 0 });
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  test('keeps a healthy channel instead of replacing it', async () => {
    const healthy = tutorConn({ calendar_id: 'cal-1', channel_id: 'chan-1', channel_resource_id: 'res-1', channel_token: 't', channel_expires_at: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    const ctx = setup({ repo: fakeRepo({ connections: [healthy] }) });
    expect(await maintain(ctx)).toEqual({ tutors: 1, ok: 1, failed: 0 });
    expect(ctx.fetch.api().some((c) => c.url.pathname.endsWith('/events/watch'))).toBe(false);
    expect(ctx.repo.conns.get(TUTOR).channel_id).toBe('chan-1');
  });

  test('replaces a channel that is about to expire', async () => {
    const aging = tutorConn({ calendar_id: 'cal-1', channel_id: 'chan-1', channel_resource_id: 'res-1', channel_token: 't', channel_expires_at: new Date(NOW.getTime() + 3600_000).toISOString() });
    const ctx = setup({ repo: fakeRepo({ connections: [aging] }) });
    await maintain(ctx);
    expect(ctx.repo.conns.get(TUTOR).channel_id).not.toBe('chan-1');
    expect(ctx.fetch.api().some((c) => c.url.pathname === '/calendar/v3/channels/stop')).toBe(true);
  });

  test('a tutor Google cannot serve is counted failed and the others still run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = tutors(3);
    rows[1].refresh_token_enc = 'garbage';
    const ctx = setup({ repo: fakeRepo({ connections: rows }) });
    expect(await maintain(ctx)).toEqual({ tutors: 3, ok: 2, failed: 1 });
    expect(ctx.repo.conns.get('tutor-2').last_error).toBe('google_error');
    expect(ctx.repo.conns.get('tutor-3').last_synced_at).toBe(NOW.toISOString());
  });

  test('a run that throws outright is counted failed and the others still run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = tutors(2);
    rows[0].refresh_token_enc = 'garbage';
    const ctx = setup({ repo: fakeRepo({ connections: rows }) });
    const update = ctx.repo.updateConnection.getMockImplementation();
    ctx.repo.updateConnection.mockImplementation(async (id, fields) => {
      if (id === 'tutor-1' && fields.last_error) throw new Error('updateConnection: down');
      return update(id, fields);
    });
    expect(await maintain(ctx)).toEqual({ tutors: 2, ok: 1, failed: 1 });
  });

  test('a push channel that cannot be made does not fail the tutor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = fakeFetch();
    const original = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, init) => (String(url).endsWith('/events/watch')
      ? Response.json({ error: {} }, { status: 403 })
      : original(url, init)));
    const ctx = setup({ repo: fakeRepo({ connections: [tutorConn()] }), fetch });
    expect(await maintain(ctx)).toEqual({ tutors: 1, ok: 1, failed: 0 });
    expect(ctx.repo.conns.get(TUTOR).last_synced_at).toBe(NOW.toISOString());
  });

  test('stops starting new tutors once the time budget is spent', async () => {
    let t = 0;
    const ctx = setup({ repo: fakeRepo({ connections: tutors(4) }) });
    ctx.repo.pendingSessions.mockImplementation(async () => { t += 50_000; return []; });
    const summary = await maintain(ctx, { budgetMs: 120_000 }, { clock: () => t });
    expect(summary).toEqual({ tutors: 4, ok: 3, failed: 0 }); // starts at 0, 50k and 100k; 150k is past the budget
    expect(ctx.repo.conns.get('tutor-4').last_synced_at).toBeNull();
  });

  test('the default budget is two minutes', async () => {
    let t = 0;
    const ctx = setup({ repo: fakeRepo({ connections: tutors(3) }) });
    ctx.repo.pendingSessions.mockImplementation(async () => { t += 61_000; return []; });
    expect(await maintain(ctx, undefined, { clock: () => t })).toEqual({ tutors: 3, ok: 2, failed: 0 });
  });
});

// ---------------------------------------------------------------- the entry files

describe('googleEndpoint', () => {
  const stubGoogle = () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    vi.stubEnv('GOOGLE_TOKEN_KEY', KEY);
  };

  test('503 with the not-set-up message when the Google variables are missing, without building a database client', async () => {
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']) {
      stubGoogle();
      vi.stubEnv(name, '');
      const handler = vi.fn();
      const res = await googleEndpoint(handler)(post({}));
      expect(res.status, name).toBe(503);
      expect(await res.json()).toEqual({ error: NOT_SET_UP });
      expect(handler).not.toHaveBeenCalled();
    }
  });

  test('500 when the database is not configured, with a message that names nothing', async () => {
    stubGoogle();
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await googleEndpoint(vi.fn())(post({}));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/SUPABASE|key/i);
  });

  test('hands the handler its dependencies', async () => {
    stubGoogle();
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    let seen;
    const res = await googleEndpoint(async (request, deps) => { seen = deps; return Response.json({ ok: true }); })(post({}));
    expect(res.status).toBe(200);
    expect(Object.keys(seen).sort()).toEqual(['config', 'fetchImpl', 'now', 'repo', 'verify', 'waitUntil']);
    expect(seen.config).toMatchObject({ clientId: 'id', clientSecret: 'secret', tokenKey: KEY });
    expect(seen.now()).toBeInstanceOf(Date);
    expect(typeof seen.repo.takeState).toBe('function');
    expect(await seen.verify(new Request('https://site.test/x'))).toBeNull(); // no bearer token: no database call
  });

  test('a handler that throws is a 500 with a plain message and a name-only log', async () => {
    stubGoogle();
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await googleEndpoint(async () => { throw new TypeError('secret detail maya@gmail.com'); })(post({}));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong. Try again.' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('maya@gmail.com');
  });

  test('every endpoint file answers 503 when Google is not set up, and exports only its own method', async () => {
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']) vi.stubEnv(name, '');
    const entries = [
      ['start', startEntry, 'POST'], ['callback', callbackEntry, 'GET'], ['settings', settingsEntry, 'POST'],
      ['disconnect', disconnectEntry, 'POST'], ['sync', syncEntry, 'POST'], ['personal', personalEntry, 'GET'], ['notify', notifyEntry, 'POST'],
    ];
    for (const [name, mod, method] of entries) {
      expect(Object.keys(mod), name).toEqual([method]);
      const res = await mod[method](new Request(`https://site.test/api/google/${name}`, { method }));
      expect(res.status, name).toBe(503);
      expect(await res.json()).toEqual({ error: NOT_SET_UP });
    }
  });
});
