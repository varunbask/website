import { describe, test, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createGoogleRepo } from '../../api/_lib/google/repo.js';
import {
  withGoogle, ensureCalendar, ensureChannel, stopSync, pushPending, pullChanges,
} from '../../api/_lib/google/sync.js';
import { GoogleNotFound, GoogleGone, GoogleRateError, GoogleApiError } from '../../api/_lib/google/calendar.js';
import { GoogleAuthError, TOKEN_URL } from '../../api/_lib/google/oauth.js';
import { encrypt } from '../../api/_lib/google/crypto.js';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const STAMP = NOW.toISOString();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const TUTOR = 'tutor-1';
const OTHER_TUTOR = 'tutor-2';
const MAYA = 'student-maya';
const BEN = 'student-ben';
const CAL = 'vp-calendar@group.calendar.google.test';
const KEY = randomBytes(32).toString('base64');

const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  tokenKey: KEY,
  notifyUrl: 'https://site.test/api/google/notify',
  portalUrl: 'https://site.test/portal/',
};

// ---------------------------------------------------------------- fakes

// An in-memory Calendar API with the calendarClient method shapes. It records
// calls, and can be told to throw on the nth call of a method.
function fakeGoogle({ pageSize = 250, syncToken = 'sync-next' } = {}) {
  const events = new Map();
  const instances = new Map();
  const calls = [];
  const counts = {};
  const failures = [];
  let seq = 0;
  const key = (cal, id) => `${cal}\n${id}`;

  function enter(method, args) {
    calls.push({ method, args });
    counts[method] = (counts[method] ?? 0) + 1;
    const i = failures.findIndex((f) => f.method === method && f.on === counts[method]);
    if (i >= 0) throw failures.splice(i, 1)[0].error;
  }

  function page(all, query, maxResults = pageSize) {
    const size = Math.min(pageSize, maxResults);
    const start = Number(query.pageToken ?? 0);
    const end = start + size;
    const items = all.slice(start, end);
    if (end < all.length) return { items, nextPageToken: String(end) };
    return syncToken ? { items, nextSyncToken: syncToken } : { items };
  }

  return {
    calls,
    called: (method) => calls.filter((c) => c.method === method),
    fail(method, error, on = 1) { failures.push({ method, on, error }); },
    seed(cal, event) { events.set(key(cal, event.id), event); },
    seedInstances(masterId, list) { instances.set(masterId, list); },
    event: (cal, id) => events.get(key(cal, id)),

    async insertCalendar(body) {
      enter('insertCalendar', [body]);
      seq += 1;
      return { id: `new-cal-${seq}` };
    },
    async insertEvent(cal, body) {
      enter('insertEvent', [cal, body]);
      seq += 1;
      const ev = { ...body, id: `ev-${seq}`, status: 'confirmed', htmlLink: `https://calendar.google.test/ev-${seq}`, updated: STAMP };
      events.set(key(cal, ev.id), ev);
      return ev;
    },
    async patchEvent(cal, id, body) {
      enter('patchEvent', [cal, id, body]);
      const old = events.get(key(cal, id));
      if (!old) throw new GoogleNotFound();
      const ev = { ...old, ...body };
      events.set(key(cal, id), ev);
      return ev;
    },
    async deleteEvent(cal, id) {
      enter('deleteEvent', [cal, id]);
      events.delete(key(cal, id));
    },
    async listEvents(cal, query = {}) {
      enter('listEvents', [cal, query]);
      let all = [...events.entries()].filter(([k]) => k.startsWith(`${cal}\n`)).map(([, v]) => v);
      if (query.privateExtendedProperty) {
        const [name, value] = query.privateExtendedProperty.split('=');
        all = all.filter((e) => e.extendedProperties?.private?.[name] === value);
      }
      if (query.showDeleted === false) all = all.filter((e) => e.status !== 'cancelled');
      return page(all, query, query.maxResults);
    },
    async listInstances(cal, id, query = {}) {
      enter('listInstances', [cal, id, query]);
      return page(instances.get(id) ?? [], query);
    },
    async watchEvents(cal, body) {
      enter('watchEvents', [cal, body]);
      return { id: body.id, resourceId: `resource-${body.id}`, expiration: String(NOW.getTime() + body.ttlSeconds * 1000) };
    },
    async stopChannel(body) {
      enter('stopChannel', [body]);
      return null;
    },
  };
}

// In-memory repo with the methods the sync engine uses. claimPull keeps the
// real 60 second rule; writes are recorded in `calls`.
function fakeRepo({ sessions = [], connections = [], tombstones = [], profiles = {}, googleEmails = {}, students = [] } = {}) {
  const state = { sessions, connections, tombstones };
  const calls = [];
  let nextId = 100;
  const connOf = (userId) => state.connections.find((c) => c.user_id === userId);
  const record = (name, args) => calls.push({ name, args });

  const repo = {
    async updateConnection(userId, fields) {
      record('updateConnection', [userId, fields]);
      Object.assign(connOf(userId), fields);
    },
    async claimPull(userId, now) {
      record('claimPull', [userId]);
      const c = connOf(userId);
      const started = c.pull_started_at ? Date.parse(c.pull_started_at) : null;
      if (started !== null && now.getTime() - started < 60_000) return false;
      c.pull_started_at = now.toISOString();
      return true;
    },
    async getProfile(userId) { return profiles[userId] ?? null; },
    async studentGoogleEmail(userId) { return googleEmails[userId] ?? null; },
    async pendingSessions(tutorId, limit) {
      return state.sessions
        .filter((s) => s.tutor_id === tutorId && ['pending', 'error'].includes(s.sync_state)
          && Date.parse(s.starts_at) > NOW.getTime() - 30 * DAY)
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .slice(0, limit)
        .map((r) => ({ ...r })); // a read is a snapshot, as from a database
    },
    async tombstones(tutorId) { return state.tombstones.filter((t) => t.tutor_id === tutorId); },
    async removeTombstone(id) {
      record('removeTombstone', [id]);
      state.tombstones = state.tombstones.filter((t) => t.id !== id);
    },
    async sessionById(id) {
      record('sessionById', [id]);
      const row = state.sessions.find((s) => String(s.id) === String(id));
      return row ? { ...row } : null;
    },
    async sessionByEvent(calendarId, eventId) {
      record('sessionByEvent', [calendarId, eventId]);
      const row = state.sessions.find((s) => s.google_calendar_id === calendarId && s.google_event_id === eventId);
      return row ? { ...row } : null;
    },
    // Like the real one: with ifUpdatedAt, a row that has changed since is left alone and null comes back
    async updateSession(id, fields, opts) {
      record('updateSession', opts ? [id, fields, opts] : [id, fields]);
      const row = state.sessions.find((s) => s.id === id);
      if (!row || (opts?.ifUpdatedAt !== undefined && row.updated_at !== opts.ifUpdatedAt)) return null;
      Object.assign(row, fields);
      return row;
    },
    async cancelRecurring(tutorId, recurringId, now) {
      record('cancelRecurring', [tutorId, recurringId, now]);
      const hit = state.sessions.filter((r) => r.tutor_id === tutorId && r.google_recurring_id === recurringId
        && Date.parse(r.ends_at) > now.getTime() && r.status !== 'cancelled');
      for (const r of hit) Object.assign(r, { status: 'cancelled', sync_state: 'synced', google_synced_at: now.toISOString() });
      return hit.length;
    },
    async insertSession(row) {
      record('insertSession', [row]);
      nextId += 1;
      state.sessions.push({ id: nextId, ...row });
      return { id: nextId };
    },
    async linkedStudents(tutorId) {
      record('linkedStudents', [tutorId]);
      return students;
    },
  };
  return { repo, state, calls, called: (name) => calls.filter((c) => c.name === name) };
}

// ---------------------------------------------------------------- fixtures

const MAYA_ROW = { id: MAYA, full_name: 'Maya Lee', email: 'maya@school.test', google_email: 'maya@gmail.test' };

