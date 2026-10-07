// Live updates, the parts with no browser in them (live.js wires them up).
//
// Supabase Realtime sends a message for each row that changes in a table the
// project publishes (supabase/migrations/20261020120000_realtime.sql). It only
// tells a person about rows their own read rules let them see, so a student
// hears about their own work and the admin hears about everything. A DELETE
// is the exception: the database can no longer check who may read the row, so
// a delete reaches every subscriber and carries only the primary key.
//
// This file decides which tables a role listens to, what one change means for
// the store's caches (the narrowest drop that keeps every list right), how a
// burst of changes becomes one refresh, and how long to wait between retries.

// Every table here has row level security on, and the portal's own reads of it
// are the only thing a message can reveal. See the migration for the list of
// tables that are deliberately left out.
export const FAMILY_TABLES = ['sessions', 'tasks', 'submissions', 'grades', 'updates', 'materials', 'profiles'];
export const STAFF_TABLES = ['session_series', 'tutor_students', 'student_profiles', 'student_notes'];

// The admin's money tables are not published. Only the admin reads or writes
// them, and a DELETE reaches every subscriber of a table (RLS cannot filter a
// row that is gone) with its primary key. The Account page already refreshes
// after the admin's own writes, and a change to a session or a person drops
// its billing data too (store.invalidate, store.invalidatePeople).
export const BILLING_TABLES = [
  'billing_settings', 'billing_policies', 'family_rates', 'tutor_rates', 'session_billing',
  'payments', 'payouts', 'billing_adjustments', 'billing_contacts', 'statements',
];

// Tables that must never be published: they hold tokens, invite secrets or
// the family contact details of people who are not signed in, or they are
// written while a person types (drafts), which would echo every keystroke.
export const NEVER_LIVE = [
  'google_connections', 'google_oauth_states', 'google_deletions',
  'portal_invites', 'review_invites', 'site_reviews', 'referrals', 'submission_drafts', 'session_edits',
  ...BILLING_TABLES,
];

// The tables one role subscribes to. Fewer tables means fewer messages for
// the database to check, and a role never asks for a table it cannot read.
export function liveTables(role) {
  switch (role) {
    case 'student': return [...FAMILY_TABLES];
    case 'parent': return [...FAMILY_TABLES, 'parent_students'];
    case 'tutor': return [...FAMILY_TABLES, ...STAFF_TABLES];
    case 'admin': return [...FAMILY_TABLES, ...STAFF_TABLES, 'parent_students'];
    default: return [];
  }
}

// Rows with a student_id: the change belongs to that student's cache
const STUDENT_TABLES = new Set([
  'sessions', 'session_series', 'tasks', 'submissions', 'grades', 'updates', 'materials',
  'student_profiles', 'student_notes',
]);
const LINK_TABLES = new Set(['tutor_students', 'parent_students']);

// What one refresh has to drop:
//   all       everything (a person was deleted, a message was cut short, we were offline)
//   people    the lists built from profiles and links
//   students  ids whose cached work, schedule and updates are stale
export const emptyPlan = () => ({ all: false, people: false, students: [] });

export function planIsEmpty(plan) {
  return !plan.all && !plan.people && plan.students.length === 0;
}

// Folds a plan fragment ({ all?, people?, students? }) into a plan
export function mergePlan(plan, fragment) {
  if (!fragment) return plan;
  if (fragment.all) plan.all = true;
  if (fragment.people) plan.people = true;
  for (const id of fragment.students ?? []) {
    const key = String(id);
    if (!plan.students.includes(key)) plan.students.push(key);
  }
  return plan;
}

const hasKeys = (row) => Boolean(row) && typeof row === 'object' && Object.keys(row).length > 0;

// One Realtime payload ({ table, eventType, new, old, errors }) -> a plan
// fragment. Anything it cannot place narrowly refreshes everything, because a
// missed change is worse than one more load.
export function classifyChange(payload) {
  const table = payload?.table;
  const isDelete = payload?.eventType === 'DELETE';
  // A message the server had to cut (too large) carries no row at all
  const row = isDelete ? payload?.old : payload?.new;
  const usable = hasKeys(row) && !payload?.errors;

  if (table === 'profiles') {
    // A deleted profile takes its sessions, work and billing with it
    return isDelete ? { all: true } : { people: true };
  }

  if (LINK_TABLES.has(table)) {
    // A link's primary key is both ids, so even a delete names the student
    const studentId = row?.student_id ?? payload?.old?.student_id ?? payload?.new?.student_id ?? null;
    return { people: true, students: studentId ? [studentId] : [], all: !usable && !studentId };
  }

  if (STUDENT_TABLES.has(table)) {
    const studentId = payload?.new?.student_id ?? payload?.old?.student_id ?? null;
    if (studentId) return { students: [studentId] };
    // A delete of a row whose primary key is not the student (a session, a task)
    return { all: true };
  }

  return { all: true };
}

