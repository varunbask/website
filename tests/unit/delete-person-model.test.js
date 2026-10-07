import { describe, test, expect } from 'vitest';
import {
  plural, firstName, confirmName, nameMatches, canDelete, normalizePreview, namesWithCounts, listNames, headline, detailLines,
  typedLabel, blockedTitle, deleteTitle, doneText, failureText, problemText, withoutPerson,
} from '../../portal/js/delete-person-model.js';
import { nameMatches as serverNameMatches, refusalMessage } from '../../api/_lib/people-delete.js';

const constance = { id: 'c', full_name: 'Constance  Lin', email: 'no-login+c@people.varunbaskaran.com', role: 'student' };
const me = { id: 'admin' };

const counts = (over = {}) => ({
  sessions: 0, upcoming_sessions: 0, assignments: 0, tasks: 0, submissions: 0, drafts: 0, files: 0, updates: 0, series: 0, rates: 0, links: 0, invites: 0, statements: 0,
  ...over,
});
const preview = (over = {}, c = {}) => normalizePreview({ person: constance, counts: counts(c), ...over });

describe('words', () => {
  test('plurals', () => {
    expect(plural(0, 'lesson')).toBe('0 lessons');
    expect(plural(1, 'lesson')).toBe('1 lesson');
    expect(plural(2, 'lesson')).toBe('2 lessons');
    expect(plural(1, 'child', 'children')).toBe('1 child');
    expect(plural(3, 'child', 'children')).toBe('3 children');
  });

  test('first names and what is typed', () => {
    expect(firstName(constance)).toBe('Constance');
    expect(firstName({ full_name: '', email: 'x@example.com' })).toBe('x@example.com');
    expect(firstName({})).toBe('This person');
    expect(confirmName(constance)).toBe('Constance Lin');
    expect(confirmName({ full_name: ' ', email: ' x@example.com ' })).toBe('x@example.com');
    expect(typedLabel(constance)).toBe('Type Constance Lin to confirm');
    expect(deleteTitle(constance)).toBe('Delete Constance Lin?');
    expect(blockedTitle(constance)).toBe('Constance can’t be deleted');
    expect(doneText(constance)).toBe('Constance was deleted.');
  });

  test('lists of names', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Maya'])).toBe('Maya');
    expect(listNames(['Maya', 'Leo'])).toBe('Maya and Leo');
    expect(listNames(['Maya', 'Leo', 'Ava'])).toBe('Maya, Leo and Ava');
    expect(namesWithCounts([{ name: 'Maya Chen', total: 3 }])).toBe('Maya Chen (3)');
    expect(namesWithCounts([{ name: 'Maya Chen', total: 3 }, { name: 'Leo Park', total: 1 }])).toBe('Maya Chen (3) and Leo Park (1)');
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, total: 1 }));
    expect(namesWithCounts(many)).toBe('S0 (1), S1 (1), S2 (1), S3 (1), S4 (1), S5 (1), and 3 more');
  });

  test('no dashes in anything shown', () => {
    const p = preview({ lessons: [{ name: 'Maya', total: 2 }], children: ['Maya'], no_payer: ['Maya'] },
      { sessions: 3, upcoming_sessions: 3, submissions: 2, tasks: 4, assignments: 1, updates: 1, series: 1, rates: 2, statements: 1, links: 2, invites: 1 });
    const text = [headline(constance, p.counts), ...detailLines(p), typedLabel(constance), blockedTitle(constance), doneText(constance),
      failureText(0, {}), failureText(401, {}), failureText(404, {}), failureText(500, {})].join(' ');
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('the name guard', () => {
  test('trims, squeezes spaces, ignores case', () => {
    expect(nameMatches('constance lin', constance)).toBe(true);
    expect(nameMatches('  CONSTANCE   LIN ', constance)).toBe(true);
    expect(nameMatches('Constance', constance)).toBe(false);
    expect(nameMatches('', constance)).toBe(false);
    expect(nameMatches(undefined, constance)).toBe(false);
  });

  test('a person with no name is matched by their address; with neither, nothing', () => {
    expect(nameMatches('X@Example.com', { full_name: '', email: 'x@example.com' })).toBe(true);
    expect(nameMatches('', { full_name: '', email: '' })).toBe(false);
  });

  test('the page and the server agree', () => {
    const people = [constance, { full_name: 'Mary Lin', email: 'm@example.com' }, { full_name: '', email: 'x@example.com' }, { full_name: ' ', email: '' }, { full_name: 'Zoë  Müller' }];
    const typed = ['Constance Lin', 'constance  lin', '  Mary Lin', 'mary', 'x@example.com', 'X@EXAMPLE.COM', '', ' ', 'zoë müller', 'ZOË MÜLLER', 'Zoe Muller'];
    for (const person of people) for (const text of typed) expect(nameMatches(text, person), `${person.full_name}|${text}`).toBe(serverNameMatches(text, person));
  });
});

describe('who gets a Delete button', () => {
  test('students, parents and tutors; not an admin, not yourself, not someone with no name to type', () => {
    expect(canDelete({ id: 's', role: 'student', full_name: 'Maya' }, me)).toBe(true);
    expect(canDelete({ id: 'p', role: 'parent', full_name: 'Grace' }, me)).toBe(true);
    expect(canDelete({ id: 't', role: 'tutor', full_name: 'Daniel' }, me)).toBe(true);
    expect(canDelete({ id: 'a', role: 'admin', full_name: 'Another' }, me)).toBe(false);
    expect(canDelete({ id: 'admin', role: 'tutor', full_name: 'Me' }, me)).toBe(false);
    expect(canDelete({ id: 'x', role: 'student', full_name: '', email: '' }, me)).toBe(false);
    expect(canDelete({ id: 'w', role: 'pending', full_name: 'Sam' }, me)).toBe(false);
    expect(canDelete(null, me)).toBe(false);
  });
});

describe('the preview', () => {
  test('fills every field, whatever the server sent', () => {
    const p = normalizePreview({});
    expect(p).toEqual({ person: null, counts: counts(), lessons: [], children: [], no_payer: [], blocked: null });
    const q = normalizePreview({ counts: { sessions: '4', files: -1, tasks: 'x', rates: 2.9 }, blocked: { code: 'has_payments', message: 'No.' } });
    expect(q.counts.sessions).toBe(4);
    expect(q.counts.files).toBe(0);
    expect(q.counts.tasks).toBe(0);
    expect(q.counts.rates).toBe(2);
    expect(q.blocked).toEqual({ code: 'has_payments', message: 'No.' });
    expect(normalizePreview({ blocked: {} }).blocked).toBeNull();
  });

  test('the sentence over the dialog names the three counts, zero included', () => {
    expect(headline(constance, counts({ sessions: 0, assignments: 3, files: 2 })))
      .toBe('This permanently deletes Constance and 0 lessons, 3 assignments, 2 files. This can’t be undone.');
    expect(headline(constance, counts({ sessions: 1, assignments: 1, files: 1 })))
      .toBe('This permanently deletes Constance and 1 lesson, 1 assignment, 1 file. This can’t be undone.');
  });

  test('details: nothing when there is nothing', () => {
    expect(detailLines(preview())).toEqual([]);
  });

  test('details: lessons still to come', () => {
    expect(detailLines(preview({}, { sessions: 6, upcoming_sessions: 5 }))).toEqual(['5 of the 6 lessons are still to come.']);
    expect(detailLines(preview({}, { sessions: 6, upcoming_sessions: 1 }))).toEqual(['1 of the 6 lessons is still to come.']);
    expect(detailLines(preview({}, { sessions: 7, upcoming_sessions: 7 }))).toEqual(['All 7 lessons are still to come.']);
    expect(detailLines(preview({}, { sessions: 1, upcoming_sessions: 1 }))).toEqual(['The lesson is still to come.']);
    expect(detailLines(preview({}, { sessions: 6, upcoming_sessions: 0 }))).toEqual([]);
  });

  test('details: what a student has', () => {
    const lines = detailLines(preview({}, {
      submissions: 2, tasks: 5, assignments: 3, updates: 4, series: 1, rates: 2, statements: 0, links: 3, invites: 1,
    }));
    expect(lines).toEqual([
      '2 submitted answers and their grades.',
      '2 other tasks.',
      '4 progress updates and notes.',
      '1 repeating lesson schedule.',
      '2 hourly rates.',
      '3 tutor or parent links.',
      'Their invite link.',
    ]);
  });

  test('details: a tutor, whose lessons go with them', () => {
    const lines = detailLines(preview({ lessons: [{ name: 'Ava Chen', total: 4 }, { name: 'Constance Lin', total: 3 }] }, { sessions: 7, upcoming_sessions: 7, links: 2 }));
    expect(lines).toEqual([
      'All 7 lessons are still to come.',
      'The lessons go with them: Ava Chen (4) and Constance Lin (3). To keep them, move the lessons to another tutor first.',
      '2 tutor or parent links.',
    ]);
  });

  test('details: a parent, whose children stay', () => {
    expect(detailLines(preview({ children: ['Maya Lin'], no_payer: ['Maya Lin'] }, { links: 1 }))).toEqual([
      'Maya Lin stays in the portal; only the link to them is removed.',
      'Maya Lin would have no one to bill until you link a parent.',
    ]);
    expect(detailLines(preview({ children: ['Maya Lin', 'Leo Park'] }, { links: 2, invites: 2, statements: 1 }))).toEqual([
      '1 sent statement.',
      'Maya Lin and Leo Park stay in the portal; only the link to them is removed.',
      '2 invite links.',
    ]);
  });
});

describe('when a call fails', () => {
  test('the server’s own words win', () => {
    expect(failureText(409, { message: 'Grace has payments recorded.' })).toBe('Grace has payments recorded.');
    expect(problemText(409, { message: 'Grace has payments recorded.' })).toBe('Grace has payments recorded.');
  });

  test('else a plain line for the status', () => {
    expect(failureText(0, {})).toBe('Check your connection and try again.');
    expect(failureText(401, {})).toBe('Sign in again as an admin.');
    expect(failureText(404, {})).toBe('That person is already gone.');
    expect(failureText(500, {})).toBe('Please try again.');
    expect(problemText(500, {})).toBe('That didn’t work: Please try again.');
    expect(problemText(0, undefined)).toBe('That didn’t work: Check your connection and try again.');
  });

  test('the refusal words of the server are what the page shows, sentence for sentence', () => {
    for (const code of ['has_payments', 'paid_sessions', 'is_admin']) {
      const message = refusalMessage(code, { full_name: 'Grace Lin', role: 'parent' });
      expect(problemText(409, { error: code, message })).toBe(message);
    }
  });
});

describe('the list left behind', () => {
  const data = () => ({
    people: [
      { id: 'c', role: 'student' }, { id: 'm', role: 'parent' }, { id: 'j', role: 'parent' }, { id: 't', role: 'tutor' }, { id: 'o', role: 'student' },
    ],
    tutorLinks: [{ tutor_id: 't', student_id: 'c', subject: null }, { tutor_id: 't', student_id: 'o', subject: null }],
    parentLinks: [
      { parent_id: 'm', student_id: 'c', bills: true }, { parent_id: 'j', student_id: 'c', bills: false },
      { parent_id: 'm', student_id: 'o', bills: true },
    ],
    invites: [{ id: 1, profile_id: 'c' }, { id: 2, profile_id: 'o' }],
  });

  test('a student: the row, their links and their invites go; their parents stay', () => {
    const next = withoutPerson(data(), 'c');
    expect(next.people.map((p) => p.id)).toEqual(['m', 'j', 't', 'o']);
    expect([...next.byId.keys()]).toEqual(['m', 'j', 't', 'o']);
    expect(next.tutorLinks).toEqual([{ tutor_id: 't', student_id: 'o', subject: null }]);
    expect(next.parentLinks).toEqual([{ parent_id: 'm', student_id: 'o', bills: true }]);
    expect(next.invites).toEqual([{ id: 2, profile_id: 'o' }]);
  });

  test('a paying parent: the next linked parent pays; a child with no one else has no payer', () => {
    const next = withoutPerson(data(), 'm');
    expect(next.parentLinks).toEqual([{ parent_id: 'j', student_id: 'c', bills: true }]);
    expect(next.people.map((p) => p.id)).toEqual(['c', 'j', 't', 'o']);
  });

  test('a parent who did not pay changes nobody’s bill; the input is not changed', () => {
    const before = data();
    const next = withoutPerson(before, 'j');
    expect(next.parentLinks.find((l) => l.parent_id === 'm' && l.student_id === 'c').bills).toBe(true);
    expect(before.people).toHaveLength(5);
    expect(before.parentLinks).toHaveLength(3);
  });

  test('a tutor: their links go, their students stay', () => {
    const next = withoutPerson(data(), 't');
    expect(next.tutorLinks).toEqual([]);
    expect(next.people.map((p) => p.id)).toEqual(['c', 'm', 'j', 'o']);
  });

  test('links without a bills column are left as they are', () => {
    const next = withoutPerson({ ...data(), parentLinks: [{ parent_id: 'm', student_id: 'c' }, { parent_id: 'j', student_id: 'c' }] }, 'm');
    expect(next.parentLinks).toEqual([{ parent_id: 'j', student_id: 'c' }]);
  });
});
