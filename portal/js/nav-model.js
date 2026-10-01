// Pure navigation model. The sidebar, rail, overlay, phone tab bar and More sheet
// all render from this one model, so they always show the same items and counts.
//
// navModel({ role, page, scope, route, counts, fresh }) returns
//   { mode, groups: [{ key, label, switcher, items }], tabbar: [...], more: [...] }
// Item: { key, label, icon, href, current, ancestor, badge, railBadge, isNew, children }
//   current   this exact item is the page (aria-current="page")
//   ancestor  a child is current (parent label turns strong, no pill)
//   badge     { n, text, tone, context } or null; never shown with isNew
//   railBadge the count bubble for the rail and tab bar when children carry the counts
// counts: { todo, todoOverdue, inReview, tasksOpen, reviewQueue, pending }
// fresh:  { graded, updates } booleans for "New" (students and parents only)

const STAFF_ROLES = new Set(['tutor', 'admin']);
const STUDENT_VIEWS = new Set(['overview', 'assignments', 'tasks', 'calendar', 'updates']);
const SUBS = [['todo', 'To do'], ['in-review', 'In review'], ['graded', 'Graded'], ['archived', 'Archived']];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A count badge, or null at zero; "99+" above 99
export function badge(n, context, tone = 'neutral') {
  if (!n || n <= 0) return null;
  return { n, text: n > 99 ? '99+' : String(n), tone, context };
}

// Staff are in Student mode on a student-scoped route with a student chosen
export function isStudentMode(route, scope) {
  if (!scope?.student || !STUDENT_VIEWS.has(route?.view)) return false;
  return !(route.view === 'calendar' && route.params?.scope === 'all');
}

function item(key, label, icon, href, { current = false, badge: b = null, isNew = false, children = null, railBadge = null } = {}) {
  const ancestor = Boolean(children?.some((c) => c.current));
  // A row never shows a count and "New" together
  return { key, label, icon, href, current, ancestor, badge: isNew ? null : b, railBadge, isNew, children };
}

// Overview, Assignments (four subs), Tasks, Calendar, Updates for one student
function studentItems({ route, counts, fresh, family, staff }) {
  const view = route?.view;
  const sub = route?.sub ?? 'todo';
  const todoBadge = badge(
    counts.todo,
    counts.todoOverdue > 0 ? `${counts.todo} to do, ${counts.todoOverdue} overdue` : `${counts.todo} to do`,
    counts.todoOverdue > 0 ? 'danger' : 'neutral',
  );
  const subBadges = {
    todo: todoBadge,
    'in-review': badge(counts.inReview, `${counts.inReview} in review`),
  };
  const subNew = { graded: family && Boolean(fresh.graded) };
  const children = SUBS.map(([key, label]) => item(key, label, null, `#/assignments/${key}`, {
    current: view === 'assignments' && sub === key,
    badge: subBadges[key] ?? null,
    isNew: subNew[key] ?? false,
  }));
  const calendarCurrent = view === 'calendar' && route?.params?.scope !== 'all';
  return [
    item('overview', 'Overview', staff ? 'chart-line-up' : 'house', '#/overview', { current: view === 'overview' }),
    item('assignments', 'Assignments', 'clipboard-text', '#/assignments/todo', { children, railBadge: todoBadge }),
    item('tasks', 'Tasks', 'check-square', '#/tasks', {
      current: view === 'tasks',
      badge: badge(counts.tasksOpen, plural(counts.tasksOpen, 'open task', 'open tasks')),
    }),
    item('calendar', 'Calendar', 'calendar-blank', '#/calendar', { current: calendarCurrent }),
    item('updates', 'Updates', 'chat-circle-text', '#/updates', {
      current: view === 'updates',
      isNew: family && Boolean(fresh.updates),
    }),
  ];
}

