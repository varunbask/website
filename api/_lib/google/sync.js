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

const NO_CHANNEL = { channel_id: null, channel_resource_id: null, channel_token: null, channel_expires_at: null };

// Google answered 404 for the connection's own VP calendar: it was deleted there. Forget it, its
// sync token and its channel, and queue the tutor's upcoming sessions, so the next run makes a new
// calendar (ensureCalendar) and sends them again. That is not a failure to show the tutor.
async function calendarGone(conn, repo, now) {
  await saveConnection(conn, repo, { calendar_id: null, sync_token: null, ...NO_CHANNEL });
  await repo.markUpcomingPending({ tutorId: conn.user_id, now });
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
  let watch;
  try {
    watch = await google.watchEvents(conn.calendar_id, {
      id, token, address: config.notifyUrl, ttlSeconds: CHANNEL_TTL_SECONDS,
    });
  } catch (error) {
    if (!(error instanceof GoogleNotFound)) throw error;
    await calendarGone(conn, repo, now);
    return false;
  }
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
  await saveConnection(conn, repo, NO_CHANNEL);
}

// ---------------------------------------------------------------- push

// What a failed Google call means for the loop: auth problems end the whole
// run (withGoogle reports them), a rate limit stops it, anything else is one failure
function outcome(error) {
  if (error instanceof GoogleAuthError) throw error;
  return error instanceof GoogleRateError ? 'stop' : 'fail';
}

// An update that applies only while the row still has the updated_at it was read with;
// false when it changed meanwhile
async function writeIfUnchanged(repo, row, fields) {
  return Boolean(await repo.updateSession(row.id, fields, { ifUpdatedAt: row.updated_at }));
}

// Marks a pushed row synced only if the portal has not changed it since it was
// read (compare-and-set on updated_at). If it changed meanwhile, the row stays
// pending for the next push, which sends the newer edit; `kept` is what Google
// now holds for it (event id, calendar, link, etag) and is saved regardless.
async function settle(repo, row, synced, kept) {
  const done = await writeIfUnchanged(repo, row, synced);
  if (!done && kept) await repo.updateSession(row.id, kept);
}

async function patchIfThere(google, calendarId, eventId, body) {
  try {
    return await google.patchEvent(calendarId, eventId, body);
  } catch (error) {
    // Deleted in Google (404 or 410): the caller inserts again
    if (error instanceof GoogleNotFound || error instanceof GoogleGone) return null;
    throw error;
  }
}

// Best effort: an event in a calendar the connection no longer uses may be gone along with it
async function deleteQuietly(google, calendarId, eventId) {
  try {
    await google.deleteEvent(calendarId, eventId);
  } catch {
    // nothing more to do for an event nobody will look at
  }
}

async function pushRow(row, conn, google, { repo, config, stamp, result }) {
  // A row bound to another calendar than the connection's (the VP calendar was deleted or replaced)
  // is not bound at all: its old event is dropped if it can be, and the row goes into the current calendar
  const moved = Boolean(row.google_calendar_id && row.google_calendar_id !== conn.calendar_id);
  const calendarId = row.google_calendar_id ?? conn.calendar_id;

  if (row.status === 'cancelled') {
    if (row.google_event_id) {
      if (moved) await deleteQuietly(google, calendarId, row.google_event_id);
      else await google.deleteEvent(calendarId, row.google_event_id);
      const cleared = { google_event_id: null, google_link: null, google_etag: null };
      await settle(repo, row, { ...cleared, sync_state: 'synced', google_synced_at: stamp }, cleared);
      result.deleted += 1;
    } else {
      await settle(repo, row, { sync_state: 'synced', google_synced_at: stamp }, null);
    }
    return;
  }

  const [student, studentEmail] = await Promise.all([repo.getProfile(row.student_id), repo.studentGoogleEmail(row.student_id)]);
  const body = sessionToEvent(row, { studentName: student?.full_name, studentEmail, portalUrl: config.portalUrl });

  if (moved && row.google_event_id) await deleteQuietly(google, calendarId, row.google_event_id);
  let ev = null;
  let savedCalendar = calendarId;
  if (row.google_event_id && !moved) {
    ev = await patchIfThere(google, calendarId, row.google_event_id, body);
  } else {
    // An earlier insert may have reached Google without its id being saved: bind that event instead of adding a twin
    const found = await google.listEvents(conn.calendar_id, {
      privateExtendedProperty: `vpSessionId=${row.id}`, maxResults: 1, showDeleted: false,
    });
    const tagged = found?.items?.[0];
    if (tagged) ev = await patchIfThere(google, conn.calendar_id, tagged.id, body);
    savedCalendar = conn.calendar_id;
  }
  if (!ev) {
    ev = await google.insertEvent(conn.calendar_id, body);
    savedCalendar = conn.calendar_id;
  }
  const kept = { google_event_id: ev.id, google_calendar_id: savedCalendar, google_link: https(ev.htmlLink), google_etag: ev.etag ?? null };
  await settle(repo, row, { ...kept, sync_state: 'synced', google_synced_at: stamp }, kept);
  result.pushed += 1;
}