const makeConn = (over = {}) => ({
  user_id: TUTOR,
  purpose: 'tutor',
  google_email: 'tutor@gmail.test',
  refresh_token_enc: encrypt('refresh-secret', KEY),
  sync_enabled: true,
  calendar_id: CAL,
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

const session = (over = {}) => ({
  id: 1,
  tutor_id: TUTOR,
  student_id: MAYA,
  subject: 'Algebra',
  starts_at: '2026-10-05T17:00:00+00:00',
  ends_at: '2026-10-05T18:00:00+00:00',
  location: null,
  meeting_url: 'https://meet.test/abc',
  notes: null,
  status: 'scheduled',
  updated_at: '2026-10-02T11:00:00+00:00',
  sync_state: 'pending',
  google_event_id: null,
  google_calendar_id: null,
  google_recurring_id: null,
  google_link: null,
  ...over,
});

// The default Google event below, as the portal row it maps to
const syncedSession = (over = {}) => session({
  starts_at: '2026-10-06T17:00:00+00:00',
  ends_at: '2026-10-06T18:00:00+00:00',
  sync_state: 'synced',
  google_event_id: 'ev1',
  google_calendar_id: CAL,
  google_link: 'https://calendar.google.test/event?eid=ev1',
  ...over,
});

const event = (over = {}) => ({
  id: 'ev1',
  status: 'confirmed',
  summary: 'Algebra (Maya Lee)',
  location: 'https://meet.test/abc',
  start: { dateTime: '2026-10-06T17:00:00Z' },
  end: { dateTime: '2026-10-06T18:00:00Z' },
  updated: '2026-10-02T11:30:00.000Z',
  htmlLink: 'https://calendar.google.test/event?eid=ev1',
  attendees: [],
  ...over,
});

const mayaInvited = { attendees: [{ email: 'maya@gmail.test' }] };

function setup({ sessions = [], tombstones = [], conn: connOver = {}, students = [MAYA_ROW], google } = {}) {
  const conn = makeConn(connOver);
  const g = fakeGoogle(google);
  const fake = fakeRepo({
    sessions,
    tombstones,
    connections: [{ ...conn }],
    students,
    profiles: { [MAYA]: { id: MAYA, role: 'student', full_name: 'Maya Lee', email: 'maya@school.test' } },
    googleEmails: { [MAYA]: 'maya@gmail.test' },
  });
  return { conn, g, ...fake };
}

const push = (s) => pushPending(s.conn, s.g, { repo: s.repo, config, now: NOW });
const pull = (s) => pullChanges(s.conn, s.g, { repo: s.repo, now: NOW });

// The portal user edits the first session while a Google call is in flight
function editDuring(s, method, edit) {
  const real = s.g[method];
  s.g[method] = async (...args) => {
    const out = await real(...args);
    Object.assign(s.state.sessions[0], edit);
    return out;
  };
}
const READ = { ifUpdatedAt: '2026-10-02T11:00:00+00:00' }; // the updated_at of the fixture rows, as a pull or push read it
const EDITED = { subject: 'Edited', updated_at: '2026-10-02T11:59:00+00:00' };

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------- push

describe('pushPending', () => {
  test('inserts an event for a pending session, with the student invited from their Google address', async () => {
    const s = setup({ sessions: [session()] });
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 0, stopped: false });
    const [{ args: [cal, body] }] = s.g.called('insertEvent');
    expect(cal).toBe(CAL);
    expect(body.attendees).toEqual([{ email: 'maya@gmail.test' }]);
    expect(body.summary).toBe('Algebra (Maya Lee)');
    expect(body.extendedProperties.private.vpSessionId).toBe('1');
    expect(body.description).toContain('https://site.test/portal/');

    const row = s.state.sessions[0];
    expect(row.google_event_id).toBe('ev-1');
    expect(row.google_calendar_id).toBe(CAL);
    expect(row.google_link).toBe('https://calendar.google.test/ev-1');
    expect(row.sync_state).toBe('synced');
    expect(row.google_synced_at).toBe(STAMP);
  });

  test('invites nobody when the student has no connected Google address', async () => {
    const s = setup({ sessions: [session({ student_id: BEN })] });
    await push(s);
    expect(s.g.called('insertEvent')[0].args[1].attendees).toEqual([]);
  });

  test('creates the calendar first when the connection has none, and uses its id', async () => {
    const s = setup({ sessions: [session()], conn: { calendar_id: null } });
    await push(s);

    expect(s.g.called('insertCalendar')[0].args[0]).toEqual({ summary: 'VP Education sessions', timeZone: 'America/Los_Angeles' });
    expect(s.g.called('insertEvent')[0].args[0]).toBe('new-cal-1');
    expect(s.conn.calendar_id).toBe('new-cal-1');
    expect(s.state.connections[0].calendar_id).toBe('new-cal-1');
    expect(s.state.sessions[0].google_calendar_id).toBe('new-cal-1');
  });

  test('patches the existing event of a synced session', async () => {
    const s = setup({ sessions: [session({ google_event_id: 'ev1', google_calendar_id: CAL, sync_state: 'pending', subject: 'Geometry' })] });
    s.g.seed(CAL, event());
    const result = await push(s);

    expect(result.pushed).toBe(1);
    expect(s.g.called('insertEvent')).toHaveLength(0);
    expect(s.g.called('listEvents')).toHaveLength(0); // it already has its event id: no lookup for a tagged one
    const [{ args: [cal, id, body] }] = s.g.called('patchEvent');
    expect([cal, id]).toEqual([CAL, 'ev1']);
    expect(body.summary).toBe('Geometry (Maya Lee)');
    expect(s.state.sessions[0]).toMatchObject({ google_event_id: 'ev1', google_calendar_id: CAL, sync_state: 'synced', google_synced_at: STAMP });
  });

  test('inserts instead when the patch finds no event (404)', async () => {
    const s = setup({ sessions: [session({ google_event_id: 'gone', google_calendar_id: CAL })] });
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 0, stopped: false });
    expect(s.g.called('patchEvent')).toHaveLength(1);
    expect(s.g.called('insertEvent')).toHaveLength(1);
    expect(s.state.sessions[0].google_event_id).toBe('ev-1');
    expect(s.state.sessions[0].sync_state).toBe('synced');
  });

  test('a cancelled synced session deletes its event and clears the id and link', async () => {
    const s = setup({
      sessions: [session({ status: 'cancelled', google_event_id: 'ev1', google_calendar_id: CAL, google_link: 'https://calendar.google.test/event?eid=ev1' })],
    });
    s.g.seed(CAL, event());
    const result = await push(s);

    expect(result).toEqual({ pushed: 0, deleted: 1, failed: 0, stopped: false });
    expect(s.g.called('deleteEvent')[0].args).toEqual([CAL, 'ev1']);
    expect(s.g.event(CAL, 'ev1')).toBeUndefined();
    expect(s.state.sessions[0]).toMatchObject({ google_event_id: null, google_link: null, sync_state: 'synced', google_synced_at: STAMP });
  });

  test('a cancelled session that never had an event is just marked synced', async () => {
    const s = setup({ sessions: [session({ status: 'cancelled' })] });
    const result = await push(s);

    expect(result).toEqual({ pushed: 0, deleted: 0, failed: 0, stopped: false });
    expect(s.g.calls).toHaveLength(0);
    expect(s.calls.find((c) => c.name === 'updateSession').args)
      .toEqual([1, { sync_state: 'synced', google_synced_at: STAMP }, { ifUpdatedAt: '2026-10-02T11:00:00+00:00' }]);
  });

  test('a tombstone deletes its event and is removed', async () => {
    const s = setup({ tombstones: [{ id: 7, tutor_id: TUTOR, calendar_id: 'old-cal', event_id: 'evX' }, { id: 8, tutor_id: OTHER_TUTOR, calendar_id: 'x', event_id: 'y' }] });
    const result = await push(s);

    expect(result).toEqual({ pushed: 0, deleted: 1, failed: 0, stopped: false });
    expect(s.g.called('deleteEvent')[0].args).toEqual(['old-cal', 'evX']);
    expect(s.state.tombstones.map((t) => t.id)).toEqual([8]);
  });

  test('a tombstone that fails is kept and counted, and the sessions still push', async () => {
    const s = setup({ sessions: [session()], tombstones: [{ id: 7, tutor_id: TUTOR, calendar_id: 'old-cal', event_id: 'evX' }] });
    s.g.fail('deleteEvent', new GoogleApiError(500));
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 1, stopped: false });
    expect(s.state.tombstones).toHaveLength(1);
    expect(s.state.sessions[0].sync_state).toBe('synced');
  });

  test('a rate error on a tombstone stops the run before any session', async () => {
    const s = setup({ sessions: [session()], tombstones: [{ id: 7, tutor_id: TUTOR, calendar_id: 'old-cal', event_id: 'evX' }] });
    s.g.fail('deleteEvent', new GoogleRateError());
    const result = await push(s);

    expect(result).toEqual({ pushed: 0, deleted: 0, failed: 0, stopped: true });
    expect(s.state.tombstones).toHaveLength(1);
    expect(s.g.called('insertEvent')).toHaveLength(0);
  });

  test('a rate error stops the run and leaves that row and the rest pending', async () => {
    const s = setup({
      sessions: [
        session({ id: 1, starts_at: '2026-10-05T17:00:00+00:00' }),
        session({ id: 2, starts_at: '2026-10-06T17:00:00+00:00' }),
        session({ id: 3, starts_at: '2026-10-07T17:00:00+00:00' }),
      ],
    });
    s.g.fail('insertEvent', new GoogleRateError(), 2);
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 0, stopped: true });
    expect(s.g.called('insertEvent')).toHaveLength(2);
    expect(s.state.sessions.map((r) => r.sync_state)).toEqual(['synced', 'pending', 'pending']);
  });

  test('a rate error on the first row stops after it', async () => {
    const s = setup({ sessions: [session({ id: 1 }), session({ id: 2, starts_at: '2026-10-06T17:00:00+00:00' })] });
    s.g.fail('insertEvent', new GoogleRateError());
    const result = await push(s);

    expect(result.stopped).toBe(true);
    expect(s.g.called('insertEvent')).toHaveLength(1);
    expect(s.state.sessions.map((r) => r.sync_state)).toEqual(['pending', 'pending']);
  });

  test('another error marks that row error and the others still push', async () => {
    const s = setup({
      sessions: [
        session({ id: 1, starts_at: '2026-10-05T17:00:00+00:00' }),
        session({ id: 2, starts_at: '2026-10-06T17:00:00+00:00' }),
      ],
    });
    s.g.fail('insertEvent', new GoogleApiError(500));
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 1, stopped: false });
    expect(s.state.sessions.map((r) => r.sync_state)).toEqual(['error', 'synced']);
    expect(s.state.sessions[0].google_event_id).toBeNull();
  });

  test('an error-state session is retried', async () => {
    const s = setup({ sessions: [session({ sync_state: 'error' })] });
    const result = await push(s);
    expect(result.pushed).toBe(1);
    expect(s.state.sessions[0].sync_state).toBe('synced');
  });

  test('a GoogleAuthError propagates and leaves the row as it was', async () => {
    const s = setup({ sessions: [session()] });
    s.g.fail('insertEvent', new GoogleAuthError());
    await expect(push(s)).rejects.toBeInstanceOf(GoogleAuthError);
    expect(s.state.sessions[0].sync_state).toBe('pending');
  });

  test('a GoogleAuthError on a tombstone propagates too', async () => {
    const s = setup({ tombstones: [{ id: 7, tutor_id: TUTOR, calendar_id: 'c', event_id: 'e' }] });
    s.g.fail('deleteEvent', new GoogleAuthError());
    await expect(push(s)).rejects.toBeInstanceOf(GoogleAuthError);
    expect(s.state.tombstones).toHaveLength(1);
  });

  test('a session whose earlier insert reached Google without its id being saved binds that event, no twin', async () => {
    const s = setup({ sessions: [session()] });
    s.g.seed(CAL, event({ id: 'tagged', extendedProperties: { private: { vpSessionId: '1' } } }));
    s.g.seed(CAL, event({ id: 'other', extendedProperties: { private: { vpSessionId: '2' } } }));
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 0, stopped: false });
    expect(s.g.called('listEvents')[0].args).toEqual([CAL, { privateExtendedProperty: 'vpSessionId=1', maxResults: 1, showDeleted: false }]);
    expect(s.g.called('insertEvent')).toHaveLength(0);
    expect(s.g.called('patchEvent')[0].args.slice(0, 2)).toEqual([CAL, 'tagged']);
    expect(s.g.called('patchEvent')[0].args[2].summary).toBe('Algebra (Maya Lee)');
    expect(s.state.sessions[0]).toMatchObject({ google_event_id: 'tagged', google_calendar_id: CAL, sync_state: 'synced', google_synced_at: STAMP });
  });

  test('a tagged event that is gone before the patch is replaced by an insert', async () => {
    const s = setup({ sessions: [session()] });
    s.g.seed(CAL, event({ id: 'tagged', extendedProperties: { private: { vpSessionId: '1' } } }));
    s.g.fail('patchEvent', new GoogleNotFound());
    await push(s);

    expect(s.g.called('insertEvent')).toHaveLength(1);
    expect(s.state.sessions[0].google_event_id).toBe('ev-1');
  });

  test('a patch answered with 410 inserts instead, like a 404', async () => {
    const s = setup({ sessions: [session({ google_event_id: 'gone', google_calendar_id: CAL })] });
    s.g.fail('patchEvent', new GoogleGone());
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 0, stopped: false });
    expect(s.g.called('insertEvent')).toHaveLength(1);
    expect(s.state.sessions[0]).toMatchObject({ google_event_id: 'ev-1', sync_state: 'synced' });
  });

  test('a tagged event whose patch answers 410 is replaced by an insert', async () => {
    const s = setup({ sessions: [session()] });
    s.g.seed(CAL, event({ id: 'tagged', extendedProperties: { private: { vpSessionId: '1' } } }));
    s.g.fail('patchEvent', new GoogleGone());
    await push(s);

    expect(s.g.called('insertEvent')).toHaveLength(1);
    expect(s.state.sessions[0].google_event_id).toBe('ev-1');
  });

  test('a rate limit while creating the calendar stops the run instead of throwing', async () => {
    const s = setup({ sessions: [session()], tombstones: [{ id: 7, tutor_id: TUTOR, calendar_id: 'old-cal', event_id: 'evX' }], conn: { calendar_id: null } });
    s.g.fail('insertCalendar', new GoogleRateError());
    const result = await push(s);

    expect(result).toEqual({ pushed: 0, deleted: 0, failed: 0, stopped: true });
    expect(s.g.called('insertEvent')).toHaveLength(0);
    expect(s.g.called('deleteEvent')).toHaveLength(0);
    expect(s.state.sessions[0].sync_state).toBe('pending');
    expect(s.state.tombstones).toHaveLength(1);
  });

  test('any other error creating the calendar still propagates', async () => {
    for (const error of [new GoogleApiError(500), new GoogleAuthError()]) {
      const s = setup({ sessions: [session()], conn: { calendar_id: null } });
      s.g.fail('insertCalendar', error);
      await expect(push(s)).rejects.toBe(error);
    }
  });

  test('the echo of a push of a session with no subject changes nothing (the generic label is not stored)', async () => {
    const s = setup({ sessions: [session({ subject: null })] });
    await push(s);
    expect(s.g.called('insertEvent')[0].args[1].summary).toBe('Tutoring session (Maya Lee)');
    const before = structuredClone(s.state.sessions[0]);
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions[0]).toEqual(before);
  });

  test('a rate error while looking for a tagged event stops the run', async () => {
    const s = setup({ sessions: [session()] });
    s.g.fail('listEvents', new GoogleRateError());
    const result = await push(s);

    expect(result.stopped).toBe(true);
    expect(s.state.sessions[0].sync_state).toBe('pending');
  });

  test('the synced mark is a compare-and-set on the updated_at that was read', async () => {
    const s = setup({ sessions: [session()] });
    await push(s);
    expect(s.called('updateSession')[0].args[2]).toEqual({ ifUpdatedAt: '2026-10-02T11:00:00+00:00' });
    expect(s.called('updateSession')).toHaveLength(1);
  });

  test('an edit made while an insert is in flight keeps the row pending, with the event id stored, and the next push sends the edit', async () => {
    const s = setup({ sessions: [session()] });
    editDuring(s, 'insertEvent', EDITED);
    const result = await push(s);

    expect(result).toEqual({ pushed: 1, deleted: 0, failed: 0, stopped: false });
    const kept = { google_event_id: 'ev-1', google_calendar_id: CAL, google_link: 'https://calendar.google.test/ev-1' };
    expect(s.state.sessions[0]).toMatchObject({ ...kept, sync_state: 'pending', subject: 'Edited' });
    expect(s.state.sessions[0].google_synced_at).toBeUndefined();
    expect(s.called('updateSession').map((c) => c.args)).toEqual([
      [1, { ...kept, sync_state: 'synced', google_synced_at: STAMP }, { ifUpdatedAt: '2026-10-02T11:00:00+00:00' }],
      [1, kept],
    ]);

    await push(s);
    expect(s.g.called('insertEvent')).toHaveLength(1);
    expect(s.g.called('patchEvent')[0].args.slice(0, 2)).toEqual([CAL, 'ev-1']);
    expect(s.g.called('patchEvent')[0].args[2].summary).toBe('Edited (Maya Lee)');
    expect(s.state.sessions[0].sync_state).toBe('synced');
  });

  test('an edit made while a patch is in flight keeps the row pending', async () => {
    const s = setup({ sessions: [session({ google_event_id: 'ev1', google_calendar_id: CAL })] });
    s.g.seed(CAL, event());
    editDuring(s, 'patchEvent', EDITED);
    await push(s);

    expect(s.state.sessions[0]).toMatchObject({ google_event_id: 'ev1', sync_state: 'pending', subject: 'Edited' });
  });

  test('a session restored while its event is being deleted keeps no dead event id and stays pending, so the next push inserts it again', async () => {
    const s = setup({ sessions: [session({ status: 'cancelled', google_event_id: 'ev1', google_calendar_id: CAL, google_link: 'https://calendar.google.test/event?eid=ev1' })] });
    s.g.seed(CAL, event());
    editDuring(s, 'deleteEvent', { status: 'scheduled', updated_at: '2026-10-02T11:59:00+00:00' });
    const result = await push(s);

    expect(result).toEqual({ pushed: 0, deleted: 1, failed: 0, stopped: false });
    expect(s.state.sessions[0]).toMatchObject({ status: 'scheduled', sync_state: 'pending', google_event_id: null, google_link: null });

    await push(s);
    expect(s.g.called('insertEvent')).toHaveLength(1);
    expect(s.state.sessions[0]).toMatchObject({ sync_state: 'synced', google_event_id: 'ev-1' });
  });

  test('a cancelled session without an event that was edited since it was read stays pending', async () => {
    const s = setup({ sessions: [session({ status: 'cancelled' })] });
    const stale = { ...s.state.sessions[0] };
    Object.assign(s.state.sessions[0], { status: 'scheduled', updated_at: '2026-10-02T11:59:00+00:00' });
    s.repo.pendingSessions = async () => [stale];
    await push(s);

    expect(s.state.sessions[0]).toMatchObject({ status: 'scheduled', sync_state: 'pending' });
    expect(s.called('updateSession')).toHaveLength(1);
  });

  test('reads at most 50 pending sessions, oldest first, and ignores other tutors', async () => {
    const sessions = [
      session({ id: 1, tutor_id: OTHER_TUTOR }),
      session({ id: 2, starts_at: '2026-10-09T17:00:00+00:00' }),
      session({ id: 3, starts_at: '2026-10-07T17:00:00+00:00' }),
    ];
    const s = setup({ sessions });
    await push(s);
    expect(s.g.called('insertEvent').map((c) => c.args[1].extendedProperties.private.vpSessionId)).toEqual(['3', '2']);
    expect(s.state.sessions[0].sync_state).toBe('pending');
  });
});

