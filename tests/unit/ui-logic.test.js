import { test, expect, describe } from 'vitest';
import { badgeText, initials, avatarSize, buttonClass, drawerHref, rowAside, rowMeta, labelPart } from '../../portal/js/ui.js';
import { toastDuration, menuIndex, MAX_TOASTS } from '../../portal/js/overlays.js';
import { normalizeTheme, storedValue, THEME_COLORS, THEME_KEY } from '../../portal/js/theme.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { dueLabel } from '../../portal/js/dates.js';

const NOW = new Date('2026-10-14T19:00:00.000Z'); // Wed Oct 14, 12:00 pm Pacific
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function itemFor(task, subs = [], audience = 'family') {
  return deriveItems([{ id: 1, kind: 'assignment', title: 'Algebra worksheet 3', created_at: daysAgo(60), completed_at: null, ...task }],
    subs.map((s, i) => ({ id: 100 + i, task_id: task.id ?? 1, status: 'ai_graded', created_at: minutesAgo(5), grade: null, ...s })),
    NOW, { audience })[0];
}

describe('badgeText', () => {
  test('hides zero, empty and negative counts', () => {
    for (const n of [0, null, undefined, -3, NaN, 'x']) expect(badgeText(n)).toBeNull();
  });
  test('shows the number up to 99, then "99+"', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(4521)).toBe('99+');
  });
});

