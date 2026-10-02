// Pure helpers for the Google Calendar sync screens: the status words, personal
// events as week-grid blocks, the hash a Google round trip comes back with, and
// clash lines for the session form. No DOM and no network (google.js does that).
//
// A personal event from the server: { id, title, start, end, all_day }. Timed
// ones carry ISO instants with an offset; all-day ones carry 'YYYY-MM-DD' dates
// and Google's exclusive end date. Times are read and shown in the business
// zone (dates.js), so a week that crosses a daylight-saving change still lines up.

import { relativeTime, addDays, parseKey, zonedIso, dayKey } from './dates.js';
import { timeRange, shortDayText } from './sessions-model.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_CLASH_LINES = 4;

const ms = (iso) => Date.parse(iso);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// ---------------------------------------------------------------------------
// Status

// "Just now" and "Yesterday" read as part of a sentence in lower case; a date
// ("Oct 3") and "5 minutes ago" already do
function afterVerb(text) {
  return text === 'Just now' || text === 'Yesterday' ? text.toLowerCase() : text;
}

// The words beside the tutor's switch
//   Off | Reconnect needed | Sync paused, retrying | Synced 5 minutes ago | Synced Oct 3
export function syncStatusText(status, now = new Date()) {
  if (!status?.connected || !status.sync_enabled) return 'Off';
  if (status.last_error === 'reconnect') return 'Reconnect needed';
  if (status.last_error === 'google_error') return 'Sync paused, retrying';
  if (!status.last_synced_at) return 'Not synced yet';
  return `Synced ${afterVerb(relativeTime(status.last_synced_at, now).text)}`;
}

// A status that says nothing is connected
export const OFF_STATUS = Object.freeze({
  connected: false, purpose: null, google_email: null, sync_enabled: false, last_synced_at: null, last_error: null,
});

// The status the screens use, from what my_google_connection returns (zero or
// one row, as an array or as the row itself) or from a status endpoint's body:
// { connected, purpose, google_email, sync_enabled, last_synced_at, last_error }
export function normalizeStatus(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return { ...OFF_STATUS };
  return {
    connected: row.connected !== false,
    purpose: row.purpose ?? null,
    google_email: row.google_email ?? null,
    sync_enabled: Boolean(row.sync_enabled),
    last_synced_at: row.last_synced_at ?? null,
    last_error: row.last_error ?? null,
  };
}

// The server's own error sentence, if it is short and plain enough to show as
// it is; otherwise null
export function safeErrorText(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  return t && t.length <= 200 && !/[\r\n<>]/.test(t) ? t : null;
}

// What a connected student sees where the "Get Google Calendar invites" button was
export function inviteText(email) {
  return blank(email) ? 'Google Calendar invites are on' : `Invites go to ${String(email).trim()}`;
}

// ---------------------------------------------------------------------------
// Personal events

// The instants to ask Google for when showing a week: Pacific midnight at the
// start of the week to Pacific midnight a week later (never more than 42 days)
export function weekRange(weekKey) {
  return { from: zonedIso(weekKey, '00:00'), to: zonedIso(addDays(weekKey, 7), '00:00') };
}

// The same for one Pacific day (the session form's clash check)
export function dayRange(key) {
  return { from: zonedIso(key, '00:00'), to: zonedIso(addDays(key, 1), '00:00') };
}

const isAllDay = (e) => e.all_day === true || DATE_ONLY.test(String(e.start ?? ''));

