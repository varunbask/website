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
  expect(Object.keys(familyRoutes('student'))).toEqual(views);
  expect(Object.keys(familyRoutes('parent'))).toEqual([...views, 'billing']);
  expect(familyRoutes('parent').billing).toMatchObject({ scoped: false });
  expect(familyRoutes('parent').billing.title({})).toBe('Billing');
});
