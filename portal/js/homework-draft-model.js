// Pure logic for drafting homework from lesson photos (staff only): the photo
// budget and downscale math, the options, the request body, how a finished
// draft fills the form, and the recent drafts list. No DOM; homework-draft.js
// builds the panel. The server checks the same numbers again
// (api/_lib/homework-draft.js); a test keeps the two in step.
//
// Nothing here is ever shown to a student or a parent.

// Photos: shrunk in the browser to at most 1600 px on the long edge as a
// JPEG (which also drops EXIF, location included), 1 to 6 of them, and all
// their base64 together at or under 3.5 MB so the request stays under the
// 4.5 MB body limit.
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_CHARS = Math.floor(3.5 * 1024 * 1024);
export const SHRINK_TRIES = Object.freeze([
  Object.freeze({ maxEdge: 1600, quality: 0.85 }),
  Object.freeze({ maxEdge: 1200, quality: 0.7 }),   // only when the first try would not fit the budget
]);

export const MIN_PROBLEMS = 1;
export const MAX_PROBLEMS = 15;
export const DEFAULT_PROBLEMS = 5;
export const MAX_NOTES = 500;
export const MAX_DETAILS = 12000;            // tasks.details holds this much
export const DIFFICULTIES = Object.freeze([
  Object.freeze({ value: 'easier', label: 'Easier' }),
  Object.freeze({ value: 'same', label: 'About the same' }),
  Object.freeze({ value: 'harder', label: 'Harder' }),
]);

export const POLL_MS = 5000;                 // how often a drafting draft is asked about
export const RECENT_DAYS = 7;
export const MAX_ATTACHMENTS = 10;           // files on a new assignment, as in item-form.js
export const REFRESH_WITHIN_S = 60;          // refresh the sign-in token this close to its expiry
export const GONE_ERROR = 'This draft is no longer available.';

export const DRAFTING_TEXT = 'Drafting your homework. This can take a few minutes; you can keep working and come back.';
export const READY_TEXT = 'The draft is in the form below. Check every problem and the answer key, then create the assignment.';

// ---------------------------------------------------------------------------
// Photos

// The size a photo is drawn at: the long edge at most maxEdge, never enlarged
export function fitSize(width, height, maxEdge = SHRINK_TRIES[0].maxEdge) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

// Characters of base64 for this many bytes
export function base64Length(bytes) {
  return 4 * Math.ceil(Math.max(0, bytes) / 3);
}

// Whether a chosen file can be a lesson photo (some phones leave the type blank)
export function isImageFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type) return file.type.startsWith('image/');
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(String(file.name ?? ''));
}

