// Pure logic for "Before you start", the block at the top of a staff member's
// session drawer for a lesson that has not ended yet. It answers "what happened
// last time and what is pending" from data the drawer already loaded: the
// student's sessions, their items (buckets.js deriveItems, so statuses and
// buckets are the portal's own) and their submissions. No DOM, no network.
//
// What it picks:
//   last lesson   the latest earlier lesson that already happened, preferring
//                 the same subject and tutor, then any
//   homework      items set in that lesson (tasks.session_id), items made or
//                 due since it started, and anything overdue; overdue first
//   waiting       AI drafts and failed gradings the tutor has yet to release
// Nothing to say gives null, so the drawer shows no empty box.

import { dayKey, todayKey, daysBetween, addDays } from './dates.js';
import { sortSessions, isCancelled, sessionTitle, shortDayText, ATTENDANCE } from './sessions-model.js';
import { isOpen } from './overview-model.js';
import { queueGroups } from './review-model.js';
import { byDue } from './format.js';

export const MAX_PREP_ROWS = 6;
// Work due up to a week after this lesson still counts as "since then"
export const PREP_HORIZON_DAYS = 7;
// A recap longer than this (or with this many lines) may need the Full recap toggle
export const RECAP_CLAMP_CHARS = 110;
export const RECAP_CLAMP_LINES = 3;

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const same = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const subjectKey = (s) => text(s?.subject).toLowerCase();

// ---------------------------------------------------------------------------
// Which sessions get the block

// A lesson that is still to come or happening now (not cancelled, not ended)
export function appliesTo(session, now = new Date()) {
  if (!session || isCancelled(session)) return false;
  const end = ms(session.ends_at);
  return Number.isFinite(end) && end > ms(now);
}

// ---------------------------------------------------------------------------
// Last lesson

// How well an earlier lesson matches this one: 0 same subject and tutor,
// 1 same subject, 2 same tutor, 3 anything else
function matchTier(candidate, session) {
  const subject = subjectKey(candidate) === subjectKey(session);
  const tutor = same(candidate.tutor_id, session.tutor_id);
  if (subject) return tutor ? 0 : 1;
  return tutor ? 2 : 3;
}

// The student's latest earlier lesson that has already ended and was not
// cancelled. A better match (same subject, then same tutor) wins over a more
// recent lesson of another subject. Returns the session or null.
export function pickLastLesson(sessions, session, now = new Date()) {
  if (!session) return null;
  const t = ms(now);
  const start = ms(session.starts_at);
  const earlier = sortSessions(sessions).filter((s) => !same(s.id, session.id)
    && same(s.student_id, session.student_id)
    && !isCancelled(s)
    && ms(s.starts_at) < start
    && ms(s.ends_at) <= t);
  let best = null;
  let bestTier = Infinity;
  // sortSessions is oldest first, so a later entry of the same tier replaces an earlier one
  for (const s of earlier) {
    const tier = matchTier(s, session);
    if (tier <= bestTier) {
      best = s;
      bestTier = tier;
    }
  }
  return best;
}

