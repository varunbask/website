// Pure logic for tutoring sessions: labels and states, tutor colors, the
// week grid layout, clash checks, weekly repeats, edits to a series and the
// .ics export. No DOM. Times are entered and shown in the business zone
// (dates.js), with " PT" when the viewer's clock is in another zone.
//
// A session row: { id, student_id, tutor_id, series_id, subject, starts_at,
// ends_at, location, meeting_url, notes, status ('scheduled' | 'cancelled'),
// attendance ('present' | 'late' | 'absent' | null), recap, moved_from,
// changed_at, created_at, updated_at }

import {
  WEEK_START, dayKey, addDays, weekday, zonedIso, businessTime, viewerIsInBusinessZone,
  parseKey, daysBetween,
} from './dates.js';
import { tutorToneClass } from './tutor-colors-model.js';

export const MAX_SESSION_MINUTES = 480;
export const DAY_START_HOUR = 7;      // the week grid shows at least 7 am to 9 pm
export const DAY_END_HOUR = 21;
export const MIN_BLOCK_MINUTES = 20;  // a short session still gets a readable block
export const ATTENDANCE = Object.freeze({ present: 'Present', late: 'Late', absent: 'Absent' });
export const DURATIONS = Object.freeze([30, 45, 60, 75, 90, 120]);

const MIN_MS = 60_000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ms = (iso) => Date.parse(iso);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// ---------------------------------------------------------------------------
// Words

// "4:00 pm" in the business zone
export function clockText(iso) {
  const { hour, minute } = businessTime(iso);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

// "4:00 to 5:30 pm", "11:30 am to 12:30 pm", plus " PT" outside the zone
export function timeRange(session, { viewerInZone } = {}) {
  const inZone = viewerInZone ?? viewerIsInBusinessZone(new Date(ms(session.starts_at)));
  const a = clockText(session.starts_at);
  const b = clockText(session.ends_at);
  const sameHalf = a.slice(-2) === b.slice(-2);
  const text = sameHalf ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
  return inZone ? text : `${text} PT`;
}

export function durationMinutes(session) {
  return Math.round((ms(session.ends_at) - ms(session.starts_at)) / MIN_MS);
}

// "45 minutes", "1 hour", "1 hour 30 minutes", "2 hours"
export function durationText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '';
  const mins = m ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : '';
  return [hours, mins].filter(Boolean).join(' ') || '0 minutes';
}

export function sessionTitle(session) {
  return blank(session?.subject) ? 'Tutoring session' : session.subject.trim();
}

// "Thu, Oct 8", plus the year when it differs from the reference day's
export function shortDayText(key, refKey = null) {
  const { y, m, d } = parseKey(key);
  const year = refKey && parseKey(refKey).y !== y ? `, ${y}` : '';
  return `${WEEKDAYS[weekday(key)].slice(0, 3)}, ${MONTHS[m - 1]} ${d}${year}`;
}

// "Moved from Thu, Oct 8 at 4:00 pm", or null when the session never moved
export function movedNote(session, today = null) {
  if (!session?.moved_from) return null;
  return `Moved from ${shortDayText(dayKey(session.moved_from), today)} at ${clockText(session.moved_from)}`;
}

// ---------------------------------------------------------------------------
// State

export const isCancelled = (s) => s?.status === 'cancelled';

// { key, label, tone } for the pill on a session
//   cancelled | now | moved | scheduled before it ends
//   attended | late | missed | finished after it ends
export function sessionState(session, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : ms(now);
  if (isCancelled(session)) return { key: 'cancelled', label: 'Cancelled', tone: 'neutral' };
  const start = ms(session.starts_at);
  const end = ms(session.ends_at);
  if (start <= t && t < end) return { key: 'now', label: 'Happening now', tone: 'accent' };
  if (end <= t) {
    if (session.attendance === 'present') return { key: 'attended', label: 'Attended', tone: 'success' };
    if (session.attendance === 'late') return { key: 'late', label: 'Arrived late', tone: 'warning' };
    if (session.attendance === 'absent') return { key: 'missed', label: 'Missed', tone: 'danger' };
    return { key: 'finished', label: 'Finished', tone: 'neutral' };
  }
  if (session.moved_from) return { key: 'moved', label: 'Moved', tone: 'warning' };
  return { key: 'scheduled', label: 'Scheduled', tone: 'neutral' };
}

