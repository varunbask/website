import { test, expect, vi } from 'vitest';

// The views import the store chain, which builds a Supabase client
vi.mock('../../portal/js/supabase.js', () => ({ sb: {} }));
const { familyRoutes } = await import('../../portal/js/routes.js');

test('Billing is the parent page only: student.html has no #/billing', () => {
  expect(Object.keys(familyRoutes('parent'))).toContain('billing');
  expect(Object.keys(familyRoutes('student'))).not.toContain('billing');
  expect(Object.keys(familyRoutes())).not.toContain('billing');
});

test('both family pages keep the student views; Billing is not about one child', () => {
  const views = ['overview', 'assignments', 'tasks', 'calendar', 'updates'];
  const student = Object.keys(familyRoutes('student'));
  expect(student).toEqual(expect.arrayContaining(views));
  // SAT is the student's own page in v1: parent.html has no SAT
  expect(student).toContain('sat');
  expect(Object.keys(familyRoutes('parent'))).toEqual([...student.filter((k) => k !== 'sat'), 'billing']);
  expect(familyRoutes('parent').billing).toMatchObject({ scoped: false });
  expect(familyRoutes('parent').billing.title({})).toBe('Billing');
});
