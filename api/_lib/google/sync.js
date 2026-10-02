// The Google Calendar sync engine for one tutor: token handling, the calendar
// and its change channel, and the push (portal to Google) and pull (Google to
// portal) passes. `repo` is createGoogleRepo(db); `google` is a calendarClient.
// Writes go through the service role, so the pending trigger does not mark them.
import { randomBytes, randomUUID } from 'node:crypto';
import { calendarClient, GoogleNotFound, GoogleGone, GoogleRateError } from './calendar.js';
import { GoogleAuthError, refreshAccess } from './oauth.js';
import { decrypt } from './crypto.js';
import { CALENDAR_NAME, TIME_ZONE, CHANNEL_TTL_SECONDS, RENEW_WITHIN_MS } from './config.js';
import { sessionToEvent, eventToSessionFields, matchStudent, resolveConflict } from './mapping.js';

const DAY_MS = 24 * 3600 * 1000;
const MAX_SESSION_MS = 8 * 3600 * 1000; // the sessions table refuses anything longer
const PUSH_BATCH = 50;
const INSTANCES_BACK_MS = 56 * DAY_MS;
const INSTANCES_AHEAD_MS = 182 * DAY_MS;
const TIME_KEYS = new Set(['starts_at', 'ends_at']);

const https = (url) => (typeof url === 'string' && /^https:\/\//.test(url) ? url : null);

// Runs fn(calendarClient) with a fresh access token for the connection.
// Records last_error ('reconnect' or 'google_error') on failure; only error
// names are logged, never tokens, addresses or event text.
export async function withGoogle(conn, { repo, config, fetchImpl }, fn) {
  try {
    const refreshToken = decrypt(conn.refresh_token_enc, config.tokenKey);
    const { access_token: access } = await refreshAccess({
      refreshToken, clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl,
    });
    if (!access) throw new Error('Google sent no access token');
    return { ok: true, value: await fn(calendarClient(access, { fetchImpl })) };
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await repo.updateConnection(conn.user_id, { last_error: 'reconnect' });
      return { ok: false, error: 'reconnect' };
    }
    console.error('Google sync failed:', error?.name ?? 'Error');
    await repo.updateConnection(conn.user_id, { last_error: 'google_error' });
    return { ok: false, error: 'google_error' };
  }
}

// Saves what it changed on conn as well, so later steps in the same run see it
async function saveConnection(conn, repo, fields) {
  await repo.updateConnection(conn.user_id, fields);
  Object.assign(conn, fields);
}

export async function ensureCalendar(conn, google, repo) {
  if (conn.calendar_id) return conn.calendar_id;
  const calendar = await google.insertCalendar({ summary: CALENDAR_NAME, timeZone: TIME_ZONE });
  await saveConnection(conn, repo, { calendar_id: calendar.id });
  return calendar.id;
}

async function stopQuietly(conn, google) {
  if (!conn.channel_id) return;
  try {
    await google.stopChannel({ id: conn.channel_id, resourceId: conn.channel_resource_id });
  } catch {
    // the channel may already be gone or expired; either way it is no use to us
  }
}

// Keeps a change channel alive: returns false when the current one has more
// than RENEW_WITHIN_MS left, otherwise replaces it and returns true.
export async function ensureChannel(conn, google, repo, { config, now = new Date(), random = randomBytes }) {
  const expires = conn.channel_expires_at ? new Date(conn.channel_expires_at).getTime() : 0;
  if (expires - now.getTime() > RENEW_WITHIN_MS) return false;

  await stopQuietly(conn, google);
  const id = randomUUID();
  const token = Buffer.from(random(32)).toString('base64url');
  const watch = await google.watchEvents(conn.calendar_id, {
    id, token, address: config.notifyUrl, ttlSeconds: CHANNEL_TTL_SECONDS,
  });
  const expiration = Number(watch.expiration);
  await saveConnection(conn, repo, {
    channel_id: id,
    channel_resource_id: watch.resourceId,
    channel_token: token,
    channel_expires_at: new Date(Number.isFinite(expiration) ? expiration : now.getTime() + CHANNEL_TTL_SECONDS * 1000).toISOString(),
  });
  return true;
}