describe('initials', () => {
  test('first and last word, at most two letters', () => {
    expect(initials('Maya Chen')).toBe('MC');
    expect(initials('maya li chen')).toBe('MC');
    expect(initials('  Maya  ')).toBe('M');
  });
  test('handles emails, accents and empty names', () => {
    expect(initials('maya.chen@example.com')).toBe('MC');
    expect(initials('élan Ørsted')).toBe('ÉØ');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

test('avatarSize snaps to a size the stylesheet has', () => {
  expect(avatarSize(24)).toBe(24);
  expect(avatarSize(40)).toBe(40);
  expect(avatarSize(27)).toBe(28);
  expect(avatarSize(64)).toBe(40);
  expect(avatarSize()).toBe(32);
});

test('buttonClass maps variant, size and block, defaulting to secondary', () => {
  expect(buttonClass()).toBe('btn btn-secondary');
  expect(buttonClass({ variant: 'primary', size: 'sm' })).toBe('btn btn-primary btn-sm');
  expect(buttonClass({ variant: 'danger-ghost', size: 'lg', block: true })).toBe('btn btn-danger-ghost btn-lg btn-block');
  expect(buttonClass({ variant: 'fancy', size: 'xl' })).toBe('btn btn-secondary');
});

describe('drawerHref', () => {
  test('adds open to the current view', () => {
    expect(drawerHref('#/assignments/graded', 12)).toBe('#/assignments/graded?open=12');
  });
  test('keeps view params, drops other drawer params, sorts', () => {
    expect(drawerHref('#/calendar?view=month&m=2026-10&open=3&focus=submit', 5))
      .toBe('#/calendar?m=2026-10&open=5&view=month');
  });
  test('works without a hash', () => {
    expect(drawerHref('', 7)).toBe('#/?open=7');
  });
});

describe('labelPart', () => {
  test('drops a closing period so label parts join cleanly', () => {
    expect(labelPart('Graph each answer on a number line.')).toBe('Graph each answer on a number line');
    expect(labelPart('  Problems 1 to 15. Show work.  ')).toBe('Problems 1 to 15. Show work');
    expect(labelPart('No period')).toBe('No period');
    expect(labelPart(null)).toBe('');
  });
});

describe('rowAside', () => {
  test('open work shows its due label and tone', () => {
    const due = '2026-10-16T06:59:00.000Z'; // Thu Oct 15, 11:59 pm Pacific
    const item = itemFor({ due_at: due });
    expect(rowAside(item, NOW)).toEqual({ ...dueLabel(due, NOW), iso: due });
    expect(rowAside(item, NOW).tone).toBe('warning');
  });
  test('undated open work has no date', () => {
    expect(rowAside(itemFor({ due_at: null }), NOW)).toBeNull();
  });
  test('in-review work shows when it was submitted', () => {
    const item = itemFor({ due_at: daysAgo(2) }, [{ status: 'pending', created_at: minutesAgo(5) }]);
    expect(rowAside(item, NOW).text).toBe('Submitted 5 minutes ago');
    expect(rowAside(item, NOW).tone).toBeNull();
    const fresh = itemFor({ due_at: null }, [{ status: 'pending', created_at: NOW.toISOString() }]);
    expect(rowAside(fresh, NOW).text).toBe('Submitted just now');
  });
  test('graded work shows the release date, in each audience’s words', () => {
    const subs = [{ status: 'ai_graded', created_at: daysAgo(3), grade: { result: 'completed', reviewed_at: daysAgo(1), released_at: daysAgo(1) } }];
    const family = rowAside(itemFor({ due_at: daysAgo(4) }, subs), NOW);
    expect(family.text).toBe('Graded Oct 13');
    expect(family.label).toBe('Graded Oct 13');
    expect(family.full).toMatch(/^Graded October 13, 2026 at /);
    // Staff rows show the bare date beside the result pill
    const staff = rowAside(itemFor({ due_at: daysAgo(4) }, subs, 'staff'), NOW, { audience: 'staff' });
    expect(staff.text).toBe('Oct 13');
    expect(staff.label).toBe('Released Oct 13');
    expect(staff.full).toMatch(/^Released October 13, 2026 at /);
  });
  test('missed work shows its due date, never "N days overdue"', () => {
    const item = itemFor({ due_at: '2026-08-02T06:59:00.000Z' });
    expect(item.bucket).toBe('archived');
    expect(rowAside(item, NOW).text).toBe('Due Aug 1');
    expect(rowAside(item, NOW).tone).toBeNull();
  });
  test('done tasks show when they were done', () => {
    const item = itemFor({ kind: 'task', due_at: null, completed_at: minutesAgo(120) });
    expect(rowAside(item, NOW).text).toBe('Done 2 hours ago');
  });
});

describe('rowMeta', () => {
  test('resubmissions show the attempt and the previous released result', () => {
    const subs = [
      { status: 'pending', created_at: minutesAgo(5) },
      { status: 'ai_graded', created_at: daysAgo(9), grade: { result: 'missing', reviewed_at: daysAgo(8), released_at: daysAgo(8) } },
    ];
    expect(rowMeta(itemFor({ due_at: daysAgo(10) }, subs))).toEqual(['Attempt 2 of 5', 'Previous result Missing']);
    const extended = [subs[0], { ...subs[1], grade: { ...subs[1].grade, result: 'extended' } }];
    expect(rowMeta(itemFor({ due_at: daysAgo(10) }, extended))).toEqual(['Attempt 2 of 5', 'Previous result Extended']);
  });
  test('an extended assignment shows its new due date in the date column', () => {
    const subs = [{ status: 'ai_graded', created_at: daysAgo(3), grade: { result: 'extended', reviewed_at: daysAgo(1), released_at: daysAgo(1) } }];
    const item = itemFor({ due_at: '2026-10-18T06:59:00.000Z', extended_from: daysAgo(2) }, subs);
    expect(item.bucket).toBe('todo');
    expect(rowAside(item, NOW).text).toMatch(/^Due /);
  });
  test('student name and kind when asked', () => {
    const item = itemFor({ kind: 'task', due_at: null });
    expect(rowMeta(item, { showStudent: true, studentName: 'Maya Chen', variant: 'mixed' })).toEqual(['Maya Chen', 'Task']);
    expect(rowMeta(item)).toEqual([]);
  });
});

test('toastDuration: 6 seconds, 10 with an action, or the given duration', () => {
  expect(toastDuration()).toBe(6000);
  expect(toastDuration({ action: { label: 'Undo', run() {} } })).toBe(10000);
  expect(toastDuration({ duration: 3000, action: { label: 'Undo' } })).toBe(3000);
  expect(MAX_TOASTS).toBe(3);
});

test('menuIndex: arrows wrap, Home and End jump, other keys do nothing', () => {
  expect(menuIndex(-1, 'ArrowDown', 3)).toBe(0);
  expect(menuIndex(-1, 'ArrowUp', 3)).toBe(2);
  expect(menuIndex(2, 'ArrowDown', 3)).toBe(0);
  expect(menuIndex(0, 'ArrowUp', 3)).toBe(2);
  expect(menuIndex(1, 'Home', 3)).toBe(0);
  expect(menuIndex(1, 'End', 3)).toBe(2);
  expect(menuIndex(1, 'a', 3)).toBeNull();
  expect(menuIndex(0, 'ArrowDown', 0)).toBeNull();
});

test('theme values match the landing page contract', () => {
  expect(THEME_KEY).toBe('vb-theme');
  expect(normalizeTheme('dark')).toBe('dark');
  expect(normalizeTheme('system')).toBe('light');
  expect(normalizeTheme(null)).toBe('light');
  expect(storedValue('dark')).toBe('dark');
  expect(storedValue('light')).toBeNull();
  expect(THEME_COLORS).toEqual({ light: '#EEEFF2', dark: '#0B0C0E' });
});
