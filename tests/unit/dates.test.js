import { describe, test, expect } from 'vitest';
import {
  BUSINESS_TZ, WEEK_START, dayKey, todayKey, parseKey, addDays, weekday, daysBetween,
  zonedIso, businessTime, viewerIsInBusinessZone, dueLabel, relativeTime, dayHeading,
  longDate, monthTitle,
} from '../../portal/js/dates.js';

// Wednesday, October 14, 2026 at 12:00 pm Pacific (PDT, UTC-7)
const NOW = new Date('2026-10-14T19:00:00Z');
const HOUR = 3_600_000;
const IN_ZONE = { viewerInZone: true };
const OUT_OF_ZONE = { viewerInZone: false };

describe('constants', () => {
  test('business zone and week start', () => {
    expect(BUSINESS_TZ).toBe('America/Los_Angeles');
    expect(WEEK_START).toBe(0);
  });
});

describe('dayKey', () => {
  test('keys an instant by its Pacific calendar day', () => {
    expect(dayKey('2026-10-15T06:59:00Z')).toBe('2026-10-14');
    expect(dayKey('2026-10-15T07:00:00Z')).toBe('2026-10-15');
    expect(dayKey('2026-12-01T07:59:00Z')).toBe('2026-11-30');
    expect(dayKey('2026-12-01T08:00:00Z')).toBe('2026-12-01');
  });

  test('accepts a Date, passes a key through, and returns null for nothing', () => {
    expect(dayKey(NOW)).toBe('2026-10-14');
    expect(dayKey('2026-03-08')).toBe('2026-03-08');
    expect(dayKey(null)).toBeNull();
    expect(dayKey('')).toBeNull();
  });

  test('todayKey is the business day of now', () => {
    expect(todayKey(NOW)).toBe('2026-10-14');
    expect(todayKey(new Date('2026-10-15T06:30:00Z'))).toBe('2026-10-14');
  });
});

describe('calendar math on keys', () => {
  test('parseKey', () => {
    expect(parseKey('2026-10-04')).toEqual({ y: 2026, m: 10, d: 4 });
  });

  test('addDays crosses months, years, leap days and DST changes', () => {
    expect(addDays('2026-10-14', 1)).toBe('2026-10-15');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-14', 0)).toBe('2026-10-14');
    expect(addDays('2026-10-14', 42)).toBe('2026-11-25');
  });

  test('weekday is 0 for Sunday', () => {
    expect(weekday('2026-10-14')).toBe(3);
    expect(weekday('2026-02-01')).toBe(0);
    expect(weekday('2026-11-01')).toBe(0);
    expect(weekday('2026-10-17')).toBe(6);
  });

  test('daysBetween counts calendar days from a to b', () => {
    expect(daysBetween('2026-10-14', '2026-10-17')).toBe(3);
    expect(daysBetween('2026-10-17', '2026-10-14')).toBe(-3);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-10-14', '2026-10-14')).toBe(0);
  });
});

describe('zonedIso', () => {
  test('11:59 pm Pacific across both DST changes', () => {
    expect(zonedIso('2026-03-08', '23:59')).toBe('2026-03-09T06:59:00.000Z');
    expect(zonedIso('2026-10-14', '23:59')).toBe('2026-10-15T06:59:00.000Z');
    expect(zonedIso('2026-11-01', '23:59')).toBe('2026-11-02T07:59:00.000Z');
    expect(zonedIso('2026-12-25')).toBe('2026-12-26T07:59:00.000Z');
  });

  test('other wall times, including both sides of the spring change', () => {
    expect(zonedIso('2026-10-14', '15:00')).toBe('2026-10-14T22:00:00.000Z');
    expect(zonedIso('2026-10-14', '00:00')).toBe('2026-10-14T07:00:00.000Z');
    expect(zonedIso('2026-03-08', '00:30')).toBe('2026-03-08T08:30:00.000Z');
    expect(zonedIso('2026-03-08', '03:00')).toBe('2026-03-08T10:00:00.000Z');
    expect(zonedIso('2026-11-01', '03:00')).toBe('2026-11-01T11:00:00.000Z');
  });

  test('round-trips through dayKey and businessTime', () => {
    for (const key of ['2026-01-01', '2026-03-08', '2026-06-30', '2026-11-01', '2026-12-31']) {
      const iso = zonedIso(key, '23:59');
      expect(dayKey(iso)).toBe(key);
      expect(businessTime(iso)).toEqual({ key, hour: 23, minute: 59 });
    }
  });

  test('nothing in, nothing out', () => {
    expect(zonedIso('')).toBeNull();
    expect(zonedIso(null)).toBeNull();
  });
});

describe('businessTime', () => {
  test('reads the Pacific wall clock with a 0 to 23 hour', () => {
    expect(businessTime('2026-10-14T19:00:00Z')).toEqual({ key: '2026-10-14', hour: 12, minute: 0 });
    expect(businessTime('2026-10-14T07:00:00Z')).toEqual({ key: '2026-10-14', hour: 0, minute: 0 });
    expect(businessTime('2026-12-01T07:59:00Z')).toEqual({ key: '2026-11-30', hour: 23, minute: 59 });
  });
});

describe('viewerIsInBusinessZone', () => {
  test('matches the offset of the machine running the test', () => {
    const summer = new Date('2026-07-01T19:00:00Z');
    const winter = new Date('2026-12-01T19:00:00Z');
    expect(viewerIsInBusinessZone(summer)).toBe(summer.getTimezoneOffset() === 420);
    expect(viewerIsInBusinessZone(winter)).toBe(winter.getTimezoneOffset() === 480);
  });
});

