// What the command palette can jump to, built from data the app already has.
// Pure (no DOM, no store), so it runs in unit tests. palette-model.js ranks
// these; palette.js shows them and runs their `target`.
//
// An item (see palette-model.js for the search fields) also carries:
//   icon     an icons.js name, or avatar: a name to draw initials for
//   target   what Enter does:
//              { href }                  router.go (a hash, ?student=..., a page)
//              { drawer: { id, extra } } router.openDrawer: an assignment or task
//                                        id, 's<id>' for a session, 'new' or
//                                        'new-session' for the create forms
//              { switchTo: id }          change the child on screen (parents)
//
// staticItems()     pages, actions and children: cheap, rebuilt on every open
// staffDataItems()  students, assignments, tasks and sessions of the workspace
// familyDataItems() assignments, tasks and sessions of the one student on screen

import { displayName, byDue } from './format.js';
import { navModel } from './nav-model.js';
import { deriveItems } from './buckets.js';
import { upcomingSessions, sessionTitle, shortDayText } from './sessions-model.js';
import { clockLabel } from './schedule-summary.js';
import { dayKey, todayKey, longDate, shortDay, daysBetween } from './dates.js';

export const SESSION_DAYS = 14;

const STAFF = new Set(['tutor', 'admin']);
const STAFF_PAGE = '/portal/staff.html';

// Words that find a page without being in its name
const PAGE_WORDS = {
  today: 'home dashboard',
  review: 'queue grading submissions marking',
  students: 'people roster',
  'calendar-all': 'schedule sessions lessons',
  people: 'accounts approvals waiting pending sign ups',
  account: 'billing payroll money invoices',
  overview: 'home progress dashboard',
  assignments: 'homework',
  tasks: 'to do checklist',
  calendar: 'schedule sessions lessons',
  updates: 'messages news notes progress reports',
  todo: 'homework to do',
  'in-review': 'homework submitted waiting',
  graded: 'homework grades scores',
  archived: 'homework old past',
};

// Admin pages inside People and Account (the top ones come from the nav model)
const ADMIN_PAGES = [
  { key: 'people-everyone', title: 'Everyone', meta: 'People', icon: 'identification-badge', href: '/portal/people.html#/everyone', words: 'accounts roles tutors parents students links' },
  { key: 'people-referrals', title: 'Referrals', meta: 'People', icon: 'identification-badge', href: '/portal/people.html#/referrals', words: 'refer friends' },
  { key: 'people-reviews', title: 'Reviews', meta: 'People', icon: 'identification-badge', href: '/portal/people.html#/reviews', words: 'testimonials ratings' },
  { key: 'account-families', title: 'Families', meta: 'Account', icon: 'currency-dollar', href: '/portal/account.html#/families', words: 'billing statements payments invoices parents' },
  { key: 'account-payroll', title: 'Payroll', meta: 'Account', icon: 'currency-dollar', href: '/portal/account.html#/payroll', words: 'tutors pay payouts' },
  { key: 'account-rates', title: 'Rates', meta: 'Account', icon: 'currency-dollar', href: '/portal/account.html#/rates', words: 'prices billing pay' },
];

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const sameId = (a, b) => String(a) === String(b);

// ---------------------------------------------------------------------------
// Pages

