import { describe, test, expect } from 'vitest';
import {
  INVITE_FILTERS, INVITE_FILTER_LABELS, normalizeInviteFilter, inviteStatus, inviteStatuses, inviteCounts,
  hasNoLoginPeople, filterByInvite, inviteSummary, inviteEmptyText,
} from '../../portal/js/invite-status-model.js';
import { inviteState } from '../../portal/js/invites-model.js';

const NOW = Date.parse('2026-10-06T18:00:00Z');
const DAY = 86400000;

const person = (id, role, extra = {}) => ({ id, full_name: id, role, no_login: true, ...extra });
const invite = (id, profile, created, { days = 30, used = null, expires } = {}) => ({
  id,
  profile_id: profile,
  created_at: new Date(Date.parse(created)).toISOString(),
  expires_at: expires ?? new Date(Date.parse(created) + days * DAY).toISOString(),
  used_at: used,
  emailed_to: null,
  emailed_at: null,
});

describe('one person', () => {
  test('no invite yet: needs one', () => {
    expect(inviteStatus(person('a', 'parent'), [], NOW)).toEqual({ key: 'needs', invite: null });
    // other people's invites do not count
    expect(inviteStatus(person('a', 'parent'), [invite(1, 'b', '2026-10-05T12:00:00Z')], NOW).key).toBe('needs');
  });

  test('a live unused invite: invited, not joined', () => {
    const mine = invite(1, 'a', '2026-10-04T12:00:00Z');
    expect(inviteStatus(person('a', 'student'), [mine], NOW)).toEqual({ key: 'invited', invite: mine });
  });

  test('an unused invite past its expiry: expired', () => {
    const old = invite(1, 'a', '2026-08-01T12:00:00Z');
    expect(inviteStatus(person('a', 'parent'), [old], NOW)).toEqual({ key: 'expired', invite: old });
  });

  test('a used invite on a person who has a login: not waiting on anything', () => {
    const used = invite(1, 'a', '2026-10-01T12:00:00Z', { used: '2026-10-02T12:00:00Z' });
    expect(inviteStatus(person('a', 'parent', { no_login: false }), [used], NOW)).toBeNull();
    expect(inviteStatus(person('a', 'parent', { no_login: undefined }), [used], NOW)).toBeNull();
  });

  test('a used invite on a profile still marked no_login: joined, waiting for the page to catch up', () => {
    const used = invite(1, 'a', '2026-10-01T12:00:00Z', { used: '2026-10-02T12:00:00Z' });
    expect(inviteStatus(person('a', 'parent'), [used], NOW)).toEqual({ key: 'joining', invite: used });
    // a used link that has also run past its expiry is still joined, not expired
    const lapsed = invite(2, 'a', '2026-08-01T12:00:00Z', { used: '2026-08-02T12:00:00Z' });
    expect(inviteStatus(person('a', 'parent'), [lapsed], NOW).key).toBe('joining');
  });

  test('only students and parents without a login are ever waiting', () => {
    expect(inviteStatus(person('t', 'tutor'), [], NOW)).toBeNull();
    expect(inviteStatus(person('x', 'admin'), [], NOW)).toBeNull();
    expect(inviteStatus(person('p', 'pending'), [], NOW)).toBeNull();
    expect(inviteStatus(null, [], NOW)).toBeNull();
  });

  test('several invites: the latest one decides', () => {
    const expired = invite(1, 'a', '2026-08-01T12:00:00Z');
    const live = invite(2, 'a', '2026-10-03T12:00:00Z');
    expect(inviteStatus(person('a', 'parent'), [expired, live], NOW).key).toBe('invited');
    expect(inviteStatus(person('a', 'parent'), [live, expired], NOW).key).toBe('invited');
    // a new link made after an old one was used and the person is still no_login
    const used = invite(3, 'a', '2026-09-20T12:00:00Z', { used: '2026-09-21T12:00:00Z' });
    expect(inviteStatus(person('a', 'parent'), [used, live], NOW)).toEqual({ key: 'invited', invite: live });
    // the latest being the expired one: expired, whatever came before it
    const lapsed = invite(4, 'a', '2026-09-01T12:00:00Z');
    expect(inviteStatus(person('a', 'parent'), [lapsed, invite(5, 'a', '2026-07-01T12:00:00Z', { used: '2026-07-02T00:00:00Z' })], NOW).key).toBe('expired');
  });

  test('"latest" is an instant, whatever offset the row is written with', () => {
    // 2026-10-05 20:00 in Los Angeles is 2026-10-06 03:00 UTC: later than 01:00 UTC, though "2026-10-05..." sorts first as text
    const west = { ...invite(1, 'a', '2026-10-06T03:00:00Z'), created_at: '2026-10-05T20:00:00-07:00', expires_at: '2026-11-04T20:00:00-08:00' };
    const east = { ...invite(2, 'a', '2026-10-06T01:00:00Z'), created_at: '2026-10-06T01:00:00+00:00', expires_at: '2026-10-06T02:00:00+00:00' };
    expect(inviteStatus(person('a', 'parent'), [east, west], NOW)).toEqual({ key: 'invited', invite: west });
    expect(inviteState([east, west], NOW).invite).toBe(west);
  });
});

