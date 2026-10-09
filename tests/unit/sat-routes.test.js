import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeRoute, isScoped, viewTitle, defaultCrumbs } from '../../portal/js/app-model.js';
import { parseHash } from '../../portal/js/router.js';
import { navModel, isStudentMode } from '../../portal/js/nav-model.js';
import { pageItems } from '../../portal/js/palette-items.js';
import { helpSections, partsText } from '../../portal/js/help-model.js';

// routes.js pulls in every view, and with them the Supabase client: stand in for the CDN script
let routes;
beforeAll(async () => {
  globalThis.window = { supabase: { createClient: () => ({}) } };
  routes = await import('../../portal/js/routes.js');
});

const MAYA = { id: 's1', full_name: 'Maya Lin' };
const keys = (list) => list.map((i) => i.key);
const fix = (hash, table, opts) => normalizeRoute(parseHash(hash, table), { table, defaultHash: '#/overview', ...opts });

describe('the #/sat routes', () => {
  test('on student.html and staff.html, not on parent.html, and student-scoped', () => {
    expect(routes.familyRoutes('student').sat).toBeTruthy();
    expect(routes.staffRoutes().sat).toBeTruthy();
    expect(routes.familyRoutes('parent').sat).toBeUndefined();
    expect(routes.peopleRoutes().sat).toBeUndefined();
    expect(isScoped(routes.staffRoutes().sat, { view: 'sat' })).toBe(true);
  });

  test('the home page stands without a sub; the runners and review take an id', () => {
    const table = routes.familyRoutes('student');
    for (const ok of ['#/sat', '#/sat/learn', '#/sat/learn/boundaries', '#/sat/practice', '#/sat/practice/alg-ch1', '#/sat/tests',
      '#/sat/test/full-01?module=rw2&sitting=abc', '#/sat/review/42?show=wrong', '#/sat/library?tab=bank']) {
      expect(fix(ok, table, { hasScope: true }), ok).toBeNull();
    }
    expect(parseHash('#/sat/practice/alg-ch1', table)).toMatchObject({ view: 'sat', sub: 'practice', id: 'alg-ch1' });
    // an id where none belongs is dropped; an unknown sub goes home
    expect(fix('#/sat/tests/9', table, { hasScope: true })).toBe('#/sat/tests');
    expect(fix('#/sat/library/x?tab=bank', table, { hasScope: true })).toBe('#/sat/library?tab=bank');
    expect(fix('#/sat/nope', table, { hasScope: true })).toBe('#/overview');
    // staff without a student go to Students
    const staff = routes.staffRoutes();
    expect(normalizeRoute(parseHash('#/sat', staff), { table: staff, hasScope: false, audience: 'staff', staff: true, defaultHash: '#/today' })).toBe('#/students');
  });

  test('other views with subs still need one (Assignments)', () => {
    const table = routes.familyRoutes('student');
    expect(fix('#/assignments', table, { hasScope: true })).toBe('#/assignments/todo');
    expect(fix('#/assignments/todo/5', table, { hasScope: true })).toBe('#/assignments/todo');
  });

  test('titles, crumbs with the student name for staff, and the runners hide the phone tab bar', () => {
    const entry = routes.staffRoutes().sat;
    expect(viewTitle(entry, parseHash('#/sat', routes.staffRoutes()))).toBe('SAT');
    const crumbs = defaultCrumbs(entry, parseHash('#/sat/practice', routes.staffRoutes()), { scopeName: 'Maya Lin' });
    expect(crumbs).toEqual([{ label: 'Maya Lin', href: '#/overview' }, { label: 'SAT', href: '#/sat' }, { label: 'Practice', href: null }]);
    expect(entry.hideTabbar(parseHash('#/sat/test/full-01', routes.staffRoutes()))).toBe(true);
    expect(entry.back(parseHash('#/sat/practice/alg-ch1', routes.staffRoutes()))).toEqual({ label: 'Back to practice', href: '#/sat/practice' });
    expect(entry.hideTabbar(parseHash('#/sat/practice', routes.staffRoutes()))).toBe(false);
    expect(entry.back(parseHash('#/sat', routes.staffRoutes()))).toBeNull();
  });
});

