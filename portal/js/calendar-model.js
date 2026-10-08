// Pure calendar logic (spec 5.10): the 42-cell month matrix, day keys for
// items, keyboard movement, chip capacity, chip and dot kinds, spoken day
// labels, the agenda groups and the view state read from the hash. Tutoring
// sessions join the same views: the week grid helpers, the Day view's column
// and title, the tutor filter, the month chips and the agenda days all live
// here too.
// No DOM. Days are 'YYYY-MM-DD' keys in the business zone (dates.js) and are
// stepped with UTC calendar math only.

import { WEEK_START, dayKey, parseKey, addDays, weekday, longDate, monthTitle, businessTime } from './dates.js';
import { itemStatus } from './status.js';
import { byDue } from './format.js';
import {
  weekStartKey, sessionAria, sortSessions, isCancelled, canEditSession, weekTitle,
} from './sessions-model.js';
import { parseHash, buildHash, DRAWER_PARAMS } from './router.js';

export const CAL_VIEWS = Object.freeze(['day', 'week', 'month', 'list']);
export const AGENDA_DAYS = 30;   // list view range, extended 30 days at a time
export const PANEL_DAYS = 7;     // day panel with no selected day
export const MAX_DOTS = 3;       // phone month cells
export const NOTES_DAYS = 7;     // "Needs session notes" looks back this far

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Keys

// A real calendar day ('2026-02-29' is not one)
export function isDayKey(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const { y, m, d } = parseKey(v);
  return d <= daysInMonth(`${y}-${pad(m)}`);
}

export function isMonthKey(v) {
  return typeof v === 'string' && MONTH_RE.test(v);
}

