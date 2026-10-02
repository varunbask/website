import { describe, test, expect } from 'vitest';
import {
  sessionToEvent, eventToSessionFields, matchStudent, resolveConflict, personalItem, PORTAL_LINE, JOIN_LINE,
} from '../../api/_lib/google/mapping.js';

const PORTAL = 'https://www.varunbaskaran.com/portal/';
const OPTS = { studentName: 'Maya Lin', studentEmail: 'maya@example.com', portalUrl: PORTAL };

const session = (over = {}) => ({
  id: 12, student_id: 'stu-1', subject: 'Algebra', notes: null, location: null, meeting_url: null,
  starts_at: '2026-10-05T16:00:00Z', ends_at: '2026-10-05T17:00:00Z', ...over,
});

describe('constants', () => {
  test('PORTAL_LINE and JOIN_LINE', () => {
    expect(PORTAL_LINE).toBe('Open in the portal:');
    expect(JOIN_LINE).toBe('Join online:');
  });
});

describe('sessionToEvent', () => {
  test('summary has the student name when there is one', () => {
    expect(sessionToEvent(session(), OPTS).summary).toBe('Algebra (Maya Lin)');
    expect(sessionToEvent(session(), { ...OPTS, studentName: '' }).summary).toBe('Algebra');
    expect(sessionToEvent(session(), { ...OPTS, studentName: undefined }).summary).toBe('Algebra');
  });

  test('falls back to a generic subject', () => {
    expect(sessionToEvent(session({ subject: '  ' }), OPTS).summary).toBe('Tutoring session (Maya Lin)');
    expect(sessionToEvent(session({ subject: null }), { ...OPTS, studentName: '' }).summary).toBe('Tutoring session');
  });

  test('the description is the notes, then the portal line', () => {
    expect(sessionToEvent(session({ notes: ' Bring chapter 3 ' }), OPTS).description)
      .toBe(`Bring chapter 3\n\n${PORTAL_LINE} ${PORTAL}`);
    expect(sessionToEvent(session(), OPTS).description).toBe(`${PORTAL_LINE} ${PORTAL}`);
    expect(sessionToEvent(session({ notes: '   ' }), OPTS).description).toBe(`${PORTAL_LINE} ${PORTAL}`);
  });

  test('a meeting URL alone is used as the location, with no join line', () => {
    const e = sessionToEvent(session({ meeting_url: 'https://meet.test/abc' }), OPTS);
    expect(e.location).toBe('https://meet.test/abc');
    expect(e.description).not.toContain(JOIN_LINE);
  });

  test('a location alone is the location', () => {
    const e = sessionToEvent(session({ location: 'Library, room 2' }), OPTS);
    expect(e.location).toBe('Library, room 2');
    expect(e.description).not.toContain(JOIN_LINE);
  });

  test('with no location or meeting URL the location is empty', () => {
    expect(sessionToEvent(session(), OPTS).location).toBe('');
  });

  test('with both, the location is the place and the join line follows the notes', () => {
    const e = sessionToEvent(session({
      notes: 'Bring chapter 3', location: 'Library, room 2', meeting_url: 'https://meet.test/abc',
    }), OPTS);
    expect(e.location).toBe('Library, room 2');
    expect(e.description).toBe(`Bring chapter 3\n\n${JOIN_LINE} https://meet.test/abc\n\n${PORTAL_LINE} ${PORTAL}`);
  });

  test('with both and no notes the description is the join line then the portal line', () => {
    const e = sessionToEvent(session({ location: 'Cafe', meeting_url: 'https://meet.test/abc' }), OPTS);
    expect(e.description).toBe(`${JOIN_LINE} https://meet.test/abc\n\n${PORTAL_LINE} ${PORTAL}`);
  });

  test('attendees only with an email', () => {
    expect(sessionToEvent(session(), OPTS).attendees).toEqual([{ email: 'maya@example.com' }]);
    expect(sessionToEvent(session(), { ...OPTS, studentEmail: '' }).attendees).toEqual([]);
    expect(sessionToEvent(session(), { ...OPTS, studentEmail: null }).attendees).toEqual([]);
  });

  test('guests cannot modify or invite', () => {
    const e = sessionToEvent(session(), OPTS);
    expect(e.guestsCanModify).toBe(false);
    expect(e.guestsCanInviteOthers).toBe(false);
  });

  test('extendedProperties carry the session and student ids as strings', () => {
    expect(sessionToEvent(session(), OPTS).extendedProperties).toEqual({
      private: { vpSessionId: '12', vpStudentId: 'stu-1' },
    });
  });

  test('times are ISO strings in the Los Angeles time zone', () => {
    const e = sessionToEvent(session({ starts_at: '2026-10-05T09:00:00-07:00', ends_at: '2026-10-05T10:00:00-07:00' }), OPTS);
    expect(e.start).toEqual({ dateTime: '2026-10-05T16:00:00.000Z', timeZone: 'America/Los_Angeles' });
    expect(e.end).toEqual({ dateTime: '2026-10-05T17:00:00.000Z', timeZone: 'America/Los_Angeles' });
  });
});

