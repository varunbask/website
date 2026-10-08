// Pure logic behind the Profile page (#/profile), the "Finish your profile"
// cards and the Profile item's dot in the nav. No DOM, no network.
//
//   profileProgress(kind, { profile, avatarPath }) -> { done, total, missing, complete, steps }
//       kind 'student' (the student's own profile, or a parent's child) or
//       'staff' (a tutor or the admin). A student is complete with a grade, a
//       school and hobbies; staff with About me and Subjects I teach. The photo
//       counts as a step (it is in done and total, and in missing while there
//       is none), but it never keeps a profile from being complete.
//
// The limits mirror supabase/migrations/20261025120000_profiles_and_photos.sql
// (and 20261017120000_student_profiles.sql for grade, school and goals); a unit
// test reads both and fails if they drift apart.

import { LIMITS, normalizeField, gradeText } from './student-profile-model.js';

export const PROFILE_VIEW = 'profile';
export const PROFILE_HREF = '#/profile';

// The fields a student (or their parent) fills in, in the order of the form.
// learning_notes is never one of them: it is for tutors.
export const STUDENT_FIELDS = Object.freeze([
  'grade_level', 'school', 'pronouns', 'interests', 'favorite_subjects', 'goals', 'learning_style',
]);

// What a tutor or the admin writes about themselves
export const STAFF_FIELDS = Object.freeze(['bio', 'subjects', 'education', 'interests']);

export const STUDENT_LIMITS = Object.freeze(Object.fromEntries(STUDENT_FIELDS.map((key) => [key, LIMITS[key]])));
export const STAFF_LIMITS = Object.freeze({ bio: 600, subjects: 200, education: 200, interests: 500 });

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// ---------------------------------------------------------------------------
// Grade

const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
};