// '2026-10' from a day key
export function monthOf(key) {
  return key.slice(0, 7);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// '2026-12' + 1 -> '2027-01'
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}`;
}

// ---------------------------------------------------------------------------
// Month grid

// Always 42 cells (six weeks) so the grid never changes height between months.
// Cell: { key, inMonth, weekday, isWeekend }
export function monthMatrix(ym, weekStart = WEEK_START) {
  const first = `${ym}-01`;
  const lead = (weekday(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => {
    const key = addDays(start, i);
    const wd = weekday(key);
    return { key, inMonth: monthOf(key) === ym, weekday: wd, isWeekend: wd === 0 || wd === 6 };
  });
}

// True when a day is one of the 42 cells shown for a month (adjacent-month
// days included)
export function inGrid(ym, key, weekStart = WEEK_START) {
  if (!isMonthKey(ym) || !isDayKey(key)) return false;
  return monthMatrix(ym, weekStart).some((cell) => cell.key === key);
}

// Column headers: [{ short: 'Sun', long: 'Sunday' }, ...]
export function weekdayHeaders(weekStart = WEEK_START) {
  return Array.from({ length: 7 }, (_, i) => {
    const long = WEEKDAYS[(weekStart + i) % 7];
    return { short: long.slice(0, 3), long };
  });
}

// The number shown in a cell; the 1st of an adjacent month reads "Nov 1"
export function cellText({ key, inMonth }) {
  const { m, d } = parseKey(key);
  return !inMonth && d === 1 ? `${MONTHS_SHORT[m - 1]} 1` : String(d);
}

// ---------------------------------------------------------------------------
// Items by day

// How a calendar entry looks. kind: open | soon | overdue | submitted | graded
// | done | missed | draft (staff) | failed. icon: the chip's leading icon.
// Results: Completed is graded, a released Missing (or one archived) is
// missed, Extended looks like work due soon.
export function chipKind(item, audience = 'family') {
  const kindIcon = item.task.kind === 'task' ? 'check-square' : 'clipboard-text';
  const status = itemStatus(item, { audience });
  switch (status.key) {
    case 'overdue': return { kind: 'overdue', icon: 'warning-circle' };
    case 'soon': return { kind: 'soon', icon: kindIcon };
    case 'extended': return { kind: 'soon', icon: 'clock' };
    case 'todo': return { kind: 'open', icon: kindIcon };
    case 'done': return { kind: 'done', icon: kindIcon };
    case 'completed':
    case 'graded': return { kind: 'graded', icon: 'check-circle' };
    case 'missing': return { kind: 'missed', icon: 'minus-circle' };
    case 'draft':
    case 'edited': return { kind: 'draft', icon: 'pencil-simple-line' };
    case 'failed': return { kind: 'failed', icon: 'x-circle' };
    default: return { kind: 'submitted', icon: 'hourglass-medium' };
  }
}

// Most urgent first: work that needs doing, then work waiting, then finished
const RANK = { overdue: 0, failed: 1, soon: 2, draft: 3, open: 4, submitted: 5, graded: 6, missed: 7, done: 8 };
const rankOf = (item, audience) => RANK[chipKind(item, audience).kind] ?? 9;

function sortDay(list, audience) {
  return [...list].sort((a, b) => (rankOf(a, audience) - rankOf(b, audience))
    || byDue(a.task, b.task)
    || String(a.task.title ?? '').localeCompare(String(b.task.title ?? '')));
}

// { byDay: Map<'YYYY-MM-DD', Item[]>, undated: Item[] }, each day sorted most
// urgent first, then by due time. Keys are Pacific days (dates.dayKey).
export function itemsByDay(items, audience = 'family') {
  const byDay = new Map();
  const undated = [];
  for (const item of items ?? []) {
    const due = item.task.due_at;
    if (!due) {
      undated.push(item);
      continue;
    }
    const key = dayKey(due);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }
  for (const [key, list] of byDay) byDay.set(key, sortDay(list, audience));
  return { byDay, undated: sortDay(undated, audience) };
}

// Dated items in one month
export function countInMonth(byDay, ym) {
  let n = 0;
  for (const [key, list] of byDay) if (monthOf(key) === ym) n += list.length;
  return n;
}

// ---------------------------------------------------------------------------
// Keyboard (on day buttons)

function shiftKeyMonths(key, n) {
  const { y, m, d } = parseKey(key);
  const ym = shiftMonth(`${y}-${pad(m)}`, n);
  return `${ym}-${pad(Math.min(d, daysInMonth(ym)))}`;
}

// The day a key moves to, or null for keys the grid does not handle.
// Arrows: a day or a week. Home/End: start and end of the week. PageUp/PageDown:
// a month (same day, clamped to the month length); with shift, a year.
export function moveKey(key, keyName, { shift = false, weekStart = WEEK_START } = {}) {
  const intoWeek = (weekday(key) - weekStart + 7) % 7;
  switch (keyName) {
    case 'ArrowLeft': return addDays(key, -1);
    case 'ArrowRight': return addDays(key, 1);
    case 'ArrowUp': return addDays(key, -7);
    case 'ArrowDown': return addDays(key, 7);
    case 'Home': return addDays(key, -intoWeek);
    case 'End': return addDays(key, 6 - intoWeek);
    case 'PageUp': return shiftKeyMonths(key, shift ? -12 : -1);
    case 'PageDown': return shiftKeyMonths(key, shift ? 12 : 1);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Chips and dots

// Chip lines a month cell has room for, by viewport width. 0 means the phone
// grid, which shows dots instead of chips.
export function capacityFor(width) {
  if (width >= 1280) return 3;
  if (width >= 1024) return 2;
  if (width >= 768) return 1;
  return 0;
}

// The same, capped by the width a month cell really gets: the grid narrows
// with the expanded sidebar and, at 1280 and up, the 320px day panel beside
// it (an 85px cell at 1280). A chip title needs about 60px to show whole
// words, so a narrower cell takes fewer chips, and below 80px only dots.
export function capacityForGrid(gridWidth, viewport) {
  const byViewport = capacityFor(viewport);
  if (!(gridWidth > 0)) return byViewport;
  const cell = gridWidth / 7;
  let byCell = 0;
  if (cell >= 112) byCell = 3;
  else if (cell >= 96) byCell = 2;
  else if (cell >= 80) byCell = 1;
  return Math.min(byViewport, byCell);
}

// Which chips fit. When some do not, one line goes to "+N more", except at
// capacity 1, where the single chip stays and a short "+N" sits beside it.
export function chipsFor(dayItems, capacity) {
  const list = dayItems ?? [];
  if (capacity <= 0) return { shown: [], more: list.length };
  if (list.length <= capacity) return { shown: [...list], more: 0 };
  const keep = capacity === 1 ? 1 : capacity - 1;
  return { shown: list.slice(0, keep), more: list.length - keep };
}

export function moreLabel(more, capacity) {
  return capacity === 1 ? `+${more}` : `+${more} more`;
}

// Phone cells: one dot per item, most urgent first, at most three
export function dotsFor(dayItems, audience = 'family') {
  return sortDay(dayItems ?? [], audience).slice(0, MAX_DOTS).map((i) => chipKind(i, audience).kind);
}

// A month cell's entries: the day's sessions first, then its due items. Both
// share the cell's chip capacity (chipsFor), so "+N more" counts them together.
// [{ type: 'session', session } | { type: 'due', item }]
export function dayEntries(daySessions, dayItems) {
  return [
    ...(daySessions ?? []).map((session) => ({ type: 'session', session })),
    ...(dayItems ?? []).map((item) => ({ type: 'due', item })),
  ];
}

// Phone cells with sessions: [{ kind, session? }], at most MAX_DOTS. Sessions
// come first as { kind: 'session', session } (the view tints them by subject);
// when due items exist too, one dot is kept for the most urgent of them.
export function dotsForDay(daySessions, dayItems, audience = 'family') {
  const sessions = daySessions ?? [];
  const due = dotsFor(dayItems, audience);
  const room = due.length ? MAX_DOTS - 1 : MAX_DOTS;
  const shown = sessions.slice(0, room).map((session) => ({ kind: 'session', session }));
  return [...shown, ...due.slice(0, MAX_DOTS - shown.length).map((kind) => ({ kind }))];
}

// ---------------------------------------------------------------------------
// Words

// "Due soon" -> "due soon"; "AI draft" keeps its capitals
function lowerFirst(s) {
  return /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

// "Wednesday, October 14", plus the year when it is not the current one
export function dateWords(key, today) {
  const { y } = parseKey(key);
  return y === parseKey(today).y ? longDate(key) : `${longDate(key)}, ${y}`;
}

// "Oct 14", plus the year when it is not the current one ("Jan 5, 2027")
export function shortDay(key, today) {
  const { y, m, d } = parseKey(key);
  const base = `${MONTHS_SHORT[m - 1]} ${d}`;
  return y === parseKey(today).y ? base : `${base}, ${y}`;
}

// "4 pm", "4:30 pm": a session's start on a month chip, in the business zone
export function chipTime(iso) {
  const { hour, minute } = businessTime(iso);
  return `${hour % 12 || 12}${minute ? `:${pad(minute)}` : ''} ${hour < 12 ? 'am' : 'pm'}`;
}

// "Algebra worksheet, overdue", "Essay for Maya Chen, AI draft": one due item
// spoken, for a day button or a link chip
export function itemAria(item, audience = 'family') {
  const who = item.studentName ? ` for ${item.studentName}` : '';
  return `${item.task.title || 'Untitled'}${who}, ${lowerFirst(itemStatus(item, { audience }).label)}`;
}

// The day button's accessible name:
// "Wednesday, October 14, today. 2 items: Algebra worksheet, overdue; Read chapter 3, done"
// "Thursday, October 15. Nothing due."
// Items may carry studentName (all-students calendar): "Essay for Maya Chen, AI draft".
// Pass options.sessions (an array, even an empty one) to speak the day's
// tutoring sessions first, "2 sessions: Algebra with Daniel Ortiz, 4:00 to
// 5:00 pm; ...", and to say "Nothing scheduled or due." on an empty day.
// options.whoFor(session) gives the name after "with"; options.now the clock.
export function dayLabel(key, dayItems, today, audience = 'family', options = {}) {
  const head = key === today ? `${dateWords(key, today)}, today` : dateWords(key, today);
  const list = dayItems ?? [];
  const withSessions = Array.isArray(options.sessions);
  const sessions = withSessions ? options.sessions : [];
  if (!list.length && !sessions.length) return `${head}. ${withSessions ? 'Nothing scheduled or due.' : 'Nothing due.'}`;
  const parts = [head];
  if (sessions.length) {
    const spoken = sessions.map((s) => sessionAria(s, { who: options.whoFor?.(s) ?? null, now: options.now ?? new Date() }));
    parts.push(`${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}: ${spoken.join('; ')}`);
  }
  if (list.length) {
    parts.push(`${list.length} ${list.length === 1 ? 'item' : 'items'}: ${list.map((item) => itemAria(item, audience)).join('; ')}`);
  }
  return parts.join('. ');
}

// ---------------------------------------------------------------------------
// Agenda (list view, and the day panel's "Next 7 days")

// { overdue, days: [{ key, items }], undated, later, end }
//   overdue  open work past its due time, oldest first (archived work excluded,
//            so missed work older than 30 days does not pile up here)
//   days     every item due from today through end (today + days - 1), by day,
//            overdue items excepted (they are pinned above)
//   undated  open work with no due date
//   later    how many dated items fall after end ("Show the next 30 days")
export function agendaGroups(items, today, { days = AGENDA_DAYS, audience = 'family' } = {}) {
  const end = addDays(today, days - 1);
  const overdue = [];
  const undated = [];
  const byDay = new Map();
  let later = 0;
  for (const item of items ?? []) {
    const due = item.task.due_at;
    if (!due) {
      if (item.dueState === 'undated') undated.push(item);
      continue;
    }
    if (item.dueState === 'overdue') {
      if (item.bucket !== 'archived') overdue.push(item);
      continue;
    }
    const key = dayKey(due);
    if (key < today) continue;
    if (key > end) {
      later += 1;
      continue;
    }
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }
  return {
    overdue: overdue.sort((a, b) => byDue(a.task, b.task)),
    days: [...byDay.keys()].sort().map((key) => ({ key, items: sortDay(byDay.get(key), audience) })),
    undated: sortDay(undated, audience),
    later,
    end,
  };
}

// Sessions in the agenda: agendaGroups' day groups plus the sessions of those
// days, so a day that holds only sessions still gets a group. Each day is
// { key, sessions, items }, sessions sorted by time; sessions before today are
// left out, and ones past the range join `later`.
export function agendaWithSessions(groups, sessions, today, { days = AGENDA_DAYS } = {}) {
  const end = addDays(today, days - 1);
  const sessionDays = new Map();
  let later = 0;
  for (const s of sortSessions(sessions)) {
    const key = dayKey(s.starts_at);
    if (key < today) continue;
    if (key > end) {
      later += 1;
      continue;
    }
    if (!sessionDays.has(key)) sessionDays.set(key, []);
    sessionDays.get(key).push(s);
  }
  const itemDays = new Map(groups.days.map((d) => [d.key, d.items]));
  const keys = [...new Set([...itemDays.keys(), ...sessionDays.keys()])].sort();
  return {
    ...groups,
    days: keys.map((key) => ({ key, sessions: sessionDays.get(key) ?? [], items: itemDays.get(key) ?? [] })),
    later: groups.later + later,
  };
}

// Sessions the viewer may still write up: over in the last NOTES_DAYS days, not
// cancelled, no attendance yet, and theirs to change (canEditSession). Oldest first.
export function needsNotes(sessions, now, me, { days = NOTES_DAYS, links = null } = {}) {
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  const from = t - days * 86_400_000;
  return sortSessions(sessions).filter((s) => {
    const ends = Date.parse(s.ends_at);
    return !isCancelled(s) && !s.attendance && ends <= t && ends > from && canEditSession(s, me, { links });
  });
}

// ---------------------------------------------------------------------------
// Week view

// The Sunday that starts the week the calendar shows: the hash's `w` when it is
// a real day, else the selected day's week, else today's when today is in the
// month on screen, else the month's first week.
export function deriveWeek({ week = null, selected = null, month, today }) {
  if (isDayKey(week)) return weekStartKey(week);
  if (isDayKey(selected)) return weekStartKey(selected);
  if (month && monthOf(today) !== month) return weekStartKey(`${month}-01`);
  return weekStartKey(today);
}

// The month a week belongs to: the one its Wednesday falls in
export function monthOfWeek(week) {
  return monthOf(addDays(week, 3));
}

// One day column of a time grid: { key, short, long, num, isToday, isWeekend }
export function dayColumn(key, today) {
  const wd = weekday(key);
  return {
    key,
    short: WEEKDAYS[wd].slice(0, 3),
    long: WEEKDAYS[wd],
    num: parseKey(key).d,
    isToday: key === today,
    isWeekend: wd === 0 || wd === 6,
  };
}

// The seven day columns of a week
export function weekDays(week, today) {
  return Array.from({ length: 7 }, (_, i) => dayColumn(addDays(week, i), today));
}

// "4 pm", "12 pm", "12 am": the hour labels down the week grid's side
export function hourLabel(hour) {
  return `${hour % 12 || 12} ${hour % 24 < 12 ? 'am' : 'pm'}`;
}

// The hours a grid shows, from hourRange's { start, end }: [7, 8, ..., 20]
export function hourMarks({ start, end }) {
  return Array.from({ length: Math.max(end - start, 0) }, (_, i) => start + i);
}

// Where "now" sits as a fraction of the shown hours (business zone), or null
// when it falls outside them
export function nowFraction(now, { start, end }) {
  const { hour, minute } = businessTime(now);
  const minutes = hour * 60 + minute;
  if (minutes < start * 60 || minutes >= end * 60) return null;
  return (minutes - start * 60) / ((end - start) * 60);
}

// The 'HH:00' an empty-slot click means, from how far down the column (0 to 1)
// it landed over the shown hours
export function slotTime(fraction, { start, end }) {
  const hours = Math.max(end - start, 1);
  const row = Number.isFinite(fraction) ? Math.min(Math.max(Math.floor(fraction * hours), 0), hours - 1) : 0;
  return `${pad(start + row)}:00`;
}

// Sessions that start on a day from startKey through endKey, both included
export function sessionsInRange(sessions, startKey, endKey) {
  return (sessions ?? []).filter((s) => {
    const key = dayKey(s.starts_at);
    return key >= startKey && key <= endKey;
  });
}

// The day keys a view covers, for the legend and the announcement: one day, a
// week, the month grid's 42 days, or the list's days from today
export function viewRange(view, { day, week, month, range = AGENDA_DAYS }, today) {
  if (view === 'day') return { start: day ?? today, end: day ?? today };
  if (view === 'week') return { start: week, end: addDays(week, 6) };
  if (view === 'month') {
    const cells = monthMatrix(month);
    return { start: cells[0].key, end: cells[cells.length - 1].key };
  }
  return { start: today, end: addDays(today, range - 1) };
}

// ---------------------------------------------------------------------------
// Day view

// "Tuesday, October 6, 2026": the Day view's title, always with the year
export function dayTitle(key) {
  return `${longDate(key)}, ${parseKey(key).y}`;
}

// The day the Day view opens on when someone switches to it. `day` is the hash's
// own `date`; otherwise it follows what the view they left was showing: its
// selected day, today when today is in the week or month on screen, or that
// span's first day. Pass `week` or `month` only for the view being left.
export function deriveDay({ day = null, selected = null, week = null, month = null, today }) {
  if (isDayKey(day)) return day;
  if (isDayKey(selected)) return selected;
  if (isDayKey(week)) return today >= week && today <= addDays(week, 6) ? today : week;
  if (isMonthKey(month)) return monthOf(today) === month ? today : `${month}-01`;
  return today;
}

// The previous and next buttons' accessible names for the view on screen. The
// Day, Week and Month views name the span they would show.
export function navLabels(view, { day, week, month }) {
  if (view === 'day') {
    return { prev: `Previous day, ${dayTitle(addDays(day, -1))}`, next: `Next day, ${dayTitle(addDays(day, 1))}` };
  }
  if (view === 'week') {
    return { prev: `Previous week, ${weekTitle(addDays(week, -7))}`, next: `Next week, ${weekTitle(addDays(week, 7))}` };
  }
  return { prev: `Previous month, ${monthTitle(shiftMonth(month, -1))}`, next: `Next month, ${monthTitle(shiftMonth(month, 1))}` };
}

// The params that say where a view is; a link to a day replaces them
const PLACE_PARAMS = ['view', 'date', 'w', 'm', 'd'];

// A link to one day's Day view from the current hash: the calendar's own
// params (scope, who, tutor) stay, the view's place is replaced and any open
// drawer is left behind. '#/calendar?scope=all&open=12' -> '#/calendar?date=2026-10-06&scope=all&view=day'
export function dayHref(hash, key) {
  const route = parseHash(hash);
  const params = {};
  for (const [k, v] of Object.entries(route.params)) {
    if (!DRAWER_PARAMS.includes(k) && !PLACE_PARAMS.includes(k)) params[k] = v;
  }
  return buildHash({ view: route.view ?? 'calendar', sub: route.sub, id: route.id, params: { ...params, view: 'day', date: key } });
}

// ---------------------------------------------------------------------------
// Whose sessions (the all-students calendar)

// { who: 'mine' | 'all', tutor: string | null } from the hash. A tutor starts
// on their own sessions (who=all shows everyone's); an admin may pick one
// tutor (tutor=<id>); anyone else sees every session they can read.
export function resolveSessionFilter(params = {}, role = null) {
  if (role === 'admin') return { who: 'all', tutor: params.tutor ? String(params.tutor) : null };
  if (role === 'tutor') return { who: params.who === 'all' ? 'all' : 'mine', tutor: null };
  return { who: 'all', tutor: null };
}

export function filterSessions(sessions, filter, me) {
  const list = sessions ?? [];
  if (filter?.tutor) return list.filter((s) => String(s.tutor_id) === String(filter.tutor));
  if (filter?.who === 'mine' && me?.id) return list.filter((s) => String(s.tutor_id) === String(me.id));
  return list;
}

// The admin's tutor select: [{ value, label }] by name, from the tutors the
// links and the sessions mention. names: Map of ids to names (staffNames). An
// admin who teaches (meId among them) comes first as "My sessions".
export function tutorOptions({ links = [], sessions = [], names = new Map(), meId = null } = {}) {
  const ids = new Set();
  for (const l of links) if (l.tutor_id) ids.add(String(l.tutor_id));
  for (const s of sessions) if (s.tutor_id) ids.add(String(s.tutor_id));
  const me = meId === null || meId === undefined ? null : String(meId);
  const others = [...ids]
    .filter((id) => id !== me)
    .map((id) => ({ value: id, label: String(names.get(id) ?? '').trim() || 'Unknown tutor' }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return me && ids.has(me) ? [{ value: me, label: 'My sessions' }, ...others] : others;
}

// The name after "with" for a session. One student's calendar names the tutor.
// The all-students calendar names the student; short is the one for tight
// blocks, and otherwise an admin (or a tutor looking at someone else's
// session) hears the tutor too: "Maya Lin and Daniel Ortiz".
export function sessionWho(session, {
  allScope = false, tutorNames = new Map(), studentNames = new Map(), role = null, viewerId = null, short = false,
} = {}) {
  const name = (map, id) => String(map.get(String(id)) ?? '').trim() || null;
  const tutor = name(tutorNames, session.tutor_id);
  if (!allScope) return tutor;
  const student = name(studentNames, session.student_id);
  const showTutor = role === 'admin' || (viewerId !== null && String(session.tutor_id) !== String(viewerId));
  // "Algebra with Maya Lin, taught by Daniel Ortiz" in a spoken label
  if (!short && showTutor && tutor && student) return `${student}, taught by ${tutor}`;
  return student;
}

// ---------------------------------------------------------------------------
// View state from the hash

// { view, month, selected, week, day } from the calendar params (view, m, d, w,
// date). The stored view (localStorage) counts only when the hash has none;
// then the width decides: Week at 768px and up (wide), List below. w is any day
// of the week; it is read as that week's Sunday. The Day view shows `date`
// (today when it is missing or not a real day) and takes its week and month
// from it. In the other views `date` is ignored and `day` is where the Day view
// would open from them (deriveDay).
export function resolveState(params = {}, { today, wide = true, stored = null } = {}) {
  let view = wide ? 'week' : 'list';
  if (CAL_VIEWS.includes(params.view)) view = params.view;
  else if (CAL_VIEWS.includes(stored)) view = stored;
  if (view === 'day') {
    const day = isDayKey(params.date) ? params.date : today;
    return { view, month: monthOf(day), selected: null, week: weekStartKey(day), day };
  }
  let selected = isDayKey(params.d) ? params.d : null;
  const weekParam = isDayKey(params.w) ? weekStartKey(params.w) : null;
  let month = monthOf(today);
  if (isMonthKey(params.m)) month = params.m;
  else if (selected) month = monthOf(selected);
  else if (weekParam) month = monthOfWeek(weekParam);
  // A day outside the visible grid is dropped, so the panel never describes a
  // day the grid does not show
  if (selected && !inGrid(month, selected)) selected = null;
  const week = deriveWeek({ week: weekParam, selected, month, today });
  return { view, month, selected, week, day: deriveDay({ selected, week: view === 'week' ? week : null, month, today }) };
}
