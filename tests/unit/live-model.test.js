import { test, expect } from 'vitest';
import {
  FAMILY_TABLES, STAFF_TABLES, BILLING_TABLES, NEVER_LIVE, liveTables,
  emptyPlan, planIsEmpty, mergePlan, classifyChange, addChange, createCoalescer,
  backoffMs, MAX_ATTEMPTS, RETRY_CAP_MS, isDataChanged, BROADCAST_NAME, awayLongEnough, AWAY_REFRESH_MS,
  isTextEntry, keepsOwnValue, holdsUnsentText,
} from '../../portal/js/live-model.js';
import { fakeClock } from './fake-clock.js';

const change = (table, eventType, row) => ({
  schema: 'public',
  table,
  eventType,
  new: eventType === 'DELETE' ? {} : row,
  old: eventType === 'INSERT' ? {} : (eventType === 'DELETE' ? row : {}),
  errors: null,
});

// ---------------------------------------------------------------------------
// Which tables a role listens to

test('each role listens only to tables it can read', () => {
  expect(liveTables('student')).toEqual(FAMILY_TABLES);
  expect(liveTables('parent')).toEqual([...FAMILY_TABLES, 'parent_students']);
  expect(liveTables('tutor')).toEqual([...FAMILY_TABLES, ...STAFF_TABLES]);
  const admin = liveTables('admin');
  expect(admin).toEqual([...FAMILY_TABLES, ...STAFF_TABLES, 'parent_students']);
  // Nobody, the admin included, asks for the money tables (see BILLING_TABLES)
  for (const role of ['student', 'parent', 'tutor', 'admin']) {
    for (const table of BILLING_TABLES) expect(liveTables(role), `${role} ${table}`).not.toContain(table);
  }
  expect(liveTables('student')).not.toContain('student_notes');
  expect(liveTables('parent')).not.toContain('student_profiles');
  expect(liveTables('pending')).toEqual([]);
  expect(liveTables(undefined)).toEqual([]);
});

test('no role ever listens to a table with secrets, invites, drafts or contact details', () => {
  for (const role of ['student', 'parent', 'tutor', 'admin']) {
    for (const table of NEVER_LIVE) expect(liveTables(role), `${role} ${table}`).not.toContain(table);
  }
  for (const table of ['google_connections', 'google_oauth_states', 'portal_invites', 'review_invites', 'referrals', 'submission_drafts']) {
    expect(NEVER_LIVE).toContain(table);
  }
});

test('the ten billing tables are on the never-published list, and nothing listens to them', () => {
  expect(BILLING_TABLES).toEqual([
    'billing_settings', 'billing_policies', 'family_rates', 'tutor_rates', 'session_billing',
    'payments', 'payouts', 'billing_adjustments', 'billing_contacts', 'statements',
  ]);
  for (const table of BILLING_TABLES) expect(NEVER_LIVE, table).toContain(table);
  // a stray message from one of them is not narrowed to anything: it loads everything
  for (const table of BILLING_TABLES) expect(classifyChange(change(table, 'DELETE', { id: 1 })), table).toEqual({ all: true });
});

test('a table is listed once per role', () => {
  for (const role of ['student', 'parent', 'tutor', 'admin']) {
    const tables = liveTables(role);
    expect(new Set(tables).size, role).toBe(tables.length);
  }
});

// ---------------------------------------------------------------------------
// A change becomes the narrowest invalidation

test('a row with a student id drops that student only', () => {
  const studentRows = {
    sessions: { id: 4, student_id: 'maya', tutor_id: 'dan', attendance: 'present' },
    session_series: { id: 'ser', student_id: 'maya' },
    tasks: { id: 9, student_id: 'maya' },
    submissions: { id: 3, student_id: 'maya', task_id: 9 },
    grades: { submission_id: 3, student_id: 'maya', released_at: '2026-10-20T10:00:00Z' },
    updates: { id: 1, student_id: 'maya' },
    materials: { id: 2, student_id: 'maya' },
    student_profiles: { student_id: 'maya' },
    student_notes: { id: 5, student_id: 'maya' },
  };
  for (const [table, row] of Object.entries(studentRows)) {
    for (const type of ['INSERT', 'UPDATE']) {
      expect(classifyChange(change(table, type, row)), `${table} ${type}`).toEqual({ students: ['maya'] });
    }
  }
});

test('a delete that still names the student is narrow; one without it refreshes everything', () => {
  // student_profiles has the student as its primary key
  expect(classifyChange(change('student_profiles', 'DELETE', { student_id: 'maya' }))).toEqual({ students: ['maya'] });
  // a session's primary key is only its id: the student is unknown
  expect(classifyChange(change('sessions', 'DELETE', { id: 4 }))).toEqual({ all: true });
  expect(classifyChange(change('tasks', 'DELETE', { id: 9 }))).toEqual({ all: true });
  expect(classifyChange(change('grades', 'DELETE', { submission_id: 3 }))).toEqual({ all: true });
});