// The choices in the Grade select, in order
export const GRADE_OPTIONS = Object.freeze([
  'Kindergarten',
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}${ordinal(i + 1)} grade`),
  'College',
  'Other',
]);

export const OTHER_GRADE = 'Other';

// A saved grade as the select shows it: { choice, other }. '9', '9th' and
// 'Grade 9' choose "9th grade"; anything the list does not have (a tutor typed
// "College freshman") chooses Other and keeps the words in `other`.
export function gradeChoice(stored) {
  let text = gradeText(stored);
  if (text === null) return { choice: '', other: '' };
  const spelled = /^grade\s*(\d{1,2})$/i.exec(text);
  if (spelled) text = gradeText(spelled[1]) ?? text;
  const match = GRADE_OPTIONS.find((o) => o !== OTHER_GRADE && o.toLowerCase() === text.toLowerCase());
  if (match) return { choice: match, other: '' };
  if (text.toLowerCase() === OTHER_GRADE.toLowerCase()) return { choice: OTHER_GRADE, other: '' };
  return { choice: OTHER_GRADE, other: text };
}

// What is saved for a choice: null for none, the typed words (or "Other") for
// Other, the option itself otherwise
export function gradeValue(choice, other = '') {
  const picked = normalizeField('grade_level', choice);
  if (picked === null) return null;
  if (picked === OTHER_GRADE) return normalizeField('grade_level', other) ?? OTHER_GRADE;
  return picked;
}

// ---------------------------------------------------------------------------
// The form

// Words on the student form. The student speaks for themselves; a parent
// fills it in for their child (`first` is the child's first name).
// { label, hint, placeholder, optional }
export function studentFieldText(key, { parent = false, first = '' } = {}) {
  const who = first || 'your child';
  const text = {
    grade_level: { label: 'Grade' },
    school: { label: 'School', placeholder: 'Arcadia High School' },
    pronouns: { label: 'Pronouns', placeholder: 'she/her, he/him, they/them', optional: true },
    interests: {
      label: 'Hobbies and interests',
      hint: parent ? `What does ${who} like to do outside school?` : 'What do you like to do outside school?',
      placeholder: 'Soccer, drawing, baking, video games',
    },
    favorite_subjects: { label: 'Favorite subjects', placeholder: 'Biology and art' },
    goals: {
      label: 'Goals',
      hint: parent ? `What does ${who} want to get better at?` : 'What do you want to get better at?',
      placeholder: parent ? 'Feel ready for the SAT in the spring' : 'Raise my algebra grade to an A',
    },
    learning_style: {
      label: parent ? `How ${who} learns best` : 'How I learn best',
      hint: parent ? 'Anything that helps a lesson go well.' : 'Anything that helps a lesson go well for you.',
      placeholder: parent ? 'Short breaks and lots of examples' : 'A worked example first, then one on my own',
    },
  }[key];
  return { hint: '', placeholder: '', optional: false, ...text };
}

export function staffFieldText(key) {
  const text = {
    bio: {
      label: 'About me',
      hint: 'A few friendly lines. Families of the students you teach read this.',
      placeholder: 'I have tutored math for five years and love helping students feel confident.',
    },
    subjects: { label: 'Subjects I teach', placeholder: 'Algebra, Geometry, SAT Math' },
    education: { label: 'School or university', placeholder: 'UCLA, Mathematics', optional: true },
    interests: { label: 'Hobbies and interests', placeholder: 'Hiking, chess, baking', optional: true },
  }[key];
  return { hint: '', placeholder: '', optional: false, ...text };
}

// A multi-line box for these; a one-line input for the rest (normalizeField
// keeps line breaks in the same fields)
export const LONG_FIELDS = Object.freeze(new Set(['interests', 'goals', 'learning_style', 'bio']));

// Form input (strings) to what is saved: { values, errors }. Values are
// trimmed (line breaks kept in the long fields), empty is null; errors names
// each field that is too long. kind: 'student' | 'staff'
export function checkFields(kind, raw = {}) {
  const fields = kind === 'staff' ? STAFF_FIELDS : STUDENT_FIELDS;
  const limits = kind === 'staff' ? STAFF_LIMITS : STUDENT_LIMITS;
  const label = (key) => (kind === 'staff' ? staffFieldText(key) : studentFieldText(key)).label;
  const values = {};
  const errors = {};
  for (const key of fields) {
    const value = normalizeField(key, raw[key]);
    values[key] = value;
    const length = value === null ? 0 : Array.from(value).length;
    if (length > limits[key]) errors[key] = `${label(key)} can be up to ${limits[key]} characters. This is ${length}.`;
  }
  return { values, errors };
}

// A saved row as form strings (every field '' when there is no row)
export function fieldsDraft(kind, row) {
  const fields = kind === 'staff' ? STAFF_FIELDS : STUDENT_FIELDS;
  return Object.fromEntries(fields.map((key) => [key, row?.[key] ?? '']));
}

// Would saving these values change the saved row?
export function fieldsChanged(kind, row, values) {
  const fields = kind === 'staff' ? STAFF_FIELDS : STUDENT_FIELDS;
  return fields.some((key) => (normalizeField(key, row?.[key]) ?? null) !== (values?.[key] ?? null));
}

// ---------------------------------------------------------------------------
// Progress

const STUDENT_STEPS = Object.freeze([
  { key: 'grade_level', label: 'Grade', required: true },
  { key: 'school', label: 'School', required: true },
  { key: 'interests', label: 'Hobbies and interests', required: true },
  { key: 'photo', label: 'Profile photo', required: false },
]);

const STAFF_STEPS = Object.freeze([
  { key: 'bio', label: 'About me', required: true },
  { key: 'subjects', label: 'Subjects I teach', required: true },
  { key: 'photo', label: 'Profile photo', required: false },
]);

export function profileProgress(kind, { profile = null, avatarPath = null } = {}) {
  const steps = (kind === 'staff' ? STAFF_STEPS : STUDENT_STEPS).map((step) => ({
    ...step,
    done: step.key === 'photo' ? !blank(avatarPath) : !blank(profile?.[step.key]),
  }));
  const done = steps.filter((s) => s.done).length;
  return {
    done,
    total: steps.length,
    missing: steps.filter((s) => !s.done).map((s) => s.label),
    complete: steps.every((s) => s.done || !s.required),
    steps,
  };
}

// "2 of 4 done"
export function progressText({ done = 0, total = 0 } = {}) {
  return `${done} of ${total} done`;
}

// The progress kind for a role: tutors and the admin have a staff profile,
// everyone else's Profile page is a student's (their own, or a parent's child)
export function profileKind(role) {
  return role === 'tutor' || role === 'admin' ? 'staff' : 'student';
}

// The card at the top of the Overview (Today for staff) while a profile is not
// finished. parent: the child's first name is in `first`.
export function nudgeCopy(kind, { parent = false, first = '' } = {}) {
  if (kind === 'staff') {
    return {
      title: 'Finish your tutor profile',
      text: 'Families see your photo, the subjects you teach and a few lines about you.',
      action: 'Finish your profile',
    };
  }
  if (parent) {
    const name = first || 'your child';
    return {
      title: `Help us get to know ${name}`,
      text: `Add ${name}’s grade, school and what they enjoy, so every tutor knows who they are teaching.`,
      action: first ? `Fill in ${first}’s profile` : 'Fill in the profile',
    };
  }
  return {
    title: 'Finish your profile',
    text: 'Tell your tutors a little about you. It only takes a minute.',
    action: 'Finish your profile',
  };
}

// The hidden words that go with the Profile item's dot
export const PROFILE_DOT_CONTEXT = 'Profile not finished';