// ---------------------------------------------------------------- pull

describe('pullChanges', () => {
  test('an event with the session id moves the session and marks it synced', async () => {
    const s = setup({ sessions: [syncedSession({ starts_at: '2026-10-05T17:00:00+00:00', ends_at: '2026-10-05T18:00:00+00:00' })] });
    s.g.seed(CAL, event({ extendedProperties: { private: { vpSessionId: '1' } } }));
    const result = await pull(s);

    expect(result).toEqual({ updated: 1, inserted: 0, cancelled: 0, skipped: 0 });
    expect(s.state.sessions[0]).toMatchObject({
      starts_at: '2026-10-06T17:00:00.000Z',
      ends_at: '2026-10-06T18:00:00.000Z',
      sync_state: 'synced',
      google_synced_at: STAMP,
    });
  });

  test('writes only the keys that changed, plus the sync time', async () => {
    const s = setup({ sessions: [syncedSession({ subject: 'Geometry' })] });
    s.g.seed(CAL, event({ extendedProperties: { private: { vpSessionId: '1' } } }));
    await pull(s);

    expect(s.called('updateSession').map((c) => c.args)).toEqual([[1, { subject: 'Algebra', google_synced_at: STAMP }, READ]]);
  });

  test('writes nothing when the row already matches the event, whatever the timestamp format', async () => {
    const s = setup({ sessions: [syncedSession()] });
    s.g.seed(CAL, event());
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.called('updateSession')).toHaveLength(0);
  });

  test('the echo of our own push changes nothing', async () => {
    const s = setup({ sessions: [session()] });
    await push(s);
    const before = structuredClone(s.state.sessions[0]);
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions[0]).toEqual(before);
  });

  test('an event whose session id belongs to another tutor is ignored', async () => {
    const theirs = session({ id: 2, tutor_id: OTHER_TUTOR, sync_state: 'synced', starts_at: '2026-10-05T17:00:00+00:00' });
    const s = setup({ sessions: [theirs] });
    s.g.seed(CAL, event({ id: 'evT', ...mayaInvited, extendedProperties: { private: { vpSessionId: '2' } } }));
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions).toHaveLength(1);
    expect(s.state.sessions[0]).toEqual(theirs);
    expect(s.called('updateSession')).toHaveLength(0);
  });

  test('an event for a portal session that no longer exists is not brought back', async () => {
    const s = setup();
    s.g.seed(CAL, event({ ...mayaInvited, extendedProperties: { private: { vpSessionId: '99' } } }));
    const result = await pull(s);

    expect(result.skipped).toBe(1);
    expect(s.state.sessions).toHaveLength(0);
  });

  test('a session id that is not a number is not looked up', async () => {
    const s = setup();
    s.g.seed(CAL, event({ ...mayaInvited, extendedProperties: { private: { vpSessionId: '1; drop table' } } }));
    const result = await pull(s);

    expect(s.called('sessionById')).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  test('a new event inviting a linked student inserts a session for them', async () => {
    const s = setup();
    s.g.seed(CAL, event({ id: 'new1', summary: 'Geometry', ...mayaInvited }));
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 1, cancelled: 0, skipped: 0 });
    const [{ args: [row] }] = s.called('insertSession');
    expect(row).toMatchObject({
      student_id: MAYA,
      tutor_id: TUTOR,
      subject: 'Geometry',
      starts_at: '2026-10-06T17:00:00.000Z',
      ends_at: '2026-10-06T18:00:00.000Z',
      meeting_url: 'https://meet.test/abc',
      status: 'scheduled',
      google_event_id: 'new1',
      google_calendar_id: CAL,
      google_recurring_id: null,
      google_link: 'https://calendar.google.test/event?eid=ev1',
      sync_state: 'synced',
      google_synced_at: STAMP,
    });
    expect(s.state.sessions).toHaveLength(1);
  });

  test('loads the linked students once per pull', async () => {
    const s = setup();
    s.g.seed(CAL, event({ id: 'a', ...mayaInvited }));
    s.g.seed(CAL, event({ id: 'b', ...mayaInvited }));
    s.g.seed(CAL, event({ id: 'c', attendees: [{ email: 'nobody@x.test' }] }));
    await pull(s);
    expect(s.called('linkedStudents')).toHaveLength(1);
  });

  test('a new event with no linked student is skipped', async () => {
    const s = setup();
    s.g.seed(CAL, event({ id: 'new1', attendees: [{ email: 'stranger@x.test' }] }));
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions).toHaveLength(0);
  });

  test('an all-day event is skipped', async () => {
    const s = setup();
    s.g.seed(CAL, event({ id: 'day', ...mayaInvited, start: { date: '2026-10-06' }, end: { date: '2026-10-07' } }));
    const result = await pull(s);

    expect(result.skipped).toBe(1);
    expect(s.state.sessions).toHaveLength(0);
  });

  test('an event the sessions table would refuse (no length, or over 8 hours) is skipped', async () => {
    const s = setup();
    s.g.seed(CAL, event({ id: 'empty', ...mayaInvited, end: { dateTime: '2026-10-06T17:00:00Z' } }));
    s.g.seed(CAL, event({ id: 'long', ...mayaInvited, end: { dateTime: '2026-10-07T02:00:00Z' } }));
    s.g.seed(CAL, event({ id: 'eight', ...mayaInvited, end: { dateTime: '2026-10-07T01:00:00Z' } }));
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 1, cancelled: 0, skipped: 2 });
    expect(s.state.sessions.map((r) => r.google_event_id)).toEqual(['eight']); // exactly 8 hours is allowed
  });

  test('a cancelled event cancels the session', async () => {
    const s = setup({ sessions: [syncedSession()] });
    s.g.seed(CAL, { id: 'ev1', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 1, skipped: 0 });
    expect(s.called('updateSession').map((c) => c.args)).toEqual([[1, { status: 'cancelled', sync_state: 'synced', google_synced_at: STAMP }, READ]]);
  });

  test('a cancelled event for an unknown session, or an already cancelled one, changes nothing', async () => {
    const s = setup({ sessions: [syncedSession({ id: 2, google_event_id: 'ev2', status: 'cancelled' })] });
    s.g.seed(CAL, { id: 'nothing', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    s.g.seed(CAL, { id: 'ev2', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 2 });
    expect(s.called('updateSession')).toHaveLength(0);
  });

  test('a cancelled event for an older event of a session now bound to another one is ignored', async () => {
    const s = setup({ sessions: [syncedSession({ google_event_id: 'ev-new' })] });
    s.g.seed(CAL, { id: 'ev-old', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z', extendedProperties: { private: { vpSessionId: '1' } } });
    const result = await pull(s);

    expect(result.cancelled).toBe(0);
    expect(s.state.sessions[0].status).toBe('scheduled');
  });

  test('a recurring master yields a session per instance, with the recurring id', async () => {
    const s = setup();
    s.g.seed(CAL, event({ id: 'm1', recurrence: ['RRULE:FREQ=WEEKLY'], summary: 'Chemistry (Maya Lee)', ...mayaInvited }));
    s.g.seedInstances('m1', [
      event({ id: 'm1_20261005T170000Z', recurringEventId: 'm1', summary: 'Chemistry (Maya Lee)', ...mayaInvited, start: { dateTime: '2026-10-05T17:00:00Z' }, end: { dateTime: '2026-10-05T18:00:00Z' } }),
      event({ id: 'm1_20261012T170000Z', recurringEventId: 'm1', summary: 'Chemistry (Maya Lee)', ...mayaInvited, start: { dateTime: '2026-10-12T17:00:00Z' }, end: { dateTime: '2026-10-12T18:00:00Z' } }),
      { id: 'm1_20261019T170000Z', recurringEventId: 'm1', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' },
    ]);
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 2, cancelled: 0, skipped: 1 });
    expect(s.state.sessions.map((r) => [r.google_event_id, r.google_recurring_id, r.subject])).toEqual([
      ['m1_20261005T170000Z', 'm1', 'Chemistry'],
      ['m1_20261012T170000Z', 'm1', 'Chemistry'],
    ]);
    expect(s.g.called('listInstances')[0].args).toEqual([CAL, 'm1', {
      timeMin: '2026-08-07T12:00:00.000Z',
      timeMax: '2027-04-02T12:00:00.000Z',
      showDeleted: true,
    }]);
  });

  test('the instances of a recurring master are paged', async () => {
    const s = setup({ google: { pageSize: 1 } });
    s.g.seed(CAL, event({ id: 'm1', recurrence: ['RRULE:FREQ=WEEKLY'], ...mayaInvited }));
    s.g.seedInstances('m1', [
      event({ id: 'm1_a', recurringEventId: 'm1', ...mayaInvited }),
      event({ id: 'm1_b', recurringEventId: 'm1', ...mayaInvited, start: { dateTime: '2026-10-13T17:00:00Z' }, end: { dateTime: '2026-10-13T18:00:00Z' } }),
    ]);
    const result = await pull(s);

    expect(result.inserted).toBe(2);
    expect(s.g.called('listInstances').map((c) => c.args[2].pageToken)).toEqual([undefined, '1']);
  });

  test('a recurring master cancelled in Google cancels the upcoming sessions of its series', async () => {
    const s = setup({
      sessions: [
        syncedSession({ id: 1, google_event_id: 'm2_a', google_recurring_id: 'm2' }),
        syncedSession({ id: 2, google_event_id: 'm2_b', google_recurring_id: 'm2' }),
        syncedSession({ id: 3, google_event_id: 'm2_old', google_recurring_id: 'm2', starts_at: '2026-09-28T17:00:00+00:00', ends_at: '2026-09-28T18:00:00+00:00' }),
        syncedSession({ id: 4, google_event_id: 'other_a', google_recurring_id: 'other' }),
        syncedSession({ id: 5, tutor_id: OTHER_TUTOR, google_event_id: 'm2_c', google_recurring_id: 'm2' }),
      ],
    });
    s.g.seed(CAL, { id: 'm2', status: 'cancelled', recurrence: ['RRULE:FREQ=WEEKLY'], updated: '2026-10-02T11:30:00.000Z' });
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 2, skipped: 0 });
    expect(s.called('cancelRecurring').map((c) => c.args)).toEqual([[TUTOR, 'm2', NOW]]);
    expect(s.g.called('listInstances')).toHaveLength(0);
    expect(s.state.sessions.map((r) => r.status)).toEqual(['cancelled', 'cancelled', 'scheduled', 'scheduled', 'scheduled']);
    expect(s.state.sessions[0]).toMatchObject({ sync_state: 'synced', google_synced_at: STAMP });
  });

  test('a series deleted in Google that arrives as a bare cancelled master cancels its sessions too', async () => {
    const s = setup({ sessions: [syncedSession({ id: 1, google_event_id: 'm3_a', google_recurring_id: 'm3' })] });
    s.g.seed(CAL, { id: 'm3', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 1, skipped: 0 });
    expect(s.state.sessions[0].status).toBe('cancelled');
  });

  test('a cancelled event that is not the master of any series is skipped', async () => {
    const s = setup({ sessions: [syncedSession({ google_recurring_id: 'm2' })] });
    s.g.seed(CAL, { id: 'loner', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    s.g.seed(CAL, { id: 'm2_x', recurringEventId: 'm2', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 2 });
    expect(s.called('cancelRecurring').map((c) => c.args[1])).toEqual(['loner']); // an instance never cancels its series
    expect(s.state.sessions[0].status).toBe('scheduled');
  });

  test('a master whose instances are gone (404 or 410) means its series was deleted', async () => {
    for (const error of [new GoogleNotFound(), new GoogleGone()]) {
      const s = setup({
        sessions: [
          syncedSession({ id: 1, google_event_id: 'm1_a', google_recurring_id: 'm1' }),
          syncedSession({ id: 2, google_event_id: 'x', google_recurring_id: 'x' }),
        ],
      });
      s.g.seed(CAL, event({ id: 'm1', recurrence: ['RRULE:FREQ=WEEKLY'], ...mayaInvited }));
      s.g.fail('listInstances', error);
      const result = await pull(s);

      expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 1, skipped: 0 });
      expect(s.called('cancelRecurring').map((c) => c.args)).toEqual([[TUTOR, 'm1', NOW]]);
      expect(s.state.sessions.map((r) => r.status)).toEqual(['cancelled', 'scheduled']);
      expect(s.state.connections[0].last_synced_at).toBe(STAMP);
    }
  });

  test('a deleted series with nothing upcoming in the portal counts as one skipped event', async () => {
    const s = setup();
    s.g.seed(CAL, { id: 'm4', status: 'cancelled', recurrence: ['RRULE:FREQ=WEEKLY'], updated: '2026-10-02T11:30:00.000Z' });
    expect(await pull(s)).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
  });

  test('an exception listed on its own keeps its recurring id', async () => {
    const s = setup();
    s.g.seed(CAL, event({ id: 'm1_20261006T170000Z', recurringEventId: 'm1', ...mayaInvited }));
    await pull(s);
    expect(s.state.sessions[0].google_recurring_id).toBe('m1');
  });

  test('when the portal row is pending and newer than the event, the portal wins and the row is untouched', async () => {
    const pending = syncedSession({ sync_state: 'pending', subject: 'Calculus', updated_at: '2026-10-02T11:45:00+00:00' });
    const s = setup({ sessions: [pending] });
    const before = structuredClone(pending);
    s.g.seed(CAL, event({ updated: '2026-10-02T11:00:00.000Z' }));
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions[0]).toEqual(before);
    expect(s.called('updateSession')).toHaveLength(0);
  });

  test('when the event is newer than a pending row, Google wins and the row becomes synced', async () => {
    const s = setup({ sessions: [syncedSession({ sync_state: 'pending', subject: 'Calculus', updated_at: '2026-10-02T11:00:00+00:00' })] });
    s.g.seed(CAL, event({ updated: '2026-10-02T11:30:00.000Z' }));
    await pull(s);

    expect(s.called('updateSession').map((c) => c.args)).toEqual([[1, { subject: 'Algebra', sync_state: 'synced', google_synced_at: STAMP }, READ]]);
  });

  test('a row found by event id (no session id on the event) is updated', async () => {
    const s = setup({ sessions: [syncedSession({ subject: 'Geometry' })] });
    s.g.seed(CAL, event());
    await pull(s);
    expect(s.called('sessionByEvent')[0].args).toEqual([CAL, 'ev1']);
    expect(s.state.sessions[0].subject).toBe('Algebra');
  });

  test('a 410 on the sync token clears it and does one full list, storing the new token', async () => {
    const s = setup({ conn: { sync_token: 'old-token' } });
    s.g.seed(CAL, event({ id: 'new1', ...mayaInvited }));
    s.g.fail('listEvents', new GoogleGone());
    const result = await pull(s);

    expect(result.inserted).toBe(1);
    expect(s.g.called('listEvents').map((c) => c.args)).toEqual([
      [CAL, { syncToken: 'old-token', singleEvents: false, showDeleted: true }],
      [CAL, { singleEvents: false, showDeleted: true, maxResults: 250 }],
    ]);
    expect(s.state.connections[0].sync_token).toBe('sync-next');
  });

  test('a second 410 on the full list is an error, and releases the lock', async () => {
    const s = setup({ conn: { sync_token: 'old-token' } });
    s.g.fail('listEvents', new GoogleGone(), 1);
    s.g.fail('listEvents', new GoogleGone(), 2);
    await expect(pull(s)).rejects.toBeInstanceOf(GoogleGone);
    expect(s.g.called('listEvents')).toHaveLength(2);
    expect(s.state.connections[0].pull_started_at).toBeNull();
  });

  test('lists with the stored sync token when there is one', async () => {
    const s = setup({ conn: { sync_token: 'tok-1' } });
    await pull(s);
    expect(s.g.called('listEvents')[0].args).toEqual([CAL, { syncToken: 'tok-1', singleEvents: false, showDeleted: true }]);
  });

  test('follows nextPageToken through every page', async () => {
    const s = setup({ google: { pageSize: 1 } });
    s.g.seed(CAL, event({ id: 'a', ...mayaInvited }));
    s.g.seed(CAL, event({ id: 'b', ...mayaInvited, start: { dateTime: '2026-10-07T17:00:00Z' }, end: { dateTime: '2026-10-07T18:00:00Z' } }));
    const result = await pull(s);

    expect(result.inserted).toBe(2);
    expect(s.g.called('listEvents').map((c) => c.args[1].pageToken)).toEqual([undefined, '1']);
    expect(s.g.called('listEvents')[1].args[1].maxResults).toBe(250);
    expect(s.state.connections[0].sync_token).toBe('sync-next');
  });

  test('on success it stores the token and time, and clears the error and the lock', async () => {
    const s = setup({ conn: { sync_token: 'tok-1', last_error: 'google_error' } });
    await pull(s);

    expect(s.state.connections[0]).toMatchObject({
      sync_token: 'sync-next',
      last_synced_at: STAMP,
      last_error: null,
      pull_started_at: null,
    });
  });

  test('keeps the old sync token when Google sends no new one', async () => {
    const s = setup({ conn: { sync_token: 'tok-1' }, google: { syncToken: null } });
    await pull(s);
    expect(s.state.connections[0].sync_token).toBe('tok-1');
  });

  test('answers busy, and does nothing, when someone else holds the pull lock', async () => {
    const s = setup({ conn: { pull_started_at: new Date(NOW.getTime() - 10_000).toISOString() } });
    s.state.connections[0].pull_started_at = new Date(NOW.getTime() - 10_000).toISOString();
    const result = await pull(s);

    expect(result).toEqual({ busy: true });
    expect(s.g.calls).toHaveLength(0);
    expect(s.called('updateConnection')).toHaveLength(0);
  });

  test('takes over a lock that is more than 60 seconds old', async () => {
    const s = setup();
    s.state.connections[0].pull_started_at = new Date(NOW.getTime() - 90_000).toISOString();
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 0 });
    expect(s.g.called('listEvents')).toHaveLength(1);
  });

  test('an event stretched past 8 hours, or to no length, leaves its row as it was, and the pull still completes with its new token', async () => {
    const s = setup({
      sessions: [
        syncedSession({ id: 1, google_event_id: 'long' }),
        syncedSession({ id: 2, google_event_id: 'empty' }),
        syncedSession({ id: 3, google_event_id: 'eight', subject: 'Geometry' }),
      ],
      conn: { sync_token: 'tok-1' },
    });
    const before = structuredClone(s.state.sessions);
    s.g.seed(CAL, event({ id: 'long', end: { dateTime: '2026-10-07T02:00:00Z' } })); // 9 hours
    s.g.seed(CAL, event({ id: 'empty', end: { dateTime: '2026-10-06T17:00:00Z' } })); // no length
    s.g.seed(CAL, event({ id: 'eight', end: { dateTime: '2026-10-07T01:00:00Z' } })); // exactly 8 hours is allowed
    const result = await pull(s);

    expect(result).toEqual({ updated: 1, inserted: 0, cancelled: 0, skipped: 2 });
    expect(s.state.sessions.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(s.state.sessions[2]).toMatchObject({ subject: 'Algebra', ends_at: '2026-10-07T01:00:00.000Z' });
    expect(s.state.connections[0]).toMatchObject({ sync_token: 'sync-next', last_synced_at: STAMP });
  });

  test('the same holds for an instance of a recurring master', async () => {
    const s = setup({ sessions: [syncedSession({ google_event_id: 'm1_a', google_recurring_id: 'm1' })] });
    const before = structuredClone(s.state.sessions);
    s.g.seed(CAL, event({ id: 'm1', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    s.g.seedInstances('m1', [event({ id: 'm1_a', recurringEventId: 'm1', end: { dateTime: '2026-10-07T02:00:00Z' } })]);
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions).toEqual(before);
    expect(s.state.connections[0].sync_token).toBe('sync-next');
  });

  test('a database error on one event counts it skipped and the pull goes on; only the error name and the event id are logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup({
      sessions: [
        syncedSession({ id: 1, google_event_id: 'ev1', subject: 'A' }),
        syncedSession({ id: 2, google_event_id: 'ev2', subject: 'B' }),
      ],
    });
    s.g.seed(CAL, event({ id: 'ev1' }));
    s.g.seed(CAL, event({ id: 'ev2' }));
    const update = s.repo.updateSession;
    s.repo.updateSession = async (id, ...rest) => {
      if (id === 1) throw new Error('updateSession: Maya Lee row is locked');
      return update(id, ...rest);
    };
    const result = await pull(s);

    expect(result).toEqual({ updated: 1, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions.map((r) => r.subject)).toEqual(['A', 'Algebra']);
    expect(s.state.connections[0]).toMatchObject({ sync_token: 'sync-next', last_synced_at: STAMP, pull_started_at: null });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('Error');
    expect(logged).toContain('ev1');
    expect(logged).not.toMatch(/Maya|locked|updateSession/);
  });

  test('a failed insert or series cancel is isolated the same way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup();
    s.g.seed(CAL, event({ id: 'new1', ...mayaInvited }));
    s.g.seed(CAL, event({ id: 'new2', ...mayaInvited }));
    s.g.seed(CAL, { id: 'gone-series', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    s.repo.cancelRecurring = async () => { throw new Error('cancelRecurring: down'); };
    const insert = s.repo.insertSession;
    s.repo.insertSession = async (row) => {
      if (row.google_event_id === 'new1') throw new Error('insertSession: down');
      return insert(row);
    };
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 1, cancelled: 0, skipped: 2 });
    expect(s.state.sessions.map((r) => r.google_event_id)).toEqual(['new2']);
    expect(s.state.connections[0].last_synced_at).toBe(STAMP);
  });

  test('a GoogleAuthError or GoogleRateError raised while applying an event still ends the pull', async () => {
    for (const error of [new GoogleAuthError(), new GoogleRateError()]) {
      const s = setup({ sessions: [syncedSession({ subject: 'Geometry' })] });
      s.g.seed(CAL, event());
      s.repo.updateSession = async () => { throw error; };
      await expect(pull(s)).rejects.toBe(error);
      expect(s.state.connections[0].pull_started_at).toBeNull();
      expect(s.state.connections[0].last_synced_at).toBeNull();
    }
  });

  test('a pull write is a compare-and-set on the updated_at that was read', async () => {
    const s = setup({ sessions: [syncedSession({ subject: 'Geometry' })] });
    s.g.seed(CAL, event());
    await pull(s);
    expect(s.called('updateSession').map((c) => c.args[2])).toEqual([READ]);
  });

  test('a row changed in the portal between the read and the write is left alone, and that event is skipped', async () => {
    const s = setup({ sessions: [syncedSession({ subject: 'Geometry' })] });
    s.g.seed(CAL, event());
    const stale = { ...s.state.sessions[0] };
    Object.assign(s.state.sessions[0], { subject: 'Edited', updated_at: '2026-10-02T11:59:00+00:00' });
    s.repo.sessionByEvent = async () => stale;
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions[0]).toMatchObject({ subject: 'Edited', updated_at: '2026-10-02T11:59:00+00:00' });
  });

  test('a cancellation that misses the compare-and-set is skipped too', async () => {
    const s = setup({ sessions: [syncedSession()] });
    s.g.seed(CAL, { id: 'ev1', status: 'cancelled', updated: '2026-10-02T11:30:00.000Z' });
    const stale = { ...s.state.sessions[0] };
    Object.assign(s.state.sessions[0], { subject: 'Edited', updated_at: '2026-10-02T11:59:00+00:00' });
    s.repo.sessionByEvent = async () => stale;
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions[0].status).toBe('scheduled');
  });

  test('a row whose push failed (error) keeps its unpushed edit like a pending one', async () => {
    const errored = syncedSession({ sync_state: 'error', subject: 'Calculus', updated_at: '2026-10-02T11:45:00+00:00' });
    const s = setup({ sessions: [errored] });
    const before = structuredClone(errored);
    s.g.seed(CAL, event({ updated: '2026-10-02T11:00:00.000Z' }));
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 1 });
    expect(s.state.sessions[0]).toEqual(before);
  });

  test('an error row older than the event gives way to Google and becomes synced', async () => {
    const s = setup({ sessions: [syncedSession({ sync_state: 'error', subject: 'Calculus', updated_at: '2026-10-02T11:00:00+00:00' })] });
    s.g.seed(CAL, event({ updated: '2026-10-02T11:30:00.000Z' }));
    await pull(s);
    expect(s.state.sessions[0]).toMatchObject({ subject: 'Algebra', sync_state: 'synced' });
  });

  test('does nothing, not even taking the lock, when the connection has no calendar yet', async () => {
    const s = setup({ conn: { calendar_id: null } });
    const result = await pull(s);

    expect(result).toEqual({ updated: 0, inserted: 0, cancelled: 0, skipped: 0 });
    expect(s.g.calls).toHaveLength(0);
    expect(s.called('claimPull')).toHaveLength(0);
    expect(s.called('updateConnection')).toHaveLength(0);
  });

  test('a failure while pulling releases the lock and rethrows', async () => {
    const s = setup();
    s.g.fail('listEvents', new GoogleApiError(500));
    await expect(pull(s)).rejects.toBeInstanceOf(GoogleApiError);

    expect(s.state.connections[0].pull_started_at).toBeNull();
    expect(s.state.connections[0].last_synced_at).toBeNull();
  });
});

