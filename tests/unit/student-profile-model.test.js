import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LIMITS, PROFILE_DRAWER, PROFILE_FIELDS, mailtoHref, FIELD_LABELS, PLACEHOLDER_DOMAIN, isPlaceholderEmail, realEmail, headerEmail, telHref,
  normalizeField, checkProfile, profileDraft, isBlankProfile, profileChanged, profileChanges, gradeText, profileFacts, aboutFacts,
  updatedText, sinceText, subjectChips, checkNote, sortNotes, authorName, canDeleteNote, noteByline, notesWindow, NOTES_SHOWN,
  parentContacts,
} from '../../portal/js/student-profile-model.js';

const NOW = new Date('2026-10-17T20:00:00Z');
const names = new Map([['t1', 'Daniel Ortiz'], ['t2', 'Priya Shah'], ['a1', 'Varun Baskaran']]);

describe('limits match the migration', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261017120000_student_profiles.sql', import.meta.url)), 'utf8');
  test.each([['grade_level', 40], ['school', 120], ['goals', 1000], ['learning_notes', 1000]])('%s is at most %i characters', (col, max) => {
    expect(LIMITS[col]).toBe(max);
    expect(sql).toContain(`check (char_length(${col}) <= ${max})`);
  });

  test('a note is at most 2000 characters', () => {
    expect(LIMITS.note).toBe(2000);
    expect(sql).toContain('char_length(body) <= 2000');
  });

  test('the placeholder domain is the one the database hides', () => {
    expect(sql).toContain(`%@${PLACEHOLDER_DOMAIN}`);
  });
});

describe('placeholder emails', () => {
  test('an address on the placeholder domain is not a real one', () => {
    expect(isPlaceholderEmail('no-login+u-mateo@people.varunbaskaran.com')).toBe(true);
    expect(isPlaceholderEmail('  No-Login+X@People.VarunBaskaran.com ')).toBe(true);
    expect(isPlaceholderEmail('maya.lin@example.com')).toBe(false);
    expect(isPlaceholderEmail('x@notpeople.varunbaskaran.com')).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });

  test('realEmail trims and drops placeholders and blanks', () => {
    expect(realEmail(' maya.lin@example.com ')).toBe('maya.lin@example.com');
    expect(realEmail('no-login+u-mateo@people.varunbaskaran.com')).toBeNull();
    expect(realEmail('')).toBeNull();
    expect(realEmail(undefined)).toBeNull();
  });

  test('the staff header shows a real email that is not just the name', () => {
    expect(headerEmail({ email: 'maya.lin@example.com' }, 'Maya Lin')).toBe('maya.lin@example.com');
    expect(headerEmail({ email: 'no-login+u-mateo@people.varunbaskaran.com' }, 'Mateo Diaz')).toBeNull();
    expect(headerEmail({ email: 'maya.lin@example.com' }, 'maya.lin@example.com')).toBeNull();
    expect(headerEmail(null, 'x')).toBeNull();
  });
});

describe('email links', () => {
  test('a plain address becomes a mailto link', () => {
    expect(mailtoHref(' grace.lin@example.com ')).toBe('mailto:grace.lin@example.com');
    expect(mailtoHref('a+b@example.co.uk')).toBe('mailto:a+b@example.co.uk');
  });

  test('a placeholder, a blank or an address that could add to the link gets none', () => {
    expect(mailtoHref('no-login+u-rosa@people.varunbaskaran.com')).toBeNull();
    expect(mailtoHref('')).toBeNull();
    expect(mailtoHref('x@y.com?cc=evil@z.com')).toBeNull();
    expect(mailtoHref('x@y.com&body=hi')).toBeNull();
    expect(mailtoHref('not an address')).toBeNull();
  });

  test('the editor opens with open=profile', () => {
    expect(PROFILE_DRAWER).toBe('profile');
  });
});

