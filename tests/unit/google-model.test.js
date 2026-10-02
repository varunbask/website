import { describe, test, expect } from 'vitest';
import {
  syncStatusText, personalBlocks, allDayOn, readGoogleReturn, googleDayUrl, personalClashes,
  personalLabel, personalWhen, personalClashLine, mergePersonalClashes, weekRange, dayRange, inviteText,
  safeGoogleLink, ownGoogleLink, defaultReturnTo, syncNote, SYNC_NOTE, RECONNECT_NOTE, normalizeStatus, safeErrorText, OFF_STATUS,
} from '../../portal/js/google-model.js';
import { layoutDay, sessionsByDay } from '../../portal/js/sessions-model.js';
import { dayKey, zonedIso } from '../../portal/js/dates.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific
const NOW = new Date('2026-10-14T19:00:00Z');
const status = (over = {}) => ({
  connected: true, purpose: 'tutor', google_email: 'daniel@gmail.com', sync_enabled: true,
  last_synced_at: '2026-10-14T18:59:40Z', last_error: null, ...over,
});

describe('syncStatusText', () => {
  test('off when not connected or sync is off', () => {
    expect(syncStatusText({ connected: false }, NOW)).toBe('Off');
    expect(syncStatusText({ connected: false, unavailable: true }, NOW)).toBe('Off');
    expect(syncStatusText(status({ sync_enabled: false }), NOW)).toBe('Off');
    expect(syncStatusText(null, NOW)).toBe('Off');
    expect(syncStatusText(undefined, NOW)).toBe('Off');
  });

  test('off wins over an old error', () => {
    expect(syncStatusText(status({ sync_enabled: false, last_error: 'reconnect' }), NOW)).toBe('Off');
  });

  test('the two error codes', () => {
    expect(syncStatusText(status({ last_error: 'reconnect' }), NOW)).toBe('Reconnect needed');
    expect(syncStatusText(status({ last_error: 'google_error' }), NOW)).toBe('Sync paused, retrying');
  });

  test('an unknown error code is ignored', () => {
    expect(syncStatusText(status({ last_error: 'something_else' }), NOW)).toBe('Synced just now');
  });

  test('how long ago it synced', () => {
    const at = (iso) => syncStatusText(status({ last_synced_at: iso }), NOW);
    expect(at('2026-10-14T18:59:40Z')).toBe('Synced just now');
    expect(at('2026-10-14T19:00:00Z')).toBe('Synced just now');
    expect(at('2026-10-14T18:55:00Z')).toBe('Synced 5 minutes ago');
    expect(at('2026-10-14T18:59:00Z')).toBe('Synced 1 minute ago');
    expect(at('2026-10-14T17:00:00Z')).toBe('Synced 2 hours ago');
    expect(at('2026-10-13T19:00:00Z')).toBe('Synced yesterday');
    expect(at('2026-10-11T19:00:00Z')).toBe('Synced 3 days ago');
  });

  test('older than a week gives a date, not a lowercased one', () => {
    expect(syncStatusText(status({ last_synced_at: '2026-10-03T19:00:00Z' }), NOW)).toBe('Synced Oct 3');
    expect(syncStatusText(status({ last_synced_at: '2025-10-03T19:00:00Z' }), NOW)).toBe('Synced Oct 3, 2025');
  });

  test('a clock a little ahead of the server still reads as just now', () => {
    expect(syncStatusText(status({ last_synced_at: '2026-10-14T19:00:30Z' }), NOW)).toBe('Synced just now');
  });

  test('on but never synced', () => {
    expect(syncStatusText(status({ last_synced_at: null }), NOW)).toBe('Not synced yet');
  });
});

describe('weekRange', () => {
  test('a plain week runs from Sunday 00:00 to the next Sunday 00:00, Pacific', () => {
    expect(weekRange('2026-10-04')).toEqual({
      from: '2026-10-04T07:00:00.000Z',
      to: '2026-10-11T07:00:00.000Z',
    });
  });

  test('the fall-back week is 169 hours long', () => {
    const { from, to } = weekRange('2026-11-01');
    expect(from).toBe('2026-11-01T07:00:00.000Z');
    expect(to).toBe('2026-11-08T08:00:00.000Z');
    expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(169);
  });

  test('the spring-forward week is 167 hours long', () => {
    const { from, to } = weekRange('2026-03-08');
    expect(from).toBe('2026-03-08T08:00:00.000Z');
    expect(to).toBe('2026-03-15T07:00:00.000Z');
    expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(167);
  });
});

