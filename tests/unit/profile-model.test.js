import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  STUDENT_FIELDS, STAFF_FIELDS, STUDENT_LIMITS, STAFF_LIMITS, GRADE_OPTIONS, OTHER_GRADE, LONG_FIELDS, PROFILE_HREF,
  gradeChoice, gradeValue, studentFieldText, staffFieldText, checkFields, fieldsDraft, fieldsChanged,
  profileProgress, progressText, profileKind, nudgeCopy, PROFILE_DOT_CONTEXT,
} from '../../portal/js/profile-model.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const photosSql = read('supabase/migrations/20261025120000_profiles_and_photos.sql');
const profilesSql = read('supabase/migrations/20261017120000_student_profiles.sql');

describe('profileProgress', () => {
  test('a student is complete with a grade, a school and hobbies; the photo never blocks it', () => {
    const p = profileProgress('student', { profile: { grade_level: '9th grade', school: 'Arcadia High', interests: 'Soccer' }, avatarPath: null });
    expect(p).toMatchObject({ done: 3, total: 4, complete: true, missing: ['Profile photo'] });
    expect(p.steps.map((s) => [s.key, s.required, s.done])).toEqual([
      ['grade_level', true, true], ['school', true, true], ['interests', true, true], ['photo', false, false],
    ]);
  });

  test('the photo counts as a step done', () => {
    const p = profileProgress('student', { profile: { grade_level: '9th grade', school: 'A', interests: 'B' }, avatarPath: 'u/abcdefgh.webp' });
    expect(p).toMatchObject({ done: 4, total: 4, complete: true, missing: [] });
  });

  test('missing required fields keep it incomplete, in form order', () => {
    const p = profileProgress('student', { profile: { grade_level: '9th grade', school: '  ', interests: null }, avatarPath: 'u/abcdefgh.webp' });
    expect(p).toMatchObject({ done: 2, total: 4, complete: false, missing: ['School', 'Hobbies and interests'] });
  });

  test('no row at all is nothing done', () => {
    expect(profileProgress('student', {})).toMatchObject({ done: 0, total: 4, complete: false, missing: ['Grade', 'School', 'Hobbies and interests', 'Profile photo'] });
    expect(profileProgress('student')).toMatchObject({ done: 0, complete: false });
  });

  test('other fields do not count (goals, pronouns, how they learn)', () => {
    const p = profileProgress('student', { profile: { goals: 'x', pronouns: 'x', learning_style: 'x', favorite_subjects: 'x' } });
    expect(p.done).toBe(0);
  });

  test('staff are complete with About me and Subjects I teach', () => {
    expect(profileProgress('staff', { profile: { bio: 'Hi', subjects: 'Algebra' } })).toMatchObject({ done: 2, total: 3, complete: true, missing: ['Profile photo'] });
    expect(profileProgress('staff', { profile: { bio: 'Hi', education: 'UCLA', interests: 'Chess' } }))
      .toMatchObject({ done: 1, total: 3, complete: false, missing: ['Subjects I teach', 'Profile photo'] });
    expect(profileProgress('staff', { profile: null, avatarPath: 'x/abcdefgh.png' })).toMatchObject({ done: 1, complete: false });
  });

  test('"2 of 4 done"', () => {
    expect(progressText({ done: 2, total: 4 })).toBe('2 of 4 done');
    expect(progressText(profileProgress('staff', {}))).toBe('0 of 3 done');
  });

  test('tutors and the admin have staff profiles, everyone else a student one', () => {
    expect(profileKind('tutor')).toBe('staff');
    expect(profileKind('admin')).toBe('staff');
    expect(profileKind('student')).toBe('student');
    expect(profileKind('parent')).toBe('student');
  });
});

