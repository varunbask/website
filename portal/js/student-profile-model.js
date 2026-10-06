// Pure logic behind the student profile, the staff notes and the parent contacts
// (student-profile-card.js, student-profile-drawer.js). No DOM, no network.
//
// The limits mirror supabase/migrations/20261017120000_student_profiles.sql; a
// unit test reads that file and fails if the two drift apart.

import { relativeTime } from './dates.js';
import { tutorEntries } from './schedule-summary.js';

export const LIMITS = Object.freeze({ grade_level: 40, school: 120, goals: 1000, learning_notes: 1000, note: 2000 });

// The fields staff edit, in the order they appear
export const PROFILE_FIELDS = Object.freeze(['grade_level', 'school', 'goals', 'learning_notes']);

export const FIELD_LABELS = Object.freeze({
  grade_level: 'Grade',
  school: 'School',
  goals: 'Goals',
  learning_notes: 'Learning notes',
});

// One line (grade, school) or free text with line breaks (goals, learning notes, a note)
const MULTILINE = new Set(['goals', 'learning_notes', 'note']);

export const PLACEHOLDER_DOMAIN = 'people.varunbaskaran.com';

// The drawer id (the open= value) of the profile editor
export const PROFILE_DRAWER = 'profile';

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

// ---------------------------------------------------------------------------
// Email and phone

