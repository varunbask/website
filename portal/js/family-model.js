// Pure logic for the family side of the Overview: the "Recent sessions" card
// (what the tutor wrote after each lesson) and the "Your children" row a parent
// with several children sees first. No DOM, no network.
//
// Recent sessions are the ones that already ended and were not cancelled,
// newest first. Attendance and the recap are written by the tutor and both are
// visible to the family (the session drawer shows them too).

import { dayKey, todayKey, daysBetween, weekday, longDate, parseKey } from './dates.js';
import {
  sortSessions, isCancelled, sessionTitle, timeRange, shortDayText, toneClass, ATTENDANCE,
} from './sessions-model.js';
import { nextSessionOf, nextSessionParts } from './schedule-summary.js';
import { overdueItems, gradedItems } from './overview-model.js';
import { displayName, firstName } from './format.js';

export const RECENT_LIMIT = 3;
export const RECAP_PREVIEW_CHARS = 280;
export const NO_NOTES_TEXT = 'No notes yet';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const counted = (n, one_, many) => `${n} ${n === 1 ? one_ : many}`;

// ---------------------------------------------------------------------------
// Recent sessions

// Sessions that already ended and were not cancelled, newest first (a session
// still under way has no notes yet, so it stays out). limit caps the list.
export function recentSessions(sessions, now = new Date(), { limit = RECENT_LIMIT } = {}) {
  const t = ms(now);
  return sortSessions(sessions)
    .filter((s) => !isCancelled(s) && Number.isFinite(ms(s.ends_at)) && ms(s.ends_at) <= t)
    .reverse()
    .slice(0, limit);
}

// The pill for a session's attendance: { key, label, tone, icon }, or null
// when the tutor has not marked it
const ATTENDANCE_STYLE = {
  present: { tone: 'success', icon: 'check-circle' },
  late: { tone: 'warning', icon: 'clock' },
  absent: { tone: 'danger', icon: 'minus-circle' },
};

export function attendanceStatus(value) {
  const style = ATTENDANCE_STYLE[value];
  return style ? { key: value, label: ATTENDANCE[value], ...style } : null;
}