describe('dayRange', () => {
  test('is Pacific midnight to Pacific midnight', () => {
    expect(dayRange('2026-10-14')).toEqual({ from: '2026-10-14T07:00:00.000Z', to: '2026-10-15T07:00:00.000Z' });
  });

  test('a day with a clock change is 25 or 23 hours long', () => {
    const fall = dayRange('2026-11-01');
    expect((Date.parse(fall.to) - Date.parse(fall.from)) / 3_600_000).toBe(25);
    const spring = dayRange('2026-03-08');
    expect((Date.parse(spring.to) - Date.parse(spring.from)) / 3_600_000).toBe(23);
  });
});

describe('personalBlocks', () => {
  const timed = (id, start, end, title = 'Dentist') => ({ id, title, start, end, all_day: false });

  test('a timed event becomes a block layoutDay accepts', () => {
    const { timed: blocks, allDay } = personalBlocks([timed('abc', '2026-10-14T15:00:00-07:00', '2026-10-14T16:00:00-07:00')]);
    expect(allDay).toEqual([]);
    expect(blocks).toEqual([{
      id: 'g:abc', starts_at: '2026-10-14T15:00:00-07:00', ends_at: '2026-10-14T16:00:00-07:00', personal: true, title: 'Dentist',
    }]);
    const [layout] = layoutDay(blocks, { startHour: 7, endHour: 21 });
    expect(layout.session.personal).toBe(true);
    expect(layout.top).toBeCloseTo((15 - 7) / 14, 6);
    expect(layout.height).toBeCloseTo(1 / 14, 6);
    expect(layout.cols).toBe(1);
  });

  test('timed and all-day events are returned separately', () => {
    const { timed: blocks, allDay } = personalBlocks([
      timed('a', '2026-10-14T15:00:00-07:00', '2026-10-14T16:00:00-07:00'),
      { id: 'b', title: 'Trip', start: '2026-10-17', end: '2026-10-18', all_day: true },
    ]);
    expect(blocks.map((b) => b.id)).toEqual(['g:a']);
    expect(allDay).toEqual([{ id: 'g:b', title: 'Trip', personal: true, first: '2026-10-17', last: '2026-10-17' }]);
  });

  test('a multi-day all-day event ends the day before Google’s exclusive end date', () => {
    const { allDay } = personalBlocks([{ id: 'c', title: 'Conference', start: '2026-10-12', end: '2026-10-15', all_day: true }]);
    expect(allDay[0]).toMatchObject({ first: '2026-10-12', last: '2026-10-14' });
  });

  test('an all-day event whose end equals its start (no exclusive end) is one day', () => {
    const { allDay } = personalBlocks([{ id: 'd', title: 'Holiday', start: '2026-10-12', end: '2026-10-12', all_day: true }]);
    expect(allDay[0]).toMatchObject({ first: '2026-10-12', last: '2026-10-12' });
  });

  test('a date-only start counts as all-day even without the flag', () => {
    const { timed: blocks, allDay } = personalBlocks([{ id: 'e', title: 'Holiday', start: '2026-10-12', end: '2026-10-13' }]);
    expect(blocks).toEqual([]);
    expect(allDay).toHaveLength(1);
  });

  test('a blank title says Busy', () => {
    const { timed: blocks } = personalBlocks([timed('f', '2026-10-14T09:00:00-07:00', '2026-10-14T10:00:00-07:00', '  ')]);
    expect(blocks[0].title).toBe('Busy');
  });

  test('events that cannot be placed are dropped', () => {
    const { timed: blocks, allDay } = personalBlocks([
      null,
      { title: 'No id', start: '2026-10-14T09:00:00-07:00', end: '2026-10-14T10:00:00-07:00' },
      timed('bad', 'not a date', '2026-10-14T10:00:00-07:00'),
      timed('backwards', '2026-10-14T11:00:00-07:00', '2026-10-14T10:00:00-07:00'),
      { id: 'ad', title: 'x', start: 'garbage', end: 'garbage', all_day: true },
    ]);
    expect(blocks).toEqual([]);
    expect(allDay).toEqual([]);
  });

  test('no events, or none given', () => {
    expect(personalBlocks([])).toEqual({ timed: [], allDay: [] });
    expect(personalBlocks(undefined)).toEqual({ timed: [], allDay: [] });
  });

  test('timed blocks come back in time order', () => {
    const { timed: blocks } = personalBlocks([
      timed('late', '2026-10-14T18:00:00-07:00', '2026-10-14T19:00:00-07:00'),
      timed('early', '2026-10-14T08:00:00-07:00', '2026-10-14T09:00:00-07:00'),
    ]);
    expect(blocks.map((b) => b.id)).toEqual(['g:early', 'g:late']);
  });

  test('an overlapping session and personal block share the day in columns', () => {
    const { timed: blocks } = personalBlocks([timed('p', '2026-10-14T16:30:00-07:00', '2026-10-14T17:30:00-07:00')]);
    const session = { id: 5, starts_at: zonedIso('2026-10-14', '16:00'), ends_at: zonedIso('2026-10-14', '17:00') };
    const out = layoutDay([session, ...blocks], { startHour: 7, endHour: 21 });
    expect(out.map((l) => [l.col, l.cols])).toEqual([[0, 2], [1, 2]]);
  });

  describe('a fall-back week (Sun Nov 1, 2026: clocks go back at 2 am)', () => {
    // Sunday 1:30 am happens twice; Monday and later are on standard time (-08:00)
    const events = [
      timed('first', '2026-11-01T01:30:00-07:00', '2026-11-01T02:30:00-07:00', 'Night shift'),
      timed('mon', '2026-11-02T09:00:00-08:00', '2026-11-02T10:30:00-08:00', 'Standup'),
      timed('sat', '2026-11-07T23:00:00-08:00', '2026-11-07T23:59:00-08:00', 'Late'),
    ];

    test('every block lands on its Pacific day and wall time', () => {
      const { timed: blocks } = personalBlocks(events);
      const byDay = sessionsByDay(blocks);
      expect([...byDay.keys()]).toEqual(['2026-11-01', '2026-11-02', '2026-11-07']);
      const mon = layoutDay(byDay.get('2026-11-02'), { startHour: 7, endHour: 21 });
      expect(mon[0].top).toBeCloseTo(2 / 14, 6);
      expect(mon[0].height).toBeCloseTo(1.5 / 14, 6);
    });

    test('the repeated 1:30 am reads as 1:30 am on Sunday', () => {
      const { timed: blocks } = personalBlocks(events);
      const [sun] = layoutDay(sessionsByDay(blocks).get('2026-11-01'), { startHour: 0, endHour: 24 });
      expect(sun.top).toBeCloseTo(1.5 / 24, 6);
    });

    test('the week range holds all of them', () => {
      const { from, to } = weekRange('2026-11-01');
      for (const e of events) {
        expect(Date.parse(e.start)).toBeGreaterThanOrEqual(Date.parse(from));
        expect(Date.parse(e.end)).toBeLessThanOrEqual(Date.parse(to));
      }
    });
  });

  describe('a spring-forward week (Sun Mar 8, 2026: clocks go forward at 2 am)', () => {
    const events = [
      timed('sat', '2026-03-07T15:00:00-08:00', '2026-03-07T16:00:00-08:00', 'Before'),
      timed('sun', '2026-03-08T15:00:00-07:00', '2026-03-08T16:00:00-07:00', 'After'),
      timed('fri', '2026-03-13T07:00:00-07:00', '2026-03-13T08:00:00-07:00', 'Early'),
    ];

    test('3 pm is 3 pm on both sides of the change', () => {
      const { timed: blocks } = personalBlocks(events);
      const byDay = sessionsByDay(blocks);
      const sat = layoutDay(byDay.get('2026-03-07'), { startHour: 7, endHour: 21 });
      const sun = layoutDay(byDay.get('2026-03-08'), { startHour: 7, endHour: 21 });
      expect(sat[0].top).toBeCloseTo(8 / 14, 6);
      expect(sun[0].top).toBeCloseTo(8 / 14, 6);
      expect(dayKey(blocks[2].starts_at)).toBe('2026-03-13');
    });
  });
});

