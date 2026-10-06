import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// api/referral.js is one function with three jobs: the JSON referral and
// consultation forms, those same forms posted natively (no JavaScript), and the
// confirm button on an Approve or Decline page. These tests go through its POST
// entry point with a stand-in database, so the routing between the three is what
// is tested. (handleReferral and handleReviewPost have their own tests.)

const world = vi.hoisted(() => ({ inserts: [], decisions: [], pending: [], review: { id: 7, status: 'new', family_name: 'The Parks', referrer_name: 'Grace' } }));

vi.mock('@vercel/functions', () => ({ waitUntil: (p) => world.pending.push(p) }));
vi.mock('../../api/_lib/supabase.js', () => ({
  adminClient: () => ({
    from: () => ({
      // rate-limit counts: nothing sent yet
      select: () => {
        const query = {
          gte: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: world.review, error: null }),
          then: (resolve) => resolve({ count: 0, error: null }),
        };
        return query;
      },
      insert: (row) => {
        world.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 11 }, error: null }) }) };
      },
      update: (changes) => {
        const query = {
          eq: () => query,
          select: () => ({ maybeSingle: async () => { world.decisions.push(changes.status); return { data: { ...world.review, status: changes.status }, error: null }; } }),
        };
        return query;
      },
    }),
  }),
}));

const { POST } = await import('../../api/referral.js');
const { reviewQuery } = await import('../../api/_lib/referral-review.js');

const formPost = (fields) => new Request('https://x.test/api/referral', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '198.51.100.7' },
  body: new URLSearchParams(fields).toString(),
});

const savedEnv = { cron: process.env.CRON_SECRET, resend: process.env.RESEND_API_KEY };
beforeEach(() => {
  world.inserts.length = 0;
  world.decisions.length = 0;
  world.pending.length = 0;
  process.env.CRON_SECRET = 'entry-test-secret';
  delete process.env.RESEND_API_KEY;
});
afterEach(() => {
  for (const [name, value] of [['CRON_SECRET', savedEnv.cron], ['RESEND_API_KEY', savedEnv.resend]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

describe('a form posted without JavaScript', () => {
  test('the booking form is saved and the visitor is sent back to it', async () => {
    const res = await formPost({
      kind: 'consultation', name: 'Grace Lin', email: 'grace@example.com', phone: '', grade: '9th grade', language: 'zh',
      subjects: 'Algebra 2', lessons: 'online', contact_pref: 'email', note: '', website: '',
    });
    const answer = await POST(res);
    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe('/?consultation=sent#book');
    await Promise.all(world.pending);
    expect(world.inserts).toHaveLength(1);
    expect(world.inserts[0]).toMatchObject({ kind: 'consultation', family_name: 'Grace Lin', lessons: 'online', language: 'zh' });
  });

  test('a booking form with something missing goes back with an error and saves nothing', async () => {
    const answer = await POST(formPost({ kind: 'consultation', name: 'Grace Lin', email: 'grace@example.com', subjects: '' }));
    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe('/?consultation=error#book');
    expect(world.inserts).toHaveLength(0);
  });

  test('the referral form is saved and the visitor is sent back to it', async () => {
    const answer = await POST(formPost({
      referrer_name: 'Grace Lin', referrer_email: 'grace@example.com', referrer_role: 'parent',
      family_name: 'The Parks', family_email: 'park@example.com', family_phone: '', grade: '', subjects: '', note: '',
      consent: 'on', website: '', language: 'en',
    }));
    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe('/?referral=sent#refer');
    expect(world.inserts).toHaveLength(1);
    expect(world.inserts[0]).toMatchObject({ family_name: 'The Parks' });
    expect(world.inserts[0]).not.toHaveProperty('kind');
  });
});

describe('the confirm button on an Approve or Decline page', () => {
  test('still reaches the decision handler, and a form post never saves a request', async () => {
    const link = reviewQuery({ id: 7, action: 'approve', now: Date.now() }, process.env);
    const answer = await POST(formPost(Object.fromEntries(new URLSearchParams(link))));
    expect(answer.headers.get('content-type')).toContain('text/html');
    expect(await answer.text()).toContain('is approved');
    expect(world.decisions).toEqual(['approved']);
    expect(world.inserts).toHaveLength(0);
  });

  test('a changed link gets the "link does not work" page, not a saved request', async () => {
    const link = Object.fromEntries(new URLSearchParams(reviewQuery({ id: 7, action: 'approve', now: Date.now() }, process.env)));
    const answer = await POST(formPost({ ...link, action: 'decline' }));
    expect(answer.status).toBe(400);
    expect(world.decisions).toEqual([]);
    expect(world.inserts).toHaveLength(0);
  });
});

describe('JSON', () => {
  test('a booking request posted as JSON is saved and answered with 201', async () => {
    const answer = await POST(new Request('https://x.test/api/referral', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
      body: JSON.stringify({ kind: 'consultation', name: 'Grace', email: 'g@example.com', subjects: 'Math', elapsed: 4000 }),
    }));
    expect(answer.status).toBe(201);
    expect(world.inserts[0]).toMatchObject({ kind: 'consultation', family_email: 'g@example.com' });
  });
});
