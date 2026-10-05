import { describe, test, expect, vi } from 'vitest';
import {
  validateReferral, looksAutomated, addressHash, handleReferral,
  PER_ADDRESS_PER_HOUR, ALL_PER_DAY, MIN_FILL_MS,
} from '../../api/_lib/referral.js';
import { sortReferrals, groupReferrals, referrerLine, languageName } from '../../portal/js/referrals-model.js';

const good = (over = {}) => ({
  referrer_name: '  Grace   Lin ',
  referrer_email: 'Grace@Example.com',
  referrer_role: 'parent',
  family_name: 'The Parks',
  family_email: 'park@example.com',
  family_phone: '',
  grade: '7th grade',
  subjects: 'Algebra',
  note: 'They need help\r\nbefore finals',
  consent: true,
  language: 'ko',
  ...over,
});

describe('validateReferral', () => {
  test('cleans a good referral into a row', () => {
    const { ok, row } = validateReferral(good());
    expect(ok).toBe(true);
    expect(row).toEqual({
      referrer_name: 'Grace Lin', referrer_email: 'grace@example.com', referrer_role: 'parent',
      family_name: 'The Parks', family_email: 'park@example.com', family_phone: null,
      grade: '7th grade', subjects: 'Algebra', note: 'They need help\nbefore finals', language: 'ko',
    });
  });

  test('a phone alone is enough to reach the family', () => {
    expect(validateReferral(good({ family_email: '', family_phone: '(626) 555-0101' })).ok).toBe(true);
  });

  test('names each problem with a code', () => {
    const { ok, errors } = validateReferral({ referrer_email: 'nope', family_phone: 'call me', referrer_role: 'tutor' });
    expect(ok).toBe(false);
    expect(errors).toMatchObject({
      referrer_name: 'required', referrer_email: 'email', referrer_role: 'required',
      family_name: 'required', family_phone: 'phone', consent: 'required',
    });
  });

  test('needs an email or a phone for the family, and the consent box', () => {
    const { errors } = validateReferral(good({ family_email: '', family_phone: '', consent: false }));
    expect(errors.family_contact).toBe('required');
    expect(errors.consent).toBe('required');
  });

  test('refuses over-long fields and keeps unknown languages as English', () => {
    const { errors } = validateReferral(good({ note: 'x'.repeat(1001), subjects: 'y'.repeat(301) }));
    expect(errors).toMatchObject({ note: 'too_long', subjects: 'too_long' });
    expect(validateReferral(good({ language: 'de' })).row.language).toBe('en');
  });

  test('accepts the plain form post values for consent', () => {
    expect(validateReferral(good({ consent: 'on' })).ok).toBe(true);
  });
});

describe('spam checks', () => {
  test('the hidden field or a form sent too fast looks automated', () => {
    const now = 1_000_000;
    expect(looksAutomated({ website: 'http://spam' }, now)).toBe(true);
    expect(looksAutomated({ started: String(now - MIN_FILL_MS + 1) }, now)).toBe(true);
    expect(looksAutomated({ started: String(now - MIN_FILL_MS) }, now)).toBe(false);
    expect(looksAutomated({}, now)).toBe(false);
  });

  test('the address is stored only as a keyed hash', () => {
    const req = new Request('https://x.test/api/referral', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
    const hash = addressHash(req, 'secret');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203');
    expect(addressHash(req, 'other')).not.toBe(hash);
  });
});

describe('handleReferral', () => {
  const repo = (mine = 0, all = 0) => ({
    countSince: vi.fn(async ({ ipHash }) => (ipHash ? mine : all)),
    insert: vi.fn(async () => {}),
  });
  const post = (body, type = 'application/json') => new Request('https://x.test/api/referral', {
    method: 'POST',
    headers: { 'content-type': type, 'x-forwarded-for': '198.51.100.7' },
    body: type === 'application/json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  const env = { CRON_SECRET: 'k' };
  const now = () => 2_000_000;

  test('saves a good referral with the address hash and answers 201', async () => {
    const r = repo();
    const res = await handleReferral(post(good({ started: '1' })), { repo: r, env, now });
    expect(res.status).toBe(201);
    expect(r.insert).toHaveBeenCalledTimes(1);
    expect(r.insert.mock.calls[0][0]).toMatchObject({ family_name: 'The Parks', ip_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  test('answers 422 with the field codes and saves nothing', async () => {
    const r = repo();
    const res = await handleReferral(post({ referrer_name: 'x' }), { repo: r, env, now });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.referrer_email).toBe('required');
    expect(r.insert).not.toHaveBeenCalled();
  });

  test('tells a bot it worked and saves nothing', async () => {
    const r = repo();
    const res = await handleReferral(post(good({ website: 'spam.example' })), { repo: r, env, now });
    expect(res.status).toBe(200);
    expect(r.insert).not.toHaveBeenCalled();
  });

  test('rate-limits one address per hour and everyone per day', async () => {
    const one = repo(PER_ADDRESS_PER_HOUR, 0);
    expect((await handleReferral(post(good()), { repo: one, env, now })).status).toBe(429);
    const all = repo(0, ALL_PER_DAY);
    expect((await handleReferral(post(good()), { repo: all, env, now })).status).toBe(429);
    expect(one.insert).not.toHaveBeenCalled();
    expect(all.insert).not.toHaveBeenCalled();
  });

  test('a plain form post is redirected back to the form', async () => {
    const r = repo();
    const ok = await handleReferral(post({ ...good(), consent: 'on' }, 'application/x-www-form-urlencoded'), { repo: r, env, now });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/?referral=sent#refer');
    const bad = await handleReferral(post({ referrer_name: 'x' }, 'application/x-www-form-urlencoded'), { repo: r, env, now });
    expect(bad.headers.get('location')).toBe('/?referral=error#refer');
  });

  test('refuses a body that is too large', async () => {
    const res = await handleReferral(post(good({ note: 'x'.repeat(20_000) })), { repo: repo(), env, now });
    expect(res.status).toBe(413);
  });
});

describe('the admin list', () => {
  const list = [
    { id: 1, status: 'contacted', created_at: '2026-10-01T10:00:00Z' },
    { id: 2, status: 'new', created_at: '2026-10-03T10:00:00Z' },
    { id: 3, status: 'new', created_at: '2026-10-02T10:00:00Z' },
  ];

  test('puts new referrals first, newest first', () => {
    expect(sortReferrals(list).map((r) => r.id)).toEqual([2, 3, 1]);
    const { fresh, contacted } = groupReferrals(list);
    expect(fresh.map((r) => r.id)).toEqual([2, 3]);
    expect(contacted.map((r) => r.id)).toEqual([1]);
  });

  test('says who referred and in which language', () => {
    expect(referrerLine({ referrer_name: 'Amy', referrer_role: 'student' })).toBe('Referred by Amy, a student');
    expect(referrerLine({ referrer_name: 'Ryan', referrer_role: 'parent' })).toBe('Referred by Ryan, a parent');
    expect(languageName('ko')).toBe('Korean');
    expect(languageName(undefined)).toBe('English');
  });
});
