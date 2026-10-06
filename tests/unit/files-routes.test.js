import { test, expect, beforeAll } from 'vitest';
import { normalizeRoute, isScoped, viewTitle } from '../../portal/js/app-model.js';
import { parseHash } from '../../portal/js/router.js';

// routes.js pulls in every view, and with them the Supabase client: stand in for the CDN script
let routes;
beforeAll(async () => {
  globalThis.window = { supabase: { createClient: () => ({}) } };
  routes = await import('../../portal/js/routes.js');
});

const entryOf = (table) => table.files;

test('Files is a student-scoped view on the family pages and on staff.html', () => {
  for (const table of [routes.familyRoutes(), routes.staffRoutes()]) {
    expect(entryOf(table)).toBeTruthy();
    expect(typeof entryOf(table).mount).toBe('function');
    expect(viewTitle(entryOf(table), { view: 'files' })).toBe('Files');
    expect(isScoped(entryOf(table), { view: 'files' })).toBe(true);
  }
});

test('Files is not on the pages that have no student (people, account)', () => {
  expect(routes.peopleRoutes().files).toBeUndefined();
  expect(routes.accountRoutes().files).toBeUndefined();
});

test('#/files needs a student: staff without one go to Students, a family page goes home', () => {
  const route = (hash, table) => parseHash(hash, table);
  const staff = routes.staffRoutes();
  const family = routes.familyRoutes();
  expect(normalizeRoute(route('#/files', staff), { table: staff, hasScope: false, audience: 'staff', staff: true, defaultHash: '#/today' })).toBe('#/students');
  expect(normalizeRoute(route('#/files', staff), { table: staff, hasScope: true, audience: 'staff', staff: true, defaultHash: '#/today' })).toBeNull();
  expect(normalizeRoute(route('#/files', family), { table: family, hasScope: false, defaultHash: '#/overview' })).toBe('#/overview');
  expect(normalizeRoute(route('#/files', family), { table: family, hasScope: true, defaultHash: '#/overview' })).toBeNull();
});

test('the assignment drawer opens over Files like over any list, but only staff may create from it', () => {
  const family = routes.familyRoutes();
  const staff = routes.staffRoutes();
  const opts = { hasScope: true, defaultHash: '#/overview' };
  expect(normalizeRoute(parseHash('#/files?open=12', family), { table: family, ...opts })).toBeNull();
  expect(normalizeRoute(parseHash('#/files?open=new', family), { table: family, ...opts })).toBe('#/files');
  expect(normalizeRoute(parseHash('#/files?open=12', staff), { table: staff, ...opts, audience: 'staff', staff: true })).toBeNull();
});
