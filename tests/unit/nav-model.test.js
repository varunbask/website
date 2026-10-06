import { describe, test, expect } from 'vitest';
import { navModel, isStudentMode, badge } from '../../portal/js/nav-model.js';

const route = (view, sub = null, params = {}) => ({ view, sub, id: null, params });
const MAYA = { student: { id: 's1', full_name: 'Maya Chen' } };
const COUNTS = { todo: 4, todoOverdue: 1, inReview: 2, tasksOpen: 3, reviewQueue: 7, pending: 3 };

// Every item in the sidebar, flattened (children included)
function flat(model) {
  const out = [];
  for (const g of model.groups) for (const item of g.items) out.push(item, ...(item.children ?? []));
  return out;
}
const find = (model, key) => flat(model).find((i) => i.key === key);
const keys = (items) => items.map((i) => i.key);
const current = (model) => flat(model).filter((i) => i.current).map((i) => i.key);

describe('badge', () => {
  test('hidden at zero, 99+ above 99, with context', () => {
    expect(badge(0, 'x')).toBeNull();
    expect(badge(undefined, 'x')).toBeNull();
    expect(badge(5, '5 to do')).toEqual({ n: 5, text: '5', tone: 'neutral', context: '5 to do' });
    expect(badge(100, 'lots').text).toBe('99+');
    expect(badge(99, 'lots').text).toBe('99');
    expect(badge(2, 'x', 'danger').tone).toBe('danger');
  });
});

describe('student', () => {
  const model = navModel({ role: 'student', page: 'student', scope: MAYA, route: route('assignments', 'graded'), counts: COUNTS, fresh: { graded: true, updates: false } });

  test('one unlabelled group with the family items', () => {
    expect(model.mode).toBeNull();
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].label).toBeNull();
    expect(keys(model.groups[0].items)).toEqual(['overview', 'assignments', 'tasks', 'files', 'calendar', 'updates']);
    expect(keys(find(model, 'assignments').children)).toEqual(['todo', 'in-review', 'graded', 'archived']);
    expect(find(model, 'overview')).toMatchObject({ label: 'Overview', icon: 'house', href: '#/overview' });
    expect(find(model, 'assignments')).toMatchObject({ icon: 'clipboard-text', href: '#/assignments/todo' });
    expect(find(model, 'in-review').href).toBe('#/assignments/in-review');
    expect(find(model, 'tasks')).toMatchObject({ icon: 'check-square', href: '#/tasks' });
    expect(find(model, 'files')).toMatchObject({ label: 'Files', icon: 'paperclip', href: '#/files', current: false, badge: null, isNew: false });
    expect(find(model, 'calendar')).toMatchObject({ icon: 'calendar-blank', href: '#/calendar' });
    expect(find(model, 'updates')).toMatchObject({ icon: 'chat-circle-text', href: '#/updates' });
  });

  test('current sub-item, with the parent marked as its ancestor', () => {
    expect(current(model)).toEqual(['graded']);
    expect(find(model, 'assignments').ancestor).toBe(true);
    expect(find(model, 'tasks').ancestor).toBe(false);
  });

  test('badges and New', () => {
    expect(find(model, 'todo').badge).toEqual({ n: 4, text: '4', tone: 'danger', context: '4 to do, 1 overdue' });
    expect(find(model, 'in-review').badge).toEqual({ n: 2, text: '2', tone: 'neutral', context: '2 in review' });
    expect(find(model, 'tasks').badge).toEqual({ n: 3, text: '3', tone: 'neutral', context: '3 open tasks' });
    expect(find(model, 'graded')).toMatchObject({ isNew: true, badge: null });
    expect(find(model, 'updates')).toMatchObject({ isNew: false, badge: null });
    expect(find(model, 'archived').badge).toBeNull();
    expect(find(model, 'assignments').badge).toBeNull();
    expect(find(model, 'assignments').railBadge).toEqual(find(model, 'todo').badge);
  });

  test('to do badge stays neutral with nothing overdue; zero counts are hidden', () => {
    const m = navModel({ role: 'student', page: 'student', scope: MAYA, route: route('overview'), counts: { todo: 1, todoOverdue: 0, inReview: 0, tasksOpen: 1 } });
    expect(find(m, 'todo').badge).toEqual({ n: 1, text: '1', tone: 'neutral', context: '1 to do' });
    expect(find(m, 'in-review').badge).toBeNull();
    expect(find(m, 'tasks').badge.context).toBe('1 open task');
    expect(current(m)).toEqual(['overview']);
  });

  test('tab bar: Overview, Assignments, Tasks, Calendar, More (Files, Updates)', () => {
    expect(keys(model.tabbar)).toEqual(['overview', 'assignments', 'tasks', 'calendar', 'more']);
    expect(keys(model.more)).toEqual(['files', 'updates']);
    expect(keys(model.tabbar)).not.toContain('files');
    const assignments = model.tabbar.find((i) => i.key === 'assignments');
    expect(assignments.current).toBe(true);
    expect(assignments.badge).toEqual(find(model, 'todo').badge);
    expect(model.tabbar.every((i) => i.isNew === false)).toBe(true);
    expect(model.tabbar.at(-1)).toMatchObject({ label: 'More', icon: 'list', href: null, current: false });
  });

  test('More is current when its hidden item is', () => {
    const m = navModel({ role: 'student', page: 'student', scope: MAYA, route: route('updates'), counts: COUNTS });
    expect(m.tabbar.at(-1).current).toBe(true);
    expect(current(m)).toEqual(['updates']);
  });

  test('Files is the current item on #/files, and More lights up with it', () => {
    const m = navModel({ role: 'student', page: 'student', scope: MAYA, route: route('files'), counts: COUNTS });
    expect(current(m)).toEqual(['files']);
    expect(find(m, 'files').ancestor).toBe(false);
    expect(m.tabbar.at(-1)).toMatchObject({ key: 'more', current: true });
    expect(m.tabbar.slice(0, -1).some((t) => t.current)).toBe(false);
    expect(m.more.find((i) => i.key === 'files')).toMatchObject({ label: 'Files', current: true, href: '#/files' });
  });
});