// ---------------------------------------------------------------------------
// Tutor colors. A lesson is drawn in the color of its tutor (the admin picks it,
// or the tutor's id picks one; tutor-colors-model.js). The store hands the
// loaded colors to setTutorColors; tutorToneClass(tutor_id) is the class a
// lesson's row, block, chip or dot carries.

export { setTutorColors, tutorToneClass, tutorColorOf } from './tutor-colors-model.js';

// The tutors of some sessions, once each, for the calendar legend:
// [{ tutorId, label, tone }] by label. names is a Map of tutor ids to names
// (staffNames()). Without a name the label is the subjects that tutor teaches in
// these sessions (never an id), or "Tutor" when they have none.
export function tutorLegend(sessions, names = new Map()) {
  const byTutor = new Map();
  for (const s of sortSessions(sessions)) {
    const key = String(s.tutor_id ?? '');
    if (!byTutor.has(key)) byTutor.set(key, { tutorId: s.tutor_id ?? null, name: null, subjects: new Map(), tone: tutorToneClass(s.tutor_id) });
    const entry = byTutor.get(key);
    const name = names?.get?.(key);
    if (typeof name === 'string' && name.trim()) entry.name = name.trim();
    const subject = blank(s.subject) ? null : s.subject.trim();
    if (subject && !entry.subjects.has(subject.toLowerCase())) entry.subjects.set(subject.toLowerCase(), subject);
  }
  return [...byTutor.values()]
    .map((e) => ({ tutorId: e.tutorId, label: e.name ?? ([...e.subjects.values()].join(', ') || 'Tutor'), tone: e.tone }))
    .sort((a, b) => a.label.localeCompare(b.label) || String(a.tutorId).localeCompare(String(b.tutorId)));
}

// ---------------------------------------------------------------------------
// Lists

export function sortSessions(list) {
  return [...(list ?? [])].sort((a, b) => (ms(a.starts_at) - ms(b.starts_at)) || (Number(a.id) - Number(b.id)));
}