test('people and links drop the people lists, and the student when the row names one', () => {
  expect(classifyChange(change('profiles', 'UPDATE', { id: 'p1', full_name: 'New Name', role: 'student' }))).toEqual({ people: true });
  expect(classifyChange(change('profiles', 'INSERT', { id: 'p2', role: 'pending' }))).toEqual({ people: true });
  // a deleted person takes sessions, work and money with them
  expect(classifyChange(change('profiles', 'DELETE', { id: 'p1' }))).toEqual({ all: true });
  expect(classifyChange(change('parent_students', 'INSERT', { parent_id: 'grace', student_id: 'maya', bills: true })))
    .toEqual({ people: true, students: ['maya'], all: false });
  expect(classifyChange(change('tutor_students', 'DELETE', { tutor_id: 'dan', student_id: 'maya' })))
    .toEqual({ people: true, students: ['maya'], all: false });
  expect(classifyChange(change('tutor_students', 'UPDATE', { tutor_id: 'dan', student_id: 'maya', subject: 'SAT' })))
    .toEqual({ people: true, students: ['maya'], all: false });
});

test('a message the server cut short, or an unknown table, refreshes everything', () => {
  expect(classifyChange({ schema: 'public', table: 'sessions', eventType: 'UPDATE', new: {}, old: {}, errors: ['Error 413: Payload too large'] }))
    .toEqual({ all: true });
  expect(classifyChange({ table: 'something_new', eventType: 'INSERT', new: { id: 1 } })).toEqual({ all: true });
  expect(classifyChange(undefined)).toEqual({ all: true });
});

test('a plan folds fragments together without repeats', () => {
  const plan = emptyPlan();
  expect(planIsEmpty(plan)).toBe(true);
  addChange(plan, change('sessions', 'UPDATE', { id: 1, student_id: 'maya' }));
  addChange(plan, change('tasks', 'INSERT', { id: 2, student_id: 'maya' }));
  addChange(plan, change('tasks', 'INSERT', { id: 3, student_id: 'sam' }));
  expect(plan).toEqual({ all: false, people: false, students: ['maya', 'sam'] });
  mergePlan(plan, { people: true, students: ['maya'] });
  expect(plan).toEqual({ all: false, people: true, students: ['maya', 'sam'] });
  mergePlan(plan, { all: true });
  expect(plan.all).toBe(true);
  expect(planIsEmpty(plan)).toBe(false);
  expect(mergePlan(emptyPlan(), null)).toEqual(emptyPlan());
});

// ---------------------------------------------------------------------------
// Bursts become one refresh

test('a burst of changes is handed over once, after a quiet moment', () => {
  const clock = fakeClock();
  const flushed = [];
  const c = createCoalescer({ ...clock, onFlush: (plan) => flushed.push(plan) });
  c.add(change('sessions', 'UPDATE', { id: 1, student_id: 'maya' }));
  clock.advance(400);
  c.add(change('sessions', 'UPDATE', { id: 2, student_id: 'maya' }));
  clock.advance(400);
  c.add(change('tasks', 'UPDATE', { id: 3, student_id: 'sam' }));
  clock.advance(599);
  expect(flushed).toHaveLength(0);
  clock.advance(1);
  expect(flushed).toHaveLength(1);
  expect(flushed[0].students).toEqual(['maya', 'sam']);
  expect(c.pending()).toBe(false);
  // nothing fires again by itself
  clock.advance(10_000);
  expect(flushed).toHaveLength(1);
});

test('a steady stream cannot hold the refresh back for longer than maxWait', () => {
  const clock = fakeClock();
  const times = [];
  const c = createCoalescer({ ...clock, wait: 600, maxWait: 3000, onFlush: () => times.push(clock.now()) });
  // a change every half second: never quiet for 600 ms
  for (let t = 0; t < 10_000; t += 500) {
    c.add(change('sessions', 'UPDATE', { id: t, student_id: 'maya' }));
    clock.advance(500);
  }
  expect(times.slice(0, 3)).toEqual([3000, 6000, 9000]);
});

test('changes in separate bursts are handed over separately', () => {
  const clock = fakeClock();
  const flushed = [];
  const c = createCoalescer({ ...clock, onFlush: (plan) => flushed.push(plan) });
  c.add(change('sessions', 'UPDATE', { id: 1, student_id: 'maya' }));
  clock.advance(700);
  c.add(change('tasks', 'INSERT', { id: 1, student_id: 'sam' }));
  clock.advance(700);
  expect(flushed.map((p) => p.students)).toEqual([['maya'], ['sam']]);
});

test('while the tab is hidden the plan waits, and flushNow hands it over', () => {
  const clock = fakeClock();
  const flushed = [];
  let visible = false;
  const c = createCoalescer({ ...clock, canFlush: () => visible, onFlush: (plan) => flushed.push(plan) });
  c.add(change('sessions', 'UPDATE', { id: 1, student_id: 'maya' }));
  c.add({ all: true });
  clock.advance(5000);
  expect(flushed).toHaveLength(0);
  expect(c.pending()).toBe(true);
  visible = true;
  c.flushNow();
  expect(flushed).toHaveLength(1);
  expect(flushed[0].all).toBe(true);
  c.flushNow();
  expect(flushed).toHaveLength(1);
});