describe('parent', () => {
  test('same items; tab bar Overview, Assignments, Calendar, Updates, More (Tasks, Files)', () => {
    const m = navModel({ role: 'parent', page: 'parent', scope: MAYA, route: route('updates'), counts: COUNTS, fresh: { updates: true } });
    expect(keys(m.groups[0].items)).toEqual(['overview', 'assignments', 'tasks', 'files', 'calendar', 'updates']);
    expect(keys(m.tabbar)).toEqual(['overview', 'assignments', 'calendar', 'updates', 'more']);
    expect(keys(m.more)).toEqual(['tasks', 'files']);
    expect(find(m, 'updates').isNew).toBe(true);
    expect(m.tabbar.find((i) => i.key === 'updates')).toMatchObject({ current: true, isNew: false });
  });

  test('Files is current on #/files and More lights up', () => {
    const m = navModel({ role: 'parent', page: 'parent', scope: MAYA, route: route('files'), counts: COUNTS });
    expect(current(m)).toEqual(['files']);
    expect(m.tabbar.at(-1).current).toBe(true);
  });

  test('no linked child: Overview only', () => {
    const m = navModel({ role: 'parent', page: 'parent', scope: null, route: route('overview'), counts: {} });
    expect(keys(flat(m))).toEqual(['overview']);
    expect(keys(m.tabbar)).toEqual(['overview', 'more']);
    expect(m.more).toEqual([]);
  });
});

