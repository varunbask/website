import { describe, test, expect, vi } from 'vitest';
import {
  validateReferral, validateConsultation, looksAutomated, addressHash, handleReferral, createReferralRepo,
  PER_ADDRESS_PER_HOUR, ALL_PER_DAY, MIN_FILL_MS, MIN_FILL_MS_CONSULTATION,
} from '../../api/_lib/referral.js';
import { buildReferralEmail, buildConsultationEmail, sendReferralEmail } from '../../api/_lib/referral-mail.js';
import {
  sortReferrals, groupReferrals, referrerLine, languageName,
  isConsultation, kindLabel, lessonsLabel, contactPrefLabel, decisionWords,
} from '../../portal/js/referrals-model.js';

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

const goodConsult = (over = {}) => ({
  kind: 'consultation',
  name: '  Grace   Lin ',
  email: 'Grace@Example.com',
  phone: '(626) 555-0101',
  grade: '9th grade',
  language: 'zh',
  subjects: 'Algebra 2 and SAT prep',
  lessons: 'in_person',
  contact_pref: 'text',
  note: 'After 4pm\r\nplease',
  ...over,
});

describe('validateConsultation', () => {
  test('cleans a good request into a row, with the requester as both referrer and family', () => {
    const { ok, errors, row } = validateConsultation(goodConsult());
    expect(ok).toBe(true);
    expect(errors).toEqual({});
    expect(row).toEqual({
      kind: 'consultation',
      referrer_name: 'Grace Lin', referrer_email: 'grace@example.com', referrer_role: 'parent',
      family_name: 'Grace Lin', family_email: 'grace@example.com', family_phone: '(626) 555-0101',
      grade: '9th grade', subjects: 'Algebra 2 and SAT prep', note: 'After 4pm\nplease',
      language: 'zh', contact_pref: 'text', lessons: 'in_person',
    });
  });

  test('only the name, the email and the subjects are needed', () => {
    const { ok, row } = validateConsultation({ name: 'Grace', email: 'g@example.com', subjects: 'Math' });
    expect(ok).toBe(true);
    expect(row).toMatchObject({
      kind: 'consultation', family_phone: null, grade: null, note: null, contact_pref: null, lessons: null, language: 'en',
    });
  });

  test('names each missing or bad field with a code', () => {
    const { ok, errors } = validateConsultation({ kind: 'consultation', email: 'nope', phone: 'call me', lessons: 'moon', contact_pref: 'pigeon' });
    expect(ok).toBe(false);
    expect(errors).toEqual({
      name: 'required', email: 'email', phone: 'phone', subjects: 'required', lessons: 'required', contact_pref: 'required',
    });
    expect(validateConsultation({}).errors).toMatchObject({ name: 'required', email: 'required', subjects: 'required' });
  });

  test('a phone call or a text needs a phone number; the other ways do not', () => {
    for (const pref of ['phone', 'text']) {
      expect(validateConsultation(goodConsult({ phone: '', contact_pref: pref })).errors).toEqual({ phone: 'phone_needed' });
    }
    for (const pref of ['email', 'wechat', 'kakaotalk']) {
      expect(validateConsultation(goodConsult({ phone: '', contact_pref: pref })).ok).toBe(true);
    }
  });

  test('refuses over-long fields and keeps unknown languages as English', () => {
    const { errors } = validateConsultation(goodConsult({ name: 'n'.repeat(121), grade: 'g'.repeat(41), subjects: 's'.repeat(301), note: 'x'.repeat(1001) }));
    expect(errors).toEqual({ name: 'too_long', grade: 'too_long', subjects: 'too_long', note: 'too_long' });
    expect(validateConsultation(goodConsult({ language: 'de' })).row.language).toBe('en');
  });

  test('every row it makes satisfies the referrals table: a family email, a parent or student role', () => {
    const { row } = validateConsultation(goodConsult({ phone: '' }));
    expect(row.family_email || row.family_phone).toBeTruthy();
    expect(['parent', 'student']).toContain(row.referrer_role);
    expect(row.subjects.length).toBeLessThanOrEqual(300);
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

  test('the page times itself from the first touch, and its own clock decides', () => {
    const now = 1_000_000;
    expect(looksAutomated({ elapsed: MIN_FILL_MS - 1 }, now)).toBe(true);
    expect(looksAutomated({ elapsed: MIN_FILL_MS }, now)).toBe(false);
    expect(looksAutomated({ elapsed: '2000' }, now)).toBe(true);
    // a device clock that is wrong changes nothing: elapsed wins over started
    expect(looksAutomated({ elapsed: 9000, started: String(now + 60_000) }, now)).toBe(false);
    expect(looksAutomated({ elapsed: 100, started: String(now - 60_000) }, now)).toBe(true);
    // no timing at all (no JavaScript) is let through
    expect(looksAutomated({ elapsed: '' }, now)).toBe(false);
  });

  test('the booking form asks for less time than the referral form', () => {
    const now = 1_000_000;
    expect(MIN_FILL_MS_CONSULTATION).toBe(1500);
    expect(looksAutomated({ elapsed: 2000 }, now, MIN_FILL_MS_CONSULTATION)).toBe(false);
    expect(looksAutomated({ elapsed: 1499 }, now, MIN_FILL_MS_CONSULTATION)).toBe(true);
    expect(looksAutomated({ elapsed: 2000 }, now)).toBe(true);
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
    insert: vi.fn(async () => 42),
  });
  const post = (body, type = 'application/json') => new Request('https://x.test/api/referral', {
    method: 'POST',
    headers: { 'content-type': type, 'x-forwarded-for': '198.51.100.7' },
    body: type === 'application/json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  const env = { CRON_SECRET: 'k' };
  const now = () => 2_000_000;

  test('emails the owner after saving, with the new id, and a failed email loses nothing', async () => {
    const r = repo();
    const notify = vi.fn(async () => { throw new Error('Resend down'); });
    const pending = [];
    const res = await handleReferral(post(good()), { repo: r, env, now, notify, waitUntil: (p) => pending.push(p) });
    expect(res.status).toBe(201);
    await Promise.all(pending);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ family_name: 'The Parks' }), 42);
  });

  test('a bot never triggers an email', async () => {
    const notify = vi.fn();
    await handleReferral(post(good({ website: 'x' })), { repo: repo(), env, now, notify });
    expect(notify).not.toHaveBeenCalled();
  });

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

  test('a referral is saved without the consultation columns, so it still works before they exist', async () => {
    const r = repo();
    await handleReferral(post(good()), { repo: r, env, now });
    const saved = r.insert.mock.calls[0][0];
    expect(saved).not.toHaveProperty('kind');
    expect(saved).not.toHaveProperty('lessons');
    expect(saved).not.toHaveProperty('contact_pref');
  });
});

describe('handleReferral with a consultation request', () => {
  const repo = (mine = 0, all = 0) => ({
    countSince: vi.fn(async ({ ipHash }) => (ipHash ? mine : all)),
    insert: vi.fn(async () => 7),
  });
  const post = (body, type = 'application/json') => new Request('https://x.test/api/referral', {
    method: 'POST',
    headers: { 'content-type': type, 'x-forwarded-for': '198.51.100.7' },
    body: type === 'application/json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  const env = { CRON_SECRET: 'k' };
  const now = () => 2_000_000;

  test('saves it as a consultation with the address hash and answers 201', async () => {
    const r = repo();
    const res = await handleReferral(post(goodConsult({ started: '1' })), { repo: r, env, now });
    expect(res.status).toBe(201);
    expect(r.insert).toHaveBeenCalledTimes(1);
    expect(r.insert.mock.calls[0][0]).toMatchObject({
      kind: 'consultation', family_name: 'Grace Lin', family_email: 'grace@example.com',
      lessons: 'in_person', contact_pref: 'text', ip_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test('answers 422 with the field codes and saves nothing when fields are missing', async () => {
    const r = repo();
    const res = await handleReferral(post({ kind: 'consultation', name: 'Grace' }), { repo: r, env, now });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual({ email: 'required', subjects: 'required' });
    expect(r.insert).not.toHaveBeenCalled();
  });

  test('a referral-shaped body is not a consultation without the kind', async () => {
    const r = repo();
    const res = await handleReferral(post(goodConsult({ kind: undefined })), { repo: r, env, now });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toHaveProperty('referrer_name');
  });

  test('emails the owner a consultation row after saving, and a bot triggers nothing', async () => {
    const r = repo();
    const notify = vi.fn(async () => {});
    const pending = [];
    await handleReferral(post(goodConsult()), { repo: r, env, now, notify, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'consultation', family_name: 'Grace Lin' }), 7);

    const quiet = vi.fn();
    const res = await handleReferral(post(goodConsult({ website: 'spam.example' })), { repo: r, env, now, notify: quiet });
    expect(res.status).toBe(200);
    expect(quiet).not.toHaveBeenCalled();
    expect(r.insert).toHaveBeenCalledTimes(1);
  });

  test('has its own rate limits, counted per kind so referrals never use them up', async () => {
    const one = repo(PER_ADDRESS_PER_HOUR, 0);
    expect((await handleReferral(post(goodConsult()), { repo: one, env, now })).status).toBe(429);
    const all = repo(0, ALL_PER_DAY);
    expect((await handleReferral(post(goodConsult()), { repo: all, env, now })).status).toBe(429);
    expect(one.insert).not.toHaveBeenCalled();
    expect(all.insert).not.toHaveBeenCalled();

    const r = repo();
    await handleReferral(post(goodConsult()), { repo: r, env, now });
    expect(r.countSince.mock.calls.map(([q]) => q.kind)).toEqual(['consultation', 'consultation']);
    const referrals = repo();
    await handleReferral(post({ referrer_name: 'x', referrer_email: 'x@example.com', referrer_role: 'parent', family_name: 'F', family_email: 'f@example.com', consent: true }), { repo: referrals, env, now });
    expect(referrals.countSince.mock.calls.map(([q]) => q.kind)).toEqual(['referral', 'referral']);
  });

  test('an honest quick fill passes: the booking form only needs 1.5 seconds', async () => {
    const r = repo();
    expect((await handleReferral(post(goodConsult({ elapsed: 1600 })), { repo: r, env, now })).status).toBe(201);
    const bot = repo();
    const res = await handleReferral(post(goodConsult({ elapsed: 400 })), { repo: bot, env, now });
    expect(res.status).toBe(200);   // told it worked, nothing saved
    expect(bot.insert).not.toHaveBeenCalled();
  });

  test('a plain form post is redirected back to the booking form', async () => {
    const r = repo();
    const ok = await handleReferral(post(goodConsult(), 'application/x-www-form-urlencoded'), { repo: r, env, now });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/?consultation=sent#book');
    const bad = await handleReferral(post({ kind: 'consultation', name: 'x' }, 'application/x-www-form-urlencoded'), { repo: r, env, now });
    expect(bad.headers.get('location')).toBe('/?consultation=error#book');
    const busy = await handleReferral(post(goodConsult(), 'application/x-www-form-urlencoded'), { repo: repo(PER_ADDRESS_PER_HOUR), env, now });
    expect(busy.headers.get('location')).toBe('/?consultation=busy#book');
  });
});

describe('createReferralRepo.countSince', () => {
  // A stand-in for the Supabase query: records its filters, answers with count or error
  const fakeDb = (answer) => {
    const calls = [];
    const db = {
      from: () => ({
        select: () => {
          const filters = [];
          const query = {
            gte: () => query,
            eq: (column, value) => { filters.push([column, value]); return query; },
            then: (resolve) => { calls.push(filters); resolve(answer(filters)); },
          };
          return query;
        },
      }),
    };
    return { db, calls };
  };

  test('counts one kind, for one address when given', async () => {
    const { db, calls } = fakeDb(() => ({ count: 3, error: null }));
    expect(await createReferralRepo(db).countSince({ ipHash: 'h', since: new Date(0), kind: 'consultation' })).toBe(3);
    expect(calls).toEqual([[['ip_hash', 'h'], ['kind', 'consultation']]]);
  });

  test('counts every row when no kind is given', async () => {
    const { db, calls } = fakeDb(() => ({ count: 0, error: null }));
    await createReferralRepo(db).countSince({ since: new Date(0) });
    expect(calls).toEqual([[]]);
  });

  test('before the kind column exists the count is tried again without it, so referrals keep working', async () => {
    const { db, calls } = fakeDb((filters) => (filters.some(([c]) => c === 'kind')
      ? { count: null, error: { message: '' } }
      : { count: 2, error: null }));
    expect(await createReferralRepo(db).countSince({ since: new Date(0), kind: 'referral' })).toBe(2);
    expect(calls).toHaveLength(2);
  });

  test('an error that stays is thrown', async () => {
    const { db } = fakeDb(() => ({ count: null, error: { message: 'down' } }));
    await expect(createReferralRepo(db).countSince({ since: new Date(0), kind: 'referral' })).rejects.toThrow('countSince: down');
  });
});

describe('the consultation email', () => {
  const env = { CRON_SECRET: 'cron-secret', SITE_URL: 'https://www.varunbaskaran.com' };
  const row = validateConsultation(goodConsult({ name: 'Grace <b>Lin</b>', note: 'Call after 5 & on weekends' })).row;

  test('has its own subject and body, with no approve or decline links', () => {
    const mail = buildConsultationEmail(row, { env });
    expect(mail.subject).toBe('New consultation request: Grace <b>Lin</b>');
    expect(mail.text).toContain('New consultation request from the website.');
    expect(mail.text).toContain("Student's grade: 9th grade");
    expect(mail.text).toContain('Lessons: In person (San Gabriel Valley area)');
    expect(mail.text).toContain('Best way to reach: Text message');
    expect(mail.text).toContain('Preferred language: Chinese');
    expect(mail.text).toContain('https://www.varunbaskaran.com/portal/people.html#/referrals');
    expect(mail.text + mail.html).not.toMatch(/approve|decline/i);
  });

  test('escapes what the visitor typed, and replies go to them', () => {
    const mail = buildConsultationEmail(row, { env });
    expect(mail.html).toContain('Grace &lt;b&gt;Lin&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Lin');
    expect(mail.html).toContain('Call after 5 &amp; on weekends');
    expect(mail.replyTo).toBe('grace@example.com');
  });

  test('the referral email builder hands a consultation row over, and a referral keeps its own', () => {
    expect(buildReferralEmail(row, 3, { env }).subject).toMatch(/^New consultation request:/);
    const referral = validateReferral(good()).row;
    const mail = buildReferralEmail(referral, 3, { env });
    expect(mail.subject).toBe('New referral: The Parks');
    expect(mail.text).toContain('Approve: ');
  });

  test('is sent through Resend with the consultation subject', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await sendReferralEmail(row, 3, { env: { ...env, RESEND_API_KEY: 'k' }, fetchImpl })).toBe('sent');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.subject).toMatch(/^New consultation request:/);
    expect(body.reply_to).toBe('grace@example.com');
  });
});

describe('the admin list', () => {
  const list = [
    { id: 1, status: 'approved', created_at: '2026-10-01T10:00:00Z' },
    { id: 4, status: 'declined', created_at: '2026-09-30T10:00:00Z' },
    { id: 2, status: 'new', created_at: '2026-10-03T10:00:00Z' },
    { id: 3, status: 'new', created_at: '2026-10-02T10:00:00Z' },
  ];

  test('groups New, Approved and Declined, each newest first', () => {
    expect(sortReferrals(list).map((r) => r.id)).toEqual([2, 3, 1, 4]);
    const { fresh, approved, declined } = groupReferrals(list);
    expect(fresh.map((r) => r.id)).toEqual([2, 3]);
    expect(approved.map((r) => r.id)).toEqual([1]);
    expect(declined.map((r) => r.id)).toEqual([4]);
  });

  test('says who referred and in which language', () => {
    expect(referrerLine({ referrer_name: 'Amy', referrer_role: 'student' })).toBe('Referred by Amy, a student');
    expect(referrerLine({ referrer_name: 'Ryan', referrer_role: 'parent' })).toBe('Referred by Ryan, a parent');
    expect(languageName('ko')).toBe('Korean');
    expect(languageName(undefined)).toBe('English');
  });
});

describe('the admin list shows consultation requests', () => {
  const consult = { id: 9, kind: 'consultation', status: 'new', created_at: '2026-10-04T10:00:00Z', lessons: 'either', contact_pref: 'kakaotalk' };

  test('labels each row Consultation or Referral; rows from before the kind column are referrals', () => {
    expect(isConsultation(consult)).toBe(true);
    expect(kindLabel(consult)).toBe('Consultation');
    expect(kindLabel({ id: 1, kind: 'referral' })).toBe('Referral');
    expect(kindLabel({ id: 2 })).toBe('Referral');
    expect(isConsultation(undefined)).toBe(false);
  });

  test('says what they asked for in plain words', () => {
    expect(lessonsLabel('online')).toBe('Online');
    expect(lessonsLabel('in_person')).toBe('In person');
    expect(lessonsLabel('either')).toBe('Online or in person');
    expect(lessonsLabel(null)).toBeNull();
    expect(contactPrefLabel('text')).toBe('Text message');
    expect(contactPrefLabel('kakaotalk')).toBe('KakaoTalk');
    expect(contactPrefLabel('pigeon')).toBeNull();
  });

  test('a consultation is marked handled, a referral approved or declined', () => {
    expect(decisionWords(consult).approve).toBe('Mark as handled');
    expect(decisionWords(consult).done.approved).toBe('marked as handled');
    expect(decisionWords({ id: 1 }).approve).toBe('Approve');
    expect(decisionWords({ id: 1 }).done.declined).toBe('declined');
  });

  test('sit in the same New, Approved and Declined groups as referrals', () => {
    const list = [{ id: 1, status: 'new', created_at: '2026-10-01T10:00:00Z' }, consult, { ...consult, id: 10, status: 'approved' }];
    const { fresh, approved } = groupReferrals(list);
    expect(fresh.map((r) => r.id)).toEqual([9, 1]);
    expect(approved.map((r) => r.id)).toEqual([10]);
  });
});
