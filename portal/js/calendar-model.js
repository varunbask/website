// Pure calendar logic (spec 5.10): the 42-cell month matrix, day keys for
// items, keyboard movement, chip capacity, chip and dot kinds, spoken day
// labels, the agenda groups and the view state read from the hash.
// No DOM. Days are 'YYYY-MM-DD' keys in the business zone (dates.js) and are
// stepped with UTC calendar math only.

import { WEEK_START, dayKey, parseKey, addDays, weekday, longDate } from './dates.js';
import { itemStatus } from './status.js';
import { byDue } from './format.js';

export const CAL_VIEWS = Object.freeze(['month', 'list']);
export const AGENDA_DAYS = 30;   // list view range, extended 30 days at a time
export const PANEL_DAYS = 7;     // day panel with no selected day
export const MAX_DOTS = 3;       // phone month cells

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
export function chipKind(item, audience = 'family') {
  const kindIcon = item.task.kind === 'task' ? 'check-square' : 'clipboard-text';
  const status = itemStatus(item, { audience });
  switch (status.key) {
    case 'overdue': return { kind: 'overdue', icon: 'warning-circle' };
    case 'soon': return { kind: 'soon', icon: kindIcon };
    case 'todo': return { kind: 'open', icon: kindIcon };
    case 'done': return { kind: 'done', icon: kindIcon };
    case 'graded': return { kind: 'graded', icon: 'check-circle' };
    case 'not-turned-in': return { kind: 'missed', icon: 'minus-circle' };
    case 'draft':
    case 'edited': return { kind: 'draft', icon: 'pencil-simple-line' };
    case 'failed':
    case 'needs-attention': return { kind: 'failed', icon: 'x-circle' };
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

// The day button's accessible name:
// "Wednesday, October 14, today. 2 items: Algebra worksheet, overdue; Read chapter 3, done"
// "Thursday, October 15. Nothing due."
// Items may carry studentName (all-students calendar): "Essay for Maya Chen, AI draft".
export function dayLabel(key, dayItems, today, audience = 'family') {
  const head = key === today ? `${dateWords(key, today)}, today` : dateWords(key, today);
  const list = dayItems ?? [];
  if (!list.length) return `${head}. Nothing due.`;
  const parts = list.map((item) => {
    const who = item.studentName ? ` for ${item.studentName}` : '';
    return `${item.task.title || 'Untitled'}${who}, ${lowerFirst(itemStatus(item, { audience }).label)}`;
  });
  return `${head}. ${list.length} ${list.length === 1 ? 'item' : 'items'}: ${parts.join('; ')}`;
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

// ---------------------------------------------------------------------------
// View state from the hash

// { view, month, selected } from the calendar params (view, m, d). The stored
// view (localStorage) counts only when the hash has none; then the width
// decides: Month at 768px and up (wide), List below.
export function resolveState(params = {}, { today, wide = true, stored = null } = {}) {
  let view = wide ? 'month' : 'list';
  if (CAL_VIEWS.includes(params.view)) view = params.view;
  else if (CAL_VIEWS.includes(stored)) view = stored;
  let selected = isDayKey(params.d) ? params.d : null;
  let month = monthOf(today);
  if (isMonthKey(params.m)) month = params.m;
  else if (selected) month = monthOf(selected);
  // A day outside the visible grid is dropped, so the panel never describes a
  // day the grid does not show
  if (selected && !inGrid(month, selected)) selected = null;
  return { view, month, selected };
}
