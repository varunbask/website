import { describe, test, expect } from 'vitest';
import {
  pageItems, actionItems, childItems, staticItems, studentItems, workItems, sessionItems,
  staffDataItems, familyDataItems, SESSION_DAYS,
} from '../../portal/js/palette-items.js';
import { rank, group, browse } from '../../portal/js/palette-model.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { zonedIso } from '../../portal/js/dates.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const at = (key, time = '16:00') => zonedIso(key, time);

const MAYA = { id: 's1', full_name: 'Maya Chen', email: 'maya@example.com' };
const LEO = { id: 's2', full_name: 'Leo Park', email: 'leo@example.com' };
const ZOE = { id: 's3', full_name: '', email: 'zoe@example.com' };

let nextId = 100;
const task = (extra = {}) => ({
  id: nextId++, student_id: 's1', kind: 'assignment', title: 'Essay draft', due_at: at('2026-10-20', '23:59'),
  completed_at: null, created_at: '2026-10-01T00:00:00Z', ...extra,
});
const sub = (taskId, extra = {}) => ({
  id: nextId++, task_id: taskId, student_id: 's1', status: 'graded', created_at: '2026-10-05T00:00:00Z', grade: null, ...extra,
});
const session = (key, extra = {}) => ({
  id: nextId++, student_id: 's1', tutor_id: 't1', subject: 'Algebra', starts_at: at(key, '16:00'), ends_at: at(key, '17:00'),
  status: 'scheduled', ...extra,
});

const keys = (items) => items.map((i) => i.key);
const titles = (items) => items.map((i) => i.title);
const find = (items, key) => items.find((i) => i.key === key);