describe('expiry is an instant, not a Pacific date', () => {
  const at = (expires) => inviteStatus(person('a', 'parent'), [{ id: 1, profile_id: 'a', created_at: '2026-09-01T00:00:00Z', expires_at: expires, used_at: null }], NOW).key;

  test('the same instant written in different offsets gives the same answer', () => {
    // 18:00 UTC is 11:00 in Los Angeles in October
    expect(at('2026-10-06T18:00:00Z')).toBe('invited');
    expect(at('2026-10-06T11:00:00-07:00')).toBe('invited');
    expect(at('2026-10-06T20:00:00+02:00')).toBe('invited');
    // one second earlier is expired in every spelling
    expect(at('2026-10-06T17:59:59Z')).toBe('expired');
    expect(at('2026-10-06T10:59:59-07:00')).toBe('expired');
    expect(at('2026-10-06T19:59:59+02:00')).toBe('expired');
  });

  test('the same Pacific calendar day can be on either side, by the instant', () => {
    // both are "October 6" in Los Angeles; only the clock instant matters
    expect(at('2026-10-06T00:30:00-07:00')).toBe('expired'); // 07:30 UTC
    expect(at('2026-10-06T23:30:00-07:00')).toBe('invited'); // Oct 7, 06:30 UTC
  });

  test('across the fall-back hour in Los Angeles', () => {
    const lateNow = Date.parse('2026-11-01T09:15:00Z'); // 01:15 PST, the second 1 AM
    const status = (expires) => inviteStatus(person('a', 'parent'), [{ id: 1, profile_id: 'a', created_at: '2026-10-02T00:00:00Z', expires_at: expires, used_at: null }], lateNow).key;
    expect(status('2026-11-01T01:30:00-08:00')).toBe('invited'); // 09:30 UTC
    expect(status('2026-11-01T01:30:00-07:00')).toBe('expired'); // 08:30 UTC, the first 1:30 AM
  });

  test('an invite is still good at the exact instant it expires', () => {
    expect(at('2026-10-06T18:00:00.000Z')).toBe('invited');
    expect(at('2026-10-06T17:59:59.999Z')).toBe('expired');
  });
});

describe('everyone at once', () => {
  const people = [
    person('p1', 'parent'), // no invite
    person('p2', 'parent'), // live
    person('p3', 'parent'), // expired
    person('s1', 'student'), // no invite
    person('s2', 'student'), // joined, not refreshed yet
    person('s3', 'student', { no_login: false }), // has a login
    person('t1', 'tutor', { no_login: false }),
    person('w1', 'pending', { no_login: false }),
  ];
  const invites = [
    invite(1, 'p2', '2026-10-04T12:00:00Z'),
    invite(2, 'p3', '2026-08-01T12:00:00Z'),
    invite(3, 'p3', '2026-07-01T12:00:00Z', { used: '2026-07-02T12:00:00Z' }),
    invite(4, 's2', '2026-10-05T12:00:00Z', { used: '2026-10-06T12:00:00Z' }),
    invite(5, 's3', '2026-09-01T12:00:00Z', { used: '2026-09-02T12:00:00Z' }),
  ];
  const statuses = inviteStatuses(people, invites, NOW);

  test('a status for each person without a login, none for the rest', () => {
    expect([...statuses].map(([id, s]) => [id, s.key])).toEqual([
      ['p1', 'needs'], ['p2', 'invited'], ['p3', 'expired'], ['s1', 'needs'], ['s2', 'joining'],
    ]);
    expect(statuses.get('p2').invite.id).toBe(1);
    expect(hasNoLoginPeople(statuses)).toBe(true);
    expect(hasNoLoginPeople(inviteStatuses([person('a', 'parent', { no_login: false })], [], NOW))).toBe(false);
    expect(hasNoLoginPeople(inviteStatuses(null, null, NOW))).toBe(false);
  });

  test('it agrees with the one-person answer', () => {
    for (const p of people) expect(statuses.get(p.id) ?? null).toEqual(inviteStatus(p, invites, NOW));
  });

  test('counts: joined people are not waiting, and pending sign-ups are not in the list', () => {
    expect(inviteCounts(people, statuses)).toEqual({ needs: 2, invited: 1, expired: 1, waiting: 4, all: 7 });
    expect(inviteCounts(people, statuses, 'parent')).toEqual({ needs: 1, invited: 1, expired: 1, waiting: 3, all: 3 });
    expect(inviteCounts(people, statuses, 'student')).toEqual({ needs: 1, invited: 0, expired: 0, waiting: 1, all: 3 });
    expect(inviteCounts(people, statuses, 'tutor')).toEqual({ needs: 0, invited: 0, expired: 0, waiting: 0, all: 1 });
    expect(inviteCounts([], new Map())).toEqual({ needs: 0, invited: 0, expired: 0, waiting: 0, all: 0 });
    expect(inviteCounts(null, null)).toEqual({ needs: 0, invited: 0, expired: 0, waiting: 0, all: 0 });
  });

  test('the filter keeps only that state', () => {
    const ids = (filter) => filterByInvite(people, statuses, filter).map((p) => p.id);
    expect(ids('needs')).toEqual(['p1', 's1']);
    expect(ids('invited')).toEqual(['p2']);
    expect(ids('expired')).toEqual(['p3']);
    expect(ids('all')).toEqual(people.map((p) => p.id));
    expect(ids('nonsense')).toEqual(people.map((p) => p.id));
    expect(filterByInvite(null, statuses, 'needs')).toEqual([]);
  });

  test('a new invite moves a person from needs to invited without touching anyone else', () => {
    const made = [...invites, invite(6, 'p1', '2026-10-06T17:00:00Z')];
    const next = inviteStatuses(people, made, NOW);
    expect(inviteCounts(people, next)).toMatchObject({ needs: 1, invited: 2, expired: 1 });
    expect(next.get('p3').key).toBe('expired');
  });

  test('counts always add up', () => {
    const c = inviteCounts(people, statuses);
    expect(c.needs + c.invited + c.expired).toBe(c.waiting);
  });
});

