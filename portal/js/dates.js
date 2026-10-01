// Pure date helpers. Every due date is stored, bucketed and shown in one business
// zone (Pacific), whatever zone the viewer is in. Days are keyed as 'YYYY-MM-DD'
// strings and stepped with UTC calendar math, never by adding 86,400,000 ms.

export const BUSINESS_TZ = 'America/Los_Angeles';
export const WEEK_START = 0; // Sunday
export const DUE_SOON_HOURS = 48; // re-exported by buckets.js

const HOUR_MS = 3_600_000;
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const short = (name) => name.slice(0, 3);

// Date only, exactly as the spec asks for dayKey
const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
// Date and 24-hour wall time, for zone math
const WALL_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function partsOf(fmt, ms) {
  const out = {};
  for (const { type, value } of fmt.formatToParts(ms)) out[type] = Number(value);
  return out;
}

function toMs(v) {
  return v instanceof Date ? v.getTime() : Date.parse(v);
}

// The business-zone wall clock of an instant, read back as if it were UTC
function wallAsUtc(ms) {
  const p = partsOf(WALL_FMT, ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
}

function keyFromUtc(date) {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 'YYYY-MM-DD' of a Date or ISO string in the business zone; a key passes through
export function dayKey(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && KEY_RE.test(v)) return v;
  const p = partsOf(DAY_FMT, toMs(v));
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function todayKey(now = new Date()) {
  return dayKey(now);
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

export function addDays(key, n) {
  const { y, m, d } = parseKey(key);
  return keyFromUtc(new Date(Date.UTC(y, m - 1, d + n)));
}

// 0 for Sunday
export function weekday(key) {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Calendar days from a to b (positive when b is later)
export function daysBetween(a, b) {
  const pa = parseKey(a);
  const pb = parseKey(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

// ISO instant of a business-zone wall time on a day, e.g. ('2026-10-14', '23:59')
export function zonedIso(key, time = '23:59') {
  if (!key) return null;
  const { y, m, d } = parseKey(key);
  const [hh, mm] = time.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  // Guess the instant as if the zone were UTC, correct by the zone offset there,
  // then check once more in case the correction crossed a DST change.
  let ms = target - (wallAsUtc(target) - target);
  const again = target - (wallAsUtc(ms) - ms);
  if (again !== ms && wallAsUtc(again) === target) ms = again;
  return new Date(ms).toISOString();
}

// Business-zone day and wall time of an instant
export function businessTime(iso) {
  const p = partsOf(WALL_FMT, toMs(iso));
  return { key: dayKey(iso), hour: p.hour % 24, minute: p.minute };
}

// True when the viewer's clock reads the same as Pacific at that instant
export function viewerIsInBusinessZone(now = new Date()) {
  const ms = toMs(now);
  const businessOffsetMin = (wallAsUtc(ms) - Math.floor(ms / 1000) * 1000) / 60_000;
  return -new Date(ms).getTimezoneOffset() === businessOffsetMin;
}

// "3:00 pm"
function clock({ hour, minute }) {
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

// "Oct 14", or "Oct 14, 2027" when the year differs from the reference key's
function shortDate(key, refKey) {
  const { y, m, d } = parseKey(key);
  const year = refKey && parseKey(refKey).y === y ? '' : `, ${y}`;
  return `${short(MONTHS[m - 1])} ${d}${year}`;
}

// "Oct 5" for a timestamp, plus the year when it is not now's (business zone)
export function shortDay(iso, now = new Date()) {
  return shortDate(dayKey(iso), todayKey(now));
}

// "Wednesday, October 14"
export function longDate(key) {
  const { m, d } = parseKey(key);
  return `${WEEKDAYS[weekday(key)]}, ${MONTHS[m - 1]} ${d}`;
}

// "October 2026" from 'YYYY-MM'
export function monthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// Heading for an agenda day: "Today, Wed Oct 14", "Tomorrow, Thu Oct 15", "Fri, Oct 16"
export function dayHeading(key, today) {
  const { m, d } = parseKey(key);
  const day = short(WEEKDAYS[weekday(key)]);
  const date = `${short(MONTHS[m - 1])} ${d}`;
  const diff = daysBetween(today, key);
  if (diff === 0) return `Today, ${day} ${date}`;
  if (diff === 1) return `Tomorrow, ${day} ${date}`;
  return `${day}, ${date}`;
}

// Short and full due labels plus a tone. `viewerInZone` can be passed to test
// both viewer cases; by default it is checked at the due instant.
export function dueLabel(dueIso, now = new Date(), { viewerInZone } = {}) {
  if (!dueIso) return { text: 'No due date', full: 'No due date', tone: null };
  const dueMs = toMs(dueIso);
  const nowMs = toMs(now);
  const inZone = viewerInZone ?? viewerIsInBusinessZone(new Date(dueMs));
  const wall = businessTime(dueIso);
  const today = todayKey(now);
  const diff = daysBetween(today, wall.key);
  const overdue = dueMs < nowMs;

  let text;
  let withTime = true;
  if (overdue) {
    if (diff === 0) text = 'Due earlier today';
    else if (diff === -1) text = 'Due yesterday';
    else { text = `${-diff} days overdue`; withTime = false; }
  } else if (diff === 0) text = 'Due today';
  else if (diff === 1) text = 'Due tomorrow';
  else if (diff >= 2 && diff <= 6) text = `Due ${WEEKDAYS[weekday(wall.key)]}`;
  else text = `Due ${shortDate(wall.key, today)}`;

  const isDefaultTime = wall.hour === 23 && wall.minute === 59;
  if (withTime && !inZone) text += ` at ${clock(wall)} PT`;
  else if (withTime && !isDefaultTime) text += ` at ${clock(wall)}`;

  const sameYear = parseKey(wall.key).y === parseKey(today).y;
  const full = `Due ${longDate(wall.key)}${sameYear ? '' : `, ${parseKey(wall.key).y}`} at ${clock(wall)} Pacific time`;

  let tone = null;
  if (overdue) tone = 'danger';
  else if (dueMs - nowMs <= DUE_SOON_HOURS * HOUR_MS) tone = 'warning';
  return { text, full, tone };
}

// "Just now", "5 minutes ago", ..., "Oct 5"; full: "October 5, 2026 at 4:12 pm"
export function relativeTime(iso, now = new Date(), { viewerInZone } = {}) {
  const ms = toMs(iso);
  const elapsed = toMs(now) - ms;
  const inZone = viewerInZone ?? viewerIsInBusinessZone(new Date(ms));
  const wall = businessTime(iso);
  const { y, m, d } = parseKey(wall.key);
  const full = `${MONTHS[m - 1]} ${d}, ${y} at ${clock(wall)}${inZone ? '' : ' PT'}`;

  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(elapsed / HOUR_MS);
  const today = todayKey(now);
  const days = daysBetween(wall.key, today);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`;

  let text;
  if (minutes < 1) text = 'Just now';
  else if (minutes < 60) text = plural(minutes, 'minute');
  else if (hours < 24) text = plural(hours, 'hour');
  else if (days <= 1) text = 'Yesterday';
  else if (days <= 6) text = `${days} days ago`;
  else text = shortDate(wall.key, today);
  return { text, full };
}