describe('pageItems', () => {
  test('a student: the family pages, with Assignments sub-pages that only search finds', () => {
    const items = pageItems({ role: 'student', page: 'student', scope: { student: MAYA } });
    expect(titles(items)).toEqual(['Overview', 'Assignments', 'To do', 'In review', 'Graded', 'Archived', 'Tasks', 'Files', 'Calendar', 'Updates', 'Report', 'Profile', 'Help']);
    expect(items.filter((i) => i.browse).map((i) => i.title)).toEqual(['Overview', 'Assignments', 'Tasks', 'Files', 'Calendar', 'Updates', 'Report', 'Profile', 'Help']);
    expect(find(items, 'page:profile')).toMatchObject({ icon: 'user', target: { href: '#/profile' } });
    expect(find(items, 'page:overview:s1').target).toEqual({ href: '#/overview' });
    expect(find(items, 'page:graded:s1')).toMatchObject({ title: 'Graded', meta: 'Assignments', target: { href: '#/assignments/graded' }, browse: false });
    expect(items.every((i) => i.type === 'page' && i.icon && i.group === undefined)).toBe(true);
  });

  test('a student has no one else to name, so no header and no meta', () => {
    const items = pageItems({ role: 'student', page: 'student', scope: { student: MAYA } });
    expect(items.filter((i) => i.meta === null || i.meta === 'Assignments')).toHaveLength(items.length);
    expect(items.some((i) => i.groupLabel)).toBe(false);
  });

  test('a parent with one child is the same', () => {
    const items = pageItems({ role: 'parent', page: 'parent', scope: { student: MAYA }, multiple: false });
    expect(items.some((i) => i.groupLabel)).toBe(false);
    expect(titles(items)).toContain('Updates');
  });

  test('a parent with several children gets a header with the child on screen', () => {
    const items = pageItems({ role: 'parent', page: 'parent', scope: { student: MAYA }, multiple: true });
    expect(items.filter((i) => i.key !== 'page:help').every((i) => i.group === 'student-page' && i.groupLabel === 'Maya Chen’s pages')).toBe(true);
    expect(keys(items)).toContain('page:overview:s1');
    // the Profile page is the child's
    expect(find(items, 'page:profile:s1')).toMatchObject({ group: 'student-page', target: { href: '#/profile' } });
  });

  test('a parent with no linked child only has Overview', () => {
    const items = pageItems({ role: 'parent', page: 'parent', scope: { student: null } });
    expect(titles(items)).toEqual(['Overview', 'Billing', 'Help']);
    expect(items[0].key).toBe('page:overview');
  });

  test('a tutor with no student: the workspace pages only', () => {
    const items = pageItems({ role: 'tutor', page: 'staff', scope: null });
    expect(titles(items)).toEqual(['Today', 'Review queue', 'Students', 'Calendar', 'Profile', 'Help']);
    expect(find(items, 'page:today').target.href).toBe('#/today');
    expect(find(items, 'page:calendar-all')).toMatchObject({ meta: 'All students', target: { href: '#/calendar?scope=all' } });
    expect(items.every((i) => i.browse)).toBe(true);
  });

  test('a tutor with a student: that student’s pages under their own header', () => {
    const items = pageItems({ role: 'tutor', page: 'staff', scope: { student: LEO } });
    const own = items.filter((i) => i.group === 'student-page');
    expect(own.map((i) => i.title)).toEqual(['Overview', 'Assignments', 'To do', 'In review', 'Graded', 'Archived', 'Tasks', 'Files', 'Calendar', 'Updates', 'Report', 'SAT']);
    expect(own.every((i) => i.groupLabel === 'Leo Park’s pages' && i.key.endsWith(':s2'))).toBe(true);
    expect(items.filter((i) => !i.group).map((i) => i.title)).toEqual(['Today', 'Review queue', 'Students', 'Calendar', 'Profile', 'Help']);
    expect(find(items, 'page:profile').target.href).toBe('#/profile');
  });

  test('a student without a full name is called by their email', () => {
    const items = pageItems({ role: 'tutor', page: 'staff', scope: { student: ZOE } });
    expect(items.find((i) => i.group)?.groupLabel).toBe('zoe@example.com’s pages');
  });

  test('an admin also gets People and Account, and their pages, as full links', () => {
    const items = pageItems({ role: 'admin', page: 'staff', scope: null });
    expect(find(items, 'page:people')).toMatchObject({ meta: 'Admin', target: { href: '/portal/people.html#/pending' }, browse: true });
    expect(find(items, 'page:account').target.href).toBe('/portal/account.html#/dashboard');
    expect(find(items, 'page:account-payroll')).toMatchObject({ title: 'Payroll', meta: 'Account', target: { href: '/portal/account.html#/payroll' }, browse: false });
    expect(find(items, 'page:people-everyone').target.href).toBe('/portal/people.html#/everyone');
    expect(titles(items.filter((i) => i.browse))).toEqual(['Today', 'Review queue', 'Students', 'Calendar', 'People', 'Account', 'Profile', 'Help']);
  });

  test('a tutor never sees the admin pages', () => {
    const items = pageItems({ role: 'tutor', page: 'staff', scope: null });
    expect(items.some((i) => /people|account|payroll/.test(i.key))).toBe(false);
  });

  test('on the admin pages the workspace links lead back to staff.html', () => {
    const items = pageItems({ role: 'admin', page: 'people', scope: null });
    expect(find(items, 'page:today').target.href).toBe('/portal/staff.html#/today');
    expect(items.some((i) => i.group === 'student-page')).toBe(false);
  });

  test('keywords find a page by what it is for', () => {
    const items = pageItems({ role: 'admin', page: 'staff', scope: null });
    expect(rank(items, 'payroll')[0].item.key).toBe('page:account-payroll');
    expect(rank(items, 'billing')[0].item.key).toBe('page:account');
    expect(rank(items, 'approvals')[0].item.key).toBe('page:people');
    expect(rank(items, 'grading')[0].item.key).toBe('page:review');
  });
});

