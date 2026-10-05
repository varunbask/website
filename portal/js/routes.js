// Route tables per page (spec 4.2). Entry fields are documented in app-model.js.

import * as overview from './views/overview.js';
import * as assignments from './views/assignments.js';
import * as tasks from './views/tasks.js';
import * as calendar from './views/calendar.js';
import * as updates from './views/updates.js';
import * as today from './views/today.js';
import * as reviewQueue from './views/review-queue.js';
import * as review from './views/review.js';
import * as students from './views/students.js';
import * as people from './views/people.js';
import * as accountDashboard from './views/account-dashboard.js';
import * as accountFamilies from './views/account-families.js';
import * as accountPayroll from './views/account-payroll.js';
import * as accountRates from './views/account-rates.js';
import * as accountPrint from './views/account-print.js';
import * as referrals from './views/referrals.js';
import * as reviews from './views/reviews.js';
import { normalizeFilter } from './review-model.js';

export const ASSIGNMENT_SUBS = Object.freeze(['todo', 'in-review', 'graded', 'archived']);
export const SUB_LABELS = Object.freeze({ todo: 'To do', 'in-review': 'In review', graded: 'Graded', archived: 'Archived' });
const SUB_TITLES = { todo: 'To do assignments', 'in-review': 'Assignments in review', graded: 'Graded assignments', archived: 'Archived assignments' };

const fixed = (text) => () => text;

function assignmentsEntry() {
  return {
    mount: (ctx) => assignments.mount(ctx),
    subs: ASSIGNMENT_SUBS,
    defaultSub: 'todo',
    scoped: true,
    title: (r) => SUB_TITLES[r.sub] ?? 'Assignments',
    label: (r) => SUB_LABELS[r.sub] ?? 'Assignments',
    crumbs: (r) => [{ label: 'Assignments', href: '#/assignments/todo' }, { label: SUB_LABELS[r.sub] ?? 'To do' }],
  };
}

// Student-scoped views shared by every page that shows one student
function studentViews({ overviewScoped }) {
  return {
    overview: { mount: (ctx) => overview.mount(ctx), title: fixed('Overview'), scoped: overviewScoped, named: true },
    assignments: assignmentsEntry(),
    tasks: { mount: (ctx) => tasks.mount(ctx), title: fixed('Tasks'), scoped: true },
    calendar: { mount: (ctx) => calendar.mount(ctx), title: fixed('Calendar'), scoped: true, wide: true },
    updates: { mount: (ctx) => updates.mount(ctx), title: fixed('Updates'), scoped: true },
  };
}

// student.html and parent.html. A parent with no linked child only has Overview
// (the welcome), which is why Overview itself is not scoped here.
export function familyRoutes() {
  return studentViews({ overviewScoped: false });
}

// staff.html: Workspace views, then the student-scoped ones (need ?student)
export function staffRoutes() {
  const student = studentViews({ overviewScoped: true });
  return {
    today: { mount: (ctx) => today.mount(ctx), title: fixed('Today') },
    review: {
      id: true,
      mount: (ctx) => (ctx.route.id ? review.mount(ctx) : reviewQueue.mount(ctx)),
      title: (r) => (r.id ? 'Review' : 'Review queue'),
      crumbs: (r) => (r.id ? [{ label: 'Review queue', href: '#/review' }, { label: 'Review' }] : [{ label: 'Review queue' }]),
      hideTabbar: (r) => Boolean(r.id),
      // No tab bar on the review page: phones get a way back to the queue
      back: (r) => {
        if (!r.id) return null;
        const f = normalizeFilter(r.params?.filter);
        return { label: 'Back to review queue', href: f === 'all' ? '#/review' : `#/review?filter=${f}` };
      },
    },
    students: { mount: (ctx) => students.mount(ctx), title: fixed('Students') },
    ...student,
    // One calendar route: scope=all is the Workspace calendar, otherwise the student's
    calendar: { ...student.calendar, scoped: (r) => r.params?.scope !== 'all' },
  };
}

// people.html (admin)
export function peopleRoutes() {
  const entry = (label) => ({
    mount: (ctx) => people.mount(ctx),
    title: fixed(label),
    crumbs: () => [{ label: 'People', href: '#/pending' }, { label }],
  });
  return {
    pending: entry('Waiting for approval'),
    everyone: entry('Everyone'),
    referrals: {
      mount: (ctx) => referrals.mount(ctx),
      title: fixed('Referrals'),
      crumbs: () => [{ label: 'People', href: '#/pending' }, { label: 'Referrals' }],
    },
    reviews: {
      mount: (ctx) => reviews.mount(ctx),
      title: fixed('Reviews'),
      crumbs: () => [{ label: 'People', href: '#/pending' }, { label: 'Reviews' }],
    },
  };
}

// account.html (admin): billing and payroll, priced from the calendar
export function accountRoutes() {
  const entry = (view, label) => ({
    mount: (ctx) => view.mount(ctx),
    title: fixed(label),
    crumbs: () => [{ label: 'Account', href: '#/dashboard' }, { label }],
    wide: true,
  });
  return {
    dashboard: entry(accountDashboard, 'Dashboard'),
    families: entry(accountFamilies, 'Families'),
    payroll: entry(accountPayroll, 'Payroll'),
    rates: entry(accountRates, 'Rates'),
    // Printable statement (#/statement/<parent id>?month=) and pay slip (#/payslip/<tutor id>?period=)
    statement: { ...entry(accountPrint, 'Statement'), id: true, hideTabbar: () => true, back: () => ({ label: 'Back to families', href: '#/families' }) },
    payslip: { ...entry(accountPrint, 'Pay slip'), id: true, hideTabbar: () => true, back: () => ({ label: 'Back to payroll', href: '#/payroll' }) },
  };
}