// { timed, allDay }
//   timed   [{ id: 'g:<id>', starts_at, ends_at, personal: true, title }], in time
//           order; layoutDay lays them out beside the sessions
//   allDay  [{ id: 'g:<id>', title, personal: true, first, last }], first and last
//           being the Pacific days it covers (Google's end date is exclusive)
// An event that cannot be placed is left out.
export function personalBlocks(events) {
  const timed = [];
  const allDay = [];
  for (const e of events ?? []) {
    if (!e || blank(e.id)) continue;
    const id = `g:${e.id}`;
    const title = blank(e.title) ? 'Busy' : String(e.title).trim();
    if (isAllDay(e)) {
      if (!DATE_ONLY.test(String(e.start ?? ''))) continue;
      const first = String(e.start);
      const end = DATE_ONLY.test(String(e.end ?? '')) ? String(e.end) : null;
      const last = end && addDays(end, -1) > first ? addDays(end, -1) : first;
      allDay.push({ id, title, personal: true, first, last });
      continue;
    }
    const start = ms(e.start);
    const end = ms(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    timed.push({ id, starts_at: e.start, ends_at: e.end, personal: true, title });
  }
  timed.sort((a, b) => (ms(a.starts_at) - ms(b.starts_at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { timed, allDay };
}

// The all-day events that cover a day key
export function allDayOn(allDay, key) {
  return (allDay ?? []).filter((e) => e.first <= key && key <= e.last);
}

function dayWords(key) {
  const { m, d } = parseKey(key);
  return `${MONTHS[m - 1]} ${d}`;
}

// "Personal: Dentist, 3:00 to 4:00 pm" or "Personal: Trip, all day, Oct 12 to 14"
export function personalLabel(item, { viewerInZone } = {}) {
  const title = blank(item?.title) ? 'Busy' : String(item.title).trim();
  if (item?.first) {
    let range = '';
    if (item.last && item.last !== item.first) {
      const a = parseKey(item.first);
      const b = parseKey(item.last);
      range = `, ${dayWords(item.first)} to ${a.m === b.m && a.y === b.y ? b.d : dayWords(item.last)}`;
    }
    return `Personal: ${title}, all day${range}`;
  }
  return `Personal: ${title}, ${timeRange(item, { viewerInZone })}`;
}

// "Wed, Oct 14, 3:00 to 4:00 pm", "Sat, Oct 17, all day" or "Mon, Oct 12 to Wed, Oct 14, all day".
// today (a day key) adds the year to a day outside it.
export function personalWhen(item, { today = null, viewerInZone } = {}) {
  if (item?.first) {
    const last = item.last && item.last !== item.first ? ` to ${shortDayText(item.last, today)}` : '';
    return `${shortDayText(item.first, today)}${last}, all day`;
  }
  return `${shortDayText(dayKey(item.starts_at), today)}, ${timeRange(item, { viewerInZone })}`;
}

// ---------------------------------------------------------------------------
// Coming back from Google

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// The hash Google's round trip returns to (the server merges google=connected,
// or google=error with a reason, into the hash's query):
//   { result: 'connected' | 'error' | null, reason, cleanHash }
// cleanHash is the same hash without the google and reason params; every other
// param stays exactly as it was written. A reason only belongs to the round trip
// when google is there with it.
export function readGoogleReturn(hash) {
  const raw = String(hash ?? '');
  const body = raw.replace(/^#/, '');
  const q = body.indexOf('?');
  if (q === -1) return { result: null, reason: null, cleanHash: raw };
  const path = body.slice(0, q);
  const pairs = body.slice(q + 1).split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=');
    return { pair, key: decode(eq === -1 ? pair : pair.slice(0, eq)), value: eq === -1 ? '' : decode(pair.slice(eq + 1)) };
  });
  const google = pairs.find((p) => p.key === 'google');
  let result = null;
  let reason = null;
  if (google) {
    if (google.value === 'connected' || google.value === 'error') result = google.value;
    const why = pairs.find((p) => p.key === 'reason');
    if (result === 'error' && why && why.value) reason = why.value;
  }
  const keep = pairs.filter((p) => p.key !== 'google' && !(google && p.key === 'reason')).map((p) => p.pair);
  return { result, reason, cleanHash: `#${path}${keep.length ? `?${keep.join('&')}` : ''}` };
}

// ---------------------------------------------------------------------------
// Links

// A session's google_link only becomes a link when it points at Google Calendar
// over https (a tutor can write to that column, so it is not trusted as given)
export function safeGoogleLink(link) {
  let url;
  try {
    url = new URL(String(link ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const onCalendar = url.hostname === 'calendar.google.com'
    || (url.hostname === 'www.google.com' && url.pathname.startsWith('/calendar/'));
  return onCalendar ? url.href : null;
}

// "https://calendar.google.com/calendar/r/day/2026/10/6" from '2026-10-06'
export function googleDayUrl(key) {
  const { y, m, d } = parseKey(key);
  return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}`;
}

export const SYNC_NOTE = 'Not synced to Google yet. It will sync shortly.';

// What the session drawer tells a tutor about their own session: it is waiting
// to go to Google (or the last try failed) and their sync is on. Otherwise null.
export function syncNote(session, me, status) {
  if (!session || !me || me.role !== 'tutor' || String(session.tutor_id) !== String(me.id)) return null;
  if (!status?.connected || !status.sync_enabled) return null;
  return session.sync_state === 'pending' || session.sync_state === 'error' ? SYNC_NOTE : null;
}

// ---------------------------------------------------------------------------
// Clashes with a session being scheduled

// The timed personal events that overlap [candidate.starts_at, candidate.ends_at).
// Takes the server's events or personalBlocks().timed; all-day events never clash.
export function personalClashes(candidate, events) {
  const a = ms(candidate?.starts_at);
  const b = ms(candidate?.ends_at);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  return (events ?? []).filter((e) => {
    if (!e || isAllDay(e)) return false;
    const start = ms(e.starts_at ?? e.start);
    const end = ms(e.ends_at ?? e.end);
    return Number.isFinite(start) && Number.isFinite(end) && start < b && a < end;
  });
}

// "You have “Dentist” in your Google Calendar then."
export function personalClashLine(event) {
  const title = blank(event?.title) ? 'Busy' : String(event.title).trim();
  return `You have “${title}” in your Google Calendar then.`;
}

// Adds a line per personal clash to a session form clash report ({ title, lines,
// ... } from clashReport, or null). The report comes back untouched when nothing
// clashes; with only personal clashes it gets a title of its own.
export function mergePersonalClashes(report, clashes) {
  if (!clashes?.length) return report ?? null;
  const shown = clashes.length <= MAX_CLASH_LINES ? clashes : clashes.slice(0, MAX_CLASH_LINES - 1);
  const lines = shown.map(personalClashLine);
  if (clashes.length > shown.length) lines.push(`And ${clashes.length - shown.length} more.`);
  return {
    ...(report ?? {}),
    title: report?.title ?? 'This time overlaps your Google Calendar',
    lines: [...(report?.lines ?? []), ...lines],
  };
}