// "1.2 MB", "850 KB"
export function sizeText(chars) {
  const mb = chars / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(chars / 1024))} KB`;
}

// Whether one more photo of `chars` fits with the ones already added
export function fitsBudget(photos, chars) {
  const used = (photos ?? []).reduce((total, p) => total + (p.chars ?? 0), 0);
  return used + chars <= MAX_PHOTO_CHARS;
}

export function overBudgetText(photos, chars) {
  const used = (photos ?? []).reduce((total, p) => total + (p.chars ?? 0), 0);
  return `These photos are too large together (${sizeText(used + chars)} of ${sizeText(MAX_PHOTO_CHARS)}). Remove a photo, or use fewer or smaller ones.`;
}

// What to say about files that were not added, or '' when all were
export function photoProblems({ notImages = [], unreadable = [], tooMany = 0, overBudget = '' } = {}) {
  const out = [];
  if (notImages.length) out.push(`${notImages.join(', ')}: not an image. Add photos (JPG, PNG or WebP).`);
  if (unreadable.length) out.push(`${unreadable.join(', ')}: this photo could not be opened. Try a JPG or PNG.`);
  if (tooMany) out.push(`Add at most ${MAX_PHOTOS} photos.`);
  if (overBudget) out.push(overBudget);
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// Options

// The options as typed -> { values, errors }; errors has count or notes
export function checkOptions({ count, difficulty, hints, challenge = true, notes } = {}) {
  const errors = {};
  const raw = String(count ?? '').trim();
  const n = raw === '' ? DEFAULT_PROBLEMS : Number(raw);
  if (!Number.isInteger(n) || n < MIN_PROBLEMS || n > MAX_PROBLEMS) errors.count = `Choose ${MIN_PROBLEMS} to ${MAX_PROBLEMS} problems.`;
  const text = String(notes ?? '').trim();
  if (text.length > MAX_NOTES) errors.notes = `Keep the notes under ${MAX_NOTES} characters.`;
  const level = DIFFICULTIES.some((d) => d.value === difficulty) ? difficulty : 'same';
  return {
    values: { count: errors.count ? DEFAULT_PROBLEMS : n, difficulty: level, hints: Boolean(hints), challenge: challenge !== false, notes: text || null },
    errors,
  };
}

// The body for POST /api/grade { action: 'draft_homework' }
export function draftRequest({ photos, options, context = {}, studentId = null }) {
  return {
    action: 'draft_homework',
    images: photos.map((p) => p.dataUrl),
    count: options.count,
    difficulty: options.difficulty,
    hints: options.hints,
    challenge: options.challenge !== false,
    notes: options.notes,
    subject: context.subject ?? null,
    grade: context.grade ?? null,
    student_id: studentId ?? null,
  };
}

// The subject and grade sent as context: the lesson's subject, else the
// subject of the signed-in tutor's link to the student, else the student's
// only subject (an admin who does not teach them); the grade from the
// student's profile
export function draftContext({ lesson = null, links = null, studentId = null, tutorId = null, gradeLevel = null } = {}) {
  const same = (a, b) => a !== null && a !== undefined && String(a) === String(b);
  const fromLesson = lesson && same(lesson.student_id, studentId) ? lesson.subject : null;
  const theirs = (links ?? []).filter((l) => same(l.student_id, studentId) && String(l.subject ?? '').trim());
  const own = theirs.find((l) => same(l.tutor_id, tutorId));
  const subjects = [...new Set(theirs.map((l) => String(l.subject).trim()))];
  const subject = String(fromLesson || own?.subject || (subjects.length === 1 ? subjects[0] : '') || '').trim() || null;
  const grade = String(gradeLevel ?? '').trim() || null;
  return { subject, grade };
}

// "Algebra, 9th grade" (what the panel says it will send), or ''
export function contextText({ subject, grade } = {}) {
  return [subject, grade].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// A finished draft

// The form's fields from a draft's result: { title, details, answerKey, notice }
// (notice: the server's note that problems were left out, or null)
export function formFromDraft(result) {
  const r = result && typeof result === 'object' ? result : {};
  return {
    title: String(r.title ?? '').trim().slice(0, 200),
    details: String(r.details ?? '').trim().slice(0, MAX_DETAILS),
    answerKey: String(r.answer_key_text ?? '').trim().slice(0, 20000),
    notice: typeof r.notice === 'string' && r.notice.trim() ? r.notice.trim() : null,
  };
}

// 'drafting' | 'ready' | 'failed', exactly as the server last said. A draft
// that ran too long is the server's call (draft_status reports it failed),
// never this browser's clock.
export function draftState(row) {
  if (!row) return 'failed';
  return ['drafting', 'ready', 'failed'].includes(row.status) ? row.status : 'failed';
}

// What a draft_status answer means for polling:
//   'apply'  200: take the server's status (and the result when ready)
//   'gone'   404: the draft was deleted, or is not this person's
//   'retry'  anything else (offline 0, 400, 401, 403, 429, 5xx): ask again next time
export function pollOutcome(httpStatus) {
  if (httpStatus === 200) return 'apply';
  if (httpStatus === 404) return 'gone';
  return 'retry';
}

// Whether to refresh the sign-in token before calling the API: it expires
// within REFRESH_WITHIN_S, or the last call came back 401 (forced). A session
// without an expiry (the local demo) is left alone unless forced.
export function tokenNeedsRefresh(session, nowMs = Date.now(), { forced = false } = {}) {
  if (!session) return forced;
  if (forced) return true;
  const expires = Number(session.expires_at);
  return Number.isFinite(expires) && expires > 0 && expires * 1000 - nowMs < REFRESH_WITHIN_S * 1000;
}

// The message when files and lesson photos together would be too many for
// one assignment, or ''
export function attachmentsProblem(files, photos, max = MAX_ATTACHMENTS) {
  const total = files + photos;
  if (total <= max) return '';
  const fileText = files === 1 ? '1 file' : `${files} files`;
  const photoText = photos === 1 ? '1 lesson photo' : `${photos} lesson photos`;
  return `An assignment can have at most ${max} attachments. This one has ${fileText} and ${photoText}. Remove some files, or untick Attach these photos.`;
}

// What to say when a draft finishes after the form moved to another student
// (or none): the draft is kept in Recent drafts and never fills this form
export function elsewhereText(name) {
  return `Draft for ${name || 'another student'} is ready. Open it from Recent drafts.`;
}

// "0:05", "1:23", "12:03"
export function elapsedText(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

// The caller's drafts of the last RECENT_DAYS days, this student's first,
// newest first within each group
export function recentDrafts(rows, { studentId = null, now = new Date() } = {}) {
  const since = now.getTime() - RECENT_DAYS * 86_400_000;
  const mine = (r) => studentId !== null && String(r.student_id) === String(studentId);
  return (rows ?? [])
    .filter((r) => Date.parse(r.created_at) >= since)
    .sort((a, b) => (Number(mine(b)) - Number(mine(a))) || (Date.parse(b.created_at) - Date.parse(a.created_at)) || (b.id - a.id));
}

const DIFFICULTY_WORDS = { easier: 'easier', same: 'about the same', harder: 'harder' };

// One line about a draft's options: "5 practice problems, harder, with hints"
export function optionsText(options = {}) {
  const n = Number(options.count) || DEFAULT_PROBLEMS;
  return [
    `${n} practice ${n === 1 ? 'problem' : 'problems'}`,
    DIFFICULTY_WORDS[options.difficulty] ?? null,
    options.hints ? 'with hints' : null,
  ].filter(Boolean).join(', ');
}

// The newest draft for this student still drafting (one to pick up again
// when the form reopens), or null
export function activeDraft(rows, { studentId } = {}) {
  if (studentId === null || studentId === undefined || studentId === '') return null;
  return (rows ?? [])
    .filter((r) => String(r.student_id) === String(studentId) && draftState(r) === 'drafting')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
}

// Whether the create form should open the panel by itself: this student has a
// draft still drafting, or one that finished in the last hour
export function shouldReopen(rows, { studentId, now = new Date() } = {}) {
  if (studentId === null || studentId === undefined) return false;
  return (rows ?? []).some((r) => {
    if (String(r.student_id) !== String(studentId)) return false;
    const state = draftState(r);
    if (state === 'drafting') return true;
    const finished = Date.parse(r.finished_at ?? r.created_at);
    return state === 'ready' && now.getTime() - finished <= 3_600_000;
  });
}