describe('allDayOn', () => {
  const { allDay } = personalBlocks([
    { id: 'a', title: 'Conference', start: '2026-10-12', end: '2026-10-15', all_day: true },
    { id: 'b', title: 'Trip', start: '2026-10-17', end: '2026-10-18', all_day: true },
  ]);

  test('lists the events that cover a day', () => {
    expect(allDayOn(allDay, '2026-10-11')).toEqual([]);
    expect(allDayOn(allDay, '2026-10-12').map((e) => e.id)).toEqual(['g:a']);
    expect(allDayOn(allDay, '2026-10-14').map((e) => e.id)).toEqual(['g:a']);
    expect(allDayOn(allDay, '2026-10-15')).toEqual([]);
    expect(allDayOn(allDay, '2026-10-17').map((e) => e.id)).toEqual(['g:b']);
  });
});

describe('readGoogleReturn', () => {
  test('connected, with the only param', () => {
    expect(readGoogleReturn('#/calendar?google=connected')).toEqual({ result: 'connected', reason: null, cleanHash: '#/calendar' });
  });

  test('connected, among other params, which stay as they were', () => {
    expect(readGoogleReturn('#/calendar?view=week&google=connected&w=2026-10-04')).toEqual({
      result: 'connected', reason: null, cleanHash: '#/calendar?view=week&w=2026-10-04',
    });
  });

  test('an error with a reason drops both params', () => {
    expect(readGoogleReturn('#/calendar?view=week&google=error&reason=no_refresh')).toEqual({
      result: 'error', reason: 'no_refresh', cleanHash: '#/calendar?view=week',
    });
    expect(readGoogleReturn('#/overview?google=error&reason=denied')).toEqual({
      result: 'error', reason: 'denied', cleanHash: '#/overview',
    });
  });

  test('an error with no reason', () => {
    expect(readGoogleReturn('#/calendar?google=error')).toEqual({ result: 'error', reason: null, cleanHash: '#/calendar' });
  });

  test('no google param leaves the hash alone', () => {
    expect(readGoogleReturn('#/calendar?view=week')).toEqual({ result: null, reason: null, cleanHash: '#/calendar?view=week' });
    expect(readGoogleReturn('#/calendar')).toEqual({ result: null, reason: null, cleanHash: '#/calendar' });
  });

  test('empty or missing hash', () => {
    expect(readGoogleReturn('')).toEqual({ result: null, reason: null, cleanHash: '' });
    expect(readGoogleReturn(undefined)).toEqual({ result: null, reason: null, cleanHash: '' });
    expect(readGoogleReturn('#')).toEqual({ result: null, reason: null, cleanHash: '#' });
  });

  test('a hash with a drawer param keeps it', () => {
    expect(readGoogleReturn('#/calendar?google=connected&open=s12').cleanHash).toBe('#/calendar?open=s12');
  });

  test('an unknown google value gives no result but is still dropped', () => {
    expect(readGoogleReturn('#/calendar?google=maybe&view=list')).toEqual({ result: null, reason: null, cleanHash: '#/calendar?view=list' });
  });

  test('a reason on its own (no google param) is another page’s param and stays', () => {
    expect(readGoogleReturn('#/calendar?reason=x').cleanHash).toBe('#/calendar?reason=x');
  });

  test('other params are not re-encoded', () => {
    expect(readGoogleReturn('#/calendar?d=2026-10-14&q=a%20b&google=connected').cleanHash).toBe('#/calendar?d=2026-10-14&q=a%20b');
  });

  test('a path with sub-segments', () => {
    expect(readGoogleReturn('#/assignments/todo?google=connected').cleanHash).toBe('#/assignments/todo');
  });
});