describe('the words', () => {
  test('the chips, in order', () => {
    expect(INVITE_FILTERS).toEqual(['needs', 'invited', 'expired', 'all']);
    expect(INVITE_FILTERS.map((f) => INVITE_FILTER_LABELS[f])).toEqual(['Needs an invite', 'Invited, not joined', 'Invite expired', 'All']);
    expect(normalizeInviteFilter('expired')).toBe('expired');
    expect(normalizeInviteFilter('x')).toBe('all');
    expect(normalizeInviteFilter(undefined)).toBe('all');
  });

  test('the summary sentence', () => {
    expect(inviteSummary({ needs: 5, invited: 6, expired: 1, waiting: 12 })).toBe('12 people have no login yet: 5 need an invite, 6 invited, 1 expired.');
    expect(inviteSummary({ needs: 1, invited: 0, expired: 0, waiting: 1 })).toBe('1 person has no login yet: 1 needs an invite.');
    expect(inviteSummary({ needs: 0, invited: 2, expired: 0, waiting: 2 }, 'parent')).toBe('2 parents have no login yet: 2 invited.');
    expect(inviteSummary({ needs: 3, invited: 0, expired: 1, waiting: 4 }, 'student')).toBe('4 students have no login yet: 3 need an invite, 1 expired.');
    expect(inviteSummary({ needs: 0, invited: 0, expired: 1, waiting: 1 }, 'parent')).toBe('1 parent has no login yet: 1 expired.');
  });

  test('nobody waiting, and roles that always have a login', () => {
    const none = { needs: 0, invited: 0, expired: 0, waiting: 0 };
    expect(inviteSummary(none)).toBe('Everyone has a login.');
    expect(inviteSummary(none, 'parent')).toBe('Every parent has a login.');
    expect(inviteSummary(none, 'student')).toBe('Every student has a login.');
    expect(inviteSummary({ ...none, needs: 2, waiting: 2 }, 'tutor')).toBeNull();
    expect(inviteSummary(none, 'admin')).toBeNull();
  });

  test('the empty list under a filter', () => {
    expect(inviteEmptyText('needs')).toBe('Nobody needs an invite.');
    expect(inviteEmptyText('needs', 'parent')).toBe('No parents need an invite.');
    expect(inviteEmptyText('invited', 'student')).toBe('No students have an invite waiting to be used.');
    expect(inviteEmptyText('invited')).toBe('Nobody has an invite waiting to be used.');
    expect(inviteEmptyText('expired', 'parent')).toBe('No parents have an expired invite.');
    expect(inviteEmptyText('expired', 'tutor')).toBe('Nobody has an expired invite.');
    expect(inviteEmptyText('all')).toBeNull();
  });

  test('no dash in any sentence', () => {
    const lines = [
      ...Object.values(INVITE_FILTER_LABELS),
      inviteSummary({ needs: 5, invited: 6, expired: 1, waiting: 12 }),
      inviteSummary({ needs: 0, invited: 0, expired: 0, waiting: 0 }, 'parent'),
      ...INVITE_FILTERS.flatMap((f) => ['all', 'student', 'parent'].map((r) => inviteEmptyText(f, r))),
    ].filter(Boolean);
    for (const line of lines) expect(line).not.toMatch(/[–—]/);
  });
});