// "today", "yesterday", "6 days ago", "3 weeks ago"; null past about two months
export function agoText(startsAt, now = new Date()) {
  const days = daysBetween(dayKey(startsAt), todayKey(now));
  if (days < 0) return null;
  if (days === 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return null;
}

// Whether a recap might run past the clamped lines (the drawer confirms by
// measuring; this only decides whether the Full recap toggle is worth building)
export function recapMayOverflow(recap) {
  const body = text(recap);
  if (!body) return false;
  return body.length > RECAP_CLAMP_CHARS || body.split('\n').length >= RECAP_CLAMP_LINES;
}

// What the block shows about the last lesson:
// { session, id, when, ago, subject, tutorId, sameSubject, sameTutor, attendance,
//   attendanceLabel, recap, hasNotes }
export function lastLessonInfo(last, session, now = new Date()) {
  if (!last) return null;
  const recap = text(last.recap) || null;
  const attendance = ATTENDANCE[last.attendance] ? last.attendance : null;
  return {
    session: last,
    id: last.id,
    when: shortDayText(dayKey(last.starts_at), todayKey(now)),
    ago: agoText(last.starts_at, now),
    subject: sessionTitle(last),
    tutorId: last.tutor_id ?? null,
    sameSubject: subjectKey(last) === subjectKey(session),
    sameTutor: same(last.tutor_id, session?.tutor_id),
    attendance,
    attendanceLabel: attendance ? ATTENDANCE[attendance] : null,
    recap,
    hasNotes: Boolean(attendance || recap),
  };
}

// ---------------------------------------------------------------------------
// Homework since the last lesson

const isOverdueOpen = (item) => isOpen(item) && item.dueState === 'overdue';

// 0 overdue, 1 submitted and waiting on the tutor, 2 still to do, 3 finished
function rankOf(item) {
  if (isOverdueOpen(item)) return 0;
  if (item.task.kind !== 'task' && item.bucket === 'in-review') return 1;
  if (isOpen(item)) return 2;
  return 3;
}

// Whether an item belongs in the block:
//   linked to the last lesson (tasks.session_id)        always
//   overdue and still open                              always, whatever its age
//   linked to this lesson                               never (the drawer's own Homework section shows it)
//   linked to some other lesson                         never (unless overdue)
//   not linked to any lesson                            made or due since the last lesson started, and due
//                                                       by the same weekday after this lesson
//   archived work                                       never (long finished or long missed)
function belongs(item, { last, session, horizonKey }) {
  const task = item.task;
  if (same(task.session_id, session.id)) return false;
  if (isOverdueOpen(item)) return true;
  if (item.bucket === 'archived') return false;
  if (last && same(task.session_id, last.id)) return true;
  if (task.session_id !== null && task.session_id !== undefined) return false;
  if (!last) return false;
  const since = ms(last.starts_at);
  const made = task.created_at && ms(task.created_at) >= since;
  const due = task.due_at && ms(task.due_at) >= since;
  if (!made && !due) return false;
  return !task.due_at || dayKey(task.due_at) <= horizonKey;
}

// { rows, more, moreOverdue }: the items to list (most pressing first, at most
// `limit`), how many more there were, and how many of those are overdue
export function homeworkSince(items, { last = null, session, limit = MAX_PREP_ROWS } = {}) {
  if (!session) return { rows: [], more: 0, moreOverdue: 0 };
  const horizonKey = addDays(dayKey(session.starts_at), PREP_HORIZON_DAYS);
  const picked = (items ?? [])
    .filter((item) => belongs(item, { last, session, horizonKey }))
    .sort((a, b) => (rankOf(a) - rankOf(b)) || byDue(a.task, b.task) || (Number(a.task.id) - Number(b.task.id)));
  const rest = picked.slice(limit);
  return { rows: picked.slice(0, limit), more: rest.length, moreOverdue: rest.filter(isOverdueOpen).length };
}

// "3 more", "3 more, 2 overdue"
export function moreText({ more, moreOverdue }) {
  if (!more) return '';
  return moreOverdue ? `${more} more, ${moreOverdue} overdue` : `${more} more`;
}

// ---------------------------------------------------------------------------
// Waiting on the tutor

export const REVIEW_QUEUE_HREF = '#/review';

const plural = (n, one, many) => (n === 1 ? one : many);

// What is in the student's review queue (review-model.js queueGroups, so the
// same rule as the queue and the nav badge): AI drafts and edited drafts not yet
// released, and gradings that failed. `subs` are the student's submissions as
// staff see them. Each note links to the submission when it is the only one in
// its group, otherwise to the queue.
// { drafts, failed, total, notes: [{ key, count, text, href, linkLabel }] }
export function waitingOn(subs) {
  const groups = queueGroups(subs ?? []);
  const draftSubs = groups.filter((g) => g.key === 'draft' || g.key === 'edited').flatMap((g) => g.items);
  const failedSubs = groups.filter((g) => g.key === 'failed').flatMap((g) => g.items);
  const note = (key, list, words) => {
    const n = list.length;
    return {
      key,
      count: n,
      text: words(n),
      href: n === 1 ? `${REVIEW_QUEUE_HREF}/${encodeURIComponent(list[0].id)}` : REVIEW_QUEUE_HREF,
      linkLabel: n === 1 ? 'Review it' : 'Open review queue',
    };
  };
  const notes = [];
  if (draftSubs.length) {
    notes.push(note('drafts', draftSubs, (n) => `${n} ${plural(n, 'grade is', 'grades are')} drafted and waiting for you to release.`));
  }
  if (failedSubs.length) {
    notes.push(note('failed', failedSubs, (n) => `${n} ${plural(n, 'submission', 'submissions')} could not be graded.`));
  }
  return { drafts: draftSubs.length, failed: failedSubs.length, total: draftSubs.length + failedSubs.length, notes };
}

// ---------------------------------------------------------------------------
// The whole block

// { last, homework: { rows, more, moreOverdue }, waiting } or null when the
// lesson is over or cancelled, or there is nothing to show.
//   sessions  every session of the student
//   items     the student's derived items (staff audience)
//   subs      the student's submissions as staff see them
export function buildPrep({ session, sessions, items, subs, now = new Date() } = {}) {
  if (!appliesTo(session, now)) return null;
  const lastSession = pickLastLesson(sessions, session, now);
  const last = lastLessonInfo(lastSession, session, now);
  const homework = homeworkSince(items, { last: lastSession, session });
  const waiting = waitingOn(subs);
  if (!last && !homework.rows.length && !waiting.total) return null;
  return { last, homework, waiting };
}

// The student's own work page (the scoped Assignments list)
export function studentWorkHref(studentId) {
  return `?student=${encodeURIComponent(studentId)}#/assignments/todo`;
}