describe('eventToSessionFields', () => {
  const event = (over = {}) => ({
    id: 'e1', status: 'confirmed', summary: 'Algebra (Maya Lin)',
    start: { dateTime: '2026-10-05T09:00:00-07:00' }, end: { dateTime: '2026-10-05T10:00:00-07:00' },
    ...over,
  });

  test('strips the student suffix from the summary', () => {
    expect(eventToSessionFields(event()).subject).toBe('Algebra');
    expect(eventToSessionFields(event({ summary: 'Algebra' })).subject).toBe('Algebra');
    expect(eventToSessionFields(event({ summary: 'Review (weekly) (Maya Lin)' })).subject).toBe('Review (weekly)');
  });

  test('the generic label the portal writes for a session with no subject maps back to a null subject', () => {
    expect(eventToSessionFields(event({ summary: 'Tutoring session (Maya Lin)' })).subject).toBeNull();
    expect(eventToSessionFields(event({ summary: 'Tutoring session' })).subject).toBeNull();
    expect(eventToSessionFields(event({ summary: '  Tutoring session  ' })).subject).toBeNull();
    expect(eventToSessionFields(event({ summary: 'Tutoring session notes (Maya Lin)' })).subject).toBe('Tutoring session notes');
    expect(eventToSessionFields(event({ summary: 'tutoring session' })).subject).toBe('tutoring session');
  });

  test('an empty summary gives a null subject', () => {
    expect(eventToSessionFields(event({ summary: undefined })).subject).toBeNull();
    expect(eventToSessionFields(event({ summary: '  ' })).subject).toBeNull();
  });

  test('converts times to ISO and marks the session scheduled', () => {
    const f = eventToSessionFields(event());
    expect(f.starts_at).toBe('2026-10-05T16:00:00.000Z');
    expect(f.ends_at).toBe('2026-10-05T17:00:00.000Z');
    expect(f.status).toBe('scheduled');
  });

  test('cuts the portal line from the description', () => {
    const f = eventToSessionFields(event({ description: `Bring chapter 3\n\n${PORTAL_LINE} ${PORTAL}` }));
    expect(f.notes).toBe('Bring chapter 3');
    expect(eventToSessionFields(event({ description: `${PORTAL_LINE} ${PORTAL}` })).notes).toBeNull();
    expect(eventToSessionFields(event({ description: 'Just a note' })).notes).toBe('Just a note');
    expect(eventToSessionFields(event()).notes).toBeNull();
  });

  test('a Join online line gives the meeting URL and is cut from the notes', () => {
    const f = eventToSessionFields(event({
      location: 'Library, room 2',
      description: `Bring chapter 3\n\n${JOIN_LINE} https://meet.test/abc\n\n${PORTAL_LINE} ${PORTAL}`,
    }));
    expect(f.meeting_url).toBe('https://meet.test/abc');
    expect(f.location).toBe('Library, room 2');
    expect(f.notes).toBe('Bring chapter 3');
  });

  test('a Join online line with no notes leaves the notes null', () => {
    const f = eventToSessionFields(event({ description: `${JOIN_LINE} https://meet.test/abc\n\n${PORTAL_LINE} ${PORTAL}` }));
    expect(f.notes).toBeNull();
    expect(f.meeting_url).toBe('https://meet.test/abc');
  });

  test('notes stop at whichever marker comes first', () => {
    const portalFirst = eventToSessionFields(event({
      description: `Note\n\n${PORTAL_LINE} ${PORTAL}\n\n${JOIN_LINE} https://meet.test/abc`,
    }));
    expect(portalFirst.notes).toBe('Note');
  });

  test('a Join online line stops at markup', () => {
    const f = eventToSessionFields(event({ description: `${JOIN_LINE} https://meet.test/abc<br><br>${PORTAL_LINE} ${PORTAL}` }));
    expect(f.meeting_url).toBe('https://meet.test/abc');
  });

  describe('descriptions saved as HTML by the Google web editor', () => {
    test('notes and the meeting link come out clean', () => {
      const f = eventToSessionFields(event({
        location: 'Library, room 2',
        description: 'Bring chapter 3<br><br>Join online: <a href="https://meet.example/x">https://meet.example/x</a>'
          + `<br><br>${PORTAL_LINE} <a href="${PORTAL}">${PORTAL}</a>`,
      }));
      expect(f.notes).toBe('Bring chapter 3');
      expect(f.meeting_url).toBe('https://meet.example/x');
      expect(f.location).toBe('Library, room 2');
    });

    test('an anchor-wrapped Join link in paragraphs', () => {
      const f = eventToSessionFields(event({
        description: '<p>Bring chapter 3</p><p>Join online: <a href="https://meet.example/x" target="_blank">https://meet.example/x</a></p>'
          + `<p>${PORTAL_LINE} <a href="${PORTAL}">${PORTAL}</a></p>`,
      }));
      expect(f.notes).toBe('Bring chapter 3');
      expect(f.meeting_url).toBe('https://meet.example/x');
    });

    test('an anchor with no text becomes its href', () => {
      const f = eventToSessionFields(event({ description: `${JOIN_LINE} <a href='https://meet.example/y'></a>` }));
      expect(f.meeting_url).toBe('https://meet.example/y');
      expect(f.notes).toBeNull();
    });

    test('line break and block tag variants become newlines and other tags are stripped', () => {
      const f = eventToSessionFields(event({ description: 'A<br/>B<br />C</p>D</div><b>E</b> <i>F</i>' }));
      expect(f.notes).toBe('A\nB\nC\nD\nE F');
    });

    test('three or more newlines collapse to two', () => {
      expect(eventToSessionFields(event({ description: 'A<br><br><br><br>B' })).notes).toBe('A\n\nB');
    });

    test('entities decode, and nbsp becomes a space', () => {
      const f = eventToSessionFields(event({
        description: 'Tom &amp; Jerry &lt;3 &quot;quoted&quot; it&#39;s&nbsp;fine &gt; &amp;lt; stays',
      }));
      expect(f.notes).toBe('Tom & Jerry <3 "quoted" it\'s fine > &lt; stays');
    });

    test('entities in a link are decoded', () => {
      const f = eventToSessionFields(event({
        description: `${JOIN_LINE}&nbsp;<a href="https://meet.example/x?a=1&amp;b=2">https://meet.example/x?a=1&amp;b=2</a>`,
      }));
      expect(f.meeting_url).toBe('https://meet.example/x?a=1&b=2');
    });

    test('a plain-text description is unchanged', () => {
      const text = 'Bring chapter 3.\nIs x < y and y > z?\n\nSecond paragraph: 5 > 3 & 2 < 4';
      expect(eventToSessionFields(event({ description: text })).notes).toBe(text);
    });
  });

  test('a Join online line that is not an https URL is ignored', () => {
    const f = eventToSessionFields(event({ description: `${JOIN_LINE} http://insecure.test/x` }));
    expect(f.meeting_url).toBeNull();
  });

  test('hangoutLink becomes the meeting URL and wins over the other sources', () => {
    expect(eventToSessionFields(event({ hangoutLink: 'https://meet.google.com/xyz' })).meeting_url)
      .toBe('https://meet.google.com/xyz');
    const f = eventToSessionFields(event({
      hangoutLink: 'https://meet.google.com/xyz',
      location: 'https://zoom.test/1',
      description: `${JOIN_LINE} https://meet.test/abc`,
    }));
    expect(f.meeting_url).toBe('https://meet.google.com/xyz');
  });

  test('the Join online line wins over an https location', () => {
    const f = eventToSessionFields(event({ location: 'https://zoom.test/1', description: `${JOIN_LINE} https://meet.test/abc` }));
    expect(f.meeting_url).toBe('https://meet.test/abc');
    expect(f.location).toBeNull();
  });

  test('an https location becomes the meeting URL with a null location', () => {
    const f = eventToSessionFields(event({ location: 'https://zoom.test/1' }));
    expect(f.meeting_url).toBe('https://zoom.test/1');
    expect(f.location).toBeNull();
  });

  test('a place stays the location with no meeting URL', () => {
    const f = eventToSessionFields(event({ location: 'Library, room 2' }));
    expect(f.location).toBe('Library, room 2');
    expect(f.meeting_url).toBeNull();
  });

  test('a non-https hangoutLink is not used', () => {
    expect(eventToSessionFields(event({ hangoutLink: 'http://meet.test/x' })).meeting_url).toBeNull();
  });

  test('an all-day or timeless event gives null', () => {
    expect(eventToSessionFields(event({ start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }))).toBeNull();
    expect(eventToSessionFields(event({ start: undefined, end: undefined }))).toBeNull();
  });

  test('a cancelled event gives only the cancelled status', () => {
    expect(eventToSessionFields({ id: 'e1', status: 'cancelled' })).toEqual({ status: 'cancelled' });
  });

  test('clips long strings', () => {
    const f = eventToSessionFields(event({
      summary: `${'s'.repeat(100)} (Maya Lin)`,
      location: 'l'.repeat(300),
      description: 'n'.repeat(3000),
    }));
    expect(f.subject).toHaveLength(60);
    expect(f.location).toHaveLength(200);
    expect(f.notes).toHaveLength(2000);
  });

  test('drops a meeting URL longer than 500 characters', () => {
    const long = `https://zoom.test/${'x'.repeat(500)}`;
    expect(eventToSessionFields(event({ location: long })).meeting_url).toBeNull();
  });

  test('keeps only an https htmlLink', () => {
    expect(eventToSessionFields(event({ htmlLink: 'https://calendar.google.com/e/1' })).google_link)
      .toBe('https://calendar.google.com/e/1');
    expect(eventToSessionFields(event({ htmlLink: 'http://calendar.test/e/1' })).google_link).toBeNull();
    expect(eventToSessionFields(event()).google_link).toBeNull();
  });
});