// ---------------------------------------------------------------- channel and calendar

describe('ensureCalendar', () => {
  test('returns the stored calendar without calling Google', async () => {
    const s = setup();
    expect(await ensureCalendar(s.conn, s.g, s.repo)).toBe(CAL);
    expect(s.g.calls).toHaveLength(0);
  });

  test('creates the VP Education sessions calendar and saves its id', async () => {
    const s = setup({ conn: { calendar_id: null } });
    const id = await ensureCalendar(s.conn, s.g, s.repo);

    expect(id).toBe('new-cal-1');
    expect(s.g.called('insertCalendar')[0].args[0]).toEqual({ summary: 'VP Education sessions', timeZone: 'America/Los_Angeles' });
    expect(s.state.connections[0].calendar_id).toBe('new-cal-1');
    expect(s.conn.calendar_id).toBe('new-cal-1');
  });
});

describe('ensureChannel', () => {
  const live = { channel_id: 'old-ch', channel_resource_id: 'old-res', channel_token: 'old-tok' };

  test('keeps a channel that is more than 48 hours from expiring', async () => {
    const s = setup({ conn: { ...live, channel_expires_at: new Date(NOW.getTime() + 3 * DAY).toISOString() } });
    await ensureChannel(s.conn, s.g, s.repo, { config, now: NOW });

    expect(s.g.calls).toHaveLength(0);
    expect(s.called('updateConnection')).toHaveLength(0);
  });

  test('renews a channel that expires in an hour: stops the old one and saves the new', async () => {
    const s = setup({ conn: { ...live, channel_expires_at: new Date(NOW.getTime() + HOUR).toISOString() } });
    const random = vi.fn((n) => Buffer.alloc(n, 7));
    await ensureChannel(s.conn, s.g, s.repo, { config, now: NOW, random });

    expect(s.g.calls.map((c) => c.method)).toEqual(['stopChannel', 'watchEvents']);
    expect(s.g.called('stopChannel')[0].args[0]).toEqual({ id: 'old-ch', resourceId: 'old-res' });
    const [cal, watch] = s.g.called('watchEvents')[0].args;
    expect(cal).toBe(CAL);
    expect(watch.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(watch.token).toBe(Buffer.alloc(32, 7).toString('base64url'));
    expect(random).toHaveBeenCalledWith(32);
    expect(watch.address).toBe('https://site.test/api/google/notify');
    expect(watch.ttlSeconds).toBe(7 * 24 * 3600);

    const saved = s.state.connections[0];
    expect(saved).toMatchObject({
      channel_id: watch.id,
      channel_resource_id: `resource-${watch.id}`,
      channel_token: watch.token,
      channel_expires_at: new Date(NOW.getTime() + 7 * DAY).toISOString(),
    });
    expect(s.conn.channel_id).toBe(watch.id);
  });

  test('sets up a first channel without stopping anything', async () => {
    const s = setup();
    await ensureChannel(s.conn, s.g, s.repo, { config, now: NOW });

    expect(s.g.calls.map((c) => c.method)).toEqual(['watchEvents']);
    expect(s.state.connections[0].channel_id).toBeTruthy();
    expect(s.g.called('watchEvents')[0].args[1].token).toMatch(/^[\w-]{43}$/);
  });

  test('an error stopping the old channel is ignored', async () => {
    const s = setup({ conn: { ...live, channel_expires_at: new Date(NOW.getTime() - HOUR).toISOString() } });
    s.g.fail('stopChannel', new GoogleNotFound());
    await ensureChannel(s.conn, s.g, s.repo, { config, now: NOW });

    expect(s.g.called('watchEvents')).toHaveLength(1);
    expect(s.state.connections[0].channel_id).not.toBe('old-ch');
  });
});

describe('stopSync', () => {
  test('stops the channel and clears the channel fields', async () => {
    const s = setup({ conn: { channel_id: 'ch', channel_resource_id: 'res', channel_token: 'tok', channel_expires_at: STAMP } });
    await stopSync(s.conn, s.g, s.repo);

    expect(s.g.called('stopChannel')[0].args[0]).toEqual({ id: 'ch', resourceId: 'res' });
    expect(s.state.connections[0]).toMatchObject({ channel_id: null, channel_resource_id: null, channel_token: null, channel_expires_at: null });
  });

  test('ignores a stop error and still clears the fields', async () => {
    const s = setup({ conn: { channel_id: 'ch', channel_resource_id: 'res', channel_token: 'tok', channel_expires_at: STAMP } });
    s.g.fail('stopChannel', new GoogleApiError(500));
    await stopSync(s.conn, s.g, s.repo);
    expect(s.state.connections[0].channel_id).toBeNull();
  });

  test('with no channel it only clears', async () => {
    const s = setup();
    await stopSync(s.conn, s.g, s.repo);
    expect(s.g.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- withGoogle

describe('withGoogle', () => {
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const router = ({ token = reply(200, { access_token: 'access-1' }), api = reply(200, { items: [] }) } = {}) => (
    vi.fn(async (url) => (String(url) === TOKEN_URL ? token : api))
  );

  test('refreshes the decrypted token, hands fn a client using the new access token, and returns its value', async () => {
    const s = setup();
    const fetchImpl = router();
    const out = await withGoogle(s.conn, { repo: s.repo, config, fetchImpl }, async (client) => {
      await client.listEvents(CAL);
      return 42;
    });

    expect(out).toEqual({ ok: true, value: 42 });
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(tokenUrl).toBe(TOKEN_URL);
    const form = new URLSearchParams(tokenInit.body);
    expect(form.get('refresh_token')).toBe('refresh-secret');
    expect(form.get('client_id')).toBe('client-id');
    expect(form.get('client_secret')).toBe('client-secret');
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer access-1');
    expect(s.called('updateConnection')).toHaveLength(0);
  });

  test('turns invalid_grant into last_error reconnect without running fn', async () => {
    const s = setup();
    const fn = vi.fn();
    const fetchImpl = router({ token: reply(400, { error: 'invalid_grant' }) });
    const out = await withGoogle(s.conn, { repo: s.repo, config, fetchImpl }, fn);

    expect(out).toEqual({ ok: false, error: 'reconnect' });
    expect(fn).not.toHaveBeenCalled();
    expect(s.called('updateConnection').map((c) => c.args)).toEqual([[TUTOR, { last_error: 'reconnect' }]]);
  });

  test('a GoogleAuthError from fn also means reconnect', async () => {
    const s = setup();
    const out = await withGoogle(s.conn, { repo: s.repo, config, fetchImpl: router() }, async () => { throw new GoogleAuthError(); });

    expect(out).toEqual({ ok: false, error: 'reconnect' });
    expect(s.state.connections[0].last_error).toBe('reconnect');
  });

  test('any other error sets google_error and logs only the error name', async () => {
    const s = setup();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await withGoogle(s.conn, { repo: s.repo, config, fetchImpl: router() }, async () => { throw new GoogleApiError(500); });

    expect(out).toEqual({ ok: false, error: 'google_error' });
    expect(s.state.connections[0].last_error).toBe('google_error');
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('GoogleApiError');
    expect(logged).not.toMatch(/Google API error|refresh-secret|access-1|tutor@gmail/);
  });

  test('a token that cannot be decrypted is a google_error, not a crash', async () => {
    const s = setup({ conn: { refresh_token_enc: 'garbage' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await withGoogle(s.conn, { repo: s.repo, config, fetchImpl: router() }, vi.fn());
    expect(out).toEqual({ ok: false, error: 'google_error' });
  });
});

// ---------------------------------------------------------------- repo (stubbed query builder)

// A chainable stand-in for the supabase-js builder: it records every call made
// on it and resolves, when awaited, to whatever respond() returns.
function fakeDb(respond) {
  const log = [];
  return {
    log,
    from(table) {
      const entry = { table, ops: [] };
      log.push(entry);
      const builder = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') return (resolve, reject) => Promise.resolve(respond(entry)).then(resolve, reject);
          return (...args) => { entry.ops.push([prop, ...args]); return builder; };
        },
      });
      return builder;
    },
  };
}

const ok = (data) => ({ data, error: null });
const has = (entry, ...op) => expect(entry.ops).toContainEqual(op);

describe('createGoogleRepo', () => {
  afterEach(() => { vi.useRealTimers(); });

  test('every method throws "<name>: <message>" on a Supabase error', async () => {
    const repo = createGoogleRepo(fakeDb(() => ({ data: null, error: { message: 'boom' } })));
    await expect(repo.getConnection(TUTOR)).rejects.toThrow('getConnection: boom');
    await expect(repo.listSyncTutors()).rejects.toThrow('listSyncTutors: boom');
    await expect(repo.updateConnection(TUTOR, {})).rejects.toThrow('updateConnection: boom');
    await expect(repo.takeState('n', NOW)).rejects.toThrow('takeState: boom');
    await expect(repo.claimPull(TUTOR, NOW)).rejects.toThrow('claimPull: boom');
    await expect(repo.pendingSessions(TUTOR, 5)).rejects.toThrow('pendingSessions: boom');
    await expect(repo.updateSession(1, {})).rejects.toThrow('updateSession: boom');
    await expect(repo.insertSession({})).rejects.toThrow('insertSession: boom');
    await expect(repo.cancelRecurring(TUTOR, 'm1', NOW)).rejects.toThrow('cancelRecurring: boom');
    await expect(repo.markUpcomingPending({ tutorId: TUTOR, now: NOW })).rejects.toThrow('markUpcomingPending: boom');
    await expect(repo.linkedStudents(TUTOR)).rejects.toThrow('linkedStudents: boom');
  });

  test('getConnection returns the row, or null when there is none', async () => {
    const db = fakeDb(() => ok({ user_id: TUTOR }));
    expect(await createGoogleRepo(db).getConnection(TUTOR)).toEqual({ user_id: TUTOR });
    has(db.log[0], 'eq', 'user_id', TUTOR);
    expect(await createGoogleRepo(fakeDb(() => ok(null))).getConnection(TUTOR)).toBeNull();
    expect(await createGoogleRepo(fakeDb(() => ok(null))).getConnectionByChannel('ch')).toBeNull();
  });

  test('getConnectionByChannel looks the channel up', async () => {
    const db = fakeDb(() => ok({ user_id: TUTOR }));
    await createGoogleRepo(db).getConnectionByChannel('ch-1');
    expect(db.log[0].table).toBe('google_connections');
    has(db.log[0], 'eq', 'channel_id', 'ch-1');
  });

  test('listSyncTutors asks for sync-on tutors', async () => {
    const db = fakeDb(() => ok([{ user_id: TUTOR }]));
    expect(await createGoogleRepo(db).listSyncTutors()).toEqual([{ user_id: TUTOR }]);
    has(db.log[0], 'eq', 'purpose', 'tutor');
    has(db.log[0], 'eq', 'sync_enabled', true);
  });

  test('upsertConnection upserts on user_id, updateConnection and deleteConnection filter by user', async () => {
    const db = fakeDb(() => ok({ user_id: TUTOR }));
    const repo = createGoogleRepo(db);
    await repo.upsertConnection({ user_id: TUTOR, purpose: 'tutor' });
    await repo.updateConnection(TUTOR, { last_error: null });
    await repo.deleteConnection(TUTOR);

    has(db.log[0], 'upsert', { user_id: TUTOR, purpose: 'tutor' }, { onConflict: 'user_id' });
    has(db.log[1], 'update', { last_error: null });
    has(db.log[1], 'eq', 'user_id', TUTOR);
    expect(db.log[2].ops.map((o) => o[0])).toContain('delete');
    has(db.log[2], 'eq', 'user_id', TUTOR);
  });

  test('saveState inserts the row', async () => {
    const db = fakeDb(() => ok(null));
    const row = { nonce: 'n', user_id: TUTOR, purpose: 'tutor', verifier: 'v', return_to: '/portal/', expires_at: STAMP };
    await createGoogleRepo(db).saveState(row);
    expect(db.log[0].table).toBe('google_oauth_states');
    has(db.log[0], 'insert', row);
  });

  test('takeState deletes the row by nonce and returns it while it is fresh', async () => {
    const row = { nonce: 'n', user_id: TUTOR, expires_at: new Date(NOW.getTime() + 60_000).toISOString() };
    const db = fakeDb(() => ok(row));
    expect(await createGoogleRepo(db).takeState('n', NOW)).toEqual(row);
    expect(db.log[0].ops.map((o) => o[0])).toContain('delete');
    has(db.log[0], 'eq', 'nonce', 'n');
  });

  test('takeState returns null for an expired or missing state', async () => {
    const expired = { nonce: 'n', expires_at: new Date(NOW.getTime() - 1000).toISOString() };
    expect(await createGoogleRepo(fakeDb(() => ok(expired))).takeState('n', NOW)).toBeNull();
    expect(await createGoogleRepo(fakeDb(() => ok(null))).takeState('n', NOW)).toBeNull();
  });

  test('getProfile reads id, role, name and email', async () => {
    const db = fakeDb(() => ok({ id: MAYA, role: 'student', full_name: 'Maya Lee', email: 'm@x.test' }));
    expect(await createGoogleRepo(db).getProfile(MAYA)).toMatchObject({ id: MAYA, role: 'student' });
    expect(db.log[0].table).toBe('profiles');
    has(db.log[0], 'select', 'id, role, full_name, email');
    has(db.log[0], 'eq', 'id', MAYA);
  });

  test('pendingSessions filters by tutor, state and the last 30 days, oldest first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const db = fakeDb(() => ok([{ id: 1 }]));
    expect(await createGoogleRepo(db).pendingSessions(TUTOR, 50)).toEqual([{ id: 1 }]);
    const [entry] = db.log;
    expect(entry.table).toBe('sessions');
    has(entry, 'eq', 'tutor_id', TUTOR);
    has(entry, 'in', 'sync_state', ['pending', 'error']);
    has(entry, 'gt', 'starts_at', new Date(NOW.getTime() - 30 * DAY).toISOString());
    has(entry, 'order', 'starts_at', { ascending: true });
    has(entry, 'limit', 50);
  });

  test('tombstones lists a tutor\'s deletions and removeTombstone deletes by id', async () => {
    const db = fakeDb(() => ok([{ id: 7 }]));
    const repo = createGoogleRepo(db);
    expect(await repo.tombstones(TUTOR)).toEqual([{ id: 7 }]);
    await repo.removeTombstone(7);
    expect(db.log[0].table).toBe('google_deletions');
    has(db.log[0], 'eq', 'tutor_id', TUTOR);
    has(db.log[1], 'eq', 'id', 7);
    expect(db.log[1].ops.map((o) => o[0])).toContain('delete');
  });

  test('sessionById and sessionByEvent look a session up', async () => {
    const db = fakeDb(() => ok({ id: 5 }));
    const repo = createGoogleRepo(db);
    expect(await repo.sessionById('5')).toEqual({ id: 5 });
    await repo.sessionByEvent(CAL, 'ev1');
    has(db.log[0], 'eq', 'id', '5');
    has(db.log[1], 'eq', 'google_calendar_id', CAL);
    has(db.log[1], 'eq', 'google_event_id', 'ev1');
    expect(await createGoogleRepo(fakeDb(() => ok(null))).sessionByEvent(CAL, 'x')).toBeNull();
  });

  test('updateSession updates by id and returns the row; insertSession returns the id', async () => {
    const db = fakeDb((entry) => ok(entry.ops.some((o) => o[0] === 'update') ? { id: 5, sync_state: 'synced' } : { id: 9 }));
    const repo = createGoogleRepo(db);
    expect(await repo.updateSession(5, { sync_state: 'synced' })).toEqual({ id: 5, sync_state: 'synced' });
    expect(await repo.insertSession({ subject: 'x' })).toEqual({ id: 9 });
    has(db.log[0], 'update', { sync_state: 'synced' });
    has(db.log[0], 'eq', 'id', 5);
    has(db.log[1], 'insert', { subject: 'x' });
  });

  test('updateSession with ifUpdatedAt only touches a row that still has that updated_at, and gives null when none matched', async () => {
    const db = fakeDb(() => ok(null));
    const repo = createGoogleRepo(db);
    expect(await repo.updateSession(5, { sync_state: 'synced' }, { ifUpdatedAt: '2026-10-02T11:00:00+00:00' })).toBeNull();
    await repo.updateSession(5, { sync_state: 'synced' });

    has(db.log[0], 'eq', 'id', 5);
    has(db.log[0], 'eq', 'updated_at', '2026-10-02T11:00:00+00:00');
    expect(db.log[0].ops.map((o) => o[0])).toEqual(['update', 'eq', 'eq', 'select', 'maybeSingle']);
    expect(db.log[1].ops.some((o) => o[1] === 'updated_at')).toBe(false);
  });

  test('cancelRecurring cancels the tutor\'s unfinished, not yet cancelled sessions of a series and counts them', async () => {
    const db = fakeDb(() => ok([{ id: 1 }, { id: 2 }]));
    expect(await createGoogleRepo(db).cancelRecurring(TUTOR, 'm1', NOW)).toBe(2);
    const [entry] = db.log;
    expect(entry.table).toBe('sessions');
    has(entry, 'update', { status: 'cancelled', sync_state: 'synced', google_synced_at: STAMP });
    has(entry, 'eq', 'tutor_id', TUTOR);
    has(entry, 'eq', 'google_recurring_id', 'm1');
    has(entry, 'gt', 'ends_at', STAMP);
    has(entry, 'neq', 'status', 'cancelled');
    expect(await createGoogleRepo(fakeDb(() => ok([]))).cancelRecurring(TUTOR, 'm1', NOW)).toBe(0);
  });

  test('linkedStudents joins the links, the profiles and the students\' Google addresses', async () => {
    const db = fakeDb((entry) => ok({
      tutor_students: [{ student_id: MAYA }, { student_id: BEN }],
      profiles: [
        { id: MAYA, full_name: 'Maya Lee', email: 'maya@school.test' },
        { id: BEN, full_name: 'Ben Ng', email: 'ben@school.test' },
      ],
      google_connections: [{ user_id: MAYA, google_email: 'maya@gmail.test' }],
    }[entry.table]));
    expect(await createGoogleRepo(db).linkedStudents(TUTOR)).toEqual([
      { id: MAYA, full_name: 'Maya Lee', email: 'maya@school.test', google_email: 'maya@gmail.test' },
      { id: BEN, full_name: 'Ben Ng', email: 'ben@school.test', google_email: null },
    ]);
    const conns = db.log.find((e) => e.table === 'google_connections');
    has(conns, 'eq', 'purpose', 'student');
    has(conns, 'in', 'user_id', [MAYA, BEN]);
  });

  test('linkedStudents is empty, with no further queries, when the tutor has no students', async () => {
    const db = fakeDb(() => ok([]));
    expect(await createGoogleRepo(db).linkedStudents(TUTOR)).toEqual([]);
    expect(db.log).toHaveLength(1);
  });

  test('studentGoogleEmail returns the address or null', async () => {
    const db = fakeDb(() => ok({ google_email: 'maya@gmail.test' }));
    expect(await createGoogleRepo(db).studentGoogleEmail(MAYA)).toBe('maya@gmail.test');
    has(db.log[0], 'eq', 'purpose', 'student');
    expect(await createGoogleRepo(fakeDb(() => ok(null))).studentGoogleEmail(MAYA)).toBeNull();
  });

  test('tutorsWithSyncFor returns the sync-on connections of the student\'s tutors', async () => {
    const db = fakeDb((entry) => ok(entry.table === 'tutor_students'
      ? [{ tutor_id: TUTOR }, { tutor_id: OTHER_TUTOR }]
      : [{ user_id: TUTOR, purpose: 'tutor' }]));
    expect(await createGoogleRepo(db).tutorsWithSyncFor(MAYA)).toEqual([{ user_id: TUTOR, purpose: 'tutor' }]);
    has(db.log[0], 'eq', 'student_id', MAYA);
    has(db.log[1], 'in', 'user_id', [TUTOR, OTHER_TUTOR]);
    has(db.log[1], 'eq', 'purpose', 'tutor');
    has(db.log[1], 'eq', 'sync_enabled', true);
  });

  test('tutorsWithSyncFor is empty, with no second query, for a student without tutors', async () => {
    const db = fakeDb(() => ok([]));
    expect(await createGoogleRepo(db).tutorsWithSyncFor(MAYA)).toEqual([]);
    expect(db.log).toHaveLength(1);
  });

  test('markUpcomingPending marks scheduled sessions after now, filtered by tutor and/or student', async () => {
    const db = fakeDb(() => ok(null));
    const repo = createGoogleRepo(db);
    await repo.markUpcomingPending({ tutorId: TUTOR, now: NOW });
    await repo.markUpcomingPending({ studentId: MAYA, now: NOW });
    await repo.markUpcomingPending({ tutorId: TUTOR, studentId: MAYA, now: NOW });

    for (const entry of db.log) {
      expect(entry.table).toBe('sessions');
      has(entry, 'update', { sync_state: 'pending' });
      has(entry, 'eq', 'status', 'scheduled');
      has(entry, 'gt', 'starts_at', STAMP);
    }
    const eqs = (entry) => entry.ops.filter((o) => o[0] === 'eq' && o[1] !== 'status').map((o) => o[1]);
    expect(eqs(db.log[0])).toEqual(['tutor_id']);
    expect(eqs(db.log[1])).toEqual(['student_id']);
    expect(eqs(db.log[2])).toEqual(['tutor_id', 'student_id']);
  });

  test('markUpcomingPending refuses to run without a tutor or a student', async () => {
    const db = fakeDb(() => ok(null));
    await expect(createGoogleRepo(db).markUpcomingPending({ now: NOW })).rejects.toThrow('markUpcomingPending');
    expect(db.log).toHaveLength(0);
  });

  test('claimPull is true when a row came back, false when the lock is held', async () => {
    const db = fakeDb(() => ok([{ user_id: TUTOR }]));
    expect(await createGoogleRepo(db).claimPull(TUTOR, NOW)).toBe(true);
    const [entry] = db.log;
    has(entry, 'update', { pull_started_at: STAMP });
    has(entry, 'eq', 'user_id', TUTOR);
    has(entry, 'or', `pull_started_at.is.null,pull_started_at.lt.${new Date(NOW.getTime() - 60_000).toISOString()}`);
    expect(entry.ops.map((o) => o[0])).toContain('select');
    expect(await createGoogleRepo(fakeDb(() => ok([]))).claimPull(TUTOR, NOW)).toBe(false);
  });
});
