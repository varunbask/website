import { describe, test, expect, vi } from 'vitest';
import {
  handlePeople, createPeopleRepo,
} from '../../api/_lib/people.js';
import {
  nameMatches, confirmNameOf, firstNameOf, refusalMessage, payPeriodStart, laDay, paidSessionCount, blockerOf,
  failureCode, createDeleteRepo, HOMEWORK_BUCKET, MATERIALS_BUCKET, AVATARS_BUCKET,
} from '../../api/_lib/people-delete.js';

const NOW = Date.parse('2026-10-14T19:00:00Z');
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';
const CONSTANCE = 'cccccccc-0000-4000-8000-000000000001';
const MARY = 'cccccccc-0000-4000-8000-000000000002';
const DANIEL = 'cccccccc-0000-4000-8000-000000000003';
const MAYA = 'cccccccc-0000-4000-8000-000000000004';
const LEO = 'cccccccc-0000-4000-8000-000000000005';
const JIN = 'cccccccc-0000-4000-8000-000000000006';

const PEOPLE = {
  [ADMIN]: { id: ADMIN, full_name: 'Varun Baskaran', email: 'varun@example.com', role: 'admin', no_login: false },
  [CONSTANCE]: { id: CONSTANCE, full_name: 'Constance  Lin', email: 'no-login+c@people.varunbaskaran.com', role: 'student', no_login: true },
  [MARY]: { id: MARY, full_name: 'Mary Lin', email: 'mary@example.com', role: 'parent', no_login: false },
  [DANIEL]: { id: DANIEL, full_name: 'Daniel Ortiz', email: 'daniel@example.com', role: 'tutor', no_login: false },
  [MAYA]: { id: MAYA, full_name: 'Maya Chen', email: 'maya@example.com', role: 'student', no_login: false },
};

const COUNTS = {
  assignments: 3, tasks: 5, submissions: 2, drafts: 1, updates: 1, notes: 1, series: 1, family_rates: 1, tutor_rates: 0,
  tutor_links: 1, parent_links: 1, invites: 1, statements: 0,
};

// Everything the handler reads through the repo, with answers that can be changed
function fakes({ admin = true, people = PEOPLE, sessions = [], counts = COUNTS, refs = {}, files = { homework: [`${CONSTANCE}/a.pdf`, `${CONSTANCE}/b.png`], materials: [] },
  billing = { payerOf: {}, payments: [], payouts: [], anchor: '2026-09-27' }, naming = 0, children = [], moves = [], names = {}, deleteError = null,
  disconnect = async () => false } = {}) {
  const calls = [];
  const note = (name, fn) => vi.fn(async (...args) => {
    calls.push(name);
    return fn(...args);
  });
  const repo = {
    getProfile: note('getProfile', async (id) => people[id] ?? null),
    sessionsOf: note('sessionsOf', async () => sessions),
    countsOf: note('countsOf', async () => counts),
    billingRefs: note('billingRefs', async () => ({ payments: 0, payouts: 0, adjustments: 0, ...refs })),
    billingFacts: note('billingFacts', async () => billing),
    paymentsNaming: note('paymentsNaming', async () => naming),
    filesOf: note('filesOf', async () => files),
    childrenOf: note('childrenOf', async () => children),
    payerMoves: note('payerMoves', async () => moves),
    namesOf: note('namesOf', async (ids) => Object.fromEntries(ids.map((i) => [i, names[i] ?? people[i]?.full_name ?? '']))),
    removeFiles: note('removeFiles', async (bucket, paths) => paths.length),
    deleteSessionEdits: note('deleteSessionEdits', async () => {}),
    setPayer: note('setPayer', async () => {}),
  };
  const auth = { deleteUser: note('deleteUser', async () => (deleteError ? { error: deleteError } : { data: {}, error: null })) };
  const disconnectGoogle = note('disconnectGoogle', disconnect);
  const log = vi.fn();
  const warn = vi.fn();
  const deps = {
    repo, auth, verifyAdmin: vi.fn(async () => (admin ? { id: ADMIN } : null)), now: () => NOW, disconnectGoogle, log, warn,
  };
  return { repo, auth, deps, calls, disconnectGoogle, log, warn };
}

const post = (body) => new Request('https://x.test/api/people', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const run = async (body, f = fakes()) => {
  const res = await handlePeople(post(body), f.deps);
  return { res, json: await res.json().catch(() => null), f };
};
const remove = (id, confirm_name, f) => run({ action: 'delete_person', id, confirm_name }, f);
const preview = (id, f) => run({ action: 'delete_preview', id }, f);

// A lesson at a Pacific time: `daysAhead` days from NOW, one hour long
const lesson = (id, student, tutor, daysAhead, over = {}) => {
  const start = NOW + daysAhead * 86400000;
  return { id, student_id: student, tutor_id: tutor, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 3600000).toISOString(), ...over };
};

describe('the name guard', () => {
  test('trims, ignores case and spacing', () => {
    const person = PEOPLE[CONSTANCE];
    expect(nameMatches('  constance LIN ', person)).toBe(true);
    expect(nameMatches('Constance Lin', person)).toBe(true);
    expect(nameMatches('Constance', person)).toBe(false);
    expect(nameMatches('', person)).toBe(false);
    expect(nameMatches(undefined, person)).toBe(false);
    expect(nameMatches(42, person)).toBe(false);
  });

  test('a person with no name is confirmed by their address; with neither nothing matches', () => {
    expect(confirmNameOf({ full_name: ' ', email: 'x@example.com' })).toBe('x@example.com');
    expect(nameMatches('X@Example.com', { full_name: '', email: 'x@example.com' })).toBe(true);
    expect(nameMatches('', { full_name: '', email: '' })).toBe(false);
    expect(nameMatches('anything', { full_name: '', email: null })).toBe(false);
  });

  test('first names for the sentences', () => {
    expect(firstNameOf({ full_name: 'Grace  Lin' })).toBe('Grace');
    expect(firstNameOf({ full_name: '' })).toBe('This person');
  });
});

