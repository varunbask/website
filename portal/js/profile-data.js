// Reads and writes for the Profile page (supabase/migrations/
// 20261025120000_profiles_and_photos.sql). The database decides who may read
// or write what; these only ask.
//
//   family fields   save_student_profile() and family_profile(): the student,
//                   a linked parent or a tutor of the student. Never the
//                   tutors' learning notes.
//   staff_profiles  a tutor's or the admin's own row (bio, subjects, education,
//                   interests), read by anyone who may see that person

import { sb } from './supabase.js';
import { STUDENT_FIELDS, STAFF_FIELDS } from './profile-model.js';
import { normalizeField } from './student-profile-model.js';
import { rememberPaths } from './photos.js';

const STAFF_COLUMNS = `profile_id, ${STAFF_FIELDS.join(', ')}, updated_at`;

// What the family may read of a student's profile, or null when nothing was
// saved yet: { grade_level, school, goals, pronouns, interests,
// favorite_subjects, learning_style, updated_at }
export async function loadStudentFields(studentId) {
  const { data, error } = await sb.rpc('family_profile', { p_student: studentId });
  if (error) throw error;
  return data?.[0] ?? null;
}

// The fields whose value differs from the row the form was opened on
const changedKeys = (fields, row, values) => fields.filter((key) => (normalizeField(key, row?.[key]) ?? null) !== (values?.[key] ?? null));

// Saves the seven family fields (values from checkFields('student', ...)) and
// returns the saved row. `row` is what the form was opened on. The database
// function writes all seven, so the fields this person did not change are
// read again first and sent as they are now: a tutor (or the other parent)
// who changed the goals a minute ago keeps their change.
export async function saveStudentFields(studentId, values, { row = null } = {}) {
  const changed = new Set(changedKeys(STUDENT_FIELDS, row, values));
  const now = await loadStudentFields(studentId);
  const args = { p_student: studentId };
  for (const key of STUDENT_FIELDS) args[`p_${key}`] = changed.has(key) ? (values?.[key] ?? null) : (now?.[key] ?? null);
  const { data, error } = await sb.rpc('save_student_profile', args);
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

// A tutor's (or the admin's) own row, or null
export async function loadStaffFields(personId) {
  const { data, error } = await sb.from('staff_profiles').select(STAFF_COLUMNS).eq('profile_id', personId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// Saves a staff profile and returns it. An update of the fields that changed,
// or an insert when there is no row yet; never a PostgREST upsert, which would
// set profile_id too (the column has no update grant). If the row appeared or
// vanished meanwhile (another tab), the other one is tried once.
export async function saveStaffFields(personId, values, { row = null } = {}) {
  const changes = Object.fromEntries(changedKeys(STAFF_FIELDS, row, values).map((key) => [key, values?.[key] ?? null]));
  const full = { profile_id: personId };
  for (const key of STAFF_FIELDS) full[key] = values?.[key] ?? null;
  if (row && !Object.keys(changes).length) return row;
  const update = () => sb.from('staff_profiles').update(Object.keys(changes).length ? changes : { bio: full.bio })
    .eq('profile_id', personId).select(STAFF_COLUMNS);
  const insert = () => sb.from('staff_profiles').insert(full).select(STAFF_COLUMNS);
  let result = row ? await update() : await insert();
  const other = row ? (!result.error && !result.data?.length) : result.error?.code === '23505';
  if (other) result = row ? await insert() : await update();
  if (result.error) throw result.error;
  if (!result.data?.length) throw new Error('The profile was not saved.');
  return result.data[0];
}

// The person's own photo path, read from their profile row (a student, a
// parent's child, or staff themselves may read it), so the Profile page never
// says "No photo yet" because a lookup elsewhere failed
export async function loadAvatarPath(personId) {
  const { data, error } = await sb.from('profiles').select('id, avatar_path').eq('id', personId).maybeSingle();
  if (error) throw error;
  if (data) rememberPaths([data]);
  return data?.avatar_path ?? null;
}

// The staff profiles of these people that the viewer may read (a family reads
// their own tutors'): Map of person id -> row
export async function loadStaffCards(ids) {
  const list = [...new Set((ids ?? []).map(String))];
  if (!list.length) return new Map();
  const { data, error } = await sb.from('staff_profiles').select(STAFF_COLUMNS).in('profile_id', list);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [String(row.profile_id), row]));
}

// The required fields of every student profile the viewer may read (staff: the
// students they teach), for the Students list's "Profile not filled in":
// Map of student id -> { grade_level, school, interests }
export async function loadStudentSummaries() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('student_profiles').select('student_id, grade_level, school, interests')
      .order('student_id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return new Map(rows.map((r) => [String(r.student_id), r]));
}