describe('googleDayUrl', () => {
  test('has no zero padding', () => {
    expect(googleDayUrl('2026-10-06')).toBe('https://calendar.google.com/calendar/r/day/2026/10/6');
    expect(googleDayUrl('2026-01-09')).toBe('https://calendar.google.com/calendar/r/day/2026/1/9');
    expect(googleDayUrl('2026-12-31')).toBe('https://calendar.google.com/calendar/r/day/2026/12/31');
  });
});

describe('personalClashes', () => {
  const ev = (id, start, end, over = {}) => ({ id, title: id, start, end, all_day: false, ...over });
  const candidate = { starts_at: '2026-10-14T22:00:00Z', ends_at: '2026-10-14T23:00:00Z' }; // 3 to 4 pm PDT

  test('returns the timed events that overlap', () => {
    const events = [
      ev('inside', '2026-10-14T15:15:00-07:00', '2026-10-14T15:45:00-07:00'),
      ev('straddle-start', '2026-10-14T14:30:00-07:00', '2026-10-14T15:30:00-07:00'),
      ev('straddle-end', '2026-10-14T15:30:00-07:00', '2026-10-14T16:30:00-07:00'),
      ev('around', '2026-10-14T14:00:00-07:00', '2026-10-14T17:00:00-07:00'),
      ev('before', '2026-10-14T13:00:00-07:00', '2026-10-14T14:00:00-07:00'),
      ev('after', '2026-10-14T17:00:00-07:00', '2026-10-14T18:00:00-07:00'),
    ];
    expect(personalClashes(candidate, events).map((e) => e.id)).toEqual(['inside', 'straddle-start', 'straddle-end', 'around']);
  });

  test('touching edges do not overlap', () => {
    const events = [
      ev('ends-at-start', '2026-10-14T14:00:00-07:00', '2026-10-14T15:00:00-07:00'),
      ev('starts-at-end', '2026-10-14T16:00:00-07:00', '2026-10-14T17:00:00-07:00'),
    ];
    expect(personalClashes(candidate, events)).toEqual([]);
  });

  test('all-day events are ignored', () => {
    expect(personalClashes(candidate, [ev('trip', '2026-10-14', '2026-10-15', { all_day: true })])).toEqual([]);
    expect(personalClashes(candidate, [ev('trip', '2026-10-14', '2026-10-15')])).toEqual([]);
  });

  test('a zero-length event inside the time clashes', () => {
    expect(personalClashes(candidate, [ev('ping', '2026-10-14T15:30:00-07:00', '2026-10-14T15:30:00-07:00')])).toHaveLength(1);
  });

  test('returns the events as given, so the title can be shown', () => {
    const e = ev('x', '2026-10-14T15:30:00-07:00', '2026-10-14T16:30:00-07:00', { title: 'Dentist' });
    expect(personalClashes(candidate, [e])).toEqual([e]);
  });

  test('empty, missing or unparsable input', () => {
    expect(personalClashes(candidate, [])).toEqual([]);
    expect(personalClashes(candidate, undefined)).toEqual([]);
    expect(personalClashes(candidate, [ev('bad', 'nope', 'nope')])).toEqual([]);
    expect(personalClashes({ starts_at: 'x', ends_at: 'y' }, [ev('a', '2026-10-14T15:30:00-07:00', '2026-10-14T16:30:00-07:00')])).toEqual([]);
  });

  test('works on the blocks personalBlocks makes, too', () => {
    const { timed } = personalBlocks([ev('a', '2026-10-14T15:30:00-07:00', '2026-10-14T16:30:00-07:00')]);
    expect(personalClashes(candidate, timed)).toHaveLength(1);
  });

  test('a candidate across the fall-back hour', () => {
    // 1 am to 3 am on Nov 1 spans three real hours
    const night = { starts_at: zonedIso('2026-11-01', '00:30'), ends_at: zonedIso('2026-11-01', '03:00') };
    const second = ev('second', '2026-11-01T01:30:00-08:00', '2026-11-01T02:00:00-08:00');
    expect(personalClashes(night, [second])).toHaveLength(1);
  });
});