describe('actionItems', () => {
  test('staff get New session, assignment and task', () => {
    const items = actionItems({ role: 'tutor', scope: { student: MAYA } });
    expect(titles(items)).toEqual(['New session', 'New assignment', 'New task']);
    expect(find(items, 'action:new-session').target).toEqual({ drawer: { id: 'new-session' } });
    expect(find(items, 'action:new-assignment').target).toEqual({ drawer: { id: 'new', extra: { kind: 'assignment' } } });
    expect(find(items, 'action:new-task').target).toEqual({ drawer: { id: 'new', extra: { kind: 'task' } } });
    expect(items.every((i) => i.type === 'action' && i.browse && i.icon === 'plus')).toBe(true);
  });

  test('the student on screen is named, or the form is said to ask', () => {
    expect(find(actionItems({ role: 'tutor', scope: { student: MAYA } }), 'action:new-assignment').meta).toBe('For Maya Chen');
    expect(find(actionItems({ role: 'tutor', scope: null }), 'action:new-assignment').meta).toBe('Choose the student in the form');
  });

  test('students and parents get none', () => {
    expect(actionItems({ role: 'student', scope: { student: MAYA } })).toEqual([]);
    expect(actionItems({ role: 'parent', scope: { student: MAYA } })).toEqual([]);
  });

  test('"new" finds all three, "assignment" finds the action', () => {
    const items = actionItems({ role: 'admin' });
    expect(rank(items, 'new').map((e) => e.item.title).sort()).toEqual(['New assignment', 'New session', 'New task']);
    expect(rank(items, 'new asg')[0]?.item.title).toBe('New assignment');
    expect(rank(items, 'homework')[0].item.title).toBe('New assignment');
  });
});

describe('childItems', () => {
  test('one entry per other child', () => {
    const items = childItems([MAYA, LEO, ZOE], 's1');
    expect(titles(items)).toEqual(['Switch to Leo Park', 'Switch to zoe@example.com']);
    expect(items[0]).toMatchObject({ key: 'child:s2', type: 'child', avatar: 'Leo Park', target: { switchTo: 's2' }, browse: true });
  });

  test('ids may be numbers or text', () => {
    expect(childItems([{ id: 1, full_name: 'A' }, { id: 2, full_name: 'B' }], '1').map((i) => i.key)).toEqual(['child:2']);
  });

  test('searching a child’s name finds the switch', () => {
    expect(rank(childItems([MAYA, LEO], 's1'), 'leo')[0].item.target).toEqual({ switchTo: 's2' });
  });
});

describe('staticItems', () => {
  test('only parents with two or more children get the switch entries', () => {
    const one = staticItems({ me: { id: 'p', role: 'parent' }, page: 'parent', scope: { student: MAYA }, options: [MAYA] });
    expect(one.some((i) => i.type === 'child')).toBe(false);
    const two = staticItems({ me: { id: 'p', role: 'parent' }, page: 'parent', scope: { student: MAYA }, options: [MAYA, LEO] });
    expect(keys(two.filter((i) => i.type === 'child'))).toEqual(['child:s2']);
    expect(two.filter((i) => i.type === 'page' && i.key !== 'page:help').every((i) => i.group === 'student-page')).toBe(true);
  });

  test('staff get pages and actions, in that order, and no children', () => {
    const items = staticItems({ me: { id: 't1', role: 'tutor' }, page: 'staff', scope: { student: MAYA }, options: [MAYA, LEO] });
    expect(items.map((i) => i.type)).toEqual([...Array(18).fill('page'), 'action', 'action', 'action']);
  });

  test('students get pages only', () => {
    const items = staticItems({ me: { id: 's1', role: 'student' }, page: 'student', scope: { student: MAYA }, options: [] });
    expect(new Set(items.map((i) => i.type))).toEqual(new Set(['page']));
  });
});

