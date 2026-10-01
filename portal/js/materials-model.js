// Pure logic for lesson materials and homework from the tutor: which files may
// be added, their storage names and labels, links, and the homework set in a
// lesson. No DOM.
//
// A material row: { id, student_id, session_id, task_id, title, storage_path,
// file_type, size_bytes, url, created_by, created_at }. Exactly one of
// session_id and task_id is set, and it is either a file (storage_path,
// file_type, size_bytes) or a link (url).

import { dayKey, addDays } from './dates.js';
import { sortSessions, isCancelled, sessionTitle, shortDayText } from './sessions-model.js';

export const MATERIALS_BUCKET = 'materials';
export const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;
export const MAX_TITLE = 200;
export const SIGN_SECONDS = 600;          // signed links last 10 minutes
export const RESIGN_AFTER_MS = 8 * 60_000; // and are signed again after 8

export const MATERIAL_TYPES = Object.freeze({
  'application/pdf': { ext: 'pdf', label: 'PDF', icon: 'file-pdf' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx', label: 'PowerPoint', icon: 'presentation' },
  'application/vnd.ms-powerpoint': { ext: 'ppt', label: 'PowerPoint', icon: 'presentation' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', label: 'Word', icon: 'file-text' },
  'application/msword': { ext: 'doc', label: 'Word', icon: 'file-text' },
  'image/png': { ext: 'png', label: 'Image', icon: 'image-square' },
  'image/jpeg': { ext: 'jpg', label: 'Image', icon: 'image-square' },
});

// Some systems leave file.type blank for Office files, so the name decides then
const BY_EXTENSION = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export const MATERIAL_ACCEPT = [
  ...Object.keys(BY_EXTENSION).map((ext) => `.${ext}`),
  ...Object.keys(MATERIAL_TYPES),
].join(',');

const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name ?? ''));
  return m ? m[1].toLowerCase() : '';
};

// ---------------------------------------------------------------------------
// Files

// The file's type as the bucket knows it, or null when it is not allowed
export function materialType(file) {
  if (file?.type && MATERIAL_TYPES[file.type]) return file.type;
  return BY_EXTENSION[extOf(file?.name)] ?? null;
}

// A message saying what is wrong with a file, or null when it may be added
export function validateMaterialFile(file) {
  if (!file) return 'Choose a file.';
  if (!materialType(file)) return 'Add a PDF, a PowerPoint or Word file, or an image (JPG or PNG).';
  if (!file.size) return 'That file is empty.';
  if (file.size > MAX_MATERIAL_BYTES) return 'Files must be under 25 MB.';
  return null;
}

// '<student id>/<random id>.<ext>' in the materials bucket
export function materialPath(studentId, mime, id = globalThis.crypto.randomUUID()) {
  return `${studentId}/${id}.${MATERIAL_TYPES[mime].ext}`;
}

// "Lesson 4 slides.pptx" -> "Lesson 4 slides"
export function titleFromFile(name) {
  const base = String(name ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  return (base || 'Untitled file').slice(0, MAX_TITLE);
}

// "850 KB", "2.4 MB"
export function sizeText(bytes) {
  const n = Number(bytes);
  if (!(n > 0)) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// The name a downloaded copy gets: the title with the file's extension
export function downloadName(material) {
  const ext = MATERIAL_TYPES[material.file_type]?.ext ?? extOf(material.storage_path);
  const safe = String(material.title ?? 'file').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'file';
  return ext && !safe.toLowerCase().endsWith(`.${ext}`) ? `${safe}.${ext}` : safe;
}

// ---------------------------------------------------------------------------
// Links

// "Google Slides", "Google Doc", "Canva", "YouTube video", or the host
export function linkLabel(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'Link';
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'docs.google.com') {
    if (u.pathname.startsWith('/presentation')) return 'Google Slides';
    if (u.pathname.startsWith('/document')) return 'Google Doc';
    if (u.pathname.startsWith('/spreadsheets')) return 'Google Sheet';
    if (u.pathname.startsWith('/forms')) return 'Google Form';
  }
  if (host === 'drive.google.com') return 'Google Drive';
  if (host.endsWith('canva.com')) return 'Canva';
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'YouTube video';
  if (host.endsWith('khanacademy.org')) return 'Khan Academy';
  if (host.endsWith('desmos.com')) return 'Desmos';
  return host;
}

// Raw link form -> { ok, errors, values: { url, title } }. A blank title
// becomes the link's label ("Google Slides").
export function validateLink({ url, title } = {}) {
  const u = String(url ?? '').trim();
  const t = String(title ?? '').trim();
  const errors = {};
  if (!u) errors.url = 'Paste a link.';
  else if (!/^https:\/\/\S+$/.test(u) || u.length > 1000) errors.url = 'Use a link that starts with https://';
  else {
    try {
      new URL(u);
    } catch {
      errors.url = 'That link does not look right.';
    }
  }
  if (t.length > MAX_TITLE) errors.title = `Use at most ${MAX_TITLE} characters.`;
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, values: { url: u, title: t || (ok ? linkLabel(u) : '') } };
}