describe('personalLabel', () => {
  test('is the spoken name of a block', () => {
    const block = { starts_at: '2026-10-14T15:00:00-07:00', ends_at: '2026-10-14T16:00:00-07:00', title: 'Dentist', personal: true };
    expect(personalLabel(block, { viewerInZone: true })).toBe('Personal: Dentist, 3:00 to 4:00 pm');
  });

  test('says PT outside the business zone', () => {
    const block = { starts_at: '2026-10-14T09:30:00-07:00', ends_at: '2026-10-14T10:30:00-07:00', title: 'Gym' };
    expect(personalLabel(block, { viewerInZone: false })).toBe('Personal: Gym, 9:30 to 10:30 am PT');
  });

  test('an all-day event', () => {
    expect(personalLabel({ title: 'Trip', first: '2026-10-17', last: '2026-10-17' })).toBe('Personal: Trip, all day');
    expect(personalLabel({ title: 'Conference', first: '2026-10-12', last: '2026-10-14' })).toBe('Personal: Conference, all day, Oct 12 to 14');
    expect(personalLabel({ title: 'Leave', first: '2026-10-30', last: '2026-11-02' })).toBe('Personal: Leave, all day, Oct 30 to Nov 2');
  });
});

describe('personalWhen', () => {
  test('a timed event', () => {
    const block = { starts_at: '2026-10-14T15:00:00-07:00', ends_at: '2026-10-14T16:00:00-07:00', title: 'Dentist' };
    expect(personalWhen(block, { viewerInZone: true })).toBe('Wed, Oct 14, 3:00 to 4:00 pm');
    expect(personalWhen(block, { viewerInZone: false })).toBe('Wed, Oct 14, 3:00 to 4:00 pm PT');
  });

  test('a timed event across the noon half', () => {
    const block = { starts_at: '2026-10-14T11:30:00-07:00', ends_at: '2026-10-14T12:30:00-07:00' };
    expect(personalWhen(block, { viewerInZone: true })).toBe('Wed, Oct 14, 11:30 am to 12:30 pm');
  });

  test('a late evening event stays on its Pacific day', () => {
    const block = { starts_at: '2026-10-14T22:00:00-07:00', ends_at: '2026-10-14T23:30:00-07:00' };
    expect(personalWhen(block, { viewerInZone: true })).toBe('Wed, Oct 14, 10:00 to 11:30 pm');
  });

  test('all-day events, one day or several', () => {
    expect(personalWhen({ first: '2026-10-17', last: '2026-10-17' })).toBe('Sat, Oct 17, all day');
    expect(personalWhen({ first: '2026-10-12', last: '2026-10-14' })).toBe('Mon, Oct 12 to Wed, Oct 14, all day');
  });

  test('a day in another year gets the year', () => {
    expect(personalWhen({ first: '2027-01-02', last: '2027-01-02' }, { today: '2026-12-30' })).toBe('Sat, Jan 2, 2027, all day');
    expect(personalWhen({ first: '2026-10-17', last: '2026-10-17' }, { today: '2026-10-14' })).toBe('Sat, Oct 17, all day');
  });
});