// Today, Review queue, Students, Calendar (all students)
function workspaceItems({ route, counts, page }) {
  const onStaff = page !== 'people';
  const base = onStaff ? '' : '/portal/staff.html';
  const view = onStaff ? route?.view : null;
  return [
    item('today', 'Today', 'house', `${base}#/today`, { current: view === 'today' }),
    item('review', 'Review queue', 'tray', `${base}#/review`, {
      current: view === 'review',
      badge: badge(counts.reviewQueue, plural(counts.reviewQueue, 'submission to review', 'submissions to review')),
    }),
    item('students', 'Students', 'users-three', `${base}#/students`, { current: view === 'students' }),
    item('calendar-all', 'Calendar', 'calendar-blank', `${base}#/calendar?scope=all`, {
      current: view === 'calendar' && route?.params?.scope === 'all',
    }),
  ];
}

function peopleItem({ counts, page }) {
  return item('people', 'People', 'identification-badge', '/portal/people.html#/pending', {
    current: page === 'people',
    badge: badge(counts.pending, plural(counts.pending, 'person waiting', 'people waiting')),
  });
}

// A tab bar slot: same item without children or "New", with the rail count
function slot(it, label = it.label) {
  return {
    key: it.key, label, icon: it.icon, href: it.href,
    current: it.current || it.ancestor, badge: it.railBadge ?? it.badge, isNew: false,
  };
}

function moreSlot(more) {
  return { key: 'more', label: 'More', icon: 'list', href: null, current: more.some((i) => i.current || i.ancestor), badge: null, isNew: false };
}

export function navModel({ role, page, scope = null, route = null, counts = {}, fresh = {} }) {
  const c = {
    todo: 0, todoOverdue: 0, inReview: 0, tasksOpen: 0, reviewQueue: 0, pending: 0, ...counts,
  };
  const byKey = (list) => Object.fromEntries(list.map((i) => [i.key, i]));

  if (!STAFF_ROLES.has(role)) {
    // Students and parents. A parent with no linked child sees Overview only.
    const family = role === 'student' || role === 'parent';
    const noChild = role === 'parent' && !scope?.student;
    const all = studentItems({ route, counts: c, fresh, family, staff: false });
    const items = noChild ? all.slice(0, 1) : all;
    const k = byKey(items);
    let tabs = [k.overview];
    let more = [];
    if (!noChild && role === 'parent') { tabs = [k.overview, k.assignments, k.calendar, k.updates]; more = [k.tasks]; }
    else if (!noChild) { tabs = [k.overview, k.assignments, k.tasks, k.calendar]; more = [k.updates]; }
    return {
      mode: null,
      groups: [{ key: 'main', label: null, switcher: false, items }],
      tabbar: [...tabs.map((i) => slot(i)), moreSlot(more)],
      more,
    };
  }

  // Tutors and admins
  const onPeople = page === 'people';
  const isAdmin = role === 'admin';
  const work = workspaceItems({ route, counts: c, page });
  const student = !onPeople && scope?.student ? studentItems({ route, counts: c, fresh, family: false, staff: true }) : [];
  const people = isAdmin ? peopleItem({ counts: c, page }) : null;
  const groups = [{ key: 'workspace', label: 'Workspace', switcher: false, items: work }];
  if (!onPeople) groups.push({ key: 'student', label: 'Student', switcher: true, items: student });
  if (people) groups.push({ key: 'admin', label: 'Admin', switcher: false, items: [people] });

  const mode = !onPeople && isStudentMode(route, scope) ? 'student' : 'workspace';
  const w = byKey(work);
  let tabs;
  let more;
  if (mode === 'student') {
    const s = byKey(student);
    tabs = [s.overview, s.assignments, s.tasks, s.calendar];
    more = [s.updates, w.today, w.review, w.students, ...(people ? [people] : [])];
  } else if (isAdmin) {
    tabs = [w.today, w.review, w.students, people];
    more = [w['calendar-all']];
  } else {
    tabs = [w.today, w.review, w.students, w['calendar-all']];
    more = [];
  }
  return {
    mode,
    groups,
    tabbar: [...tabs.map((i) => slot(i, i.key === 'review' ? 'Review' : i.label)), moreSlot(more)],
    more,
  };
}