describe('studentItems', () => {
  test('a made-up address of someone without a login is never shown or searched', () => {
    const ROSA = { id: 's9', full_name: 'Rosa Diaz', email: 'no-login+1f2e@people.varunbaskaran.com' };
    const [item] = studentItems([ROSA]);
    expect(item.meta).toBeNull();
    expect(rank([item], 'login')).toEqual([]);
    expect(rank([item], 'rosa')[0].item.key).toBe('student:s9');
  });

  test('each student opens their Overview', () => {
    const items = studentItems([MAYA, LEO]);
    expect(items[0]).toMatchObject({
      key: 'student:s1', type: 'student', title: 'Maya Chen', meta: 'maya@example.com', avatar: 'Maya Chen',
      target: { href: '?student=s1#/overview' },
    });
    expect(keys(items)).toEqual(['student:s1', 'student:s2']);
  });

  test('from another page the link goes to staff.html', () => {
    expect(studentItems([MAYA], { page: 'people' })[0].target.href).toBe('/portal/staff.html?student=s1#/overview');
    expect(studentItems([MAYA], { page: 'account' })[0].target.href).toBe('/portal/staff.html?student=s1#/overview');
  });

  test('ids are encoded', () => {
    expect(studentItems([{ id: 'a b&c', full_name: 'X' }])[0].target.href).toBe('?student=a%20b%26c#/overview');
  });

  test('no full name: the email is the title and is not repeated', () => {
    expect(studentItems([ZOE])[0]).toMatchObject({ title: 'zoe@example.com', meta: null });
  });

  test('searching by name, by part of a name, by an accent-free spelling, or by email', () => {
    const items = studentItems([MAYA, { id: 's9', full_name: 'Zoë O’Brien', email: 'zoe.obrien@example.com' }, LEO]);
    expect(rank(items, 'maya')[0].item.key).toBe('student:s1');
    expect(rank(items, 'park')[0].item.key).toBe('student:s2');
    expect(rank(items, 'zoe obrien')[0].item.key).toBe('student:s9');
    expect(rank(items, 'o brien')[0].item.key).toBe('student:s9');
    expect(rank(items, 'leo@')[0].item.key).toBe('student:s2');
    expect(rank(items, 'mc')[0].item.key).toBe('student:s1');
  });

  test('nothing in, nothing out', () => {
    expect(studentItems(null)).toEqual([]);
  });
});