// ---------------------------------------------------------------------------
// Rows

export const isLink = (m) => !blank(m?.url);

export function materialIcon(m) {
  return isLink(m) ? 'link-simple' : (MATERIAL_TYPES[m?.file_type]?.icon ?? 'file-text');
}

// "PowerPoint, 2.4 MB" for a file; "Google Slides" or the host for a link
// (the host when the title already says "Google Slides")
export function materialMeta(m) {
  if (isLink(m)) {
    const label = linkLabel(m.url);
    if (label.toLowerCase() !== String(m.title ?? '').trim().toLowerCase()) return label;
    try {
      return new URL(m.url).hostname.replace(/^www\./, '');
    } catch {
      return label;
    }
  }
  return [MATERIAL_TYPES[m.file_type]?.label ?? 'File', sizeText(m.size_bytes)].filter(Boolean).join(', ');
}

// The materials of one session or one task, oldest first
export function materialsFor(list, { sessionId = null, taskId = null } = {}) {
  const same = (a, b) => a !== null && a !== undefined && String(a) === String(b);
  return [...(list ?? [])]
    .filter((m) => (sessionId !== null ? same(m.session_id, sessionId) : same(m.task_id, taskId)))
    .sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) || (Number(a.id) - Number(b.id)));
}

// How many materials each session has: Map<sessionId, n>
export function materialCounts(list) {
  const counts = new Map();
  for (const m of list ?? []) {
    if (m.session_id === null || m.session_id === undefined) continue;
    const key = String(m.session_id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Homework set in a lesson

// Tasks set in this session, soonest due first (no due date last)
export function homeworkFor(tasks, sessionId) {
  const due = (t) => (t.due_at ? Date.parse(t.due_at) : Infinity);
  return (tasks ?? [])
    .filter((t) => t.session_id !== null && t.session_id !== undefined && String(t.session_id) === String(sessionId))
    .sort((a, b) => (due(a) - due(b)) || (Number(a.id) - Number(b.id)));
}

// "the Algebra lesson on Tue, Oct 6" ("the lesson on ..." without a subject)
export function lessonLabel(session, today = null) {
  const subject = sessionTitle(session);
  const name = subject === 'Tutoring session' ? 'lesson' : `${subject} lesson`;
  return `the ${name} on ${shortDayText(dayKey(session.starts_at), today)}`;
}

// The default due day for homework set in a session: the day before the same
// tutor's next session with the student, or six days after this one when
// there is none. Never earlier than the day after this session, nor before
// tomorrow (homework set from an old lesson).
export function homeworkDueKey(session, sessions, today = null) {
  const day = dayKey(session.starts_at);
  const next = sortSessions(sessions).find((s) => !isCancelled(s)
    && String(s.tutor_id) === String(session.tutor_id)
    && String(s.student_id) === String(session.student_id)
    && Date.parse(s.starts_at) > Date.parse(session.ends_at)
    && dayKey(s.starts_at) > day);
  const key = next ? addDays(dayKey(next.starts_at), -1) : addDays(day, 6);
  const floor = [addDays(day, 1), today ? addDays(today, 1) : null].filter(Boolean).sort().pop();
  return key >= floor ? key : floor;
}
