// Reads and writes for the student profile, the staff notes and the parent
// contacts (tables student_profiles and student_notes, function
// staff_parent_contacts; see supabase/migrations/20261017120000_student_profiles.sql).
// The database decides who may read or write what; these only ask.

import { sb } from './supabase.js';
import { staffNames } from './updates-feed.js';

const PROFILE_FIELDS = 'student_id, grade_level, school, goals, learning_notes, updated_by, updated_at';
const NOTE_FIELDS = 'id, student_id, author_id, body, created_at';

// The student's profile row, or null when none was saved yet
export async function loadProfile(studentId) {
  const { data, error } = await sb.from('student_profiles').select(PROFILE_FIELDS).eq('student_id', studentId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// What a family may read of the profile: { grade_level, school, goals } or null.
// Students and parents have no access to the table (it holds learning notes),
// so they ask the database function, which returns only these three fields.
export async function loadFamilyProfile(studentId) {
  const { data, error } = await sb.rpc('family_profile', { p_student: studentId });
  if (error) throw error;
  return data?.[0] ?? null;
}

// Saves the four fields (values from checkProfile) and returns the saved row.
// Insert or update, never upsert: `exists` says which one to try first, and if
// the row appeared or vanished since it was read, the other one runs.
export async function saveProfile(studentId, values, { exists = false } = {}) {
  const update = () => sb.from('student_profiles').update(values).eq('student_id', studentId).select(PROFILE_FIELDS);
  const insert = () => sb.from('student_profiles').insert({ student_id: studentId, ...values }).select(PROFILE_FIELDS);
  let result = exists ? await update() : await insert();
  const other = exists ? (!result.error && !result.data?.length) : result.error?.code === '23505';
  if (other) result = exists ? await insert() : await update();
  if (result.error) throw result.error;
  if (!result.data?.length) throw new Error('The profile was not saved.');
  return result.data[0];
}

// Every staff note for the student (newest first is the model's job)
export async function loadNotes(studentId) {
  const { data, error } = await sb.from('student_notes').select(NOTE_FIELDS).eq('student_id', studentId)
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Adds a note and returns the saved row (the database signs it with the author)
export async function addNote(studentId, body) {
  const { data, error } = await sb.from('student_notes').insert({ student_id: studentId, body }).select(NOTE_FIELDS).single();
  if (error) throw error;
  return data;
}

// True when the note was deleted, false when it was already gone
export async function deleteNote(id) {
  const { data, error } = await sb.from('student_notes').delete().eq('id', id).select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// The student's parents: [{ parent_id, full_name, email, phone }]
export async function loadParentContacts(studentId) {
  const { data, error } = await sb.rpc('staff_parent_contacts', { p_student: studentId });
  if (error) throw error;
  return data ?? [];
}

// One settled part of the card: { ok, data }. A failure is logged and shown as
// that card's own error; it never takes the page down.
const settle = (promise) => promise.then(
  (data) => ({ ok: true, data }),
  (error) => {
    console.error(error);
    return { ok: false, data: null };
  },
);

// Everything the staff Overview's two cards need, loaded together. Never
// rejects; each part says whether it loaded.
export async function loadStaffProfile(store, studentId) {
  const [profile, notes, parents, tutors, names] = await Promise.all([
    settle(loadProfile(studentId)),
    settle(loadNotes(studentId)),
    settle(loadParentContacts(studentId)),
    settle(store.getTutors(studentId)),
    staffNames(),
  ]);
  return { profile, notes, parents, tutors, names };
}