describe('tutor', () => {
  test('workspace group and a Student group with only the switcher before a student is chosen', () => {
    const m = navModel({ role: 'tutor', page: 'staff', scope: null, route: route('today'), counts: COUNTS });
    expect(m.mode).toBe('workspace');
    expect(m.groups.map((g) => [g.key, g.label, g.switcher])).toEqual([['workspace', 'Workspace', false], ['student', 'Student', true]]);
    expect(keys(m.groups[0].items)).toEqual(['today', 'review', 'students', 'calendar-all']);
    expect(m.groups[1].items).toEqual([]);
    expect(find(m, 'today')).toMatchObject({ label: 'Today', icon: 'house', href: '#/today', current: true });
    expect(find(m, 'review')).toMatchObject({ label: 'Review queue', icon: 'tray', href: '#/review' });
    expect(find(m, 'review').badge).toEqual({ n: 7, text: '7', tone: 'neutral', context: '7 submissions to review' });
    expect(find(m, 'students')).toMatchObject({ icon: 'users-three', href: '#/students' });
    expect(find(m, 'calendar-all')).toMatchObject({ label: 'Calendar', icon: 'calendar-blank', href: '#/calendar?scope=all' });
    expect(keys(m.tabbar)).toEqual(['today', 'review', 'students', 'calendar-all', 'more']);
    expect(m.tabbar[1].label).toBe('Review');
    expect(m.more).toEqual([]);
  });

  test('student items once a student is chosen; staff never see New', () => {
    const m = navModel({ role: 'tutor', page: 'staff', scope: MAYA, route: route('assignments', 'in-review'), counts: COUNTS, fresh: { graded: true, updates: true } });
    expect(m.mode).toBe('student');
    expect(keys(m.groups[1].items)).toEqual(['overview', 'assignments', 'tasks', 'files', 'calendar', 'updates']);
    expect(find(m, 'overview').icon).toBe('chart-line-up');
    expect(find(m, 'graded').isNew).toBe(false);
    expect(find(m, 'updates').isNew).toBe(false);
    expect(current(m)).toEqual(['in-review']);
    expect(keys(m.tabbar)).toEqual(['overview', 'assignments', 'tasks', 'calendar', 'more']);
    expect(keys(m.more)).toEqual(['files', 'updates', 'today', 'review', 'students']);
  });

  test('Files is a student item: current on #/files in Student mode, never before a student is chosen', () => {
    const m = navModel({ role: 'tutor', page: 'staff', scope: MAYA, route: route('files'), counts: COUNTS });
    expect(m.mode).toBe('student');
    expect(current(m)).toEqual(['files']);
    expect(m.tabbar.at(-1).current).toBe(true);
    const none = navModel({ role: 'tutor', page: 'staff', scope: null, route: route('today'), counts: COUNTS });
    expect(find(none, 'files')).toBeUndefined();
    expect(isStudentMode(route('files'), MAYA)).toBe(true);
    expect(isStudentMode(route('files'), null)).toBe(false);
  });

  test('calendar: the Workspace item is current with scope=all, the Student item otherwise', () => {
    const all = navModel({ role: 'tutor', page: 'staff', scope: MAYA, route: route('calendar', null, { scope: 'all' }), counts: COUNTS });
    expect(current(all)).toEqual(['calendar-all']);
    expect(all.mode).toBe('workspace');
    const one = navModel({ role: 'tutor', page: 'staff', scope: MAYA, route: route('calendar'), counts: COUNTS });
    expect(current(one)).toEqual(['calendar']);
    expect(one.mode).toBe('student');
  });

  test('the review page keeps Review queue current', () => {
    const m = navModel({ role: 'tutor', page: 'staff', scope: null, route: { view: 'review', sub: null, id: '481', params: {} }, counts: COUNTS });
    expect(current(m)).toEqual(['review']);
  });
});