describe('refusal words', () => {
  const grace = { full_name: 'Grace Lin', role: 'parent' };
  test('each code has a sentence the portal shows as it is', () => {
    expect(refusalMessage('has_payments', grace)).toBe('Grace has payments recorded, so they can’t be deleted. Their billing history must stay.');
    expect(refusalMessage('has_payouts', grace)).toContain('Grace has pay recorded');
    expect(refusalMessage('has_adjustments', grace)).toContain('billing adjustments');
    expect(refusalMessage('self')).toBe('You can’t delete your own account.');
    expect(refusalMessage('is_admin', grace)).toContain('Grace is an admin');
    expect(refusalMessage('in_use', grace)).toContain('still used by other records');
    expect(refusalMessage('name_mismatch')).toContain('doesn’t match');
    expect(refusalMessage('not_found')).toContain('no longer');
    expect(refusalMessage('???')).toBe('This person can’t be deleted.');
  });

  test('paid lessons read differently for a student and a tutor', () => {
    expect(refusalMessage('paid_sessions', { full_name: 'Constance Lin', role: 'student' })).toContain('Constance’s past lessons are in a month that has been paid');
    expect(refusalMessage('paid_sessions', { full_name: 'Daniel Ortiz', role: 'tutor' })).toContain('Daniel taught lessons in a month or pay period that has been paid');
  });

  test('no dashes in what people read', () => {
    for (const code of ['self', 'is_admin', 'has_payments', 'has_payouts', 'has_adjustments', 'paid_sessions', 'in_use', 'name_mismatch', 'not_found']) {
      expect(refusalMessage(code, grace)).not.toMatch(/[–—]/);
    }
  });
});

describe('pay periods and paid lessons', () => {
  test('a pay period is 14 days from the anchor Sunday', () => {
    expect(payPeriodStart('2026-09-27', '2026-09-27')).toBe('2026-09-27');
    expect(payPeriodStart('2026-10-10', '2026-09-27')).toBe('2026-09-27');
    expect(payPeriodStart('2026-10-11', '2026-09-27')).toBe('2026-10-11');
    expect(payPeriodStart('2026-10-24', '2026-09-27')).toBe('2026-10-11');
    expect(payPeriodStart('2026-09-26', '2026-09-27')).toBe('2026-09-13');
  });

  test('the day of a lesson is the Pacific day', () => {
    expect(laDay('2026-10-15T05:30:00Z')).toBe('2026-10-14');
    expect(laDay('2026-10-15T08:30:00Z')).toBe('2026-10-15');
  });

  const base = { anchor: '2026-09-27', payerOf: { s1: 'p1' }, payments: [], payouts: [] };
  const one = (starts_at, over = {}) => ({ student_id: 's1', tutor_id: 't1', starts_at, ...over });

  test('a month with a payment from the paying parent is paid', () => {
    const facts = { ...base, payments: [{ parent_id: 'p1', period: '2026-10-01' }] };
    expect(paidSessionCount({ ...facts, sessions: [one('2026-10-05T23:00:00Z'), one('2026-11-02T23:00:00Z')] })).toBe(1);
  });

  test('a payment with no month (a prepayment) or from another parent does not make a month paid', () => {
    expect(paidSessionCount({ ...base, payments: [{ parent_id: 'p1', period: null }], sessions: [one('2026-10-05T23:00:00Z')] })).toBe(0);
    expect(paidSessionCount({ ...base, payments: [{ parent_id: 'p2', period: '2026-10-01' }], sessions: [one('2026-10-05T23:00:00Z')] })).toBe(0);
  });

  test('a pay period with a payout to the tutor is paid, whoever the student is', () => {
    const facts = { ...base, payerOf: {}, payouts: [{ tutor_id: 't1', period_start: '2026-09-27' }] };
    expect(paidSessionCount({ ...facts, sessions: [one('2026-10-05T23:00:00Z'), one('2026-10-12T23:00:00Z')] })).toBe(1);
    expect(paidSessionCount({ ...facts, sessions: [one('2026-10-05T23:00:00Z', { tutor_id: 't2' })] })).toBe(0);
  });

  test('a lesson late on the last evening of a month belongs to that Pacific month', () => {
    const facts = { ...base, payments: [{ parent_id: 'p1', period: '2026-10-01' }] };
    // 2026-11-01 03:00 UTC is still October 31 in Pacific time
    expect(paidSessionCount({ ...facts, sessions: [one('2026-11-01T03:00:00Z')] })).toBe(1);
  });

  test('the first blocker wins, in the order of the refusal list', () => {
    expect(blockerOf({ refs: { payments: 1, payouts: 1, adjustments: 1 }, paid: 3 })).toBe('has_payments');
    expect(blockerOf({ refs: { payments: 0, payouts: 1, adjustments: 1 }, paid: 3 })).toBe('has_payouts');
    expect(blockerOf({ refs: { payments: 0, payouts: 0, adjustments: 1 }, paid: 3 })).toBe('has_adjustments');
    expect(blockerOf({ refs: { payments: 0, payouts: 0, adjustments: 0 }, paid: 3 })).toBe('paid_sessions');
    expect(blockerOf({ refs: { payments: 0, payouts: 0, adjustments: 0 }, paid: 0 })).toBeNull();
  });

  test('what the database said, as a code', () => {
    expect(failureCode({ code: '23503', message: 'update or delete on table "profiles" violates foreign key constraint' })).toBe('in_use');
    expect(failureCode({ message: 'violates RESTRICT setting of foreign key constraint "payments_parent_id_fkey"' })).toBe('in_use');
    expect(failureCode({ code: 'VP002', message: 'This session is in a month or pay period that has been paid' })).toBe('paid_sessions');
    expect(failureCode({ message: 'Database error deleting user' })).toBeNull();
    expect(failureCode(null)).toBeNull();
  });
});