describe('round trip', () => {
  const back = (s, over = {}) => eventToSessionFields({ ...sessionToEvent(s, OPTS), ...over });

  test('keeps subject, notes, location and times', () => {
    const s = session({ notes: 'Bring chapter 3', location: 'Library, room 2' });
    expect(back(s)).toMatchObject({
      subject: 'Algebra',
      notes: 'Bring chapter 3',
      location: 'Library, room 2',
      meeting_url: null,
      starts_at: '2026-10-05T16:00:00.000Z',
      ends_at: '2026-10-05T17:00:00.000Z',
      status: 'scheduled',
    });
  });

  test('a session with only a meeting link comes back as a meeting link', () => {
    expect(back(session({ notes: 'N', meeting_url: 'https://meet.test/abc' }))).toMatchObject({
      notes: 'N', location: null, meeting_url: 'https://meet.test/abc',
    });
  });

  test('a session with both a location and a meeting link keeps both', () => {
    const f = back(session({ notes: 'Bring chapter 3', location: 'Library, room 2', meeting_url: 'https://meet.test/abc' }));
    expect(f).toMatchObject({
      subject: 'Algebra', notes: 'Bring chapter 3', location: 'Library, room 2', meeting_url: 'https://meet.test/abc',
    });
  });

  test('both, with no notes, keeps both and no notes', () => {
    const f = back(session({ location: 'Library', meeting_url: 'https://meet.test/abc' }));
    expect(f).toMatchObject({ notes: null, location: 'Library', meeting_url: 'https://meet.test/abc' });
  });
});