// plan <- the change in one payload
export function addChange(plan, payload) {
  return mergePlan(plan, classifyChange(payload));
}

// Collects changes and hands them over as one plan after a quiet moment.
//   wait      how long without a new change before the plan is handed over
//   maxWait   the longest a steady stream of changes may hold it back
//   canFlush  false while the page cannot use a refresh (the tab is hidden);
//             the plan then waits for flushNow()
// Timers and the clock are passed in so tests control them.
export function createCoalescer({
  wait = 600,
  maxWait = 3000,
  onFlush,
  canFlush = () => true,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let plan = emptyPlan();
  let timer = null;
  let firstAt = null;       // when the first change of this plan arrived

  function fire() {
    timer = null;
    if (planIsEmpty(plan) || !canFlush()) return;
    const out = plan;
    plan = emptyPlan();
    firstAt = null;
    onFlush(out);
  }

  function arm() {
    if (timer !== null) clearTimer(timer);
    const left = Math.max(0, maxWait - (now() - firstAt));
    timer = setTimer(fire, Math.min(wait, left));
  }

  return {
    // fragment: a plan fragment, or a Realtime payload when it has a table
    add(change) {
      if (change && typeof change === 'object' && 'table' in change) addChange(plan, change);
      else mergePlan(plan, change);
      if (planIsEmpty(plan)) return;
      if (firstAt === null) firstAt = now();
      arm();
    },
    // Hand over whatever waits, now (the tab came back, a test)
    flushNow() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      fire();
    },
    pending: () => !planIsEmpty(plan),
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      plan = emptyPlan();
      firstAt = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Reconnecting

export const RETRY_BASE_MS = 1000;
export const RETRY_CAP_MS = 30_000;
// After this many tries in a row the page stops asking until the person comes
// back to the tab or the network returns (a project without Realtime would
// otherwise fail in the console all day)
export const MAX_ATTEMPTS = 8;

// Wait before retry number `attempt` (0 is the first): 1 s, 2 s, 4 s, 8 s, 16 s,
// then 30 s, each moved by up to 20% so many tabs do not retry together.
// random() returns [0, 1); 0.5 gives the plain value.
export function backoffMs(attempt, random = Math.random) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  const base = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.min(n, 20));
  return Math.round(base * (0.8 + 0.4 * random()));
}

// ---------------------------------------------------------------------------
// The tab

export const BROADCAST_NAME = 'vb-portal';

// A message from another tab of this site: { type: 'data-changed' } means
// something there changed data in a way Realtime cannot report (a person was
// deleted), so everything loads again
export function isDataChanged(data) {
  return Boolean(data) && typeof data === 'object' && data.type === 'data-changed';
}

// A tab that was away this long may have missed messages (a phone suspends its
// connection without telling the page), so it loads everything once on return
export const AWAY_REFRESH_MS = 15_000;

export function awayLongEnough(awayMs) {
  return Number.isFinite(awayMs) && awayMs >= AWAY_REFRESH_MS;
}

// ---------------------------------------------------------------------------
// Typing: a live refresh never redraws a page while someone is writing in it

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

// Is this control one a person types into? (select, checkbox and radio apply
// their change at once, so a redraw right after loses nothing)
export function isTextEntry(el) {
  if (!el) return false;
  const tag = String(el.tagName ?? '').toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') return TEXT_INPUT_TYPES.has(String(el.type || 'text').toLowerCase());
  return el.isContentEditable === true;
}

// Fields whose text the view keeps itself (a search box rebuilds from the
// remembered query) or the person cannot change
export function keepsOwnValue(el) {
  if (!el) return true;
  const type = String(el.type || '').toLowerCase();
  return type === 'search' || el.getAttribute?.('role') === 'searchbox' || el.readOnly === true || el.disabled === true;
}

// Does this field hold text the person typed and has not sent? `typed` is what
// they entered (the watcher in live.js records it), `base` the value when they
// first focused it.
export function holdsUnsentText(el, { touched, base }) {
  if (!el || !touched || keepsOwnValue(el) || !isTextEntry(el)) return false;
  const value = el.isContentEditable ? String(el.textContent ?? '') : String(el.value ?? '');
  return value !== String(base ?? '');
}