describe('who may ask', () => {
  test('only an admin: no token, a tutor or a student gets 401 and nothing is read or deleted', async () => {
    for (const action of ['delete_preview', 'delete_person']) {
      const f = fakes({ admin: false });
      const { res } = await run({ action, id: CONSTANCE, confirm_name: 'Constance Lin' }, f);
      expect(res.status).toBe(401);
      expect(f.calls).toEqual([]);
    }
  });

  test('a bad id is a 422 before anything is read', async () => {
    for (const id of [undefined, '', 'nope', 42, `${CONSTANCE}x`, "'; drop table profiles; --"]) {
      const f = fakes();
      const { res, json } = await run({ action: 'delete_person', id, confirm_name: 'x' }, f);
      expect(res.status).toBe(422);
      expect(json).toEqual({ error: 'invalid', errors: { id: 'invalid' } });
      expect(f.calls).toEqual([]);
    }
  });

  test('a person who is not there is a 404 for both actions', async () => {
    for (const action of ['delete_preview', 'delete_person']) {
      const f = fakes({ people: {} });
      const { res, json } = await run({ action, id: CONSTANCE, confirm_name: 'Constance Lin' }, f);
      expect(res.status).toBe(404);
      expect(json.error).toBe('not_found');
      expect(f.auth.deleteUser).not.toHaveBeenCalled();
    }
  });
});

describe('what is refused', () => {
  test('you cannot delete yourself', async () => {
    const f = fakes();
    const { res, json } = await remove(ADMIN, 'Varun Baskaran', f);
    expect(res.status).toBe(409);
    expect(json).toEqual({ error: 'self', message: 'You can’t delete your own account.' });
    expect(f.auth.deleteUser).not.toHaveBeenCalled();
    expect(f.disconnectGoogle).not.toHaveBeenCalled();
  });

  test('you cannot delete any admin, however well you spell the name', async () => {
    const other = { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Second Admin', email: 'b@example.com', role: 'admin' };
    const f = fakes({ people: { ...PEOPLE, [other.id]: other } });
    const { res, json } = await remove(other.id, 'Second Admin', f);
    expect(res.status).toBe(409);
    expect(json.error).toBe('is_admin');
    expect(f.auth.deleteUser).not.toHaveBeenCalled();
  });

  test('a name that does not match is a 422 and nothing is touched', async () => {
    const f = fakes();
    const { res, json } = await remove(CONSTANCE, 'Constanse Lin', f);
    expect(res.status).toBe(422);
    expect(json.error).toBe('name_mismatch');
    expect(f.auth.deleteUser).not.toHaveBeenCalled();
    expect(f.disconnectGoogle).not.toHaveBeenCalled();
    expect(f.repo.removeFiles).not.toHaveBeenCalled();
    expect(f.repo.countsOf).not.toHaveBeenCalled();
  });

  test.each([
    ['has_payments', { payments: 2 }],
    ['has_payouts', { payouts: 1 }],
    ['has_adjustments', { adjustments: 1 }],
  ])('%s: the restricting rows stop it, with a message, before Google or Auth are touched', async (code, refs) => {
    const f = fakes({ refs });
    const { res, json } = await remove(MARY, 'Mary Lin', f);
    expect(res.status).toBe(409);
    expect(json.error).toBe(code);
    expect(json.message).toBe(refusalMessage(code, PEOPLE[MARY]));
    expect(f.disconnectGoogle).not.toHaveBeenCalled();
    expect(f.auth.deleteUser).not.toHaveBeenCalled();
    expect(f.repo.removeFiles).not.toHaveBeenCalled();
    // money rows already decide it: the lessons are not priced
    expect(f.repo.billingFacts).not.toHaveBeenCalled();
  });

  test('a student with a past lesson in a paid month is refused', async () => {
    const past = lesson(1, CONSTANCE, DANIEL, -10);
    const f = fakes({
      sessions: [past],
      billing: { payerOf: { [CONSTANCE]: MARY }, payments: [{ parent_id: MARY, period: '2026-10-01' }], payouts: [], anchor: '2026-09-27' },
    });
    const { res, json } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(409);
    expect(json.error).toBe('paid_sessions');
    expect(json.message).toContain('Constance’s past lessons are in a month that has been paid');
    expect(f.auth.deleteUser).not.toHaveBeenCalled();
  });

  test('a lesson still to come in a paid month is not a reason', async () => {
    const future = lesson(1, CONSTANCE, DANIEL, 3);
    const f = fakes({
      sessions: [future],
      billing: { payerOf: { [CONSTANCE]: MARY }, payments: [{ parent_id: MARY, period: '2026-10-01' }], payouts: [], anchor: '2026-09-27' },
    });
    const { res } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(200);
    expect(f.repo.billingFacts).not.toHaveBeenCalled(); // nothing has happened yet, so there is nothing to price
  });

  test('a past lesson in an unpaid month is not a reason', async () => {
    const f = fakes({ sessions: [lesson(1, CONSTANCE, DANIEL, -20)] });
    const { res } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(200);
  });

  test('a payment with a line for the student is a reason, though no month matches', async () => {
    const f = fakes({ sessions: [lesson(1, CONSTANCE, DANIEL, -20)], naming: 1 });
    const { res, json } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(409);
    expect(json.error).toBe('paid_sessions');
  });

  test('a tutor who was paid for the pay period of a past lesson is refused', async () => {
    const f = fakes({
      sessions: [lesson(1, MAYA, DANIEL, -10)],
      billing: { payerOf: {}, payments: [], payouts: [{ tutor_id: DANIEL, period_start: '2026-09-27' }], anchor: '2026-09-27' },
    });
    const { res, json } = await remove(DANIEL, 'Daniel Ortiz', f);
    expect(res.status).toBe(409);
    expect(json.error).toBe('paid_sessions');
    expect(json.message).toContain('Daniel taught lessons');
  });

  test('a tutor whose students paid for the month of a past lesson is refused too (sessions_guard)', async () => {
    const f = fakes({
      sessions: [lesson(1, MAYA, DANIEL, -10)],
      billing: { payerOf: { [MAYA]: JIN }, payments: [{ parent_id: JIN, period: '2026-10-01' }], payouts: [], anchor: '2026-09-27' },
    });
    const { json } = await remove(DANIEL, 'Daniel Ortiz', f);
    expect(json.error).toBe('paid_sessions');
  });
});

describe('the preview', () => {
  test('counts what would go, before anything changes', async () => {
    const f = fakes({
      sessions: [lesson(1, CONSTANCE, DANIEL, -20), lesson(2, CONSTANCE, DANIEL, 2), lesson(3, CONSTANCE, DANIEL, 9)],
      files: { homework: [`${CONSTANCE}/a.pdf`], materials: [`${CONSTANCE}/m.pdf`] },
    });
    const { res, json } = await preview(CONSTANCE, f);
    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      person: { id: CONSTANCE, full_name: 'Constance  Lin', role: 'student', no_login: true },
      counts: {
        sessions: 3, upcoming_sessions: 2, assignments: 3, tasks: 5, submissions: 2, drafts: 1, files: 2, updates: 2, series: 1,
        rates: 1, links: 2, invites: 1, statements: 0,
      },
      lessons: [],
      children: [],
      no_payer: [],
      blocked: null,
    });
    expect(f.auth.deleteUser).not.toHaveBeenCalled();
    expect(f.disconnectGoogle).not.toHaveBeenCalled();
    expect(f.repo.removeFiles).not.toHaveBeenCalled();
  });

  test('a file in both buckets with the same name counts twice', async () => {
    const same = `${CONSTANCE}/a.pdf`;
    const f = fakes({ files: { homework: [same], materials: [same] } });
    expect((await preview(CONSTANCE, f)).json.counts.files).toBe(2);
  });

  test('says why it is blocked, still with the counts', async () => {
    const f = fakes({ refs: { payments: 1 } });
    const { res, json } = await preview(MARY, f);
    expect(res.status).toBe(200);
    expect(json.blocked).toEqual({ code: 'has_payments', message: refusalMessage('has_payments', PEOPLE[MARY]) });
    expect(json.counts).toBeDefined();
  });

  test('your own account and an admin come back blocked, not as errors', async () => {
    const f = fakes();
    expect((await preview(ADMIN, f)).json).toMatchObject({ ok: true, blocked: { code: 'self' } });
    const other = { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Second Admin', role: 'admin' };
    const g = fakes({ people: { ...PEOPLE, [other.id]: other } });
    expect((await preview(other.id, g)).json).toMatchObject({ blocked: { code: 'is_admin' } });
    expect(f.repo.countsOf).not.toHaveBeenCalled();
  });

  test('a tutor: how many lessons go with them, and whose', async () => {
    const f = fakes({
      sessions: [
        lesson(1, MAYA, DANIEL, -30), lesson(2, MAYA, DANIEL, 4), lesson(3, MAYA, DANIEL, 11), lesson(4, LEO, DANIEL, 6),
      ],
      names: { [MAYA]: 'Maya Chen', [LEO]: 'Leo Park' },
    });
    const { json } = await preview(DANIEL, f);
    expect(json.counts.sessions).toBe(4);
    expect(json.counts.upcoming_sessions).toBe(3);
    expect(json.lessons).toEqual([
      { id: LEO, name: 'Leo Park', total: 1, upcoming: 1 },
      { id: MAYA, name: 'Maya Chen', total: 3, upcoming: 2 },
    ]);
  });

  test('a student has no such list: their tutors keep their other students', async () => {
    const f = fakes({ sessions: [lesson(1, CONSTANCE, DANIEL, 4)] });
    expect((await preview(CONSTANCE, f)).json.lessons).toEqual([]);
  });

  test('a parent: the children who stay, and who would be left with no one to bill', async () => {
    const f = fakes({
      children: ['Constance Lin', 'Leo Park'],
      moves: [{ student_id: CONSTANCE, next_parent_id: null }, { student_id: LEO, next_parent_id: JIN }],
      names: { [CONSTANCE]: 'Constance Lin', [LEO]: 'Leo Park' },
    });
    const { json } = await preview(MARY, f);
    expect(json.children).toEqual(['Constance Lin', 'Leo Park']);
    expect(json.no_payer).toEqual(['Constance Lin']);
  });
});