describe('limits match the migrations', () => {
  test('the student fields', () => {
    expect(STUDENT_LIMITS).toEqual({ grade_level: 40, school: 120, pronouns: 40, interests: 500, favorite_subjects: 200, goals: 1000, learning_style: 500 });
    for (const key of ['grade_level', 'school', 'goals']) expect(profilesSql).toContain(`check (char_length(${key}) <= ${STUDENT_LIMITS[key]})`);
    for (const key of ['pronouns', 'interests', 'favorite_subjects', 'learning_style']) {
      expect(photosSql).toMatch(new RegExp(`add column ${key}\\s+text check \\(char_length\\(${key}\\) <= ${STUDENT_LIMITS[key]}\\)`));
    }
  });

  test('the staff fields', () => {
    expect(STAFF_LIMITS).toEqual({ bio: 600, subjects: 200, education: 200, interests: 500 });
    const table = photosSql.slice(photosSql.indexOf('create table public.staff_profiles'));
    for (const key of STAFF_FIELDS) expect(table).toMatch(new RegExp(`${key}\\s+text check \\(char_length\\(${key}\\) <= ${STAFF_LIMITS[key]}\\)`));
  });

  test('the family fields never include the tutors\' learning notes', () => {
    expect(STUDENT_FIELDS).toEqual(['grade_level', 'school', 'pronouns', 'interests', 'favorite_subjects', 'goals', 'learning_style']);
    expect(STUDENT_FIELDS).not.toContain('learning_notes');
  });

  test('save_student_profile takes the same fields, in the same order', () => {
    const sig = /create function public\.save_student_profile\(([\s\S]*?)\)\s*returns/.exec(photosSql)[1];
    const params = [...sig.matchAll(/p_(\w+) (?:uuid|text)/g)].map((m) => m[1]);
    expect(params[0]).toBe('student');
    expect([...params.slice(1)].sort()).toEqual([...STUDENT_FIELDS].sort());
  });
});

describe('grade', () => {
  test('Kindergarten, 1st through 12th, College, Other', () => {
    expect(GRADE_OPTIONS).toEqual([
      'Kindergarten', '1st grade', '2nd grade', '3rd grade', '4th grade', '5th grade', '6th grade', '7th grade', '8th grade',
      '9th grade', '10th grade', '11th grade', '12th grade', 'College', 'Other',
    ]);
    expect(OTHER_GRADE).toBe('Other');
    for (const o of GRADE_OPTIONS) expect(o.length).toBeLessThanOrEqual(STUDENT_LIMITS.grade_level);
  });

  test('a saved grade picks its option, however it was typed', () => {
    expect(gradeChoice('9th grade')).toEqual({ choice: '9th grade', other: '' });
    expect(gradeChoice('9')).toEqual({ choice: '9th grade', other: '' });
    expect(gradeChoice('11th')).toEqual({ choice: '11th grade', other: '' });
    expect(gradeChoice('Grade 3')).toEqual({ choice: '3rd grade', other: '' });
    expect(gradeChoice('k')).toEqual({ choice: 'Kindergarten', other: '' });
    expect(gradeChoice('college')).toEqual({ choice: 'College', other: '' });
    expect(gradeChoice('Other')).toEqual({ choice: 'Other', other: '' });
  });

  test('anything else is Other, with the words kept', () => {
    expect(gradeChoice('College freshman')).toEqual({ choice: 'Other', other: 'College freshman' });
    expect(gradeChoice('Homeschool')).toEqual({ choice: 'Other', other: 'Homeschool' });
    expect(gradeChoice('')).toEqual({ choice: '', other: '' });
    expect(gradeChoice(null)).toEqual({ choice: '', other: '' });
  });

  test('what is saved for a choice', () => {
    expect(gradeValue('')).toBeNull();
    expect(gradeValue('9th grade', 'ignored')).toBe('9th grade');
    expect(gradeValue('Other', '  Gap   year ')).toBe('Gap year');
    expect(gradeValue('Other', '')).toBe('Other');
    for (const o of GRADE_OPTIONS.filter((x) => x !== 'Other')) expect(gradeChoice(gradeValue(o))).toEqual({ choice: o, other: '' });
  });
});