// Map<'YYYY-MM-DD', Session[]> by the business-zone day each starts on
export function sessionsByDay(list) {
  const map = new Map();
  for (const s of sortSessions(list)) {
    const key = dayKey(s.starts_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return map;
}

// Scheduled sessions that have not ended yet, soonest first
export function upcomingSessions(list, now = new Date(), { limit = Infinity, days = null } = {}) {
  const t = now instanceof Date ? now.getTime() : ms(now);
  const until = days === null ? Infinity : t + days * 86_400_000;
  return sortSessions(list)
    .filter((s) => !isCancelled(s) && ms(s.ends_at) > t && ms(s.starts_at) < until)
    .slice(0, limit);
}

// Moves and cancellations made after `since` (an ISO time or null) that still
// matter: the session has not ended. These drive the family's "New" marker.
// changed_at moves only on a change of time or status, never on a new plan.
export function recentChanges(list, since, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : ms(now);
  const from = since ? ms(since) : -Infinity;
  return sortSessions(list).filter((s) => (s.moved_from || isCancelled(s))
    && s.changed_at && ms(s.changed_at) > from
    && ms(s.ends_at) > t);
}

// The rest of a weekly series from this session on (this one included). The
// tutor and student must match too: series_id comes from the browser. With
// `now`, later sessions that already started are left out (they happened; the
// database's edit_following_sessions skips them the same way).
export function followingInSeries(list, session, { now = null } = {}) {
  if (!session?.series_id) return [session];
  const from = now ? Math.max(ms(session.starts_at), (now instanceof Date ? now : new Date(now)).getTime()) : ms(session.starts_at);
  return sortSessions(list).filter((s) => s.series_id === session.series_id
    && String(s.tutor_id) === String(session.tutor_id)
    && String(s.student_id) === String(session.student_id)
    && (String(s.id) === String(session.id) || ms(s.starts_at) >= from)
    && ms(s.starts_at) >= ms(session.starts_at));
}

// ---------------------------------------------------------------------------
// Week grid

export function weekStartKey(key, weekStart = WEEK_START) {
  return addDays(key, -((weekday(key) - weekStart + 7) % 7));
}

export function weekKeys(key, weekStart = WEEK_START) {
  const start = weekStartKey(key, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// "Oct 4 to 10, 2026", "Sep 27 to Oct 3, 2026", "Dec 27, 2026 to Jan 2, 2027"
export function weekTitle(startKey) {
  const endKey = addDays(startKey, 6);
  const a = parseKey(startKey);
  const b = parseKey(endKey);
  if (a.y !== b.y) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} to ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${MONTHS[a.m - 1]} ${a.d} to ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  return `${MONTHS[a.m - 1]} ${a.d} to ${b.d}, ${b.y}`;
}

// Minutes after midnight (business zone) where a session starts and ends on
// its start day; a session past midnight ends at 1440 on that day
export function dayMinutes(session) {
  const a = businessTime(session.starts_at);
  const b = businessTime(session.ends_at);
  const start = a.hour * 60 + a.minute;
  const end = b.key === a.key ? b.hour * 60 + b.minute : 1440;
  return { start, end: Math.max(end, start) };
}

// The hours the grid shows: at least DAY_START_HOUR to DAY_END_HOUR, widened
// to fit every session given
export function hourRange(list, { start = DAY_START_HOUR, end = DAY_END_HOUR } = {}) {
  let lo = start;
  let hi = end;
  for (const s of list ?? []) {
    const m = dayMinutes(s);
    lo = Math.min(lo, Math.floor(m.start / 60));
    hi = Math.max(hi, Math.ceil(m.end / 60));
  }
  return { start: lo, end: Math.min(hi, 24) };
}

// Blocks for one day's sessions: { session, top, height, col, cols }, top and
// height as fractions of the shown hours. Sessions that overlap share the width
// in columns; a cluster of overlapping sessions uses the same column count.
export function layoutDay(daySessions, { startHour = DAY_START_HOUR, endHour = DAY_END_HOUR } = {}) {
  const span = (endHour - startHour) * 60;
  const items = sortSessions(daySessions).map((session) => {
    const m = dayMinutes(session);
    const start = Math.max(m.start, startHour * 60);
    const end = Math.max(Math.min(m.end, endHour * 60), start + MIN_BLOCK_MINUTES);
    return { session, start, end, col: 0, cols: 1 };
  });

  let cluster = [];
  let clusterEnd = -1;
  let columns = [];   // the end minute of the last block in each column
  const close = () => {
    for (const it of cluster) it.cols = columns.length;
    cluster = [];
    columns = [];
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) close();
    let col = columns.findIndex((endAt) => endAt <= it.start);
    if (col < 0) {
      col = columns.length;
      columns.push(it.end);
    } else {
      columns[col] = it.end;
    }
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  close();

  return items.map((it) => ({
    session: it.session,
    top: (it.start - startHour * 60) / span,
    height: (it.end - it.start) / span,
    col: it.col,
    cols: it.cols,
  }));
}

// ---------------------------------------------------------------------------
// Clashes

export function overlaps(a, b) {
  return ms(a.starts_at) < ms(b.ends_at) && ms(b.starts_at) < ms(a.ends_at);
}

// Scheduled sessions that overlap a candidate for the same tutor or the same
// student: [{ session, who: 'tutor' | 'student' | 'both' }]. The candidate may
// be a new session (no id) or an edit (its own ids are ignored).
// student_busy() rows as stand-ins for sessions in a clash check. A tutor reads
// only their own sessions, so when a student has a lesson with another tutor
// all the tutor learns is that the student is busy then: no tutor, no subject.
export function busyBlocks(studentId, rows) {
  return (rows ?? []).map((r) => ({
    id: `busy-${studentId}-${r.starts_at}-${r.ends_at}`,
    student_id: studentId,
    tutor_id: null,
    subject: null,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    status: 'scheduled',
    busy: true,
  }));
}

export function findClashes(candidate, list, { ignoreIds = [] } = {}) {
  const ignore = new Set(ignoreIds.map(String));
  if (candidate.id !== undefined && candidate.id !== null) ignore.add(String(candidate.id));
  const out = [];
  for (const s of sortSessions(list)) {
    if (ignore.has(String(s.id)) || isCancelled(s) || !overlaps(candidate, s)) continue;
    const tutor = String(s.tutor_id) === String(candidate.tutor_id);
    const student = String(s.student_id) === String(candidate.student_id);
    if (tutor || student) out.push({ session: s, who: tutor && student ? 'both' : tutor ? 'tutor' : 'student' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forms, repeats and series edits

// 'HH:MM' of an instant in the business zone, for a time input
export function timeInput(iso) {
  const { hour, minute } = businessTime(iso);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// '17:30' + 60 -> '18:30' (clamped to 23:59)
export function addMinutesToTime(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Raw form values -> { ok, errors, values }. values come back trimmed, with
// blanks as null. How a repeat ends is checked by session-form-model.js.
export function validateSessionForm(raw = {}, { creating = true } = {}) {
  const v = {
    date: String(raw.date ?? '').trim(),
    start: String(raw.start ?? '').trim(),
    end: String(raw.end ?? '').trim(),
    subject: String(raw.subject ?? '').trim() || null,
    location: String(raw.location ?? '').trim() || null,
    meeting_url: String(raw.meeting_url ?? '').trim() || null,
    notes: String(raw.notes ?? '').trim() || null,
    repeat: creating && Boolean(raw.repeat),
  };
  const errors = {};
  if (!DAY_RE.test(v.date)) errors.date = 'Choose a date.';
  if (!TIME_RE.test(v.start)) errors.start = 'Enter a start time.';
  if (!TIME_RE.test(v.end)) errors.end = 'Enter an end time.';
  else if (!errors.start && v.end <= v.start) errors.end = 'End after the start time.';
  else if (!errors.start) {
    const [sh, sm] = v.start.split(':').map(Number);
    const [eh, em] = v.end.split(':').map(Number);
    if ((eh * 60 + em) - (sh * 60 + sm) > MAX_SESSION_MINUTES) errors.end = 'A session can be at most 8 hours.';
  }
  if (v.subject && v.subject.length > 60) errors.subject = 'Use at most 60 characters.';
  if (v.location && v.location.length > 200) errors.location = 'Use at most 200 characters.';
  if (v.meeting_url && (!/^https:\/\/\S+$/.test(v.meeting_url) || v.meeting_url.length > 500)) {
    errors.meeting_url = 'Use a link that starts with https://';
  }
  if (v.notes && v.notes.length > 2000) errors.notes = 'Use at most 2,000 characters.';
  return { ok: Object.keys(errors).length === 0, errors, values: v };
}

// [{ starts_at, ends_at }] for a session on `date` and the same weekday after
// it, `weeks` times. Each is placed by wall time, so DST never shifts it.
export function weeklyTimes({ date, start, end, weeks = 1 }) {
  return Array.from({ length: weeks }, (_, i) => {
    const key = addDays(date, i * 7);
    return { starts_at: zonedIso(key, start), ends_at: zonedIso(key, end) };
  });
}

const toMinutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const toTime = (minutes) => {
  const m = Math.min(Math.max(minutes, 0), 23 * 60 + 59);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// New times for a run of sessions when the edited one moves to `date` at
// start to end. Each row moves by the same change (days, start and end), so a
// row that was moved on its own keeps its difference; with no change in time,
// every row keeps its times. [{ id, starts_at, ends_at }]
export function retimeRows(rows, edited, { date, start, end }) {
  const shift = daysBetween(dayKey(edited.starts_at), date);
  const startDelta = toMinutes(start) - toMinutes(timeInput(edited.starts_at));
  const endDelta = toMinutes(end) - toMinutes(timeInput(edited.ends_at));
  return rows.map((row) => {
    const key = addDays(dayKey(row.starts_at), shift);
    return {
      id: row.id,
      starts_at: zonedIso(key, toTime(toMinutes(timeInput(row.starts_at)) + startDelta)),
      ends_at: zonedIso(key, toTime(toMinutes(timeInput(row.ends_at)) + endDelta)),
    };
  });
}

// A v4 UUID for a new series (the browser has crypto.randomUUID)
export function newSeriesId(random = globalThis.crypto) {
  return random.randomUUID();
}

// ---------------------------------------------------------------------------
// Spoken labels

// "Algebra with Daniel Ortiz, 4:00 to 5:00 pm, moved"
export function sessionAria(session, { who = null, now = new Date(), viewerInZone } = {}) {
  const state = sessionState(session, now);
  const parts = [`${sessionTitle(session)}${who ? ` with ${who}` : ''}`, timeRange(session, { viewerInZone })];
  if (state.key !== 'scheduled') parts.push(state.label.toLowerCase());
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// .ics (one session, or several for "Add all to my calendar")

function icsTime(iso) {
  return new Date(ms(iso)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 characters continue on the next line after a space
function fold(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join('\r\n');
}

// names: Map of tutor and student ids to names; domain: the UID's host
export function toIcs(sessions, { names = new Map(), now = new Date(), domain = 'varunbaskaran.com' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VP Education Group//Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const s of sortSessions(sessions)) {
    const tutor = names.get(String(s.tutor_id));
    const summary = tutor ? `${sessionTitle(s)} with ${tutor}` : sessionTitle(s);
    const details = [s.notes, s.meeting_url ? `Join: ${s.meeting_url}` : null].filter(Boolean).join('\n\n');
    // Each save raises the sequence, so a calendar app takes the newer copy
    const sequence = Math.max(0, Math.floor((ms(s.updated_at ?? s.created_at ?? s.starts_at) - Date.UTC(2026, 0, 1)) / MIN_MS));
    lines.push(
      'BEGIN:VEVENT',
      `UID:session-${s.id}@${domain}`,
      `DTSTAMP:${icsTime(now instanceof Date ? now.toISOString() : now)}`,
      `DTSTART:${icsTime(s.starts_at)}`,
      `DTEND:${icsTime(s.ends_at)}`,
      `SEQUENCE:${sequence}`,
      `STATUS:${isCancelled(s) ? 'CANCELLED' : 'CONFIRMED'}`,
      fold(`SUMMARY:${icsText(summary)}`),
    );
    const where = s.location || (s.meeting_url ? 'Online' : null);
    if (where) lines.push(fold(`LOCATION:${icsText(where)}`));
    // No whitespace may reach the file: a line break would start a new property
    if (s.meeting_url) lines.push(fold(`URL:${String(s.meeting_url).replace(/\s+/g, '')}`));
    if (details) lines.push(fold(`DESCRIPTION:${icsText(details)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// Who may change a session (the UI mirror of the RLS policies): an admin, or
// the session's own tutor while still assigned to the student. me: { id, role };
// links: the tutor's tutor_students rows when known (without them the link is
// assumed, and the database still has the last word).
export function canEditSession(session, me, { links = null } = {}) {
  if (!session || !me) return false;
  if (me.role === 'admin') return true;
  if (me.role !== 'tutor' || String(session.tutor_id) !== String(me.id)) return false;
  return !links || links.some((l) => String(l.tutor_id) === String(me.id) && String(l.student_id) === String(session.student_id));
}