describe('dueLabel', () => {
  const due = (iso, opts = IN_ZONE) => dueLabel(iso, NOW, opts);

  test('upcoming day words', () => {
    expect(due('2026-10-15T06:59:00Z').text).toBe('Due today');
    expect(due('2026-10-16T06:59:00Z').text).toBe('Due tomorrow');
    expect(due('2026-10-17T06:59:00Z').text).toBe('Due Friday');
    expect(due('2026-10-21T06:59:00Z').text).toBe('Due Tuesday');
    expect(due('2026-10-22T06:59:00Z').text).toBe('Due Oct 21');
    expect(due('2027-01-06T07:59:00Z').text).toBe('Due Jan 5, 2027');
  });

  test('overdue words', () => {
    expect(due('2026-10-14T16:00:00Z').text).toBe('Due earlier today at 9:00 am');
    expect(due('2026-10-14T06:59:00Z').text).toBe('Due yesterday');
    expect(due('2026-10-11T06:59:00Z').text).toBe('4 days overdue');
    expect(due('2026-10-11T06:59:00Z', OUT_OF_ZONE).text).toBe('4 days overdue');
  });

  test('a time only when it is not 11:59 pm, always with PT outside the zone', () => {
    expect(due('2026-10-14T22:00:00Z').text).toBe('Due today at 3:00 pm');
    expect(due('2026-10-15T19:00:00Z').text).toBe('Due tomorrow at 12:00 pm');
    expect(due('2026-10-16T07:00:00Z').text).toBe('Due Friday at 12:00 am');
    expect(due('2026-10-16T06:59:00Z', OUT_OF_ZONE).text).toBe('Due tomorrow at 11:59 pm PT');
    expect(due('2026-10-14T22:00:00Z', OUT_OF_ZONE).text).toBe('Due today at 3:00 pm PT');
  });

  test('full label for titles and screen readers', () => {
    expect(due('2026-10-15T06:59:00Z').full).toBe('Due Wednesday, October 14 at 11:59 pm Pacific time');
    expect(due('2026-10-14T22:00:00Z', OUT_OF_ZONE).full).toBe('Due Wednesday, October 14 at 3:00 pm Pacific time');
    expect(due('2027-01-06T07:59:00Z').full).toBe('Due Tuesday, January 5, 2027 at 11:59 pm Pacific time');
  });

  test('tone: danger when overdue, warning within 48 hours', () => {
    expect(due('2026-10-14T18:59:00Z').tone).toBe('danger');
    expect(due('2026-10-15T06:59:00Z').tone).toBe('warning');
    expect(due(new Date(NOW.getTime() + 48 * HOUR).toISOString()).tone).toBe('warning');
    expect(due(new Date(NOW.getTime() + 48 * HOUR + 60_000).toISOString()).tone).toBeNull();
    expect(due('2026-10-21T06:59:00Z').tone).toBeNull();
  });

  test('no due date', () => {
    expect(dueLabel(null, NOW)).toEqual({ text: 'No due date', full: 'No due date', tone: null });
  });

  test('defaults to the real viewer zone', () => {
    const iso = '2026-10-16T06:59:00Z';
    const inZone = viewerIsInBusinessZone(new Date(iso));
    expect(dueLabel(iso, NOW).text).toBe(inZone ? 'Due tomorrow' : 'Due tomorrow at 11:59 pm PT');
  });
});

describe('relativeTime', () => {
  const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
  const rel = (iso, opts = IN_ZONE) => relativeTime(iso, NOW, opts);

  test('minutes and hours', () => {
    expect(rel(ago(30_000)).text).toBe('Just now');
    expect(rel(new Date(NOW.getTime() + 60_000).toISOString()).text).toBe('Just now');
    expect(rel(ago(60_000)).text).toBe('1 minute ago');
    expect(rel(ago(5 * 60_000)).text).toBe('5 minutes ago');
    expect(rel(ago(59 * 60_000)).text).toBe('59 minutes ago');
    expect(rel(ago(HOUR)).text).toBe('1 hour ago');
    expect(rel(ago(2 * HOUR)).text).toBe('2 hours ago');
    expect(rel(ago(23 * HOUR)).text).toBe('23 hours ago');
  });

  test('days, then a date', () => {
    expect(rel(ago(25 * HOUR)).text).toBe('Yesterday');
    expect(rel('2026-10-11T19:00:00Z').text).toBe('3 days ago');
    expect(rel('2026-10-08T19:00:00Z').text).toBe('6 days ago');
    expect(rel('2026-10-07T19:00:00Z').text).toBe('Oct 7');
    expect(rel('2025-12-20T20:00:00Z').text).toBe('Dec 20, 2025');
  });

  test('full date and time', () => {
    expect(rel('2026-10-05T23:12:00Z').full).toBe('October 5, 2026 at 4:12 pm');
    expect(rel('2026-10-05T23:12:00Z', OUT_OF_ZONE).full).toBe('October 5, 2026 at 4:12 pm PT');
  });
});

describe('headings', () => {
  test('dayHeading', () => {
    expect(dayHeading('2026-10-14', '2026-10-14')).toBe('Today, Wed Oct 14');
    expect(dayHeading('2026-10-15', '2026-10-14')).toBe('Tomorrow, Thu Oct 15');
    expect(dayHeading('2026-10-16', '2026-10-14')).toBe('Fri, Oct 16');
  });

  test('longDate and monthTitle', () => {
    expect(longDate('2026-10-14')).toBe('Wednesday, October 14');
    expect(monthTitle('2026-10')).toBe('October 2026');
    expect(monthTitle('2027-01')).toBe('January 2027');
  });
});