describe('workItems', () => {
  const names = new Map([['s1', 'Maya Chen'], ['s2', 'Leo Park']]);
  const build = (tasks, subs = []) => workItems(deriveItems(tasks, subs, NOW, { audience: 'staff' }), { names, now: NOW });

  test('an open assignment: title, student, kind, due date; opens its drawer', () => {
    const t = task({ id: 7 });
    const [item] = build([t]);
    expect(item).toMatchObject({
      key: 'task:7', type: 'assignment', title: 'Essay draft', meta: 'Maya Chen, Assignment, due Oct 20',
      icon: 'clipboard-text', target: { drawer: { id: 7 } }, weight: 1,
    });
  });

  test('status words: in review, the result, extended, archived, no due date', () => {
    const inReview = task({ id: 1, title: 'A' });
    const graded = task({ id: 2, title: 'B' });
    const old = task({ id: 3, title: 'C', due_at: at('2026-08-01', '23:59') });
    const undated = task({ id: 4, title: 'D', due_at: null });
    const missing = task({ id: 5, title: 'E' });
    const extended = task({ id: 6, title: 'F', due_at: at('2026-10-20', '23:59'), extended_from: at('2026-10-10', '23:59') });
    const subs = [
      sub(1, { status: 'pending' }),
      sub(2, { grade: { released_at: '2026-10-12T00:00:00Z', result: 'completed' } }),
      sub(5, { grade: { released_at: '2026-10-12T00:00:00Z', result: 'missing' } }),
      sub(6, { grade: { released_at: '2026-10-12T00:00:00Z', result: 'extended' } }),
    ];
    const items = build([inReview, graded, old, undated, missing, extended], subs);
    const meta = Object.fromEntries(items.map((i) => [i.title, i.meta]));
    expect(meta).toEqual({
      A: 'Maya Chen, Assignment, in review',
      B: 'Maya Chen, Assignment, completed',
      C: 'Maya Chen, Assignment, archived',
      D: 'Maya Chen, Assignment, no due date',
      E: 'Maya Chen, Assignment, missing',
      F: 'Maya Chen, Assignment, extended to Oct 20',
    });
  });

  test('tasks: open, done, undated', () => {
    const items = build([
      task({ id: 1, kind: 'task', title: 'Pack calculator', due_at: at('2026-10-15', '23:59') }),
      task({ id: 2, kind: 'task', title: 'Watch video', completed_at: '2026-10-10T00:00:00Z' }),
      task({ id: 3, kind: 'task', title: 'Read', due_at: null }),
    ]);
    const meta = Object.fromEntries(items.map((i) => [i.title, i.meta]));
    expect(meta['Pack calculator']).toBe('Maya Chen, Task, due Oct 15');
    expect(meta['Watch video']).toBe('Maya Chen, Task, done');
    expect(meta.Read).toBe('Maya Chen, Task, no due date');
    expect(items.every((i) => i.type === 'task' && i.icon === 'check-square')).toBe(true);
  });

  test('open work comes first, soonest due first, then finished, then archived', () => {
    const items = build([
      task({ id: 1, title: 'archived', due_at: at('2026-08-01', '23:59') }),
      task({ id: 2, title: 'later', due_at: at('2026-10-30', '23:59') }),
      task({ id: 3, title: 'graded' }),
      task({ id: 4, title: 'soon', due_at: at('2026-10-15', '23:59') }),
    ], [sub(3, { grade: { released_at: '2026-10-12T00:00:00Z', result: 'completed' } })]);
    expect(titles(items)).toEqual(['soon', 'later', 'graded', 'archived']);
    expect(items.map((i) => i.weight)).toEqual([1, 1, 0, 0]);
  });

  test('without names (a family) the student is left out', () => {
    const [item] = workItems(deriveItems([task({ id: 9 })], [], NOW, { audience: 'family' }), { now: NOW });
    expect(item.meta).toBe('Assignment, due Oct 20');
  });

  test('a student the workspace does not know is left out of the line', () => {
    const [item] = build([task({ id: 9, student_id: 'nope' })]);
    expect(item.meta).toBe('Assignment, due Oct 20');
  });

  test('a blank title reads as Untitled; titles are trimmed', () => {
    const items = build([task({ id: 1, title: '  ' }), task({ id: 2, title: '  Essay  ' })]);
    expect(titles(items).sort()).toEqual(['Essay', 'Untitled']);
  });

  test('searching by title, by student and title, by kind, by status', () => {
    const items = build([
      task({ id: 1, title: 'Quadratics: factoring' }),
      task({ id: 2, title: 'Read chapter 6', student_id: 's2' }),
      task({ id: 3, kind: 'task', title: 'Bring calculator' }),
    ]);
    expect(rank(items, 'quadratic')[0].item.key).toBe('task:1');
    expect(rank(items, 'leo chapter')[0].item.key).toBe('task:2');
    expect(rank(items, 'maya chapter')).toEqual([]);
    expect(rank(items, 'calc')[0].item.key).toBe('task:3');
    expect(rank(items, 'task').map((e) => e.item.key)).toContain('task:3');
    expect(rank(items, 'homework').map((e) => e.item.key)).toEqual(['task:1', 'task:2']);
  });
});