export async function stopSync(conn, google, repo) {
  await stopQuietly(conn, google);
  await saveConnection(conn, repo, { channel_id: null, channel_resource_id: null, channel_token: null, channel_expires_at: null });
}

// ---------------------------------------------------------------- push

// What a failed Google call means for the loop: auth problems end the whole
// run (withGoogle reports them), a rate limit stops it, anything else is one failure
function outcome(error) {
  if (error instanceof GoogleAuthError) throw error;
  return error instanceof GoogleRateError ? 'stop' : 'fail';
}

async function pushRow(row, conn, google, { repo, config, stamp, result }) {
  const calendarId = row.google_calendar_id ?? conn.calendar_id;

  if (row.status === 'cancelled') {
    if (row.google_event_id) {
      await google.deleteEvent(calendarId, row.google_event_id);
      await repo.updateSession(row.id, { google_event_id: null, google_link: null, sync_state: 'synced', google_synced_at: stamp });
      result.deleted += 1;
    } else {
      await repo.updateSession(row.id, { sync_state: 'synced', google_synced_at: stamp });
    }
    return;
  }

  const [student, studentEmail] = await Promise.all([repo.getProfile(row.student_id), repo.studentGoogleEmail(row.student_id)]);
  const body = sessionToEvent(row, { studentName: student?.full_name, studentEmail, portalUrl: config.portalUrl });

  let ev = null;
  let savedCalendar = calendarId;
  if (row.google_event_id) {
    try {
      ev = await google.patchEvent(calendarId, row.google_event_id, body);
    } catch (error) {
      if (!(error instanceof GoogleNotFound)) throw error; // an event someone deleted is inserted again
    }
  }
  if (!ev) {
    ev = await google.insertEvent(conn.calendar_id, body);
    savedCalendar = conn.calendar_id;
  }
  await repo.updateSession(row.id, {
    google_event_id: ev.id,
    google_calendar_id: savedCalendar,
    google_link: https(ev.htmlLink),
    sync_state: 'synced',
    google_synced_at: stamp,
  });
  result.pushed += 1;
}