describe('deleting', () => {
  test('removes the user with the service role after Google, with counts read first, then cleans up', async () => {
    const f = fakes({
      sessions: [lesson(1, CONSTANCE, DANIEL, -20), lesson(2, CONSTANCE, DANIEL, 2)],
      files: { homework: [`${CONSTANCE}/a.pdf`, `${CONSTANCE}/b.png`], materials: [`${CONSTANCE}/m.pdf`] },
      disconnect: async () => true,
    });
    const { res, json } = await remove(CONSTANCE, '  constance lin ', f);
    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      deleted: true,
      removed: { sessions: 2, upcoming_sessions: 1, assignments: 3, tasks: 5, submissions: 2, drafts: 1, files: 3, rates: 1, links: 2, invites: 1 },
      warnings: [],
    });

    // The order: what is counted, then Google, then the user, then the leftovers
    const order = f.calls.filter((c) => ['countsOf', 'filesOf', 'sessionsOf', 'disconnectGoogle', 'deleteUser', 'removeFiles', 'deleteSessionEdits'].includes(c));
    expect(order.indexOf('countsOf')).toBeLessThan(order.indexOf('disconnectGoogle'));
    expect(order.indexOf('filesOf')).toBeLessThan(order.indexOf('disconnectGoogle'));
    expect(order.indexOf('disconnectGoogle')).toBeLessThan(order.indexOf('deleteUser'));
    expect(order.indexOf('deleteUser')).toBeLessThan(order.indexOf('removeFiles'));
    expect(order.indexOf('deleteUser')).toBeLessThan(order.indexOf('deleteSessionEdits'));

    expect(f.auth.deleteUser).toHaveBeenCalledTimes(1);
    expect(f.auth.deleteUser).toHaveBeenCalledWith(CONSTANCE);
    expect(f.disconnectGoogle).toHaveBeenCalledWith(CONSTANCE);
    expect(f.repo.removeFiles).toHaveBeenCalledWith(HOMEWORK_BUCKET, [`${CONSTANCE}/a.pdf`, `${CONSTANCE}/b.png`]);
    expect(f.repo.removeFiles).toHaveBeenCalledWith(MATERIALS_BUCKET, [`${CONSTANCE}/m.pdf`]);
    expect(f.repo.deleteSessionEdits).toHaveBeenCalledWith(CONSTANCE);
  });

  test('the log has counts and the role, no names, files or addresses', async () => {
    const f = fakes({ files: { homework: [`${CONSTANCE}/secret-name.pdf`], materials: [] } });
    await remove(CONSTANCE, 'Constance Lin', f);
    const text = f.log.mock.calls.flat().join(' ');
    expect(text).toContain('role=student');
    expect(text).toContain('files=1');
    for (const secret of ['Constance', 'Lin', 'secret-name', CONSTANCE, 'example.com']) expect(text).not.toContain(secret);
  });

  test('a parent who paid for a student: the bill goes to the other parent, if there is one', async () => {
    const f = fakes({
      moves: [{ student_id: LEO, next_parent_id: JIN }, { student_id: CONSTANCE, next_parent_id: null }],
      children: ['Leo Park', 'Constance Lin'],
    });
    const { res, json } = await remove(MARY, 'Mary Lin', f);
    expect(res.status).toBe(200);
    expect(json.warnings).toEqual([]);
    expect(f.repo.setPayer).toHaveBeenCalledTimes(1);
    expect(f.repo.setPayer).toHaveBeenCalledWith(LEO, JIN);
  });

  test('a tutor with only upcoming or unpaid lessons can be deleted, and the answer counts their lessons', async () => {
    const f = fakes({
      sessions: [lesson(1, MAYA, DANIEL, -20), lesson(2, MAYA, DANIEL, 5), lesson(3, LEO, DANIEL, 6)],
      files: { homework: [], materials: [`${MAYA}/slides.pptx`] },
    });
    const { res, json } = await remove(DANIEL, 'Daniel Ortiz', f);
    expect(res.status).toBe(200);
    expect(json.removed.sessions).toBe(3);
    expect(json.removed.upcoming_sessions).toBe(2);
    expect(f.repo.filesOf).toHaveBeenCalledWith(DANIEL, [1, 2, 3]); // the materials of their lessons go with them
    expect(f.repo.removeFiles).toHaveBeenCalledWith(MATERIALS_BUCKET, [`${MAYA}/slides.pptx`]);
  });

  test('a person without a login (a placeholder address) is deleted like anyone', async () => {
    const f = fakes();
    const { res } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(200);
  });

  test('their profile photos are removed too, and counted with the files', async () => {
    const f = fakes({ files: { homework: [`${CONSTANCE}/a.pdf`], materials: [], avatars: [`${CONSTANCE}/aB3_x-9kLmNoPqRs.webp`] } });
    const { res, json } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(200);
    expect(json.removed.files).toBe(2);
    expect(json.warnings).toEqual([]);
    expect(f.repo.removeFiles).toHaveBeenCalledWith(AVATARS_BUCKET, [`${CONSTANCE}/aB3_x-9kLmNoPqRs.webp`]);
  });

  test('no photo, no call to the avatars bucket', async () => {
    const f = fakes();
    await remove(CONSTANCE, 'Constance Lin', f);
    expect(f.repo.removeFiles.mock.calls.map(([bucket]) => bucket)).not.toContain(AVATARS_BUCKET);
  });

  test('a failed file cleanup is reported as a warning; the delete stands and the rest still runs', async () => {
    const f = fakes();
    f.repo.removeFiles.mockRejectedValueOnce(new Error('storage down'));
    const { res, json } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(200);
    expect(json.deleted).toBe(true);
    expect(json.warnings).toEqual(['homework files']);
    expect(f.repo.removeFiles).toHaveBeenCalledTimes(2);
    expect(f.repo.deleteSessionEdits).toHaveBeenCalled();
    expect(f.warn.mock.calls.flat().join(' ')).not.toContain('storage down');
  });

  test('a failed Google disconnect is a warning and does not stop the delete', async () => {
    const f = fakes({ disconnect: async () => { throw new Error('token jwt.secret.value'); } });
    const { res, json } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(200);
    expect(json.warnings).toEqual(['google']);
    expect(f.auth.deleteUser).toHaveBeenCalled();
    expect(f.warn.mock.calls.flat().join(' ')).not.toContain('jwt.secret.value');
  });

  test('with no Google wiring at all it still works', async () => {
    const f = fakes();
    delete f.deps.disconnectGoogle;
    const { res } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(200);
  });

  test('the database refusing on a reference is mapped to a code, and nothing is cleaned up', async () => {
    const f = fakes({ deleteError: { code: '23503', message: 'update or delete on table "profiles" violates foreign key constraint "x"' } });
    const { res, json } = await remove(CONSTANCE, 'Constance Lin', f);
    expect(res.status).toBe(409);
    expect(json.error).toBe('in_use');
    expect(f.repo.removeFiles).not.toHaveBeenCalled();
    expect(f.repo.deleteSessionEdits).not.toHaveBeenCalled();
  });

  test('a restrict error is checked again: a payment that appeared meanwhile is named', async () => {
    const f = fakes({ deleteError: { message: 'Database error deleting user' } });
    // the second look finds a payment
    let looks = 0;
    f.repo.billingRefs.mockImplementation(async () => ({ payments: looks++ ? 1 : 0, payouts: 0, adjustments: 0 }));
    const { res, json } = await remove(MARY, 'Mary Lin', f);
    expect(res.status).toBe(409);
    expect(json.error).toBe('has_payments');
    expect(f.repo.removeFiles).not.toHaveBeenCalled();
  });

  test('an unexplained failure is an error (the endpoint answers 500) and leaves the files alone', async () => {
    const f = fakes({ deleteError: { message: 'Database error deleting user' } });
    await expect(handlePeople(post({ action: 'delete_person', id: CONSTANCE, confirm_name: 'Constance Lin' }), f.deps)).rejects.toThrow('deleteUser');
    expect(f.repo.removeFiles).not.toHaveBeenCalled();
  });

  test('the same body twice: the second finds nobody', async () => {
    const people = { ...PEOPLE };
    const f = fakes({ people });
    f.auth.deleteUser.mockImplementation(async (id) => { delete people[id]; return { data: {}, error: null }; });
    expect((await remove(CONSTANCE, 'Constance Lin', f)).res.status).toBe(200);
    const again = await remove(CONSTANCE, 'Constance Lin', f);
    expect(again.res.status).toBe(404);
    expect(f.auth.deleteUser).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The service-role queries, against a small in-memory stand-in for supabase-js

function fakeSupabase(tables, objects = {}) {
  const removedPaths = [];
  const calls = [];
  const rowsOf = (name) => tables[name];
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.op = 'select';
      this.head = false;
      this.window = null;
    }
    select(cols, opts = {}) { this.cols = cols; this.head = Boolean(opts.head); return this; }
    update(patch) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c, v) { this.filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
    not(c, op, v) { this.filters.push((r) => (v === null ? r[c] !== null && r[c] !== undefined : r[c] !== v)); return this; }
    or(expr) {
      const parts = expr.split(',').map((p) => p.split('.'));
      this.filters.push((r) => parts.some(([c, , v]) => r[c] === v));
      return this;
    }
    contains(c, v) {
      // Like supabase-js + PostgREST on a jsonb column: an array becomes a Postgres
      // array literal ({...}) and is refused; the value must go as JSON text
      if (typeof v !== 'string') { this.bad = 'invalid input syntax for type json'; return this; }
      const want = JSON.parse(v);
      this.filters.push((r) => (r[c] ?? []).some((line) => Object.entries(want[0]).every(([k, x]) => line[k] === x)));
      return this;
    }
    order() { return this; }
    range(from, to) { this.window = [from, to]; return this; }
    maybeSingle() { this.single = true; return this; }
    run() {
      calls.push(`${this.op} ${this.table}`);
      if (this.bad) return { data: null, error: { code: '22P02', message: this.bad } };
      if (!tables[this.table]) return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
      const rows = rowsOf(this.table).filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') { rows.forEach((r) => Object.assign(r, this.patch)); return { data: null, error: null }; }
      if (this.op === 'delete') { tables[this.table] = rowsOf(this.table).filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      if (this.head) return { count: rows.length, data: null, error: null };
      const shown = this.window ? rows.slice(this.window[0], this.window[1] + 1) : rows;
      // Only the columns asked for come back, like PostgREST
      const wanted = this.cols && this.cols !== '*' ? this.cols.split(',').map((c) => c.trim()) : null;
      const project = (r) => (wanted ? Object.fromEntries(wanted.map((c) => [c, r[c]])) : { ...r });
      return { data: this.single ? (shown[0] ? project(shown[0]) : null) : shown.map(project), error: null };
    }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  const storage = {
    from: (bucket) => ({
      list: async (folder, { limit, offset }) => ({
        data: (objects[bucket] ?? []).filter((p) => p.startsWith(`${folder}/`)).map((p) => ({ name: p.slice(folder.length + 1), id: `id-${p}` }))
          .concat([{ name: 'sub', id: null }]).slice(offset, offset + limit),
        error: null,
      }),
      remove: async (paths) => {
        removedPaths.push([bucket, paths]);
        return { data: paths.map((name) => ({ name })), error: null };
      },
    }),
  };
  return { from: (t) => new Query(t), storage, removedPaths, calls, tables };
}

describe('the repo', () => {
  const sessionRow = (id, student_id, tutor_id) => ({ id, student_id, tutor_id, starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-01T01:00:00Z' });

  const world = () => ({
    sessions: [sessionRow(1, CONSTANCE, DANIEL), sessionRow(2, MAYA, DANIEL), sessionRow(3, MAYA, 'other-tutor')],
    tasks: [
      { id: 1, student_id: CONSTANCE, kind: 'assignment' }, { id: 2, student_id: CONSTANCE, kind: 'assignment' },
      { id: 3, student_id: CONSTANCE, kind: 'task' }, { id: 4, student_id: MAYA, kind: 'task' },
    ],
    submission_drafts: [{ student_id: CONSTANCE, task_id: 1 }],
    submissions: [
      { id: 1, student_id: CONSTANCE, storage_path: `${CONSTANCE}/a.pdf` },
      { id: 2, student_id: CONSTANCE, storage_path: `${MAYA}/not-hers.pdf` },
      { id: 3, student_id: CONSTANCE, storage_path: null },
    ],
    materials: [
      { id: 1, student_id: CONSTANCE, session_id: null, storage_path: `${CONSTANCE}/m1.pdf` },
      { id: 2, student_id: MAYA, session_id: 2, storage_path: `${MAYA}/lesson.pptx` },
      { id: 3, student_id: MAYA, session_id: 3, storage_path: `${MAYA}/other.pptx` },
      { id: 4, student_id: MAYA, session_id: 2, storage_path: null },
    ],
    updates: [{ student_id: CONSTANCE }], student_notes: [{ student_id: CONSTANCE }, { student_id: CONSTANCE }], session_series: [{ student_id: CONSTANCE, tutor_id: DANIEL }],
    family_rates: [{ student_id: CONSTANCE, tutor_id: null }, { student_id: MAYA, tutor_id: DANIEL }], tutor_rates: [{ tutor_id: DANIEL }],
    tutor_students: [{ tutor_id: DANIEL, student_id: CONSTANCE }, { tutor_id: DANIEL, student_id: MAYA }],
    parent_students: [
      { parent_id: MARY, student_id: CONSTANCE, bills: true, created_at: '2026-01-01' },
      { parent_id: JIN, student_id: CONSTANCE, bills: false, created_at: '2026-02-01' },
      { parent_id: MARY, student_id: MAYA, bills: true, created_at: '2026-01-01' },
    ],
    portal_invites: [{ profile_id: CONSTANCE }], statements: [{ parent_id: MARY }],
    payments: [{ parent_id: MARY, period: '2026-10-01', voided_at: null, lines: [{ student_id: CONSTANCE, session_id: 1 }] },
      { parent_id: MARY, period: null, voided_at: null, lines: [] }, { parent_id: JIN, period: '2026-09-01', voided_at: '2026-09-30', lines: [] }],
    payouts: [{ tutor_id: DANIEL, kind: 'tutor', period_start: '2026-09-27', voided_at: null }, { tutor_id: DANIEL, kind: 'opening', period_start: '2026-09-13', voided_at: null }],
    billing_adjustments: [{ party_id: MARY }],
    billing_settings: [{ id: 1, payroll_anchor: '2026-09-27' }],
    session_edits: [{ student_id: CONSTANCE, tutor_id: DANIEL }, { student_id: MAYA, tutor_id: 'other-tutor' }],
  });

  test('lessons of a person, as a student or a tutor', async () => {
    const repo = createDeleteRepo(fakeSupabase(world()));
    expect((await repo.sessionsOf(CONSTANCE)).map((s) => s.id)).toEqual([1]);
    expect((await repo.sessionsOf(DANIEL)).map((s) => s.id)).toEqual([1, 2]);
  });

  test('counts of what hangs off a student', async () => {
    const repo = createDeleteRepo(fakeSupabase(world()));
    expect(await repo.countsOf(CONSTANCE)).toEqual({
      assignments: 2, tasks: 3, submissions: 3, drafts: 1, updates: 1, notes: 2, series: 1, family_rates: 1, tutor_rates: 0,
      tutor_links: 1, parent_links: 2, invites: 1, statements: 0,
    });
    expect(await repo.countsOf(DANIEL)).toMatchObject({ family_rates: 1, tutor_rates: 1, tutor_links: 2, series: 1 });
    expect((await repo.countsOf(MARY)).statements).toBe(1);
  });

  test('the money rows that restrict a delete', async () => {
    const repo = createDeleteRepo(fakeSupabase(world()));
    expect(await repo.billingRefs(MARY)).toEqual({ payments: 2, payouts: 0, adjustments: 1 });
    expect(await repo.billingRefs(DANIEL)).toEqual({ payments: 0, payouts: 2, adjustments: 0 });
    expect(await repo.billingRefs(JIN)).toEqual({ payments: 1, payouts: 0, adjustments: 0 }); // a voided payment still restricts
    expect(await repo.billingRefs(CONSTANCE)).toEqual({ payments: 0, payouts: 0, adjustments: 0 });
  });

  test('billing facts: the paying parent, live payments with a month, live tutor payouts, the anchor', async () => {
    const repo = createDeleteRepo(fakeSupabase(world()));
    const facts = await repo.billingFacts([sessionRow(1, CONSTANCE, DANIEL)]);
    expect(facts.payerOf).toEqual({ [CONSTANCE]: MARY });
    expect(facts.payments).toEqual([{ parent_id: MARY, period: '2026-10-01' }]);
    expect(facts.payouts).toEqual([{ tutor_id: DANIEL, period_start: '2026-09-27' }]); // not the opening balance
    expect(facts.anchor).toBe('2026-09-27');
    expect(paidSessionCount({ ...facts, sessions: [sessionRow(1, CONSTANCE, DANIEL)] })).toBe(1);
  });

  test('payments that name a student', async () => {
    const repo = createDeleteRepo(fakeSupabase(world()));
    expect(await repo.paymentsNaming(CONSTANCE)).toBe(1);
    expect(await repo.paymentsNaming(MAYA)).toBe(0);
  });

  test('billing tables that do not exist yet mean no billing: nothing counted, nothing refused', async () => {
    const t = world();
    for (const name of ['payments', 'payouts', 'billing_adjustments', 'billing_settings', 'statements', 'family_rates', 'tutor_rates', 'session_edits', 'student_notes']) delete t[name];
    const repo = createDeleteRepo(fakeSupabase(t));
    expect(await repo.billingRefs(MARY)).toEqual({ payments: 0, payouts: 0, adjustments: 0 });
    expect(await repo.billingFacts([sessionRow(1, CONSTANCE, DANIEL)])).toMatchObject({ payments: [], payouts: [] });
    expect(await repo.paymentsNaming(CONSTANCE)).toBe(0);
    expect((await repo.countsOf(CONSTANCE)).notes).toBe(0);
    await expect(repo.deleteSessionEdits(CONSTANCE)).resolves.toBeUndefined();
  });

  test('any other database error is thrown, not read as zero', async () => {
    const db = fakeSupabase(world());
    const real = db.from;
    db.from = (t) => {
      const q = real(t);
      if (t === 'payments') q.run = () => ({ data: null, count: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
      return q;
    };
    await expect(createDeleteRepo(db).billingRefs(MARY)).rejects.toThrow('statement timeout');
  });

  test('files: homework in their own folder, materials of theirs and of their lessons, and what the folders hold', async () => {
    const db = fakeSupabase(world(), {
      [HOMEWORK_BUCKET]: [`${CONSTANCE}/a.pdf`, `${CONSTANCE}/orphan.png`],
      [MATERIALS_BUCKET]: [`${CONSTANCE}/m1.pdf`, `${CONSTANCE}/orphan.docx`, `${MAYA}/other.pptx`],
    });
    const repo = createDeleteRepo(db);
    const student = await repo.filesOf(CONSTANCE, []);
    expect(student.homework.sort()).toEqual([`${CONSTANCE}/a.pdf`, `${CONSTANCE}/orphan.png`]); // not a path in another folder
    expect(student.materials.sort()).toEqual([`${CONSTANCE}/m1.pdf`, `${CONSTANCE}/orphan.docx`]);
    // a tutor's lessons: the materials on them sit in their students' folders
    const tutor = await repo.filesOf(DANIEL, [1, 2]);
    expect(tutor.materials).toEqual([`${MAYA}/lesson.pptx`]);
  });

  test('files: the person\'s own photo folder, and nobody else\'s', async () => {
    const db = fakeSupabase(world(), { [AVATARS_BUCKET]: [`${CONSTANCE}/aaaaaaaaaaaaaaaa.webp`, `${MAYA}/bbbbbbbbbbbbbbbb.webp`] });
    expect((await createDeleteRepo(db).filesOf(CONSTANCE, [])).avatars).toEqual([`${CONSTANCE}/aaaaaaaaaaaaaaaa.webp`]);
  });

  test('files: no avatars bucket yet (the migration has not run) is no photos, not an error', async () => {
    const db = fakeSupabase(world());
    const real = db.storage.from;
    db.storage.from = (bucket) => (bucket === AVATARS_BUCKET
      ? { list: async () => ({ data: null, error: { message: 'Bucket not found' } }) }
      : real(bucket));
    expect((await createDeleteRepo(db).filesOf(CONSTANCE, [])).avatars).toEqual([]);
  });

  test('files: a long folder is listed a page at a time', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => `${CONSTANCE}/f${i}.pdf`);
    const repo = createDeleteRepo(fakeSupabase(world(), { [HOMEWORK_BUCKET]: many }));
    expect((await repo.filesOf(CONSTANCE, [])).homework).toHaveLength(2500 + 1); // plus the one in the answers
  });

  test('removing files: a hundred a request, and the count', async () => {
    const db = fakeSupabase(world());
    const repo = createDeleteRepo(db);
    const paths = Array.from({ length: 250 }, (_, i) => `${CONSTANCE}/f${i}`);
    expect(await repo.removeFiles(HOMEWORK_BUCKET, paths)).toBe(250);
    expect(db.removedPaths.map(([bucket, part]) => [bucket, part.length])).toEqual([[HOMEWORK_BUCKET, 100], [HOMEWORK_BUCKET, 100], [HOMEWORK_BUCKET, 50]]);
    expect(await repo.removeFiles(MATERIALS_BUCKET, [])).toBe(0);
    expect(db.removedPaths).toHaveLength(3);
  });

  test('removing files: a storage error is thrown', async () => {
    const db = fakeSupabase(world());
    db.storage.from = () => ({ remove: async () => ({ data: null, error: { message: 'nope' } }) });
    await expect(createDeleteRepo(db).removeFiles(HOMEWORK_BUCKET, ['a'])).rejects.toThrow('remove homework: nope');
  });

  test('who would pay next: the earliest of the other linked parents, or no one', async () => {
    const repo = createDeleteRepo(fakeSupabase(world()));
    expect(await repo.payerMoves(MARY)).toEqual([
      { student_id: CONSTANCE, next_parent_id: JIN },
      { student_id: MAYA, next_parent_id: null },
    ]);
    expect(await repo.payerMoves(JIN)).toEqual([]); // Jin pays for nobody
  });

  test('setPayer makes the parent pay, unless someone already does', async () => {
    const t = world();
    const repo = createDeleteRepo(fakeSupabase(t));
    await repo.setPayer(CONSTANCE, JIN);
    expect(t.parent_students.find((l) => l.parent_id === JIN).bills).toBe(false); // Mary still pays
    t.parent_students = t.parent_students.filter((l) => l.parent_id !== MARY);
    await repo.setPayer(CONSTANCE, JIN);
    expect(t.parent_students.find((l) => l.parent_id === JIN).bills).toBe(true);
  });

  test('the audit rows of their lessons go; other people’s stay', async () => {
    const t = world();
    await createDeleteRepo(fakeSupabase(t)).deleteSessionEdits(CONSTANCE);
    expect(t.session_edits).toEqual([{ student_id: MAYA, tutor_id: 'other-tutor' }]);
  });

  test('names by id', async () => {
    const repo = createDeleteRepo(fakeSupabase({ profiles: [{ id: MAYA, full_name: 'Maya Chen' }, { id: LEO, full_name: 'Leo Park' }] }));
    expect(await repo.namesOf([MAYA, MAYA, LEO])).toEqual({ [MAYA]: 'Maya Chen', [LEO]: 'Leo Park' });
    expect(await repo.namesOf([])).toEqual({});
  });

  test('the people repo carries these methods beside its own', () => {
    const repo = createPeopleRepo(fakeSupabase(world()));
    for (const name of ['sessionsOf', 'countsOf', 'billingRefs', 'billingFacts', 'filesOf', 'removeFiles', 'payerMoves', 'findInvite', 'childrenOf', 'getProfile']) {
      expect(typeof repo[name], name).toBe('function');
    }
  });
});

describe('the endpoint', () => {
  test('api/people.js loads with its Google and delete wiring, and says so when it is not configured', async () => {
    const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const { POST } = await import('../../api/people.js');
      const res = await POST(post({ action: 'delete_person', id: CONSTANCE, confirm_name: 'Constance Lin' }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'not_configured' });
    } finally {
      if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
      if (saved.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
    }
  }, 30000); // the first import of api/people.js loads supabase-js, slow when the whole suite runs
});