describe('round trip through an HTML description', () => {
  test('keeps notes, location and meeting_url when Google saves line breaks as <br>', () => {
    const s = session({ notes: 'Bring chapter 3\nand a calculator', location: 'Library, room 2', meeting_url: 'https://meet.test/abc' });
    const e = sessionToEvent(s, OPTS);
    const f = eventToSessionFields({ ...e, description: e.description.replace(/\n/g, '<br>') });
    expect(f).toMatchObject({
      notes: 'Bring chapter 3\nand a calculator', location: 'Library, room 2', meeting_url: 'https://meet.test/abc',
    });
  });

  test('also when the URLs were turned into links', () => {
    const s = session({ notes: 'Note', location: 'Library', meeting_url: 'https://meet.test/abc' });
    const e = sessionToEvent(s, OPTS);
    const html = e.description.replace(/\n/g, '<br>').replace(/https:\/\/\S+?(?=<br>|$)/g, (u) => `<a href="${u}">${u}</a>`);
    expect(html).toContain('<a href="https://meet.test/abc">');
    const f = eventToSessionFields({ ...e, description: html });
    expect(f).toMatchObject({ notes: 'Note', location: 'Library', meeting_url: 'https://meet.test/abc' });
  });
});

describe('matchStudent', () => {
  const students = [
    { id: 'a', email: 'maya@school.test', google_email: 'maya.g@gmail.test' },
    { id: 'b', email: 'sam@school.test', google_email: null },
    { id: 'c', email: null, google_email: null },
  ];
  const invite = (...emails) => ({ attendees: emails.map((email) => ({ email })) });

  test('matches on the connected Google address', () => {
    expect(matchStudent(invite('maya.g@gmail.test'), students)).toBe(students[0]);
  });

  test('matches on the portal email', () => {
    expect(matchStudent(invite('sam@school.test'), students)).toBe(students[1]);
  });

  test('is case-insensitive on both sides', () => {
    expect(matchStudent(invite('MAYA.G@Gmail.Test'), students)).toBe(students[0]);
    expect(matchStudent(invite('sam@school.test'), [{ id: 'z', email: 'SAM@School.Test' }])).toEqual({ id: 'z', email: 'SAM@School.Test' });
  });

  test('two matching students give null', () => {
    expect(matchStudent(invite('maya@school.test', 'sam@school.test'), students)).toBeNull();
  });

  test('one student matching on both addresses is still one match', () => {
    expect(matchStudent(invite('maya@school.test', 'maya.g@gmail.test'), students)).toBe(students[0]);
  });

  test('no match gives null', () => {
    expect(matchStudent(invite('someone@else.test'), students)).toBeNull();
    expect(matchStudent({}, students)).toBeNull();
    expect(matchStudent(invite('a@b.test'), undefined)).toBeNull();
  });
});