// Every page the sidebar offers, from the same nav model (so the two never
// disagree), plus the admin's deeper pages. A chosen student's pages sit under
// their own header ("Maya Chen’s pages").
export function pageItems({ role, page, scope = null, route = null, multiple = false }) {
  const model = navModel({ role, page, scope, route });
  const staff = STAFF.has(role);
  const student = scope?.student ?? null;
  // Whose pages these are, when it is not obvious: staff always pick a
  // student, parents with several children choose between them
  const who = student && (staff || multiple) ? displayName(student) : null;
  const out = [];
  for (const g of model.groups) {
    const ownPages = (g.key === 'student' || g.key === 'main') && student;
    const own = ownPages && who ? { group: 'student-page', groupLabel: `${who}\u2019s pages` } : {};
    for (const it of g.items) {
      out.push({
        key: ownPages ? `page:${it.key}:${student.id}` : `page:${it.key}`,
        type: 'page',
        ...own,
        title: it.label,
        meta: it.key === 'calendar-all' ? 'All students' : (g.key === 'admin' ? 'Admin' : null),
        keywords: PAGE_WORDS[it.key] ?? '',
        icon: it.icon,
        target: { href: it.href },
        browse: true,
        weight: 3,
      });
      for (const c of it.children ?? []) {
        out.push({
          key: ownPages ? `page:${c.key}:${student.id}` : `page:${c.key}`,
          type: 'page',
          ...own,
          title: c.label,
          meta: it.label,
          keywords: `${PAGE_WORDS[c.key] ?? ''} ${PAGE_WORDS[it.key] ?? ''}`.trim(),
          icon: it.icon,
          target: { href: c.href },
          browse: false,
          weight: 2,
        });
      }
    }
  }
  if (role === 'admin') {
    for (const p of ADMIN_PAGES) {
      out.push({
        key: `page:${p.key}`, type: 'page', title: p.title, meta: p.meta, keywords: p.words, icon: p.icon,
        target: { href: p.href }, browse: false, weight: 2,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Actions and children

// New session, assignment and task for staff. The create forms hold a Student
// field when no student is on screen, so these work from anywhere.
export function actionItems({ role, scope = null }) {
  if (!STAFF.has(role)) return [];
  const student = scope?.student ?? null;
  const forWho = student ? `For ${displayName(student)}` : 'Choose the student in the form';
  return [
    {
      key: 'action:new-session', type: 'action', title: 'New session', meta: 'Add a lesson to the calendar',
      keywords: 'add create schedule lesson tutoring book', icon: 'plus',
      target: { drawer: { id: 'new-session' } }, browse: true, weight: 3,
    },
    {
      key: 'action:new-assignment', type: 'action', title: 'New assignment', meta: forWho,
      keywords: 'add create homework set', icon: 'plus',
      target: { drawer: { id: 'new', extra: { kind: 'assignment' } } }, browse: true, weight: 3,
    },
    {
      key: 'action:new-task', type: 'action', title: 'New task', meta: forWho,
      keywords: 'add create to do checklist', icon: 'plus',
      target: { drawer: { id: 'new', extra: { kind: 'task' } } }, browse: true, weight: 3,
    },
  ];
}

// Parents with two or more children: one entry per other child
export function childItems(children, currentId) {
  return (children ?? []).filter((c) => !sameId(c.id, currentId)).map((c) => ({
    key: `child:${c.id}`,
    type: 'child',
    title: `Switch to ${displayName(c)}`,
    avatar: displayName(c),
    keywords: 'child change show',
    target: { switchTo: c.id },
    browse: true,
    weight: 2,
  }));
}

// Pages, actions and children for whoever is looking, whatever page they are on
export function staticItems({ me, page, scope = null, route = null, options = [] }) {
  const multiple = me.role === 'parent' && (options?.length ?? 0) >= 2;
  return [
    ...pageItems({ role: me.role, page, scope, route, multiple }),
    ...actionItems({ role: me.role, scope }),
    ...(multiple ? childItems(options, scope?.student?.id) : []),
  ];
}

// ---------------------------------------------------------------------------
// Students

// One entry per student: Enter opens that student's Overview. From a page that
// is not staff.html (People, Account) the link goes there.
export function studentItems(students, { page = 'staff' } = {}) {
  const base = page === 'staff' ? '' : STAFF_PAGE;
  return (students ?? []).map((s) => {
    const name = displayName(s);
    return {
      key: `student:${s.id}`,
      type: 'student',
      title: name,
      meta: s.email && s.email !== name ? s.email : null,
      avatar: name,
      target: { href: `${base}?student=${encodeURIComponent(s.id)}#/overview` },
      weight: 2,
    };
  });
}

// ---------------------------------------------------------------------------
// Assignments and tasks

const open = (item) => (item.task.kind === 'task' ? !item.task.completed_at : item.bucket === 'todo' || item.bucket === 'in-review');

// "due Oct 9", "in review", "graded", "done"
function statusText(item, now) {
  const { task } = item;
  const due = task.due_at ? `due ${shortDay(task.due_at, now)}` : null;
  if (task.kind === 'task') return task.completed_at ? 'done' : (due ?? 'no due date');
  switch (item.bucket) {
    case 'in-review': return 'in review';
    case 'graded': return 'graded';
    case 'archived': return 'archived';
    default: return due ?? 'no due date';
  }
}

// Open work first (soonest due first), then finished work, then the archive.
// `names` (student id -> name) adds the student to every line, for staff.
export function workItems(items, { names = null, now = new Date() } = {}) {
  const tier = (i) => (open(i) ? 0 : i.bucket === 'archived' ? 2 : 1);
  const sorted = [...(items ?? [])].sort((a, b) => tier(a) - tier(b) || byDue(a.task, b.task));
  return sorted.map((item) => {
    const { task } = item;
    const isTask = task.kind === 'task';
    const student = names ? names.get(String(task.student_id)) ?? null : null;
    return {
      key: `task:${task.id}`,
      type: isTask ? 'task' : 'assignment',
      title: blank(task.title) ? 'Untitled' : task.title.trim(),
      meta: [student, isTask ? 'Task' : 'Assignment', statusText(item, now)].filter(Boolean).join(', '),
      keywords: isTask ? 'task to do checklist' : 'assignment homework',
      icon: isTask ? 'check-square' : 'clipboard-text',
      target: { drawer: { id: task.id } },
      weight: open(item) ? 1 : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Sessions

// "today", "tomorrow" for the next two days, so those words find them
function dayWords(key, today) {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return '';
}

// Sessions that have not ended, starting within `days` days, soonest first
// (cancelled ones excluded). `tutorId` keeps one tutor's own, as Today does.
export function sessionItems(sessions, { now = new Date(), names = null, tutorId = null, days = SESSION_DAYS } = {}) {
  const mine = tutorId === null || tutorId === undefined
    ? (sessions ?? [])
    : (sessions ?? []).filter((s) => sameId(s.tutor_id, tutorId));
  const today = todayKey(now);
  return upcomingSessions(mine, now, { days }).map((s) => {
    const key = dayKey(s.starts_at);
    const student = names ? names.get(String(s.student_id)) ?? null : null;
    const when = `${shortDayText(key, today)} at ${clockLabel(s.starts_at)}`;
    return {
      key: `session:${s.id}`,
      type: 'session',
      title: sessionTitle(s),
      meta: [student, when].filter(Boolean).join(', '),
      keywords: `session lesson tutoring ${longDate(key)} ${dayWords(key, today)}`.trim(),
      icon: 'calendar-blank',
      target: { drawer: { id: `s${s.id}` } },
      weight: 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Data builders

// The workspace (store.getWorkspace()) for a tutor or admin. A tutor sees their
// own sessions, an admin everyone's.
export function staffDataItems({ me, workspace, page = 'staff', now = new Date() }) {
  const students = workspace?.students ?? [];
  const names = new Map(students.map((s) => [String(s.id), displayName(s)]));
  const derived = deriveItems(workspace?.tasks ?? [], workspace?.submissions ?? [], now, { audience: 'staff' });
  return [
    ...studentItems(students, { page }),
    ...workItems(derived, { names, now }),
    ...sessionItems(workspace?.sessions ?? [], { now, names, tutorId: me.role === 'admin' ? null : me.id }),
  ];
}

// One student's data (store.getStudentData) and sessions, for them or a parent
export function familyDataItems({ data, sessions, now = new Date() }) {
  const derived = deriveItems(data?.tasks ?? [], data?.submissions ?? [], now, { audience: 'family' });
  return [
    ...workItems(derived, { now }),
    ...sessionItems(sessions ?? [], { now }),
  ];
}