describe('phone links', () => {
  test('digits only, a leading plus kept', () => {
    expect(telHref('(626) 555-0101')).toBe('tel:6265550101');
    expect(telHref('+1 626 555 0101')).toBe('tel:+16265550101');
    expect(telHref('626.555.0101')).toBe('tel:6265550101');
  });

  test('a string that is not a number gives no link', () => {
    expect(telHref('call after 5')).toBeNull();
    expect(telHref('12345')).toBeNull();
    expect(telHref('1'.repeat(16))).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe('normalizing the profile', () => {
  test('one-line fields fold every run of whitespace into a space', () => {
    expect(normalizeField('school', '  Arcadia   High\n School ')).toBe('Arcadia High School');
    expect(normalizeField('grade_level', '\t9th grade')).toBe('9th grade');
  });

  test('goals and learning notes keep their line breaks', () => {
    expect(normalizeField('goals', 'Raise the grade   \r\n\r\n\r\n\r\nPass the SAT  ')).toBe('Raise the grade\n\nPass the SAT');
    expect(normalizeField('learning_notes', ' line one\nline two ')).toBe('line one\nline two');
  });

  test('empty input becomes null', () => {
    for (const key of PROFILE_FIELDS) {
      expect(normalizeField(key, '')).toBeNull();
      expect(normalizeField(key, '  \n\t ')).toBeNull();
      expect(normalizeField(key, null)).toBeNull();
      expect(normalizeField(key, undefined)).toBeNull();
    }
  });

  test('checkProfile returns the saved values', () => {
    const { values, errors } = checkProfile({ grade_level: ' 9th grade ', school: '', goals: 'Raise it', learning_notes: undefined });
    expect(values).toEqual({ grade_level: '9th grade', school: null, goals: 'Raise it', learning_notes: null });
    expect(errors).toEqual({});
  });

  test('exactly the limit is fine, one over is an error naming the field', () => {
    const at = checkProfile({ grade_level: 'x'.repeat(40), school: 'y'.repeat(120), goals: 'g'.repeat(1000), learning_notes: 'n'.repeat(1000) });
    expect(at.errors).toEqual({});
    const over = checkProfile({ grade_level: 'x'.repeat(41), school: 'y'.repeat(121), goals: 'g'.repeat(1001), learning_notes: 'n'.repeat(1001) });
    expect(Object.keys(over.errors)).toEqual(PROFILE_FIELDS);
    expect(over.errors.grade_level).toBe('Grade can be up to 40 characters. This is 41.');
    expect(over.errors.learning_notes).toBe('Learning notes can be up to 1000 characters. This is 1001.');
  });

  test('length counts characters, not UTF-16 units', () => {
    expect(checkProfile({ school: '\u{1F393}'.repeat(120) }).errors).toEqual({});
    expect(checkProfile({ school: '\u{1F393}'.repeat(121) }).errors.school).toBeTruthy();
  });

  test('spaces that only fold away do not count against the limit', () => {
    expect(checkProfile({ grade_level: `${'x'.repeat(40)}${' '.repeat(30)}` }).errors).toEqual({});
  });
});

describe('profile state', () => {
  test('a draft turns the row into form strings', () => {
    expect(profileDraft(null)).toEqual({ grade_level: '', school: '', goals: '', learning_notes: '' });
    expect(profileDraft({ grade_level: '9th grade', school: null, goals: 'g', learning_notes: null, updated_at: 'x' }))
      .toEqual({ grade_level: '9th grade', school: '', goals: 'g', learning_notes: '' });
  });

  test('blank means no row or no text anywhere', () => {
    expect(isBlankProfile(null)).toBe(true);
    expect(isBlankProfile({ grade_level: null, school: '  ', goals: '', learning_notes: null })).toBe(true);
    expect(isBlankProfile({ grade_level: null, school: null, goals: null, learning_notes: 'Needs breaks' })).toBe(false);
  });

  test('profileChanges lists only the fields that differ from the row the form opened on', () => {
    const row = { grade_level: '9th grade', school: 'Arcadia High School', goals: 'Raise it', learning_notes: 'Needs breaks' };
    const typed = (over) => checkProfile({ ...row, ...over }).values;
    expect(profileChanges(row, typed({}))).toEqual({});
    expect(profileChanges(row, typed({ school: 'Pasadena High School' }))).toEqual({ school: 'Pasadena High School' });
    expect(profileChanges(row, typed({ school: ' Arcadia   High School ', goals: 'Raise it to an A' }))).toEqual({ goals: 'Raise it to an A' });
    expect(profileChanges(row, typed({ goals: '', learning_notes: '  ' }))).toEqual({ goals: null, learning_notes: null });
  });

  test('with no row, every filled-in field is a change and blank ones are not', () => {
    expect(profileChanges(null, checkProfile({ school: 'Arcadia', goals: '' }).values)).toEqual({ school: 'Arcadia' });
    expect(profileChanges(null, checkProfile({}).values)).toEqual({});
    expect(profileChanges({ goals: null }, checkProfile({ goals: '' }).values)).toEqual({});
  });

  test('profileChanged compares normalized values', () => {
    const row = { grade_level: '9th grade', school: 'Arcadia High School', goals: 'Raise it', learning_notes: null };
    expect(profileChanged(row, checkProfile({ grade_level: ' 9th  grade', school: 'Arcadia High School', goals: 'Raise it', learning_notes: '' }).values)).toBe(false);
    expect(profileChanged(row, checkProfile({ ...row, goals: 'Raise it to an A' }).values)).toBe(true);
    expect(profileChanged(null, checkProfile({}).values)).toBe(false);
    expect(profileChanged(null, checkProfile({ school: 'X' }).values)).toBe(true);
  });
});

describe('labels', () => {
  test('field labels are the words on the card and the form', () => {
    expect(FIELD_LABELS).toEqual({ grade_level: 'Grade', school: 'School', goals: 'Goals', learning_notes: 'Learning notes' });
  });

  test('a grade written as a number reads as a grade', () => {
    expect(gradeText('9')).toBe('9th grade');
    expect(gradeText('9th')).toBe('9th grade');
    expect(gradeText(' 11 ')).toBe('11th grade');
    expect(gradeText('1')).toBe('1st grade');
    expect(gradeText('2nd')).toBe('2nd grade');
    expect(gradeText('3')).toBe('3rd grade');
    expect(gradeText('12')).toBe('12th grade');
    expect(gradeText('13')).toBe('13');
    expect(gradeText('k')).toBe('Kindergarten');
  });

  test('anything else is shown as typed', () => {
    expect(gradeText('9th grade')).toBe('9th grade');
    expect(gradeText('Grade 9')).toBe('Grade 9');
    expect(gradeText('College freshman')).toBe('College freshman');
    expect(gradeText('')).toBeNull();
    expect(gradeText(null)).toBeNull();
  });

  test('the staff card lists every field, empty ones as null', () => {
    const facts = profileFacts({ grade_level: '9', school: 'Arcadia High School', goals: null, learning_notes: 'Needs breaks' });
    expect(facts.map((f) => [f.key, f.value])).toEqual([
      ['grade_level', '9th grade'], ['school', 'Arcadia High School'], ['goals', null], ['learning_notes', 'Needs breaks'],
    ]);
    expect(facts.map((f) => f.long)).toEqual([false, false, true, true]);
    expect(profileFacts(null).every((f) => f.value === null)).toBe(true);
  });

  test('the family sees grade, school and goals that are filled in, never learning notes', () => {
    const profile = { grade_level: '9', school: null, goals: 'Raise the algebra grade', learning_notes: 'Private: gets anxious before tests' };
    const facts = aboutFacts(profile);
    expect(facts.map((f) => f.key)).toEqual(['grade_level', 'goals']);
    expect(JSON.stringify(facts)).not.toContain('anxious');
    expect(aboutFacts({ learning_notes: 'only this' })).toEqual([]);
    expect(aboutFacts(null)).toEqual([]);
  });

  test('a time worded to follow a comma', () => {
    expect(sinceText('2026-10-15T20:00:00Z', NOW).text).toBe('2 days ago');
    expect(sinceText('2026-10-16T20:00:00Z', NOW).text).toBe('yesterday');
    expect(sinceText('2026-10-17T19:59:40Z', NOW).text).toBe('just now');
    expect(sinceText('2026-10-17T18:00:00Z', NOW).text).toBe('2 hours ago');
    expect(sinceText('2026-10-15T20:00:00Z', NOW)).toMatchObject({ iso: '2026-10-15T20:00:00Z', full: expect.stringContaining('October 15, 2026') });
  });

  test('who changed it and when', () => {
    const profile = { updated_by: 't1', updated_at: '2026-10-14T20:00:00Z' };
    expect(updatedText(profile, names, NOW)).toBe('Updated by Daniel, 3 days ago');
    expect(updatedText({ updated_by: null, updated_at: '2026-10-17T19:59:30Z' }, names, NOW)).toBe('Updated just now');
    expect(updatedText({ updated_by: 'gone', updated_at: '2026-10-16T20:00:00Z' }, names, NOW)).toBe('Updated by Staff, yesterday');
    expect(updatedText(null, names, NOW)).toBeNull();
  });
});

describe('subjects', () => {
  const rows = [
    { tutor_id: 't2', full_name: 'Priya Shah', subject: 'SAT Reading' },
    { tutor_id: 't1', full_name: 'Daniel Ortiz', subject: 'Algebra' },
    { tutor_id: 't3', full_name: 'Sam Tutor', subject: null },
    { tutor_id: 't1', full_name: 'Daniel Ortiz', subject: 'Algebra' },
    { tutor_id: 't9', full_name: null, subject: 'Algebra' },
  ];

  test('each subject once, in name order, with who teaches it', () => {
    const chips = subjectChips(rows, new Map([['t9', 'Lee Tutor']]));
    expect(chips.map((c) => c.subject)).toEqual(['Algebra', 'SAT Reading']);
    expect(chips[0].tutors).toEqual(['Daniel Ortiz', 'Lee Tutor']);
    expect(chips[0].tone).toMatch(/^tc-[a-z]+$/);
    expect(chips[1].tutors).toEqual(['Priya Shah']);
  });

  test('the same subject in another case is one chip', () => {
    const chips = subjectChips([
      { tutor_id: 't1', full_name: 'Daniel Ortiz', subject: 'Algebra' },
      { tutor_id: 't2', full_name: 'Priya Shah', subject: 'algebra' },
    ]);
    expect(chips).toHaveLength(1);
    expect(chips[0].tutors).toEqual(['Daniel Ortiz', 'Priya Shah']);
  });

  test('a tutor with no subject adds no chip; no rows give none', () => {
    expect(subjectChips([{ tutor_id: 't3', full_name: 'Sam', subject: '  ' }])).toEqual([]);
    expect(subjectChips(null)).toEqual([]);
  });
});

describe('staff notes', () => {
  test('a note is trimmed and keeps its line breaks', () => {
    expect(checkNote('  Quick on factoring.\r\n\r\nSlow on word problems.  ')).toEqual({ value: 'Quick on factoring.\n\nSlow on word problems.', error: '' });
  });

  test('an empty note says to write one', () => {
    expect(checkNote('')).toEqual({ value: null, error: 'Write a note first.' });
    expect(checkNote(' \n\t ').error).toBe('Write a note first.');
    expect(checkNote(undefined).error).toBe('Write a note first.');
  });

  test('2000 characters fit, 2001 do not', () => {
    expect(checkNote('x'.repeat(2000)).error).toBe('');
    expect(checkNote('x'.repeat(2001)).error).toBe('A note can be up to 2000 characters. This one is 2001.');
    expect(checkNote('x'.repeat(2001)).value).toBeNull();
  });

  test('newest first, the id breaks a tie, the input is untouched', () => {
    const list = [
      { id: 1, created_at: '2026-10-10T10:00:00Z' },
      { id: 3, created_at: '2026-10-12T10:00:00Z' },
      { id: 2, created_at: '2026-10-12T10:00:00Z' },
      { id: 4, created_at: '2026-10-15T10:00:00Z' },
    ];
    const before = JSON.stringify(list);
    expect(sortNotes(list).map((n) => n.id)).toEqual([4, 3, 2, 1]);
    expect(JSON.stringify(list)).toBe(before);
    expect(sortNotes(null)).toEqual([]);
  });

  test('the author shows by first name, Staff when unknown', () => {
    expect(authorName('t1', names)).toBe('Daniel');
    expect(authorName('a1', names)).toBe('Varun');
    expect(authorName(null, names)).toBe('Staff');
    expect(authorName('nobody', names)).toBe('Staff');
    expect(authorName('t1', undefined)).toBe('Staff');
  });

  test('the byline: first name, relative date', () => {
    expect(noteByline({ author_id: 't1', created_at: '2026-10-15T20:00:00Z' }, names, NOW)).toBe('Daniel, 2 days ago');
    expect(noteByline({ author_id: 't2', created_at: '2026-10-16T20:00:00Z' }, names, NOW)).toBe('Priya, yesterday');
    expect(noteByline({ author_id: null, created_at: '2026-10-17T19:59:50Z' }, names, NOW)).toBe('Staff, just now');
    expect(noteByline({ author_id: 't1', created_at: '2026-09-02T20:00:00Z' }, names, NOW)).toBe('Daniel, Sep 2');
  });

  test('the author and the admin may delete a note, nobody else', () => {
    const note = { id: 1, author_id: 't1' };
    expect(canDeleteNote(note, { id: 't1', role: 'tutor' })).toBe(true);
    expect(canDeleteNote(note, { id: 't2', role: 'tutor' })).toBe(false);
    expect(canDeleteNote(note, { id: 'a1', role: 'admin' })).toBe(true);
    expect(canDeleteNote({ id: 2, author_id: null }, { id: 't1', role: 'tutor' })).toBe(false);
    expect(canDeleteNote({ id: 2, author_id: null }, { id: 'a1', role: 'admin' })).toBe(true);
    expect(canDeleteNote(note, null)).toBe(false);
    expect(canDeleteNote(null, { id: 't1', role: 'tutor' })).toBe(false);
  });

  test('a long list shows the newest few until asked for all', () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, created_at: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z` }));
    const few = notesWindow(notes);
    expect(few.shown.map((n) => n.id)).toEqual([8, 7, 6, 5, 4]);
    expect(few.hidden).toBe(3);
    expect(NOTES_SHOWN).toBe(5);
    const all = notesWindow(notes, { all: true });
    expect(all.shown).toHaveLength(8);
    expect(all.hidden).toBe(0);
    expect(notesWindow(notes.slice(0, 5)).hidden).toBe(0);
    expect(notesWindow([])).toEqual({ shown: [], hidden: 0 });
  });
});

describe('parent contacts', () => {
  test('name order, mailto and tel links built from the row', () => {
    const rows = [
      { parent_id: 'p2', full_name: 'Grace Lin', email: 'grace.lin@example.com', phone: '(626) 555-0101' },
      { parent_id: 'p1', full_name: 'Alan Lin', email: 'alan@example.com', phone: null },
    ];
    expect(parentContacts(rows)).toEqual([
      { id: 'p1', name: 'Alan Lin', email: 'alan@example.com', mailto: 'mailto:alan@example.com', phone: null, tel: null },
      { id: 'p2', name: 'Grace Lin', email: 'grace.lin@example.com', mailto: 'mailto:grace.lin@example.com', phone: '(626) 555-0101', tel: 'tel:6265550101' },
    ]);
  });

  test('a placeholder address never shows, even if it reaches the page', () => {
    const [rosa] = parentContacts([{ parent_id: 'p3', full_name: 'Rosa Diaz', email: 'no-login+u-rosa@people.varunbaskaran.com', phone: '  ' }]);
    expect(rosa).toEqual({ id: 'p3', name: 'Rosa Diaz', email: null, mailto: null, phone: null, tel: null });
  });

  test('a phone that is not a number is shown but not dialed; no name reads Parent', () => {
    const [p] = parentContacts([{ parent_id: 'p4', full_name: null, email: null, phone: 'ask for Grace' }]);
    expect(p.name).toBe('Parent');
    expect(p.phone).toBe('ask for Grace');
    expect(p.tel).toBeNull();
    expect(parentContacts(null)).toEqual([]);
  });
});

test('no label or message in the model uses an em or en dash', () => {
  const text = readFileSync(fileURLToPath(new URL('../../portal/js/student-profile-model.js', import.meta.url)), 'utf8');
  expect(text).not.toMatch(/[–—]/);
});