describe('personalClashLine', () => {
  test('names the event', () => {
    expect(personalClashLine({ title: 'Dentist' })).toBe('You have “Dentist” in your Google Calendar then.');
  });

  test('a blank title says Busy', () => {
    expect(personalClashLine({ title: '' })).toBe('You have “Busy” in your Google Calendar then.');
    expect(personalClashLine({})).toBe('You have “Busy” in your Google Calendar then.');
  });
});

describe('mergePersonalClashes', () => {
  const clash = (title) => ({ id: title, title, start: 'a', end: 'b' });

  test('returns the report untouched when nothing clashes', () => {
    const report = { title: 'This time overlaps another session', lines: ['x'] };
    expect(mergePersonalClashes(report, [])).toBe(report);
    expect(mergePersonalClashes(null, [])).toBeNull();
    expect(mergePersonalClashes({ title: null, lines: [] }, [])).toEqual({ title: null, lines: [] });
  });

  test('adds a line per overlap after the session lines', () => {
    const report = { total: 1, count: 1, title: 'This time overlaps another session', lines: ['Maya has Algebra with Daniel then.'] };
    const out = mergePersonalClashes(report, [clash('Dentist'), clash('Gym')]);
    expect(out.title).toBe('This time overlaps another session');
    expect(out.lines).toEqual([
      'Maya has Algebra with Daniel then.',
      'You have “Dentist” in your Google Calendar then.',
      'You have “Gym” in your Google Calendar then.',
    ]);
    expect(report.lines).toHaveLength(1);
  });

  test('on its own it gets a title of its own', () => {
    for (const none of [null, { total: 1, count: 0, title: null, lines: [] }]) {
      const out = mergePersonalClashes(none, [clash('Dentist')]);
      expect(out.title).toBe('This time overlaps your Google Calendar');
      expect(out.lines).toEqual(['You have “Dentist” in your Google Calendar then.']);
    }
  });

  test('a long list is cut short', () => {
    const out = mergePersonalClashes(null, ['a', 'b', 'c', 'd', 'e'].map(clash));
    expect(out.lines).toHaveLength(4);
    expect(out.lines[3]).toBe('And 2 more.');
  });
});

describe('inviteText', () => {
  test('names the address', () => {
    expect(inviteText('maya@gmail.com')).toBe('Invites go to maya@gmail.com');
  });

  test('without an address', () => {
    expect(inviteText('')).toBe('Google Calendar invites are on');
    expect(inviteText(null)).toBe('Google Calendar invites are on');
  });
});

describe('safeGoogleLink', () => {
  test('keeps a Google Calendar link', () => {
    expect(safeGoogleLink('https://www.google.com/calendar/event?eid=abc123')).toBe('https://www.google.com/calendar/event?eid=abc123');
    expect(safeGoogleLink('https://calendar.google.com/calendar/r')).toBe('https://calendar.google.com/calendar/r');
  });

  test('drops everything else', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://www.google.com/calendar/event?eid=abc',
      'https://evil.example/calendar/event',
      'https://www.google.com/search?q=x',
      'https://calendar.google.com.evil.example/x',
      'https://user:pw@calendar.google.com/x',
      '/calendar/event',
      '',
      null,
      undefined,
    ]) expect(safeGoogleLink(bad), String(bad)).toBeNull();
  });
});