describe('the SAT nav item', () => {
  const route = { view: 'sat', sub: null, id: null, params: {} };

  test('a student sees it only once the admin turns SAT on, in More on phones', () => {
    const off = navModel({ role: 'student', page: 'student', scope: { student: MAYA, sat: false }, route });
    expect(keys(off.groups[0].items)).not.toContain('sat');
    const on = navModel({ role: 'student', page: 'student', scope: { student: MAYA, sat: true }, route });
    expect(keys(on.groups[0].items).at(-1)).toBe('sat');
    expect(on.groups[0].items.at(-1)).toMatchObject({ label: 'SAT', icon: 'exam', href: '#/sat', current: true });
    expect(keys(on.more)).toEqual(['files', 'updates', 'report', 'sat', 'profile', 'help']);
    expect(on.tabbar.at(-1).current).toBe(true);
  });

  test('a parent never sees it, even with the flag', () => {
    const m = navModel({ role: 'parent', page: 'parent', scope: { student: MAYA, sat: true }, route });
    expect(keys(m.groups[0].items)).not.toContain('sat');
  });

  test('staff see it for every student, and #/sat is student mode', () => {
    const m = navModel({ role: 'tutor', page: 'staff', scope: { student: MAYA }, route });
    expect(m.mode).toBe('student');
    expect(keys(m.groups[1].items).at(-1)).toBe('sat');
    expect(isStudentMode(route, { student: MAYA })).toBe(true);
  });

  test('the palette offers SAT to a student who has it', () => {
    const items = pageItems({ role: 'student', page: 'student', scope: { student: MAYA, sat: true } });
    expect(items.find((i) => i.key.startsWith('page:sat'))).toMatchObject({ title: 'SAT', target: { href: '#/sat' } });
    expect(pageItems({ role: 'student', page: 'student', scope: { student: MAYA } }).some((i) => i.key.startsWith('page:sat'))).toBe(false);
  });
});

describe('the SAT help', () => {
  const textOf = (role, opts) => helpSections(role, opts).find((s) => s.id === 'sat');
  const words = (section) => section.blocks.flatMap((b) => b.items.map(partsText)).join('\n');

  test('students with SAT, and staff; never parents; off by default', () => {
    expect(textOf('student')).toBeUndefined();
    expect(textOf('student', { sat: true })).toBeTruthy();
    expect(textOf('parent', { sat: true })).toBeUndefined();
    expect(textOf('tutor', { sat: true })).toBeTruthy();
    expect(helpSections('student', { sat: true }).map((s) => s.id)).toEqual(['contact', 'homework', 'schedule', 'sat', 'profile', 'install', 'privacy']);
  });

  test('family words never mention how work is graded or who wrote a set; no dashes', () => {
    const student = words(textOf('student', { sat: true }));
    expect(student).not.toMatch(/\bAI\b|grader|automatic|Matthew/i);
    expect(student).toMatch(/Check/);
    for (const role of ['tutor', 'admin']) expect(words(textOf(role, { sat: true }))).not.toMatch(/[–—]/);
    expect(words(textOf('admin', { sat: true }))).toMatch(/held back/);
    expect(words(textOf('tutor', { sat: true }))).not.toMatch(/held back/);
  });

  test('the help view asks for the SAT section for staff and students with access', () => {
    const view = readFileSync(new URL('../../portal/js/views/help.js', import.meta.url), 'utf8');
    expect(view).toContain("ctx.page === 'staff' || (ctx.role === 'student' && ctx.scope?.sat === true)");
  });
});

describe('the pages that load the SAT stylesheet', () => {
  test('student.html and staff.html link sat.css; parent.html does not', () => {
    const read = (p) => readFileSync(new URL(`../../portal/${p}`, import.meta.url), 'utf8');
    expect(read('student.html')).toContain('<link rel="stylesheet" href="/portal/css/sat.css?v=1">');
    expect(read('staff.html')).toContain('<link rel="stylesheet" href="/portal/css/sat.css?v=1">');
    expect(read('parent.html')).not.toContain('sat.css');
  });
});