describe('resolveConflict', () => {
  const event = { updated: '2026-10-05T12:00:00.000Z' };

  test('pending and newer than the event gives portal', () => {
    expect(resolveConflict({ sync_state: 'pending', updated_at: '2026-10-05T12:00:01.000Z' }, event)).toBe('portal');
  });

  test('pending and older than the event gives google', () => {
    expect(resolveConflict({ sync_state: 'pending', updated_at: '2026-10-05T11:59:59.000Z' }, event)).toBe('google');
  });

  test('synced gives google', () => {
    expect(resolveConflict({ sync_state: 'synced', updated_at: '2026-10-05T13:00:00.000Z' }, event)).toBe('google');
  });

  test('an error row (its push failed) is treated like a pending one', () => {
    expect(resolveConflict({ sync_state: 'error', updated_at: '2026-10-05T12:00:01.000Z' }, event)).toBe('portal');
    expect(resolveConflict({ sync_state: 'error', updated_at: '2026-10-05T11:59:59.000Z' }, event)).toBe('google');
  });

  test('a pending row against an event with no updated time gives portal', () => {
    expect(resolveConflict({ sync_state: 'pending', updated_at: '2026-10-05T13:00:00.000Z' }, {})).toBe('portal');
  });
});

describe('personalItem', () => {
  test('a normal timed event', () => {
    expect(personalItem({
      id: 'p1', summary: 'Dentist', start: { dateTime: '2026-10-05T09:00:00-07:00' }, end: { dateTime: '2026-10-05T10:00:00-07:00' },
    })).toEqual({
      id: 'p1', title: 'Dentist', start: '2026-10-05T09:00:00-07:00', end: '2026-10-05T10:00:00-07:00', all_day: false,
    });
  });

  test('private and confidential events only say Busy', () => {
    const base = { id: 'p2', summary: 'Therapy', start: { dateTime: 'a' }, end: { dateTime: 'b' } };
    expect(personalItem({ ...base, visibility: 'private' }).title).toBe('Busy');
    expect(personalItem({ ...base, visibility: 'confidential' }).title).toBe('Busy');
  });

  test('an untitled event says Busy', () => {
    expect(personalItem({ id: 'p3', start: { dateTime: 'a' }, end: { dateTime: 'b' } }).title).toBe('Busy');
  });

  test('an all-day event', () => {
    expect(personalItem({ id: 'p4', summary: 'Holiday', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } })).toEqual({
      id: 'p4', title: 'Holiday', start: '2026-10-05', end: '2026-10-06', all_day: true,
    });
  });

  test('a cancelled or timeless event gives null', () => {
    expect(personalItem({ id: 'p5', status: 'cancelled', start: { dateTime: 'a' }, end: { dateTime: 'b' } })).toBeNull();
    expect(personalItem({ id: 'p6', summary: 'x' })).toBeNull();
  });
});
