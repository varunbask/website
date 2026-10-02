// The HTTP side of the Google Calendar sync: one handler per endpoint
// (api/google/*.js) and the daily maintenance run. Every handler takes its
// dependencies as a parameter, like api/_lib/http.js, so tests use fakes:
//   { repo, verify, config, waitUntil, fetchImpl, now }
// `repo` is createGoogleRepo(db), `verify(request)` gives { id } or null,
// `config` is googleConfig(), and `now()` gives a Date.
//
// Logs carry error names only, never tokens, addresses or event text.
import { timingSafeEqual } from 'node:crypto';
import { SCOPES, MAX_PERSONAL_DAYS } from './config.js';
import { encrypt, decrypt } from './crypto.js';
import { newState, authUrl, exchangeCode, fetchEmail, revoke } from './oauth.js';
import { personalItem } from './mapping.js';
import { withGoogle, ensureCalendar, ensureChannel, stopSync, pushPending, pullChanges } from './sync.js';

const json = (status, body, headers) => Response.json(body, { status, headers });
const redirect = (location) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_STUDENT_PUSHES = 5; // tutors pushed to straight after a student connects or disconnects
const DAY_MS = 24 * 3600 * 1000;
const PORTAL_HOME = '/portal/';

const SIGN_IN = 'Sign in again.';
const NOT_AVAILABLE = 'Google Calendar is not available for your account.';
const CONNECT_FIRST = 'Connect Google Calendar first.';
const TURN_ON_FIRST = 'Turn on Google Calendar sync first.';
const NO_ANSWER = 'Google Calendar did not answer. Try again.';

// What a tutor must grant for the sync and the personal overlay to work
const TUTOR_CALENDAR_SCOPES = SCOPES.tutor.filter((scope) => scope.includes('/auth/calendar'));
const NO_CHANNEL = { channel_id: null, channel_resource_id: null, channel_token: null, channel_expires_at: null };
// A connection moved to another Google account must forget the old account's calendar, channel and token
const NEW_ACCOUNT = { calendar_id: null, sync_token: null, last_synced_at: null, ...NO_CHANNEL };

// ---------------------------------------------------------------- helpers

// Where the portal may send a person back to: a portal page, nothing else
export function isSafeReturnTo(value) {
  return typeof value === 'string'
    && value.length <= 1000
    && value.startsWith('/portal/')
    && !value.includes('//')
    && /^[\x21-\x7e]+$/.test(value) // printable ASCII: nothing a Location header or a URL parser could misread
    && !value.includes('\\');
}

// return_to with google=<result> (and reason) merged into the query after the
// hash, which is where the portal's router keeps its params:
//   /portal/staff.html#/calendar?view=week -> ...#/calendar?view=week&google=connected
// A page address without a hash gets a route hash ('#/') so the router still treats it as a route.
export function mergeReturn(returnTo, result, reason = null) {
  const at = returnTo.indexOf('#');
  const page = at === -1 ? returnTo : returnTo.slice(0, at);
  const fragment = at === -1 ? '' : returnTo.slice(at + 1);
  const q = fragment.indexOf('?');
  const route = (q === -1 ? fragment : fragment.slice(0, q)) || '/';
  const params = (q === -1 ? '' : fragment.slice(q + 1)).split('&').filter((pair) => pair && !/^(google|reason)(=|$)/.test(pair));
  params.push(`google=${result}`);
  if (reason) params.push(`reason=${reason}`);
  return `${page}#${route}?${params.join('&')}`;
}