// One calm line of a recap for the card: line breaks and runs of spaces become
// single spaces, and a long recap is cut at a word with an ellipsis. '' when
// there is nothing to show. (The card clamps the line to two rows as well.)
export function recapPreview(recap, { max = RECAP_PREVIEW_CHARS } = {}) {
  const text = String(recap ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

// A tutor's first name from a Map of ids to full names, or null when unknown
export function tutorFirstName(names, tutorId) {
  const full = names?.get?.(String(tutorId));
  if (blank(full)) return null;
  return String(full).trim().split(/\s+/)[0];
}

// "Today, 4:00 to 5:00 pm", "Yesterday, ...", "Tue, ..." within the last
// week, "Tue, Sep 8, ..." (with the year when it differs) before that
export function recentWhen(session, today, { viewerInZone } = {}) {
  const key = dayKey(session.starts_at);
  const diff = daysBetween(today, key);
  let day;
  if (diff === 0) day = 'Today';
  else if (diff === -1) day = 'Yesterday';
  else if (diff >= -6 && diff < 0) day = WEEKDAYS[weekday(key)].slice(0, 3);
  else day = shortDayText(key, today);
  return `${day}, ${timeRange(session, { viewerInZone })}`;
}

// The spoken name of a row: "Algebra with Daniel, Tuesday, October 6, present".
// The recap is the row's description, not part of its name.
export function recentLabel(session, { who = null, today, attendance = null } = {}) {
  const key = dayKey(session.starts_at);
  const year = parseKey(key).y === parseKey(today).y ? '' : `, ${parseKey(key).y}`;
  const parts = [`${sessionTitle(session)}${who ? ` with ${who}` : ''}`, `${longDate(key)}${year}`];
  if (attendance) parts.push(attendance.label.toLowerCase());
  return parts.join(', ');
}

// Everything a Recent sessions row needs:
// [{ id, title, tone, month, day, when, who, attendance, recap, label }]
// names: Map of tutor ids to full names (the row shows the first name)
export function recentRows(sessions, names, now = new Date(), { limit = RECENT_LIMIT, viewerInZone } = {}) {
  const today = todayKey(now);
  return recentSessions(sessions, now, { limit }).map((s) => {
    const who = tutorFirstName(names, s.tutor_id);
    const attendance = attendanceStatus(s.attendance);
    const { m, d } = parseKey(dayKey(s.starts_at));
    return {
      id: s.id,
      title: sessionTitle(s),
      tone: toneClass(s.subject),
      month: m,
      day: d,
      when: recentWhen(s, today, { viewerInZone }),
      who,
      attendance,
      recap: recapPreview(s.recap) || null,
      label: recentLabel(s, { who, today, attendance }),
    };
  });
}

// ---------------------------------------------------------------------------
// Your children (a parent with two or more children)

// A parent sees this row only with two or more linked children
export const showChildrenRow = (children) => (children?.length ?? 0) >= 2;

// The link that switches to a child and opens their Overview
export function childHref(id) {
  return `?child=${encodeURIComponent(id)}#/overview`;
}

// One child's summary from their derived items and sessions. items is null
// when their work did not load, sessions null when their schedule did not;
// the rest still shows.
//   { id, name, first, hasWork, hasSchedule, next, overdue, grade }
//   next   { id, subject, day, time, text, today, tomorrow } for the next session, or null
//   grade  { score, title, releasedAt } for the newest released grade, or null
export function childSummary({ child, items = null, sessions = null, now = new Date(), viewerInZone } = {}) {
  const name = displayName(child);
  const today = todayKey(now);
  const out = {
    id: String(child?.id ?? ''),
    name,
    first: firstName(name),
    hasWork: items !== null && items !== undefined,
    hasSchedule: sessions !== null && sessions !== undefined,
    next: null,
    overdue: 0,
    grade: null,
  };
  if (out.hasWork) {
    out.overdue = overdueItems(items, { tasks: true }).length;
    const newest = gradedItems(items)[0];
    if (newest) {
      out.grade = {
        score: Number(newest.grade.score),
        title: newest.task.title || 'Untitled',
        releasedAt: newest.grade.released_at,
      };
    }
  }
  if (out.hasSchedule) {
    const next = nextSessionOf(sessions, now);
    if (next) {
      const diff = daysBetween(today, dayKey(next.starts_at));
      out.next = {
        id: next.id,
        subject: sessionTitle(next),
        ...nextSessionParts(next, today, { viewerInZone }),
        today: diff === 0,
        tomorrow: diff === 1,
      };
    }
  }
  return out;
}

// The words on a child's item: { next, overdue, grade, label }. Each part is
// { text, tone } (tone 'danger' for overdue work, otherwise null); a part is
// null when its data did not load. label is the spoken name of the link.
export function childLines(summary) {
  const next = summary.hasSchedule
    ? {
      text: summary.next
        ? `${summary.next.today ? 'Today' : summary.next.tomorrow ? 'Tomorrow' : summary.next.day} at ${summary.next.time}`
        : 'No upcoming sessions',
      tone: null,
    }
    : null;
  const overdue = summary.hasWork
    ? { text: summary.overdue > 0 ? `${summary.overdue} overdue` : 'Nothing overdue', tone: summary.overdue > 0 ? 'danger' : null }
    : null;
  const grade = summary.hasWork
    ? {
      text: summary.grade ? `Latest grade ${summary.grade.score}, ${summary.grade.title}` : 'No grades yet',
      tone: null,
    }
    : null;
  const spoken = [
    summary.name,
    next ? (summary.next ? `next session ${next.text}` : next.text.toLowerCase()) : 'schedule unavailable',
    summary.hasWork
      ? (summary.overdue > 0 ? counted(summary.overdue, 'overdue item', 'overdue items') : 'nothing overdue')
      : 'work unavailable',
    summary.hasWork && summary.grade ? `latest grade ${summary.grade.score} out of 100, ${summary.grade.title}` : null,
  ];
  return { next, overdue, grade, label: spoken.filter(Boolean).join(', ') };
}