describe('sessionItems', () => {
  const names = new Map([['s1', 'Maya Chen'], ['s2', 'Leo Park']]);

  test('a session: subject, student, day and time; opens its drawer', () => {
    const s = session('2026-10-15', { id: 55 });
    const [item] = sessionItems([s], { now: NOW, names });
    expect(item).toMatchObject({ key: 'session:55', type: 'session', title: 'Algebra', icon: 'calendar-blank', target: { drawer: { id: 's55' } }, weight: 1 });
    expect(item.meta).toMatch(/^Maya Chen, Thu, Oct 15 at 4:00 pm/);
  });

  test('only the next 14 days, soonest first', () => {
    // NOW is Oct 14 at noon, so the window closes on Oct 28 at noon
    const list = [
      session('2026-10-28', { id: 3, starts_at: at('2026-10-28', '11:00'), ends_at: at('2026-10-28', '12:00') }),
      session('2026-10-27', { id: 2 }),
      session('2026-10-28', { id: 4 }),
      session('2026-10-15', { id: 1 }),
    ];
    expect(SESSION_DAYS).toBe(14);
    expect(sessionItems(list, { now: NOW, names }).map((i) => i.key)).toEqual(['session:1', 'session:2', 'session:3']);
  });

  test('a session that already ended, and a cancelled one, are left out; one in progress stays', () => {
    const list = [
      session('2026-10-13', { id: 1 }),
      session('2026-10-15', { id: 2, status: 'cancelled' }),
      session('2026-10-14', { id: 3, starts_at: at('2026-10-14', '11:30'), ends_at: at('2026-10-14', '12:30') }),
      session('2026-10-14', { id: 4, starts_at: at('2026-10-14', '08:00'), ends_at: at('2026-10-14', '09:00') }),
    ];
    expect(sessionItems(list, { now: NOW, names }).map((i) => i.key)).toEqual(['session:3']);
  });

  test('a tutor sees their own sessions, no tutor id means all', () => {
    const list = [session('2026-10-15', { id: 1, tutor_id: 't1' }), session('2026-10-16', { id: 2, tutor_id: 't2' })];
    expect(sessionItems(list, { now: NOW, names, tutorId: 't1' }).map((i) => i.key)).toEqual(['session:1']);
    expect(sessionItems(list, { now: NOW, names, tutorId: null }).map((i) => i.key)).toEqual(['session:1', 'session:2']);
    expect(sessionItems(list, { now: NOW, names }).map((i) => i.key)).toEqual(['session:1', 'session:2']);
  });

  test('without names the line is the day and time alone; a blank subject is a tutoring session', () => {
    const [item] = sessionItems([session('2026-10-15', { subject: null })], { now: NOW });
    expect(item.title).toBe('Tutoring session');
    expect(item.meta).toMatch(/^Thu, Oct 15 at 4:00 pm/);
    expect(item.meta).not.toContain('Maya');
  });

  test('a day past this year says the year', () => {
    const [item] = sessionItems([session('2027-01-02')], { now: new Date('2026-12-28T19:00:00Z'), names });
    expect(item.meta).toMatch(/Sat, Jan 2, 2027 at 4:00 pm/);
  });

  test('search by subject, student, weekday, month and day, or "tomorrow"', () => {
    const list = [
      session('2026-10-14', { id: 1, starts_at: at('2026-10-14', '15:00'), ends_at: at('2026-10-14', '16:00') }),
      session('2026-10-15', { id: 2, subject: 'SAT Reading', student_id: 's2' }),
      session('2026-10-19', { id: 3 }),
    ];
    const items = sessionItems(list, { now: NOW, names });
    expect(rank(items, 'sat')[0].item.key).toBe('session:2');
    expect(rank(items, 'leo')[0].item.key).toBe('session:2');
    expect(rank(items, 'tomorrow').map((e) => e.item.key)).toEqual(['session:2']);
    expect(rank(items, 'today').map((e) => e.item.key)).toEqual(['session:1']);
    expect(rank(items, 'monday').map((e) => e.item.key)).toEqual(['session:3']);
    expect(rank(items, 'oct 19').map((e) => e.item.key)).toEqual(['session:3']);
    expect(rank(items, 'maya algebra').map((e) => e.item.key).sort()).toEqual(['session:1', 'session:3']);
  });
});

describe('staffDataItems', () => {
  const workspace = {
    students: [MAYA, LEO],
    tasks: [task({ id: 1, title: 'Essay draft' }), task({ id: 2, student_id: 's2', title: 'Ratios', kind: 'task' })],
    submissions: [],
    sessions: [
      session('2026-10-15', { id: 11, tutor_id: 't1' }),
      session('2026-10-16', { id: 12, tutor_id: 't2', student_id: 's2' }),
    ],
  };

  test('an admin gets every student, every item and every session', () => {
    const items = staffDataItems({ me: { id: 'a1', role: 'admin' }, workspace, now: NOW });
    expect(keys(items)).toEqual(['student:s1', 'student:s2', 'task:1', 'task:2', 'session:11', 'session:12']);
  });

  test('a tutor gets only their own sessions', () => {
    const items = staffDataItems({ me: { id: 't1', role: 'tutor' }, workspace, now: NOW });
    expect(keys(items).filter((k) => k.startsWith('session'))).toEqual(['session:11']);
  });

  test('students link to staff.html when the palette is on another page', () => {
    const items = staffDataItems({ me: { id: 'a1', role: 'admin' }, workspace, page: 'account', now: NOW });
    expect(items[0].target.href).toBe('/portal/staff.html?student=s1#/overview');
  });

  test('an empty or missing workspace is fine', () => {
    expect(staffDataItems({ me: { id: 'a1', role: 'admin' }, workspace: null, now: NOW })).toEqual([]);
    expect(staffDataItems({ me: { id: 'a1', role: 'admin' }, workspace: { students: [] }, now: NOW })).toEqual([]);
  });
});

