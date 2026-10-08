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

const STAFF_COLUMNS = `profile_id, ${STAFF_FIELDS.join(', ')}, updated_at`;

// What the family may read of a student's profile, or null when nothing was
// saved yet: { grade_level, school, goals, pronouns, interests,
// favorite_subjects, learning_style, updated_at }
export async function loadStudentFields(studentId) {
  const { data, error } = await sb.rpc('family_profile', { p_student: studentId });
  if (error) throw error;
  return data?.[0] ?? null;
}

// Saves the seven family fields (values from checkFields('student', ...)) and
// returns the saved row
export async function saveStudentFields(studentId, values) {
  const args = { p_student: studentId };
  for (const key of STUDENT_FIELDS) args[`p_${key}`] = values?.[key] ?? null;
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

// Saves a staff profile (insert the first time, update after) and returns it
export async function saveStaffFields(personId, values) {
  const row = { profile_id: personId };
  for (const key of STAFF_FIELDS) row[key] = values?.[key] ?? null;
  const { data, error } = await sb.from('staff_profiles').upsert(row, { onConflict: 'profile_id' }).select(STAFF_COLUMNS);
  if (error) throw error;
  if (!data?.length) throw new Error('The profile was not saved.');
  return data[0];
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