describe('syncNote', () => {
  const me = { id: 't1', role: 'tutor' };
  const on = { connected: true, sync_enabled: true };

  test('says so for the tutor\u2019s own pending or failed session', () => {
    expect(syncNote({ tutor_id: 't1', sync_state: 'pending' }, me, on)).toBe(SYNC_NOTE);
    expect(syncNote({ tutor_id: 't1', sync_state: 'error' }, me, on)).toBe(SYNC_NOTE);
    expect(SYNC_NOTE).toBe('Not synced to Google yet. It will sync shortly.');
  });

  test('asks to reconnect when the sync needs it', () => {
    const reconnect = { connected: true, sync_enabled: true, last_error: 'reconnect' };
    expect(RECONNECT_NOTE).toBe('Reconnect Google Calendar to sync this session.');
    expect(syncNote({ tutor_id: 't1', sync_state: 'pending' }, me, reconnect)).toBe(RECONNECT_NOTE);
    expect(syncNote({ tutor_id: 't1', sync_state: 'error' }, me, reconnect)).toBe(RECONNECT_NOTE);
  });

  test('a paused sync (google_error) still says it will sync shortly', () => {
    expect(syncNote({ tutor_id: 't1', sync_state: 'error' }, me, { ...on, last_error: 'google_error' })).toBe(SYNC_NOTE);
  });

  test('a synced session needs no note even when reconnect is needed', () => {
    expect(syncNote({ tutor_id: 't1', sync_state: 'synced' }, me, { ...on, last_error: 'reconnect' })).toBeNull();
  });

  test('says nothing for a synced session, or one with no state', () => {
    expect(syncNote({ tutor_id: 't1', sync_state: 'synced' }, me, on)).toBeNull();
    expect(syncNote({ tutor_id: 't1', sync_state: null }, me, on)).toBeNull();
    expect(syncNote({ tutor_id: 't1' }, me, on)).toBeNull();
  });

  test('says nothing when sync is off or not connected', () => {
    const session = { tutor_id: 't1', sync_state: 'pending' };
    expect(syncNote(session, me, { connected: true, sync_enabled: false })).toBeNull();
    expect(syncNote(session, me, { connected: false })).toBeNull();
    expect(syncNote(session, me, null)).toBeNull();
  });

  test('says nothing to anyone but the session\u2019s own tutor', () => {
    const session = { tutor_id: 't1', sync_state: 'pending' };
    expect(syncNote(session, { id: 't2', role: 'tutor' }, on)).toBeNull();
    expect(syncNote(session, { id: 'a1', role: 'admin' }, on)).toBeNull();
    expect(syncNote(session, { id: 't1', role: 'student' }, on)).toBeNull();
    expect(syncNote(session, null, on)).toBeNull();
    expect(syncNote(null, me, on)).toBeNull();
  });

  test('ids compare as text', () => {
    expect(syncNote({ tutor_id: 7, sync_state: 'pending' }, { id: '7', role: 'tutor' }, on)).toBe(SYNC_NOTE);
  });
});

describe('normalizeStatus', () => {
  const row = {
    connected: true, purpose: 'tutor', google_email: 'daniel@gmail.com', sync_enabled: true,
    last_synced_at: '2026-10-14T18:59:40Z', last_error: null,
  };

  test('no row means not connected', () => {
    expect(normalizeStatus([])).toEqual(OFF_STATUS);
    expect(normalizeStatus(null)).toEqual(OFF_STATUS);
    expect(normalizeStatus(undefined)).toEqual(OFF_STATUS);
    expect(normalizeStatus('nope')).toEqual(OFF_STATUS);
    expect(OFF_STATUS.connected).toBe(false);
  });

  test('takes the one row of an RPC answer, or a bare row', () => {
    expect(normalizeStatus([row])).toEqual(row);
    expect(normalizeStatus(row)).toEqual(row);
  });

  test('an endpoint answer of { connected: false } is not connected', () => {
    expect(normalizeStatus({ connected: false })).toEqual(OFF_STATUS);
  });

  test('missing fields become null or false', () => {
    expect(normalizeStatus([{ purpose: 'student', google_email: 'maya@gmail.com' }])).toEqual({
      connected: true, purpose: 'student', google_email: 'maya@gmail.com', sync_enabled: false, last_synced_at: null, last_error: null,
    });
    expect(normalizeStatus([{ sync_enabled: null }]).sync_enabled).toBe(false);
  });

  test('keeps the error code', () => {
    expect(normalizeStatus([{ ...row, last_error: 'reconnect' }]).last_error).toBe('reconnect');
  });

  test('gives a fresh object each time', () => {
    expect(normalizeStatus([])).not.toBe(OFF_STATUS);
  });
});

