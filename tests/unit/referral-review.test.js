import { describe, test, expect, vi } from 'vitest';
import {
  signReview, reviewQuery, verifyReview, handleReviewGet, handleReviewPost, LINK_DAYS,
} from '../../api/_lib/referral-review.js';
import { buildReferralEmail, sendReferralEmail, reviewLinks, DEFAULT_TO } from '../../api/_lib/referral-mail.js';

const env = { CRON_SECRET: 'cron-secret', SITE_URL: 'https://www.varunbaskaran.com' };
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const values = (query) => Object.fromEntries(new URLSearchParams(query));

describe('signed review links', () => {
  test('a link verifies for its referral and action until it expires', () => {
    const q = values(reviewQuery({ id: 7, action: 'approve', now: NOW }, env));
    expect(verifyReview(q, { env, now: NOW })).toEqual({ ok: true, id: 7, action: 'approve' });
    expect(verifyReview(q, { env, now: NOW + LINK_DAYS * DAY + 1 }).reason).toBe('expired');
  });

  test('changing the id, the action, the expiry or the signature breaks it', () => {
    const q = values(reviewQuery({ id: 7, action: 'approve', now: NOW }, env));
    for (const bad of [{ ...q, id: '8' }, { ...q, action: 'decline' }, { ...q, exp: String(NOW + 99 * DAY) }, { ...q, t: '0'.repeat(64) }, { ...q, t: 'xyz' }]) {
      expect(verifyReview(bad, { env, now: NOW }).ok).toBe(false);
    }
  });

  test('a link signed with another secret fails, and no secret means not set up', () => {
    const q = values(reviewQuery({ id: 7, action: 'approve', now: NOW }, { CRON_SECRET: 'other' }));
    expect(verifyReview(q, { env, now: NOW }).reason).toBe('invalid');
    expect(verifyReview(q, { env: {}, now: NOW }).reason).toBe('not_configured');
  });

  test('the signature covers the id, the action and the expiry', () => {
    expect(signReview({ id: 1, action: 'approve', exp: 5 }, env)).not.toBe(signReview({ id: 1, action: 'decline', exp: 5 }, env));
  });
});

describe('the review page', () => {
  const referral = (status = 'new') => ({ id: 7, status, family_name: 'The <Parks>', referrer_name: 'Grace' });
  const repo = (status = 'new') => ({
    get: vi.fn(async () => referral(status)),
    decide: vi.fn(async (id, s) => (status === 'new' ? { ...referral(s), status: s } : null)),
  });
  const getReq = (query) => new Request(`https://www.varunbaskaran.com/api/referral-review?${query}`);
  const postReq = (query) => new Request('https://www.varunbaskaran.com/api/referral-review', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: query,
  });
  const q = reviewQuery({ id: 7, action: 'approve', now: NOW }, env);

  test('opening the link only asks to confirm; nothing changes', async () => {
    const r = repo();
    const res = await handleReviewGet(getReq(q), { repo: r, env, now: () => NOW });
    const page = await res.text();
    expect(res.status).toBe(200);
    expect(r.decide).not.toHaveBeenCalled();
    expect(page).toContain('Approve this referral?');
    expect(page).toContain('method="post" action="/api/referral-review"');
    expect(page).toContain('The &lt;Parks&gt;');
    expect(page).not.toContain('<Parks>');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('the button applies it once; a second press says it was already done', async () => {
    const r = repo();
    const res = await handleReviewPost(postReq(q), { repo: r, env, now: () => NOW });
    expect(await res.text()).toContain('is approved');
    expect(r.decide).toHaveBeenCalledWith(7, 'approved');
    const again = await handleReviewPost(postReq(q), { repo: repo('approved'), env, now: () => NOW });
    expect(await again.text()).toContain('Already approved');
  });

  test('a decided referral shows that instead of the button', async () => {
    const res = await handleReviewGet(getReq(q), { repo: repo('declined'), env, now: () => NOW });
    const page = await res.text();
    expect(page).toContain('Already declined');
    expect(page).not.toContain('<form');
  });

  test('a changed or expired link changes nothing', async () => {
    const r = repo();
    const tampered = q.replace('action=approve', 'action=decline');
    expect((await handleReviewPost(postReq(tampered), { repo: r, env, now: () => NOW })).status).toBe(400);
    expect((await handleReviewGet(getReq(q), { repo: r, env, now: () => NOW + 31 * DAY })).status).toBe(400);
    expect(r.decide).not.toHaveBeenCalled();
  });
});

describe('the notification email', () => {
  const row = {
    referrer_name: 'Grace', referrer_email: 'grace@example.com', referrer_role: 'parent',
    family_name: 'The Parks <script>', family_email: null, family_phone: '626-555-0101',
    grade: '7th grade', subjects: null, note: 'Call after 5 & on weekends', language: 'ko',
  };

  test('escapes what the visitor typed and carries signed approve and decline links', () => {
    const mail = buildReferralEmail(row, 42, { env, now: NOW });
    expect(mail.html).toContain('The Parks &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Call after 5 &amp; on weekends');
    expect(mail.text).toContain('Form language: Korean');
    const links = reviewLinks(42, { env, now: NOW });
    const approve = values(new URL(links.approve).search.slice(1));
    expect(verifyReview(approve, { env, now: NOW })).toEqual({ ok: true, id: 42, action: 'approve' });
    expect(links.approve.startsWith('https://www.varunbaskaran.com/api/referral-review?')).toBe(true);
  });

  test('replies go to the family when there is an email, otherwise to the referrer', () => {
    expect(buildReferralEmail(row, 1, { env }).replyTo).toBe('grace@example.com');
    expect(buildReferralEmail({ ...row, family_email: 'park@example.com' }, 1, { env }).replyTo).toBe('park@example.com');
  });

  test('sends through Resend to the business inbox, and skips without a key', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await sendReferralEmail(row, 1, { env: { ...env, RESEND_API_KEY: 'k' }, fetchImpl })).toBe('sent');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body).to).toEqual([DEFAULT_TO]);
    expect(await sendReferralEmail(row, 1, { env, fetchImpl })).toBe('skipped');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('a refusal from Resend is reported', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }));
    await expect(sendReferralEmail(row, 1, { env: { ...env, RESEND_API_KEY: 'k' }, fetchImpl })).rejects.toThrow('403');
  });
});