// { connected, purpose, google_email, sync_enabled, last_synced_at, last_error }, or the off status for no row
export function statusOf(conn) {
  if (!conn) {
    return { connected: false, purpose: null, google_email: null, sync_enabled: false, last_synced_at: null, last_error: null };
  }
  return {
    connected: true,
    purpose: conn.purpose,
    google_email: conn.google_email,
    sync_enabled: Boolean(conn.sync_enabled),
    last_synced_at: conn.last_synced_at ?? null,
    last_error: conn.last_error ?? null,
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const ctxOf = ({ repo, config, fetchImpl }) => ({ repo, config, fetchImpl });

// Work that continues after the response; a failure is logged by name and goes nowhere else
function background(deps, task, label) {
  deps.waitUntil(Promise.resolve().then(task).catch((error) => {
    console.error(`[google] ${label}:`, error?.name ?? 'Error');
  }));
}

// Best effort: the step is attempted and its failure only logged
async function attempt(label, task) {
  try {
    return await task();
  } catch (error) {
    console.error(`[google] ${label}:`, error?.name ?? 'Error');
    return undefined;
  }
}

// Keeps the change channel alive. A channel that cannot be made (for instance
// before the notify address is verified with Google, which answers 401) must not
// stop the push and pull, which work without it. If the grant is really lost the
// push or pull that follows fails on its own and withGoogle records the reconnect.
async function keepChannel(conn, google, { repo, config, now }) {
  try {
    await ensureChannel(conn, google, repo, { config, now: now() });
  } catch (error) {
    console.error('[google] channel:', error?.name ?? 'Error');
  }
}

const pushThenPull = async (conn, google, { repo, config, now }) => {
  await pushPending(conn, google, { repo, config, now: now() });
  await pullChanges(conn, google, { repo, now: now() });
};

// After a student connects or disconnects: the sessions already marked pending
// go to Google for each tutor who has sync on (a few at a time, one after another)
async function pushForStudent(studentId, deps) {
  const { repo, config, now } = deps;
  const tutors = (await repo.tutorsWithSyncFor(studentId)).slice(0, MAX_STUDENT_PUSHES);
  for (const tutor of tutors) {
    await attempt('student push', () => withGoogle(tutor, ctxOf(deps), (google) => pushPending(tutor, google, { repo, config, now: now() })));
  }
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

// The signed-in tutor, or the response that ends the request
async function tutorCaller(request, { repo, verify }) {
  const caller = await verify(request);
  if (!caller) return { response: json(401, { error: SIGN_IN }) };
  const profile = await repo.getProfile(caller.id);
  if (profile?.role !== 'tutor') return { response: json(403, { error: NOT_AVAILABLE }) };
  return { caller };
}

// The tutor's connection; with syncOn it must have the switch on as well
async function tutorConnection(repo, caller, { syncOn }) {
  const conn = await repo.getConnection(caller.id);
  if (!conn || conn.purpose !== 'tutor') return { response: json(409, { error: CONNECT_FIRST }) };
  if (syncOn && !conn.sync_enabled) return { response: json(409, { error: TURN_ON_FIRST }) };
  return { conn };
}

// ---------------------------------------------------------------- start

// POST { purpose: 'tutor' | 'student', return_to } -> { url }
export async function handleStart(request, deps) {
  const { repo, verify, config, now } = deps;
  const caller = await verify(request);
  if (!caller) return json(401, { error: SIGN_IN });

  const body = await readJson(request);
  const purpose = body?.purpose;
  if (purpose !== 'tutor' && purpose !== 'student') return json(400, { error: 'purpose must be tutor or student.' });
  const profile = await repo.getProfile(caller.id);
  if (profile?.role !== purpose) return json(403, { error: NOT_AVAILABLE });
  if (!isSafeReturnTo(body.return_to)) return json(400, { error: 'return_to must be a portal page.' });

  const state = newState();
  await repo.saveState({
    nonce: state.nonce,
    user_id: caller.id,
    purpose,
    verifier: state.verifier,
    return_to: body.return_to,
    expires_at: new Date(now().getTime() + STATE_TTL_MS).toISOString(),
  });
  const url = authUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: SCOPES[purpose],
    state: state.nonce,
    challenge: state.challenge,
  });
  return json(200, { url });
}

// ---------------------------------------------------------------- callback

const hasScopes = (granted, needed) => typeof granted !== 'string' || needed.every((scope) => granted.split(' ').includes(scope));

// Saves a tutor's connection and returns what to do afterwards, or the reason it cannot connect
async function connectTutor({ state, tokens, email }, deps) {
  const { repo, config, now, fetchImpl } = deps;
  if (!tokens.refresh_token) return { reason: 'no_refresh' };
  if (!hasScopes(tokens.scope, TUTOR_CALENDAR_SCOPES)) {
    await revoke(tokens.refresh_token, { fetchImpl }); // a grant that cannot sync is no use to keep
    return { reason: 'scope' };
  }
  const before = await repo.getConnection(state.user_id);
  const conn = await repo.upsertConnection({
    user_id: state.user_id,
    purpose: 'tutor',
    google_email: email,
    refresh_token_enc: encrypt(tokens.refresh_token, config.tokenKey),
    scopes: tokens.scope ?? SCOPES.tutor.join(' '),
    sync_enabled: true,
    last_error: null,
    updated_at: now().toISOString(),
    ...(before && (before.purpose !== 'tutor' || before.google_email !== email) ? NEW_ACCOUNT : {}),
  });
  return {
    followUp: async () => {
      // Marking is a database step, so it comes first: the sessions go out later even if Google fails now
      await repo.markUpcomingPending({ tutorId: conn.user_id, now: now() });
      await withGoogle(conn, ctxOf(deps), async (google) => {
        await ensureCalendar(conn, google, repo);
        await keepChannel(conn, google, deps);
        await pushThenPull(conn, google, deps);
      });
    },
  };
}

// The portal keeps no student token: only the address is stored, and the grant is revoked
async function connectStudent({ state, tokens, email }, deps) {
  const { repo, now, fetchImpl } = deps;
  await repo.upsertConnection({
    user_id: state.user_id,
    purpose: 'student',
    google_email: email,
    refresh_token_enc: null,
    scopes: tokens.scope ?? SCOPES.student.join(' '),
    updated_at: now().toISOString(),
  });
  return {
    followUp: async () => {
      await revoke(tokens.access_token, { fetchImpl });
      await repo.markUpcomingPending({ studentId: state.user_id, now: now() });
      await pushForStudent(state.user_id, deps);
    },
  };
}

// GET ?code&state (or ?error&state) -> 302 to return_to with google=connected or google=error in the hash.
// The connection is saved before the redirect, so the portal never loads ahead of its row.
export async function handleCallback(request, deps) {
  try {
    const { repo, config, now, fetchImpl } = deps;
    const query = new URL(request.url).searchParams;
    const nonce = query.get('state');
    const state = nonce ? await attempt('state', () => repo.takeState(nonce, now())) : null;
    if (!state) return redirect(PORTAL_HOME);

    const returnTo = isSafeReturnTo(state.return_to) ? state.return_to : PORTAL_HOME;
    const back = (result, reason) => redirect(mergeReturn(returnTo, result, reason));
    if (query.get('error')) return back('error', query.get('error') === 'access_denied' ? 'denied' : 'failed');
    const code = query.get('code');
    if (!code) return back('error', 'failed');

    let outcome;
    try {
      const tokens = await exchangeCode({
        code, verifier: state.verifier, clientId: config.clientId, clientSecret: config.clientSecret,
        redirectUri: config.redirectUri, fetchImpl,
      });
      if (!tokens.access_token) throw new Error('Google sent no access token');
      const email = await fetchEmail(tokens.access_token, { fetchImpl });
      const given = { state, tokens, email };
      outcome = state.purpose === 'tutor' ? await connectTutor(given, deps) : await connectStudent(given, deps);
    } catch (error) {
      console.error('[google] connect:', error?.name ?? 'Error');
      return back('error', 'failed');
    }
    if (outcome.reason) return back('error', outcome.reason);

    const response = back('connected');
    background(deps, outcome.followUp, 'connect follow-up');
    return response;
  } catch (error) {
    console.error('[google] callback:', error?.name ?? 'Error');
    return redirect(PORTAL_HOME);
  }
}

// ---------------------------------------------------------------- settings

// POST { sync_enabled: boolean } (tutor) -> the status
export async function handleSettings(request, deps) {
  const { repo, now } = deps;
  const who = await tutorCaller(request, deps);
  if (who.response) return who.response;
  const body = await readJson(request);
  if (typeof body?.sync_enabled !== 'boolean') return json(400, { error: 'sync_enabled must be true or false.' });
  const found = await tutorConnection(repo, who.caller, { syncOn: false });
  if (found.response) return found.response;
  const { conn } = found;

  if (body.sync_enabled) {
    await repo.updateConnection(conn.user_id, { sync_enabled: true });
    conn.sync_enabled = true;
    await repo.markUpcomingPending({ tutorId: conn.user_id, now: now() });
    const ready = await withGoogle(conn, ctxOf(deps), async (google) => {
      await ensureCalendar(conn, google, repo);
      await keepChannel(conn, google, deps);
    });
    if (ready.ok) background(deps, () => withGoogle(conn, ctxOf(deps), (google) => pushThenPull(conn, google, deps)), 'settings');
  } else {
    await repo.updateConnection(conn.user_id, { sync_enabled: false });
    conn.sync_enabled = false;
    if (conn.channel_id) {
      const stopped = await withGoogle(conn, ctxOf(deps), (google) => stopSync(conn, google, repo));
      if (!stopped.ok) await repo.updateConnection(conn.user_id, NO_CHANNEL); // the channel dies on its own; forget it here
    }
  }
  return json(200, statusOf(await repo.getConnection(conn.user_id)));
}

// ---------------------------------------------------------------- disconnect

// POST (tutor or student) -> { connected: false }
export async function handleDisconnect(request, deps) {
  const { repo, config, now, fetchImpl } = deps;
  const caller = await deps.verify(request);
  if (!caller) return json(401, { error: SIGN_IN });

  const conn = await repo.getConnection(caller.id);
  if (!conn) return json(200, { connected: false });

  if (conn.purpose === 'tutor') {
    // Each step is best effort: the connection goes whatever Google says
    if (conn.channel_id) await attempt('stop channel', () => withGoogle(conn, ctxOf(deps), (google) => stopSync(conn, google, repo)));
    await attempt('revoke', async () => revoke(decrypt(conn.refresh_token_enc, config.tokenKey), { fetchImpl }));
    await repo.deleteConnection(caller.id);
  } else {
    // Deleted first, so the push that follows leaves their address off the invites
    await repo.deleteConnection(caller.id);
    await repo.markUpcomingPending({ studentId: caller.id, now: now() });
    background(deps, () => pushForStudent(caller.id, deps), 'student disconnect');
  }
  return json(200, { connected: false });
}

// ---------------------------------------------------------------- sync

// POST (tutor, sync on): push then pull now -> the status
export async function handleSync(request, deps) {
  const { repo } = deps;
  const who = await tutorCaller(request, deps);
  if (who.response) return who.response;
  const found = await tutorConnection(repo, who.caller, { syncOn: true });
  if (found.response) return found.response;
  const { conn } = found;

  await withGoogle(conn, ctxOf(deps), (google) => pushThenPull(conn, google, deps)); // a failure shows in the status
  return json(200, statusOf(await repo.getConnection(conn.user_id)));
}

// ---------------------------------------------------------------- personal events

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// The range as the instants Google is asked for, or null when it is unreadable, backwards or over 42 days
function readRange(query) {
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  if (!ISO_INSTANT.test(from) || !ISO_INSTANT.test(to)) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > MAX_PERSONAL_DAYS * DAY_MS) return null;
  return { timeMin: new Date(a).toISOString(), timeMax: new Date(b).toISOString() };
}