describe('admin', () => {
  test('adds an Admin group with People (and the pending count) and Account', () => {
    const m = navModel({ role: 'admin', page: 'staff', scope: null, route: route('today'), counts: COUNTS });
    expect(m.groups.map((g) => g.key)).toEqual(['workspace', 'student', 'admin']);
    expect(keys(m.groups.at(-1).items)).toEqual(['people', 'account']);
    expect(find(m, 'people')).toMatchObject({ label: 'People', icon: 'identification-badge', href: '/portal/people.html#/pending', current: false });
    expect(find(m, 'people').badge).toEqual({ n: 3, text: '3', tone: 'neutral', context: '3 people waiting' });
    expect(find(m, 'account')).toMatchObject({ label: 'Account', icon: 'currency-dollar', href: '/portal/account.html#/dashboard', current: false, badge: null });
    expect(keys(m.tabbar)).toEqual(['today', 'review', 'students', 'people', 'more']);
    expect(keys(m.more)).toEqual(['calendar-all', 'account']);
  });

  test('tutors never get Account', () => {
    const m = navModel({ role: 'tutor', page: 'staff', scope: MAYA, route: route('overview'), counts: COUNTS });
    expect(find(m, 'account')).toBeUndefined();
    expect(keys(m.more)).not.toContain('account');
  });

  test('student mode adds People and Account to More', () => {
    const m = navModel({ role: 'admin', page: 'staff', scope: MAYA, route: route('overview'), counts: COUNTS });
    expect(keys(m.tabbar)).toEqual(['overview', 'assignments', 'tasks', 'calendar', 'more']);
    expect(keys(m.more)).toEqual(['files', 'updates', 'today', 'review', 'students', 'people', 'account']);
  });

  test('on account.html: no Student group, Account is current, links go back to the staff page', () => {
    const m = navModel({ role: 'admin', page: 'account', scope: MAYA, route: route('dashboard'), counts: COUNTS });
    expect(m.groups.map((g) => g.key)).toEqual(['workspace', 'admin']);
    expect(find(m, 'students').href).toBe('/portal/staff.html#/students');
    expect(current(m)).toEqual(['account']);
    expect(m.mode).toBe('workspace');
    expect(m.tabbar.find((t) => t.key === 'more').current).toBe(true);
  });

  test('on people.html: no Student group, links go back to the staff page', () => {
    const m = navModel({ role: 'admin', page: 'people', scope: null, route: route('pending'), counts: { ...COUNTS, pending: 1 } });
    expect(m.groups.map((g) => g.key)).toEqual(['workspace', 'admin']);
    expect(find(m, 'today').href).toBe('/portal/staff.html#/today');
    expect(find(m, 'calendar-all').href).toBe('/portal/staff.html#/calendar?scope=all');
    expect(current(m)).toEqual(['people']);
    expect(find(m, 'people').badge.context).toBe('1 person waiting');
    expect(m.mode).toBe('workspace');
  });
});

describe('invariants', () => {
  const cases = [];
  for (const role of ['student', 'parent', 'tutor', 'admin']) {
    for (const scope of [null, MAYA]) {
      for (const r of [route('overview'), route('assignments', 'graded'), route('files'), route('updates'), route('today')]) {
        cases.push({ role, page: role === 'tutor' || role === 'admin' ? 'staff' : role, scope, route: r });
      }
    }
  }

  test('never a count and New on the same row, never a zero badge', () => {
    for (const c of cases) {
      for (const counts of [COUNTS, { todo: 0, inReview: 0, tasksOpen: 0, reviewQueue: 0, pending: 0 }]) {
        const m = navModel({ ...c, counts, fresh: { graded: true, updates: true } });
        for (const item of [...flat(m), ...m.tabbar, ...m.more]) {
          expect(item.isNew && item.badge).toBeFalsy();
          if (item.badge) expect(item.badge.n).toBeGreaterThan(0);
        }
      }
    }
  });

  test('Files is never a tab: on phones it lives in the More sheet, in every role', () => {
    for (const c of cases) {
      const m = navModel({ ...c, counts: COUNTS });
      const label = `${c.role} ${c.scope ? 'with' : 'without'} a student on ${c.route.view}`;
      expect(m.tabbar.map((t) => t.key), label).not.toContain('files');
      // Students always have it; a parent needs a linked child; staff need Student mode
      const expected = c.role === 'student' || (c.role === 'parent' && c.scope !== null) || m.mode === 'student';
      expect(m.more.some((i) => i.key === 'files'), label).toBe(expected);
    }
  });

  test('the tab bar always has at most five slots and ends with More', () => {
    for (const c of cases) {
      const m = navModel({ ...c, counts: COUNTS });
      expect(m.tabbar.length).toBeLessThanOrEqual(5);
      expect(m.tabbar.at(-1).key).toBe('more');
    }
  });
});

describe('isStudentMode', () => {
  test('needs a student and a student-scoped route', () => {
    expect(isStudentMode(route('overview'), MAYA)).toBe(true);
    expect(isStudentMode(route('assignments', 'todo'), MAYA)).toBe(true);
    expect(isStudentMode(route('calendar'), MAYA)).toBe(true);
    expect(isStudentMode(route('calendar', null, { scope: 'all' }), MAYA)).toBe(false);
    expect(isStudentMode(route('today'), MAYA)).toBe(false);
    expect(isStudentMode(route('overview'), null)).toBe(false);
  });
});
