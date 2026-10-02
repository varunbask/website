import { TIME_ZONE } from './config.js';

export const PORTAL_LINE = 'Open in the portal:';
export const JOIN_LINE = 'Join online:';
const SUFFIX = / \(([^()]+)\)$/;
const JOIN_URL = new RegExp(`${JOIN_LINE}[ \\t]*(https://[^\\s<]+)`);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

// Google's web editor saves descriptions as HTML. Reduce one to plain text:
// line breaks and block ends become newlines, a link becomes its text (or its
// href when the text is empty), other tags go, and common entities decode.
// Text that has no markup comes out unchanged (apart from the final trim).
function plainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>|<\/(?:p|div)\s*>/gi, '\n')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_, attrs, inner) => {
      const text = inner.replace(/<\/?[a-z][^>]*>/gi, '').trim();
      return text || (attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean) ?? '');
    })
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The Google event for a portal session (insert body; also used as a patch).
// A session with both a place and a meeting link keeps the place in the
// location and puts the link on a "Join online:" line in the description.
export function sessionToEvent(s, { studentName, studentEmail, portalUrl }) {
  const subject = (s.subject ?? '').trim() || 'Tutoring session';
  const description = [
    s.notes?.trim() || null,
    s.meeting_url && s.location ? `${JOIN_LINE} ${s.meeting_url}` : null,
    `${PORTAL_LINE} ${portalUrl}`,
  ].filter(Boolean).join('\n\n');
  return {
    summary: studentName ? `${subject} (${studentName})` : subject,
    description,
    location: s.location || s.meeting_url || '',
    start: { dateTime: new Date(s.starts_at).toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: new Date(s.ends_at).toISOString(), timeZone: TIME_ZONE },
    attendees: studentEmail ? [{ email: studentEmail }] : [],
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    extendedProperties: { private: { vpSessionId: String(s.id), vpStudentId: String(s.student_id) } },
  };
}

// Session fields from a Google event; null for an all-day or timeless event
export function eventToSessionFields(e) {
  if (e.status === 'cancelled') return { status: 'cancelled' };
  const start = e.start?.dateTime;
  const end = e.end?.dateTime;
  if (!start || !end) return null;
  const summary = String(e.summary ?? '').trim();
  const subject = summary.replace(SUFFIX, '').trim() || null;
  const desc = plainText(e.description);
  // Notes are what comes before the first line the portal added
  const cuts = [JOIN_LINE, PORTAL_LINE].map((marker) => desc.indexOf(marker)).filter((i) => i >= 0);
  const notes = (cuts.length ? desc.slice(0, Math.min(...cuts)) : desc).trim() || null;
  const loc = String(e.location ?? '').trim();
  const isUrl = /^https:\/\/\S+$/.test(loc);
  const joined = desc.match(JOIN_URL)?.[1] ?? null;
  const hangout = e.hangoutLink && /^https:\/\//.test(e.hangoutLink) ? e.hangoutLink : null;
  const meeting = hangout ?? joined ?? (isUrl ? loc : null);
  return {
    subject: subject ? subject.slice(0, 60) : null,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    location: isUrl ? null : (loc ? loc.slice(0, 200) : null),
    meeting_url: meeting && meeting.length <= 500 ? meeting : null,
    notes: notes ? notes.slice(0, 2000) : null,
    status: 'scheduled',
    google_link: e.htmlLink && /^https:\/\//.test(e.htmlLink) ? e.htmlLink : null,
  };
}

// The one linked student invited to an event, by connected Google address
// first, then portal email; null when none or more than one match
export function matchStudent(e, students) {
  const emails = new Set((e.attendees ?? []).map((a) => String(a.email ?? '').toLowerCase()).filter(Boolean));
  const hits = (students ?? []).filter((st) => [st.google_email, st.email]
    .some((m) => m && emails.has(String(m).toLowerCase())));
  return hits.length === 1 ? hits[0] : null;
}

// Who wins when both changed: Google, unless the portal row is waiting to be
// pushed and was changed after the event
export function resolveConflict(row, e) {
  const eventChanged = e.updated ? Date.parse(e.updated) : 0;
  if (row.sync_state === 'pending' && Date.parse(row.updated_at) > eventChanged) return 'portal';
  return 'google';
}

// A personal event for the tutor's overlay; private ones only say Busy
export function personalItem(e) {
  if (e.status === 'cancelled') return null;
  const allDay = Boolean(e.start?.date && !e.start?.dateTime);
  const start = e.start?.dateTime ?? e.start?.date;
  const end = e.end?.dateTime ?? e.end?.date;
  if (!start || !end) return null;
  const hidden = e.visibility === 'private' || e.visibility === 'confidential';
  return { id: String(e.id), title: hidden ? 'Busy' : (String(e.summary ?? '').trim() || 'Busy'), start, end, all_day: allDay };
}