describe('safeErrorText', () => {
  test('keeps a short plain sentence', () => {
    expect(safeErrorText('Connect Google Calendar first.')).toBe('Connect Google Calendar first.');
    expect(safeErrorText('  Google Calendar did not answer. Try again.  ')).toBe('Google Calendar did not answer. Try again.');
  });

  test('drops everything else', () => {
    expect(safeErrorText('')).toBeNull();
    expect(safeErrorText('   ')).toBeNull();
    expect(safeErrorText(null)).toBeNull();
    expect(safeErrorText(undefined)).toBeNull();
    expect(safeErrorText({ message: 'x' })).toBeNull();
    expect(safeErrorText('a'.repeat(201))).toBeNull();
    expect(safeErrorText('line one\nline two')).toBeNull();
    expect(safeErrorText('<b>hi</b>')).toBeNull();
  });

  test('the longest allowed sentence', () => {
    expect(safeErrorText('a'.repeat(200))).toHaveLength(200);
  });
});

describe('ownGoogleLink', () => {
  const link = 'https://www.google.com/calendar/event?eid=abc123';

  test('the session\u2019s own tutor gets the link', () => {
    expect(ownGoogleLink({ tutor_id: 't1', google_link: link }, { id: 't1', role: 'tutor' })).toBe(link);
  });

  test('ids compare as text, and an admin who is the tutor counts', () => {
    expect(ownGoogleLink({ tutor_id: 7, google_link: link }, { id: '7', role: 'tutor' })).toBe(link);
    expect(ownGoogleLink({ tutor_id: 'a1', google_link: link }, { id: 'a1', role: 'admin' })).toBe(link);
  });

  test('another tutor, an admin who is not the tutor, and everyone else get nothing', () => {
    const session = { tutor_id: 't1', google_link: link };
    expect(ownGoogleLink(session, { id: 't2', role: 'tutor' })).toBeNull();
    expect(ownGoogleLink(session, { id: 'a1', role: 'admin' })).toBeNull();
    expect(ownGoogleLink(session, { id: 's1', role: 'student' })).toBeNull();
    expect(ownGoogleLink(session, null)).toBeNull();
    expect(ownGoogleLink(null, { id: 't1', role: 'tutor' })).toBeNull();
  });

  test('no link, or a link that is not Google Calendar, gives nothing', () => {
    const me = { id: 't1', role: 'tutor' };
    expect(ownGoogleLink({ tutor_id: 't1', google_link: null }, me)).toBeNull();
    expect(ownGoogleLink({ tutor_id: 't1' }, me)).toBeNull();
    expect(ownGoogleLink({ tutor_id: 't1', google_link: 'https://evil.example/x' }, me)).toBeNull();
    expect(ownGoogleLink({ tutor_id: 't1', google_link: 'javascript:alert(1)' }, me)).toBeNull();
  });
});

describe('defaultReturnTo', () => {
  test('keeps the path, the search and the hash', () => {
    expect(defaultReturnTo({
      pathname: '/portal/staff.html', search: '?student=u-maya', hash: '#/calendar?view=week',
    })).toBe('/portal/staff.html?student=u-maya#/calendar?view=week');
  });

  test('with no search or no hash', () => {
    expect(defaultReturnTo({ pathname: '/portal/student.html', search: '', hash: '#/overview' })).toBe('/portal/student.html#/overview');
    expect(defaultReturnTo({ pathname: '/portal/student.html', search: '', hash: '' })).toBe('/portal/student.html');
    expect(defaultReturnTo({ pathname: '/portal/parent.html', search: '?child=c1', hash: '' })).toBe('/portal/parent.html?child=c1');
  });

  test('is what the server accepts: under /portal/ and without a double slash', () => {
    const out = defaultReturnTo({ pathname: '/portal/staff.html', search: '?student=u-maya', hash: '#/calendar?scope=all' });
    expect(out.startsWith('/portal/')).toBe(true);
    expect(out).not.toContain('//');
  });

  test('reads the page it runs on when given nothing', () => {
    const saved = globalThis.location;
    globalThis.location = { pathname: '/portal/staff.html', search: '?student=u-leo', hash: '#/today' };
    try {
      expect(defaultReturnTo()).toBe('/portal/staff.html?student=u-leo#/today');
    } finally {
      if (saved === undefined) delete globalThis.location;
      else globalThis.location = saved;
    }
  });
});