test('adding nothing does not start a timer, and cancel drops the plan', () => {
  const clock = fakeClock();
  const flushed = [];
  const c = createCoalescer({ ...clock, onFlush: (plan) => flushed.push(plan) });
  c.add({});
  c.add(null);
  expect(clock.count()).toBe(0);
  c.add({ people: true });
  expect(clock.count()).toBe(1);
  c.cancel();
  clock.advance(5000);
  expect(flushed).toHaveLength(0);
  expect(c.pending()).toBe(false);
});

// ---------------------------------------------------------------------------
// Reconnecting

test('the retry wait doubles from one second up to thirty, with a little spread', () => {
  const plain = (n) => backoffMs(n, () => 0.5);
  expect([0, 1, 2, 3, 4, 5, 6, 7].map(plain)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  expect(backoffMs(0, () => 0)).toBe(800);
  expect(backoffMs(0, () => 0.999)).toBe(1200);
  expect(backoffMs(40, () => 0.5)).toBe(RETRY_CAP_MS);
  expect(backoffMs(-3, () => 0.5)).toBe(1000);
  expect(backoffMs('x', () => 0.5)).toBe(1000);
  // the spread never exceeds twenty percent either way
  for (let n = 0; n < 8; n += 1) {
    const base = backoffMs(n, () => 0.5);
    expect(backoffMs(n, () => 0)).toBeGreaterThanOrEqual(base * 0.8 - 1);
    expect(backoffMs(n, () => 0.9999)).toBeLessThanOrEqual(base * 1.2 + 1);
  }
  expect(MAX_ATTEMPTS).toBeGreaterThan(4);
});

// ---------------------------------------------------------------------------
// Other tabs, and coming back

test('only a data-changed message from another tab counts', () => {
  expect(BROADCAST_NAME).toBe('vb-portal');
  expect(isDataChanged({ type: 'data-changed' })).toBe(true);
  expect(isDataChanged({ type: 'data-changed', at: 5 })).toBe(true);
  for (const bad of [null, undefined, 'data-changed', 7, {}, { type: 'other' }, { kind: 'data-changed' }]) expect(isDataChanged(bad)).toBe(false);
});

test('a tab that was away a short while does not reload everything', () => {
  expect(awayLongEnough(AWAY_REFRESH_MS)).toBe(true);
  expect(awayLongEnough(AWAY_REFRESH_MS - 1)).toBe(false);
  expect(awayLongEnough(0)).toBe(false);
  expect(awayLongEnough(Number.NaN)).toBe(false);
});

// ---------------------------------------------------------------------------
// Typing

const field = (tag, extra = {}) => ({ tagName: tag.toUpperCase(), type: 'text', value: '', readOnly: false, disabled: false, getAttribute: () => null, ...extra });

test('text fields count as typing; buttons, checkboxes and selects do not', () => {
  expect(isTextEntry(field('textarea'))).toBe(true);
  expect(isTextEntry(field('input'))).toBe(true);
  expect(isTextEntry(field('input', { type: 'email' }))).toBe(true);
  expect(isTextEntry(field('input', { type: 'date' }))).toBe(true);
  expect(isTextEntry(field('input', { type: 'checkbox' }))).toBe(false);
  expect(isTextEntry(field('input', { type: 'file' }))).toBe(false);
  expect(isTextEntry(field('select'))).toBe(false);
  expect(isTextEntry(field('button'))).toBe(false);
  expect(isTextEntry(field('div', { isContentEditable: true }))).toBe(true);
  expect(isTextEntry(null)).toBe(false);
});

test('a search box and read-only fields keep their own value', () => {
  expect(keepsOwnValue(field('input', { type: 'search' }))).toBe(true);
  expect(keepsOwnValue(field('input', { getAttribute: (n) => (n === 'role' ? 'searchbox' : null) }))).toBe(true);
  expect(keepsOwnValue(field('input', { readOnly: true }))).toBe(true);
  expect(keepsOwnValue(field('input', { disabled: true }))).toBe(true);
  expect(keepsOwnValue(field('textarea'))).toBe(false);
});

test('only text that was typed and still differs from the start counts as unsent', () => {
  const box = field('textarea', { value: 'half a not' });
  expect(holdsUnsentText(box, { touched: true, base: '' })).toBe(true);
  expect(holdsUnsentText(box, { touched: false, base: '' })).toBe(false);
  // typed, then put back to what it was
  expect(holdsUnsentText(field('textarea', { value: 'start' }), { touched: true, base: 'start' })).toBe(false);
  // a prefilled field the person changed
  expect(holdsUnsentText(field('input', { value: '25.00' }), { touched: true, base: '20.00' })).toBe(true);
  // the search box rebuilds itself
  expect(holdsUnsentText(field('input', { type: 'search', value: 'ma' }), { touched: true, base: '' })).toBe(false);
  expect(holdsUnsentText(null, { touched: true, base: '' })).toBe(false);
  expect(holdsUnsentText(field('div', { isContentEditable: true, textContent: 'Typed' }), { touched: true, base: '' })).toBe(true);
});