export async function pushPending(conn, google, { repo, config, now = new Date() }) {
  const result = { pushed: 0, deleted: 0, failed: 0, stopped: false };
  const stamp = now.toISOString();
  conn.calendar_id = await ensureCalendar(conn, google, repo); // an insert needs a calendar

  for (const t of await repo.tombstones(conn.user_id)) {
    try {
      await google.deleteEvent(t.calendar_id, t.event_id);
      await repo.removeTombstone(t.id);
      result.deleted += 1;
    } catch (error) {
      if (outcome(error) === 'stop') { result.stopped = true; return result; }
      result.failed += 1; // the tombstone stays and is tried again next run
    }
  }

  for (const row of await repo.pendingSessions(conn.user_id, PUSH_BATCH)) {
    try {
      await pushRow(row, conn, google, { repo, config, stamp, result });
    } catch (error) {
      if (outcome(error) === 'stop') { result.stopped = true; break; } // this row and the rest stay pending
      await repo.updateSession(row.id, { sync_state: 'error' });
      result.failed += 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------- pull

// Every item of a list call, following pages; a 410 on the sync token drops it
// and lists everything once from scratch
async function listChanges(google, conn) {
  const run = async (syncToken) => {
    const items = [];
    let pageToken;
    let nextSyncToken;
    do {
      const query = syncToken
        ? { syncToken, singleEvents: false, showDeleted: true }
        : { singleEvents: false, showDeleted: true, maxResults: 250 };
      if (pageToken) query.pageToken = pageToken;
      const page = await google.listEvents(conn.calendar_id, query);
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { items, nextSyncToken };
  };
  try {
    return await run(conn.sync_token);
  } catch (error) {
    if (!(error instanceof GoogleGone) || !conn.sync_token) throw error;
    conn.sync_token = null;
    return run(null);
  }
}

// The instances of a recurring master around now. A master deleted since it was
// listed has no instances to give (404 or 410), which is not a failure.
async function listAllInstances(google, calendarId, masterId, now) {
  const items = [];
  let pageToken;
  try {
    do {
      const query = {
        timeMin: new Date(now.getTime() - INSTANCES_BACK_MS).toISOString(),
        timeMax: new Date(now.getTime() + INSTANCES_AHEAD_MS).toISOString(),
        showDeleted: true,
      };
      if (pageToken) query.pageToken = pageToken;
      const page = await google.listInstances(calendarId, masterId, query);
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (error) {
    if (error instanceof GoogleNotFound || error instanceof GoogleGone) return [];
    throw error;
  }
  return items;
}

// Times arrive as '+00:00' from the database and as 'Z' from Google
function sameValue(key, a, b) {
  if (TIME_KEYS.has(key)) return Date.parse(a) === Date.parse(b);
  return (a ?? null) === (b ?? null);
}

async function findRow(repo, conn, e) {
  const portalId = e.extendedProperties?.private?.vpSessionId;
  if (portalId && /^\d{1,15}$/.test(String(portalId))) {
    const row = await repo.sessionById(portalId);
    if (row && row.tutor_id === conn.user_id) return row;
  }
  return repo.sessionByEvent(conn.calendar_id, e.id);
}

async function applyEvent(ctx, e, recurringId) {
  const { conn, repo, stamp, result } = ctx;
  const skip = () => { result.skipped += 1; };

  const fields = eventToSessionFields(e);
  if (!fields) return skip(); // all-day or timeless

  const row = await findRow(repo, conn, e);

  if (row) {
    // The row is bound to another event: this one is a stale or copied event
    if (row.google_event_id && row.google_event_id !== e.id) return skip();
    // Changed in the portal after the event: the next push wins
    if (resolveConflict(row, e) === 'portal') return skip();

    if (fields.status === 'cancelled') {
      if (row.status === 'cancelled') return skip();
      await repo.updateSession(row.id, { status: 'cancelled', sync_state: 'synced', google_synced_at: stamp });
      result.cancelled += 1;
      return;
    }

    const next = {
      ...fields,
      google_event_id: e.id,
      google_calendar_id: conn.calendar_id,
      google_recurring_id: recurringId,
      sync_state: 'synced',
    };
    const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => !sameValue(key, row[key], value)));
    if (!Object.keys(changes).length) return skip();
    await repo.updateSession(row.id, { ...changes, google_synced_at: stamp });
    result.updated += 1;
    return;
  }

  if (fields.status === 'cancelled') return skip();
  // An event the portal wrote belongs to its session; if that session is gone
  // (deleted, or another tutor's) the event is never turned into a new one
  if (e.extendedProperties?.private?.vpSessionId) return skip();
  const length = Date.parse(fields.ends_at) - Date.parse(fields.starts_at);
  if (!(length > 0 && length <= MAX_SESSION_MS)) return skip();

  ctx.students ??= await repo.linkedStudents(conn.user_id);
  const student = matchStudent(e, ctx.students);
  if (!student) return skip();

  await repo.insertSession({
    student_id: student.id,
    tutor_id: conn.user_id,
    ...fields,
    google_event_id: e.id,
    google_calendar_id: conn.calendar_id,
    google_recurring_id: recurringId,
    sync_state: 'synced',
    google_synced_at: stamp,
  });
  result.inserted += 1;
}

// Applies Google's changes since the stored sync token. Returns { skipped: true }
// when another pull holds the lock; otherwise counts, where `skipped` is the
// number of events left alone.
export async function pullChanges(conn, google, { repo, now = new Date() }) {
  if (!(await repo.claimPull(conn.user_id, now))) return { skipped: true };

  const result = { updated: 0, inserted: 0, cancelled: 0, skipped: 0 };
  const ctx = { conn, repo, stamp: now.toISOString(), result, students: null };
  try {
    const { items, nextSyncToken } = await listChanges(google, conn);
    for (const e of items) {
      if (e.recurrence) {
        for (const instance of await listAllInstances(google, conn.calendar_id, e.id, now)) {
          await applyEvent(ctx, instance, e.id);
        }
      } else {
        await applyEvent(ctx, e, e.recurringEventId ?? null);
      }
    }
    await repo.updateConnection(conn.user_id, {
      sync_token: nextSyncToken ?? conn.sync_token ?? null,
      last_synced_at: ctx.stamp,
      last_error: null,
      pull_started_at: null,
    });
  } catch (error) {
    // Let the next pull in at once; the sync token did not move, so nothing is lost
    await repo.updateConnection(conn.user_id, { pull_started_at: null }).catch(() => {});
    throw error;
  }
  return result;
}