// Only one push runs per tutor at a time (the push lock on the connection, which
// a crashed run leaves behind for at most a minute). Overlapping pushes would
// each insert an event for the same row. A second caller gets { busy: true }
// and does nothing; the rows it would have sent are sent by the run in progress
// or the next one. The calendar is made under the same lock.
export async function pushPending(conn, google, { repo, config, now = new Date() }) {
  if (!(await repo.claimPush(conn.user_id, now))) return { busy: true, pushed: 0, deleted: 0, failed: 0, stopped: false };
  try {
    return await pushLocked(conn, google, { repo, config, now });
  } finally {
    // A release that fails only costs the minute the lock lasts; it must not hide what ended the run
    await repo.updateConnection(conn.user_id, { push_started_at: null })
      .catch((error) => console.error('Google push unlock failed:', error?.name ?? 'Error'));
  }
}

async function pushLocked(conn, google, { repo, config, now }) {
  const result = { pushed: 0, deleted: 0, failed: 0, stopped: false };
  const stamp = now.toISOString();
  try {
    if (!conn.calendar_id) {
      // Another run may have made the calendar since this connection was read
      const latest = await repo.getConnection(conn.user_id);
      if (latest?.calendar_id) conn.calendar_id = latest.calendar_id;
    }
    conn.calendar_id = await ensureCalendar(conn, google, repo); // an insert needs a calendar
  } catch (error) {
    if (!(error instanceof GoogleRateError)) throw error;
    result.stopped = true; // rate limited before anything was sent: try again next run
    return result;
  }

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

  for (const row of await repo.pendingSessions(conn.user_id, PUSH_BATCH, now)) {
    try {
      await pushRow(row, conn, google, { repo, config, stamp, result });
    } catch (error) {
      if (error instanceof GoogleNotFound) { // an event cannot be put into the VP calendar because it is gone
        await calendarGone(conn, repo, now);
        result.stopped = true;
        break;
      }
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

// The window of instances read for a recurring master: around now
function instanceWindow(now) {
  return { from: new Date(now.getTime() - INSTANCES_BACK_MS).toISOString(), to: new Date(now.getTime() + INSTANCES_AHEAD_MS).toISOString() };
}

// The instances of a recurring master in the window, or null when the master is
// gone (404 or 410): its series was deleted in Google.
async function listAllInstances(google, calendarId, masterId, window) {
  const items = [];
  let pageToken;
  try {
    do {
      const query = { timeMin: window.from, timeMax: window.to, showDeleted: true };
      if (pageToken) query.pageToken = pageToken;
      const page = await google.listInstances(calendarId, masterId, query);
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (error) {
    if (error instanceof GoogleNotFound || error instanceof GoogleGone) return null;
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

// A series deleted in Google: its upcoming sessions are cancelled in the portal
async function cancelSeries(ctx, recurringId) {
  const count = await ctx.repo.cancelRecurring(ctx.conn.user_id, recurringId, ctx.now);
  if (count) ctx.result.cancelled += count;
  else ctx.result.skipped += 1;
}

// A series edited in Google: the rows of it in the window whose events Google no longer lists
// (the edit gave its instances new ids) are cancelled, so each week keeps one row
async function cancelStaleInstances(ctx, masterId, instances, window) {
  ctx.result.cancelled += await ctx.repo.cancelMissingInstances(
    ctx.conn.user_id, masterId, instances.map((i) => i.id), window.from, window.to, ctx.now,
  );
}

// One event that cannot be applied (a database error, say) is counted as skipped and
// logged by name and id only; the rest of the pull goes on. Auth and rate-limit
// errors still end the pull.
async function isolated(ctx, e, work) {
  try {
    await work();
  } catch (error) {
    if (error instanceof GoogleAuthError || error instanceof GoogleRateError) throw error;
    const sessionId = e.extendedProperties?.private?.vpSessionId;
    console.error('Google pull event failed:', error?.name ?? 'Error', 'event', e.id, ...(sessionId ? ['session', sessionId] : []));
    ctx.result.skipped += 1;
  }
}

async function applyEvent(ctx, e, recurringId) {
  const { conn, repo, stamp, result } = ctx;
  const skip = () => { result.skipped += 1; };

  const fields = eventToSessionFields(e);
  if (!fields) return skip(); // all-day or timeless
  if (fields.status !== 'cancelled') {
    // The sessions table refuses a length outside (0, 8 hours]; one such event, for a new session
    // or an existing one, must not make every pull fail on it
    const length = Date.parse(fields.ends_at) - Date.parse(fields.starts_at);
    if (!(length > 0 && length <= MAX_SESSION_MS)) return skip();
  }

  const row = await findRow(repo, conn, e);

  if (row) {
    // The row is bound to another event: this one is a stale or copied event
    if (row.google_event_id && row.google_event_id !== e.id) return skip();
    // The event is the version our own push left (its echo): there is nothing in it we do not already have
    if (row.google_etag && e.etag === row.google_etag) return skip();
    // Changed in the portal after the event: the next push wins
    if (resolveConflict(row, e) === 'portal') return skip();

    if (fields.status === 'cancelled') {
      if (row.status === 'cancelled') return skip();
      if (!(await writeIfUnchanged(repo, row, { status: 'cancelled', sync_state: 'synced', google_synced_at: stamp }))) return skip();
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
    if (!(await writeIfUnchanged(repo, row, { ...changes, google_synced_at: stamp }))) return skip(); // changed since it was read: the next pull or push reconciles
    result.updated += 1;
    return;
  }

  if (fields.status === 'cancelled') {
    // A series deleted in Google can arrive as a bare cancelled master, whose id the portal rows carry
    if (!e.recurringEventId) return cancelSeries(ctx, e.id);
    return skip();
  }
  // An event the portal wrote belongs to its session; if that session is gone
  // (deleted, or another tutor's) the event is never turned into a new one
  if (e.extendedProperties?.private?.vpSessionId) return skip();

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

// Applies Google's changes since the stored sync token. Returns { busy: true }
// when another pull holds the lock; otherwise counts, where `skipped` is the
// number of events left alone.
export async function pullChanges(conn, google, { repo, now = new Date() }) {
  const result = { updated: 0, inserted: 0, cancelled: 0, skipped: 0 };
  if (!conn.calendar_id) return result; // no calendar yet, nothing to pull
  if (!(await repo.claimPull(conn.user_id, now))) return { busy: true };

  const ctx = { conn, repo, now, stamp: now.toISOString(), result, students: null };
  try {
    const { items, nextSyncToken } = await listChanges(google, conn);
    for (const e of items) {
      if (e.recurrence) {
        const window = instanceWindow(now);
        const instances = e.status === 'cancelled' ? null : await listAllInstances(google, conn.calendar_id, e.id, window);
        if (instances === null) {
          await isolated(ctx, e, () => cancelSeries(ctx, e.id));
        } else {
          for (const instance of instances) await isolated(ctx, instance, () => applyEvent(ctx, instance, e.id));
          await isolated(ctx, e, () => cancelStaleInstances(ctx, e.id, instances, window));
        }
      } else {
        await isolated(ctx, e, () => applyEvent(ctx, e, e.recurringEventId ?? null));
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
    if (error instanceof GoogleNotFound) { // the list call found no VP calendar: see calendarGone
      await calendarGone(conn, repo, now);
      return result;
    }
    throw error;
  }
  return result;
}