// A person added without a login has an undeliverable address on our own domain
export function isPlaceholderEmail(email) {
  return String(email ?? '').trim().toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

// The address worth showing: trimmed, or null when empty or a placeholder
export function realEmail(email) {
  const text = String(email ?? '').trim();
  return text && !isPlaceholderEmail(text) ? text : null;
}

// What the staff Overview prints under the student's name: their real email, and
// nothing when it is a placeholder or only repeats the name
export function headerEmail(student, name = '') {
  const email = realEmail(student?.email);
  return email && email !== name ? email : null;
}

// mailto: link for an address, or null when it is not a plain address (nothing
// that could add a header or a body to the link)
export function mailtoHref(email) {
  const text = realEmail(email);
  return text && /^[^\s@?#&<>"]+@[^\s@?#&<>"]+$/.test(text) ? `mailto:${text}` : null;
}

// tel: link for a phone number as typed ("(626) 555-0101"), or null if it is not
// a plausible number (7 to 15 digits, a leading + kept)
export function telHref(phone) {
  const text = String(phone ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${text.startsWith('+') ? '+' : ''}${digits}`;
}

// ---------------------------------------------------------------------------
// The profile

// Trims one value and tidies its spacing; empty becomes null. Line breaks are
// normalized and kept in goals and learning notes, and folded into spaces in the
// one-line fields. Never changes the words.
export function normalizeField(key, value) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n');
  if (MULTILINE.has(key)) {
    text = text.split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } else {
    text = text.replace(/\s+/g, ' ').trim();
  }
  return text === '' ? null : text;
}

// Form input (strings) to what is saved: { values, errors }. errors holds one
// message per field that is too long; values are normalized (empty is null).
export function checkProfile(raw = {}) {
  const values = {};
  const errors = {};
  for (const key of PROFILE_FIELDS) {
    const value = normalizeField(key, raw[key]);
    values[key] = value;
    const max = LIMITS[key];
    if (value !== null && Array.from(value).length > max) {
      errors[key] = `${FIELD_LABELS[key]} can be up to ${max} characters. This is ${Array.from(value).length}.`;
    }
  }
  return { values, errors };
}

// The profile row as form input: every field a string
export function profileDraft(profile) {
  return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, profile?.[key] ?? '']));
}

// True when no field holds any text (no row, or every field cleared)
export function isBlankProfile(profile) {
  return !profile || PROFILE_FIELDS.every((key) => blank(profile[key]));
}

// The fields whose saved value differs from the row the form was opened on:
// { key: newValue } (null clears a field). Only these are sent on an edit, so a
// tutor who changes the school does not overwrite the goals a colleague saved a
// moment ago. With no row, every filled-in field counts as a change.
export function profileChanges(profile, values) {
  const changes = {};
  for (const key of PROFILE_FIELDS) {
    const next = values?.[key] ?? null;
    if ((normalizeField(key, profile?.[key]) ?? null) !== next) changes[key] = next;
  }
  return changes;
}

// Would saving these values change anything?
export function profileChanged(profile, values) {
  return Object.keys(profileChanges(profile, values)).length > 0;
}

// "9" and "9th" read as "9th grade", "K" as "Kindergarten"; anything else is
// shown as the tutor typed it ("Grade 9", "College freshman")
export function gradeText(raw) {
  const text = normalizeField('grade_level', raw);
  if (text === null) return null;
  const num = /^(\d{1,2})(?:st|nd|rd|th)?$/i.exec(text);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= 12) return `${n}${ordinalSuffix(n)} grade`;
    return text;
  }
  if (/^(k|kindergarten)$/i.test(text)) return 'Kindergarten';
  return text;
}

function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
}

// The rows of the staff card: every field, with null for what is not filled in
// yet. [{ key, label, value, long }]; long fields (text) take the full width.
export function profileFacts(profile) {
  return [
    { key: 'grade_level', label: 'Grade', value: gradeText(profile?.grade_level), long: false },
    { key: 'school', label: 'School', value: normalizeField('school', profile?.school), long: false },
    { key: 'goals', label: 'Goals', value: normalizeField('goals', profile?.goals), long: true },
    { key: 'learning_notes', label: 'Learning notes', value: normalizeField('learning_notes', profile?.learning_notes), long: true },
  ];
}

// What students and parents see: grade, school and goals, filled in only
// (learning notes are for staff). Empty list when there is nothing to show.
export function aboutFacts(profile) {
  return profileFacts(profile).filter((f) => f.key !== 'learning_notes' && f.value !== null);
}

// When something happened, worded to follow a comma: { text, full, iso } with
// text "2 days ago", "yesterday", "just now" or a date ("Sep 2"); full is the
// complete date and time for a tooltip
export function sinceText(iso, now = new Date()) {
  const { text, full } = relativeTime(iso, now);
  return { text: text === 'Just now' || text === 'Yesterday' ? text.toLowerCase() : text, full, iso };
}

// "Updated by Daniel, 3 days ago", or null when it was never saved by anyone
export function updatedText(profile, names, now = new Date()) {
  if (!profile?.updated_at) return null;
  const when = sinceText(profile.updated_at, now).text;
  const who = profile.updated_by ? authorName(profile.updated_by, names) : null;
  return who ? `Updated by ${who}, ${when}` : `Updated ${when}`;
}

// ---------------------------------------------------------------------------
// Subjects

// The student's subjects, once each, in name order: [{ subject, tone, tutors }].
// rows: student_tutors() rows ({ tutor_id, full_name, subject }). Rows without a
// subject are left out (a tutor linked with no subject yet).
export function subjectChips(rows, names = new Map()) {
  const bySubject = new Map();
  for (const entry of tutorEntries(rows, names)) {
    if (!entry.subject) continue;
    const key = entry.subject.toLowerCase();
    if (!bySubject.has(key)) bySubject.set(key, { subject: entry.subject, tone: entry.tone, tutors: [] });
    const chip = bySubject.get(key);
    if (!chip.tutors.includes(entry.name)) chip.tutors.push(entry.name);
  }
  return [...bySubject.values()].sort((a, b) => a.subject.localeCompare(b.subject));
}

// ---------------------------------------------------------------------------
// Staff notes

// The note as it will be saved, or an error to show: { value, error }
export function checkNote(raw) {
  const value = normalizeField('note', raw);
  if (value === null) return { value: null, error: 'Write a note first.' };
  const length = Array.from(value).length;
  if (length > LIMITS.note) {
    return { value: null, error: `A note can be up to ${LIMITS.note} characters. This one is ${length}.` };
  }
  return { value, error: '' };
}

const time = (note) => Date.parse(note?.created_at ?? '') || 0;

// Newest first; the id breaks a tie between notes made in the same moment
export function sortNotes(notes) {
  return [...(notes ?? [])].sort((a, b) => (time(b) - time(a)) || (Number(b.id) - Number(a.id)));
}

// First name of the person with this id, "Staff" when they are not known (a
// deleted account leaves a note with no author)
export function authorName(id, names) {
  const full = id ? names?.get?.(String(id)) : null;
  const first = String(full ?? '').trim().split(/\s+/)[0];
  return first || 'Staff';
}

// The author (or the admin) may delete a note
export function canDeleteNote(note, me) {
  if (!note || !me) return false;
  if (me.role === 'admin') return true;
  return Boolean(note.author_id) && String(note.author_id) === String(me.id);
}

// "Daniel, 2 days ago": the note's byline
export function noteByline(note, names, now = new Date()) {
  return `${authorName(note.author_id, names)}, ${sinceText(note.created_at, now).text}`;
}

// How many notes show before "Show all"
export const NOTES_SHOWN = 5;

// The notes to list: all of them, or the newest few with how many are hidden
export function notesWindow(notes, { all = false, limit = NOTES_SHOWN } = {}) {
  const sorted = sortNotes(notes);
  if (all || sorted.length <= limit) return { shown: sorted, hidden: 0 };
  return { shown: sorted.slice(0, limit), hidden: sorted.length - limit };
}

// ---------------------------------------------------------------------------
// Parents

// staff_parent_contacts() rows to what the card prints, in name order. A
// placeholder address never shows, whatever the database sent.
export function parentContacts(rows) {
  return (rows ?? [])
    .map((row) => {
      const email = realEmail(row.email);
      const phone = blank(row.phone) ? null : String(row.phone).trim();
      return {
        id: row.parent_id,
        name: blank(row.full_name) ? 'Parent' : String(row.full_name).trim(),
        email,
        mailto: mailtoHref(email),
        phone,
        tel: phone ? telHref(phone) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}