describe('the form', () => {
  test('checkFields trims, keeps line breaks in long fields and nulls blanks', () => {
    const { values, errors } = checkFields('student', { grade_level: ' 9th grade ', school: '  Arcadia   High ', interests: 'Soccer\n\n\n\nArt  ', goals: '   ' });
    expect(values).toEqual({
      grade_level: '9th grade', school: 'Arcadia High', pronouns: null, interests: 'Soccer\n\nArt', favorite_subjects: null, goals: null, learning_style: null,
    });
    expect(errors).toEqual({});
  });

  test('too long names the field, by its label on the form', () => {
    const over = checkFields('student', { pronouns: 'x'.repeat(41), learning_style: 'y'.repeat(501) });
    expect(over.errors).toEqual({
      pronouns: 'Pronouns can be up to 40 characters. This is 41.',
      learning_style: 'How I learn best can be up to 500 characters. This is 501.',
    });
    const staff = checkFields('staff', { bio: 'b'.repeat(601), subjects: 's'.repeat(200) });
    expect(staff.errors).toEqual({ bio: 'About me can be up to 600 characters. This is 601.' });
    expect(Object.keys(staff.values)).toEqual(STAFF_FIELDS);
  });

  test('a draft and what counts as a change', () => {
    expect(fieldsDraft('staff', null)).toEqual({ bio: '', subjects: '', education: '', interests: '' });
    const row = { grade_level: '9th grade', school: 'Arcadia High', interests: 'Soccer', goals: null };
    const same = checkFields('student', { ...fieldsDraft('student', row), school: ' Arcadia  High ' }).values;
    expect(fieldsChanged('student', row, same)).toBe(false);
    expect(fieldsChanged('student', row, { ...same, goals: 'Get an A' })).toBe(true);
    expect(fieldsChanged('student', null, checkFields('student', {}).values)).toBe(false);
    expect(fieldsChanged('staff', null, checkFields('staff', { bio: 'Hi' }).values)).toBe(true);
  });

  test('long fields are text areas', () => {
    expect([...LONG_FIELDS].sort()).toEqual(['bio', 'goals', 'interests', 'learning_style']);
  });

  test('every field has a label, and a parent reads about their child', () => {
    for (const key of STUDENT_FIELDS) expect(studentFieldText(key).label).toBeTruthy();
    for (const key of STAFF_FIELDS) expect(staffFieldText(key).label).toBeTruthy();
    expect(studentFieldText('goals').hint).toBe('What do you want to get better at?');
    expect(studentFieldText('goals', { parent: true, first: 'Maya' }).hint).toBe('What does Maya want to get better at?');
    expect(studentFieldText('learning_style').label).toBe('How I learn best');
    expect(studentFieldText('learning_style', { parent: true, first: 'Maya' }).label).toBe('How Maya learns best');
    expect(studentFieldText('interests').label).toBe('Hobbies and interests');
    expect(studentFieldText('pronouns').optional).toBe(true);
    expect(staffFieldText('bio').label).toBe('About me');
    expect(staffFieldText('subjects').label).toBe('Subjects I teach');
    expect(staffFieldText('education').label).toBe('School or university');
  });
});

describe('the nudge', () => {
  test('a student, a parent and staff each get their own words', () => {
    expect(nudgeCopy('student')).toMatchObject({ title: 'Finish your profile', action: 'Finish your profile' });
    expect(nudgeCopy('student', { parent: true, first: 'Maya' })).toMatchObject({ title: 'Help us get to know Maya', action: 'Fill in Maya’s profile' });
    expect(nudgeCopy('staff')).toMatchObject({ title: 'Finish your tutor profile' });
    expect(PROFILE_HREF).toBe('#/profile');
    expect(PROFILE_DOT_CONTEXT).toBe('Profile not finished');
  });
});

// Students and parents read these words: never how work is graded, never a dash
describe('family copy', () => {
  const FORBIDDEN = /\bAI\b|grader|automatic|could not grade/i;
  const DASH = /[–—]/;
  const copy = () => {
    const out = [PROFILE_DOT_CONTEXT, ...GRADE_OPTIONS];
    for (const parent of [false, true]) {
      for (const key of STUDENT_FIELDS) {
        const t = studentFieldText(key, { parent, first: 'Maya' });
        out.push(t.label, t.hint, t.placeholder);
      }
      out.push(...Object.values(nudgeCopy('student', { parent, first: 'Maya' })));
    }
    for (const key of STAFF_FIELDS) out.push(...Object.values(staffFieldText(key)).filter((v) => typeof v === 'string'));
    out.push(...Object.values(nudgeCopy('staff')));
    out.push(...Object.values(checkFields('student', { pronouns: 'x'.repeat(99) }).errors));
    out.push(...profileProgress('student').missing, ...profileProgress('staff').missing);
    return out.filter(Boolean);
  };

  test('no AI wording and no em or en dashes', () => {
    const all = copy();
    expect(all.length).toBeGreaterThan(40);
    for (const text of all) {
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(DASH);
    }
  });

  test('the Profile page, the nudge and the photo files say nothing about AI and use no dashes', () => {
    for (const file of ['portal/js/views/profile.js', 'portal/js/profile-nudge.js', 'portal/js/photo-model.js', 'portal/js/photo-upload.js', 'portal/js/profile-model.js']) {
      const code = read(file);
      expect(code, file).not.toMatch(DASH);
      const strings = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2]);
      for (const s of strings) expect(s, file).not.toMatch(FORBIDDEN);
    }
  });
});