describe('familyDataItems', () => {
  test('work and sessions of the student on screen, without student names', () => {
    const data = { tasks: [task({ id: 1 })], submissions: [] };
    const items = familyDataItems({ data, sessions: [session('2026-10-15', { id: 5 })], now: NOW });
    expect(keys(items)).toEqual(['task:1', 'session:5']);
    expect(items[0].meta).toBe('Assignment, due Oct 20');
  });

  test('a family never sees an unreleased grade as graded', () => {
    const t = task({ id: 1 });
    const data = { tasks: [t], submissions: [sub(1, { grade: { released_at: null, result: 'completed' } })] };
    expect(familyDataItems({ data, sessions: [], now: NOW })[0].meta).toBe('Assignment, in review');
  });

  test('nothing loaded is fine', () => {
    expect(familyDataItems({ data: null, sessions: null, now: NOW })).toEqual([]);
  });
});

describe('the palette end to end', () => {
  const me = { id: 't1', role: 'tutor' };
  const workspace = {
    students: [MAYA, LEO],
    tasks: [
      task({ id: 1, title: 'Essay draft', due_at: at('2026-10-16', '23:59') }),
      task({ id: 2, title: 'Maya, read chapter 6', student_id: 's2' }),
      ...Array.from({ length: 12 }, (_, i) => task({ id: 20 + i, title: `Worksheet ${i + 1}` })),
    ],
    submissions: [],
    sessions: [session('2026-10-15', { id: 11 })],
  };
  const items = [
    ...staticItems({ me, page: 'staff', scope: { student: MAYA }, options: [MAYA, LEO] }),
    ...staffDataItems({ me, workspace, now: NOW }),
  ];

  test('an empty box shows pages and actions, in groups', () => {
    const { groups } = group(browse(items), { perGroup: 12, total: 30 });
    expect(groups.map((g) => g.label)).toEqual(['Pages', 'Maya Chen’s pages', 'Actions']);
    expect(groups.map((g) => g.entries.length)).toEqual([6, 8, 3]);
  });

  test('recent picks lead and are not repeated below', () => {
    const recent = [find(items, 'student:s2'), find(items, 'page:today')];
    const { groups } = group(browse(items, { recent }), { perGroup: 12, total: 30 });
    expect(groups[0].label).toBe('Recent');
    expect(groups[0].entries.map((e) => e.item.key)).toEqual(['student:s2', 'page:today']);
    expect(groups.flatMap((g) => g.entries).filter((e) => e.item.key === 'page:today')).toHaveLength(1);
  });

  test('"maya" puts the student first, then the work and sessions that mention them', () => {
    const { groups } = group(rank(items, 'maya'));
    expect(groups[0].label).toBe('Students');
    expect(groups[0].entries[0].item.key).toBe('student:s1');
    expect(groups.map((g) => g.label)).toContain('Upcoming sessions');
  });

  test('"worksheet" is capped at 8 and says how many were left out', () => {
    const out = group(rank(items, 'worksheet'));
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].entries).toHaveLength(8);
    expect(out.hidden).toBe(4);
  });

  test('"maya essay" finds the essay through its student', () => {
    expect(rank(items, 'maya essay')[0].item.key).toBe('task:1');
  });

  test('"overview" finds the student’s page, not just any page', () => {
    const top = rank(items, 'overview')[0].item;
    expect(top).toMatchObject({ key: 'page:overview:s1', group: 'student-page' });
  });

  test('"new" finds the actions', () => {
    const top = group(rank(items, 'new')).groups[0];
    expect(top.label).toBe('Actions');
  });
});