// GET ?from&to (tutor, sync on) -> { events: [{ id, title, start, end, all_day }] }. Nothing is stored.
export async function handlePersonal(request, deps) {
  const { repo } = deps;
  const who = await tutorCaller(request, deps);
  if (who.response) return who.response;
  const range = readRange(new URL(request.url).searchParams);
  if (!range) return json(400, { error: `Choose a range of at most ${MAX_PERSONAL_DAYS} days.` });
  const found = await tutorConnection(repo, who.caller, { syncOn: true });
  if (found.response) return found.response;

  const listed = await withGoogle(found.conn, ctxOf(deps), (google) => google.listEvents('primary', {
    singleEvents: true, orderBy: 'startTime', timeMin: range.timeMin, timeMax: range.timeMax, maxResults: 250,
  }));
  if (!listed.ok) return json(502, { error: NO_ANSWER });
  const events = (listed.value?.items ?? []).map(personalItem).filter(Boolean);
  return json(200, { events }, { 'cache-control': 'private, max-age=60' });
}

// ---------------------------------------------------------------- notify

// POST from Google (channel headers). Always 200, so Google never retries or drops the channel.
export async function handleNotify(request, deps) {
  const { repo, now } = deps;
  try {
    const channelId = request.headers.get('x-goog-channel-id');
    const token = request.headers.get('x-goog-channel-token');
    const state = request.headers.get('x-goog-resource-state');
    if (!channelId || !token) return new Response(null, { status: 200 });

    const conn = await repo.getConnectionByChannel(channelId);
    const trusted = conn && conn.purpose === 'tutor' && conn.sync_enabled && conn.channel_token && sameSecret(token, conn.channel_token);
    // 'sync' is Google saying hello when a channel is made: nothing has changed yet
    if (trusted && state !== 'sync') {
      background(deps, () => withGoogle(conn, ctxOf(deps), (google) => pullChanges(conn, google, { repo, now: now() })), 'notify');
    }
  } catch (error) {
    console.error('[google] notify:', error?.name ?? 'Error');
  }
  return new Response(null, { status: 200 });
}

// ---------------------------------------------------------------- daily maintenance

// For every tutor with sync on, while time remains: make sure the calendar and
// channel exist, then push and pull. Returns { tutors, ok, failed }.
// deps: { repo, config, fetchImpl, now, clock } (clock is Date.now by default).
export async function maintainAll(deps, { budgetMs = 120_000 } = {}) {
  const { repo, now = () => new Date(), clock = Date.now } = deps;
  const run = { ...deps, now };
  const started = clock();
  const tutors = await repo.listSyncTutors();
  const summary = { tutors: tutors.length, ok: 0, failed: 0 };

  for (const conn of tutors) {
    if (clock() - started >= budgetMs) break;
    try {
      const result = await withGoogle(conn, ctxOf(run), async (google) => {
        await ensureCalendar(conn, google, repo);
        await keepChannel(conn, google, run);
        await pushThenPull(conn, google, run);
      });
      if (result.ok) summary.ok += 1;
      else summary.failed += 1;
    } catch (error) {
      console.error('[google] maintain:', error?.name ?? 'Error');
      summary.failed += 1;
    }
  }
  return summary;
}
