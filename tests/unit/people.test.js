import { describe, test, expect, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  handlePeople, placeholderEmail, isPlaceholder, normalizeEmail, normalizeName, inviteLink, inviteProblem, namesText,
  buildInviteEmail, PLACEHOLDER_DOMAIN, createPeopleRepo,
} from '../../api/_lib/people.js';
import { hashToken } from '../../api/_lib/testimonials.js';
import { sendMail } from '../../api/_lib/referral-mail.js';

const NOW = Date.parse('2026-10-05T19:00:00Z');
const TOKEN = 'A'.repeat(43);
const ENV = { SITE_URL: 'https://www.varunbaskaran.com', RESEND_API_KEY: 're_test' };

function fakes({ invite = undefined, children = ['Maya Lin'], updateError = null, admin = true } = {}) {
  const state = {
    invite: invite === undefined
      ? { id: 7, profile_id: 'p1', expires_at: '2026-11-01T00:00:00Z', used_at: null, profile: { full_name: 'Grace Lin', role: 'parent', no_login: true } }
      : invite,
    profiles: {},
    users: {},
    sent: [],
    emailed: null,
  };
  const repo = {
    findInvite: vi.fn(async (hash) => (hash === hashToken(TOKEN) ? state.invite : null)),
    childrenOf: vi.fn(async () => children),
    claimInvite: vi.fn(async () => {
      if (state.invite.used_at) return false;
      state.invite.used_at = 'now';
      return true;
    }),
    releaseInvite: vi.fn(async () => { state.invite.used_at = null; }),
    markEmailed: vi.fn(async (id, to, at) => { state.emailed = { id, to, at }; }),
    markNoLogin: vi.fn(async (id, role, name) => { state.profiles[id] = { role, name, no_login: true }; }),
    finishJoin: vi.fn(async (id, email) => { state.profiles[id] = { ...(state.profiles[id] ?? {}), email, no_login: false }; }),
  };
  const auth = {
    createUser: vi.fn(async (attrs) => { state.users.new = attrs; return { data: { user: { id: 'new-id' } }, error: null }; }),
    updateUserById: vi.fn(async (id, attrs) => (updateError ? { data: null, error: updateError } : (state.users[id] = attrs, { data: { user: { id } }, error: null }))),
    deleteUser: vi.fn(async () => ({ error: null })),
  };
  const send = vi.fn(async (mail) => { state.sent.push(mail); return 'sent'; });
  const deps = { repo, auth, verifyAdmin: vi.fn(async () => (admin ? { id: 'admin' } : null)), env: ENV, now: () => NOW, send };
  return { state, repo, auth, send, deps };
}

const post = (body) => new Request('https://x.test/api/people', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = (t) => new Request(`https://x.test/api/people${t === undefined ? '' : `?t=${t}`}`);

describe('helpers', () => {
  test('placeholder addresses are unique, undeliverable and recognised', () => {
    const a = placeholderEmail();
    expect(a).toMatch(new RegExp(`^no-login\\+[0-9a-f-]{36}@${PLACEHOLDER_DOMAIN.replace(/\./g, '\\.')}$`));
    expect(a).not.toBe(placeholderEmail());
    expect(isPlaceholder(a)).toBe(true);
    expect(isPlaceholder('grace@example.com')).toBe(false);
  });

  test('emails and names', () => {
    expect(normalizeEmail('  Grace@Example.COM ')).toBe('grace@example.com');
    for (const bad of ['', 'grace', 'grace@', '@x.com', 'a b@x.com', `x@${PLACEHOLDER_DOMAIN}`, `${'a'.repeat(250)}@x.com`]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
    expect(normalizeName('  Grace   Lin ')).toBe('Grace Lin');
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('x'.repeat(121))).toBeNull();
  });

  test('the link carries the token after #, so it never reaches a server log', () => {
    expect(inviteLink(TOKEN, ENV)).toBe(`https://www.varunbaskaran.com/portal/join.html#t=${TOKEN}`);
  });

  test('link problems', () => {
    const ok = { used_at: null, expires_at: '2026-11-01T00:00:00Z', profile: { no_login: true, role: 'parent' } };
    expect(inviteProblem(ok, NOW)).toBeNull();
    expect(inviteProblem(null, NOW)).toBe('invalid');
    expect(inviteProblem({ ...ok, used_at: 'x' }, NOW)).toBe('used');
    expect(inviteProblem({ ...ok, profile: { no_login: false, role: 'parent' } }, NOW)).toBe('used');
    expect(inviteProblem({ ...ok, expires_at: '2026-10-01T00:00:00Z' }, NOW)).toBe('expired');
    expect(inviteProblem({ ...ok, profile: { no_login: true, role: 'tutor' } }, NOW)).toBe('invalid');
  });

  test('names and the email', () => {
    expect(namesText(['Maya Lin'])).toBe('Maya');
    expect(namesText(['Maya Lin', 'Leo Park', 'Ava Chen'])).toBe('Maya, Leo and Ava');
    const mail = buildInviteEmail({ name: 'Grace Lin', role: 'parent', children: ['Maya Lin'], link: 'https://l.test/x', to: 'grace@example.com' });
    expect(mail).toMatchObject({ to: 'grace@example.com', subject: 'Your VP Education Group portal account', replyTo: 'vbmgroupsllc@gmail.com' });
    expect(mail.text).toContain('Hi Grace,');
    expect(mail.text).toContain('Maya’s lessons, homework and monthly statements');
    expect(mail.html).toContain('href="https://l.test/x"');
    const hostile = buildInviteEmail({ name: '<script>x</script>', role: 'student', link: 'https://l.test/"onmouseover', to: 'a@b.co' });
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).not.toContain('"onmouseover');
  });

  test('sendMail sends to the mail’s own address when it has one', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await sendMail({ to: 'grace@example.com', from: 'VP <portal@varunbaskaran.com>', subject: 's', html: 'h', text: 't' }, { env: ENV, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.to).toEqual(['grace@example.com']);
    expect(body.from).toBe('VP <portal@varunbaskaran.com>');
    await sendMail({ subject: 's', html: 'h', text: 't' }, { env: ENV, fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).to).toEqual(['vbmgroupsllc@gmail.com']);
  });
});

describe('GET: the join page asks about a link', () => {
  test('a good link names the person and their children', async () => {
    const { deps } = fakes();
    const res = await handlePeople(get(TOKEN), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: 'Grace Lin', role: 'parent', children: ['Maya Lin'] });
  });

  test('bad, unknown, used and expired links', async () => {
    expect((await handlePeople(get('short'), fakes().deps)).status).toBe(404);
    expect((await handlePeople(get('B'.repeat(43)), fakes().deps)).status).toBe(404);
    const used = fakes({ invite: { id: 1, profile_id: 'p', used_at: 'x', expires_at: '2027-01-01', profile: { no_login: true, role: 'parent' } } });
    expect((await handlePeople(get(TOKEN), used.deps)).status).toBe(410);
    const old = fakes({ invite: { id: 1, profile_id: 'p', used_at: null, expires_at: '2026-01-01', profile: { no_login: true, role: 'parent' } } });
    expect(await (await handlePeople(get(TOKEN), old.deps)).json()).toEqual({ error: 'expired' });
  });
});

describe('create: a person with no sign-in', () => {
  test('the admin adds a parent: a confirmed user with a placeholder address, marked no_login', async () => {
    const f = fakes();
    const res = await handlePeople(post({ action: 'create', full_name: ' Grace  Lin ', role: 'parent' }), f.deps);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: 'new-id' });
    expect(f.state.users.new).toMatchObject({ email_confirm: true, user_metadata: { full_name: 'Grace Lin' } });
    expect(isPlaceholder(f.state.users.new.email)).toBe(true);
    expect(f.state.users.new.password).toBeUndefined();
    expect(f.state.profiles['new-id']).toEqual({ role: 'parent', name: 'Grace Lin', no_login: true });
  });

  test('only the admin, only students and parents, a name is needed', async () => {
    expect((await handlePeople(post({ action: 'create', full_name: 'X', role: 'parent' }), fakes({ admin: false }).deps)).status).toBe(401);
    expect((await handlePeople(post({ action: 'create', full_name: 'X', role: 'tutor' }), fakes().deps)).status).toBe(422);
    expect((await handlePeople(post({ action: 'create', full_name: '  ', role: 'student' }), fakes().deps)).status).toBe(422);
  });

  test('if the profile cannot be marked, the new user is removed again', async () => {
    const f = fakes();
    f.repo.markNoLogin.mockRejectedValueOnce(new Error('db down'));
    await expect(handlePeople(post({ action: 'create', full_name: 'Grace', role: 'parent' }), f.deps)).rejects.toThrow('db down');
    expect(f.auth.deleteUser).toHaveBeenCalledWith('new-id');
  });
});

describe('email: the admin sends the link', () => {
  test('emails the parent the personal link and records it', async () => {
    const f = fakes();
    const res = await handlePeople(post({ action: 'email', t: TOKEN, to: 'Grace@Example.com' }), f.deps);
    expect(res.status).toBe(200);
    expect(f.state.sent[0]).toMatchObject({ to: 'grace@example.com' });
    expect(f.state.sent[0].text).toContain(`https://www.varunbaskaran.com/portal/join.html#t=${TOKEN}`);
    expect(f.state.emailed).toMatchObject({ id: 7, to: 'grace@example.com' });
  });

  test('admin only; a bad address; a used link; no email service', async () => {
    expect((await handlePeople(post({ action: 'email', t: TOKEN, to: 'a@b.co' }), fakes({ admin: false }).deps)).status).toBe(401);
    expect((await handlePeople(post({ action: 'email', t: TOKEN, to: 'nope' }), fakes().deps)).status).toBe(422);
    const used = fakes({ invite: { id: 1, profile_id: 'p', used_at: 'x', expires_at: '2027-01-01', profile: { no_login: true, role: 'parent' } } });
    expect((await handlePeople(post({ action: 'email', t: TOKEN, to: 'a@b.co' }), used.deps)).status).toBe(410);
    const f = fakes();
    f.deps.send = vi.fn(async () => 'skipped');
    expect((await handlePeople(post({ action: 'email', t: TOKEN, to: 'a@b.co' }), f.deps)).status).toBe(503);
  });
});

describe('join: the parent claims the account', () => {
  test('moves the same account to their email and password, once', async () => {
    const f = fakes();
    const res = await handlePeople(post({ action: 'join', t: TOKEN, email: 'Grace@Example.com', password: 'correct horse' }), f.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: 'grace@example.com' });
    expect(f.auth.updateUserById).toHaveBeenCalledWith('p1', { email: 'grace@example.com', password: 'correct horse', email_confirm: true });
    expect(f.state.profiles.p1).toMatchObject({ email: 'grace@example.com', no_login: false });
    // the link is spent: a second use is refused
    f.state.invite.profile.no_login = false;
    expect((await handlePeople(post({ action: 'join', t: TOKEN, email: 'x@y.co', password: 'another one' }), f.deps)).status).toBe(410);
  });

  test('checks the email and password before touching anything', async () => {
    const f = fakes();
    const res = await handlePeople(post({ action: 'join', t: TOKEN, email: 'nope', password: 'short' }), f.deps);
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual({ email: 'invalid', password: 'too_short' });
    expect(f.repo.claimInvite).not.toHaveBeenCalled();
    expect(f.auth.updateUserById).not.toHaveBeenCalled();
  });

  test('an email that belongs to another account gives the link back', async () => {
    const f = fakes({ updateError: { code: 'email_exists', message: 'A user with this email address has already been registered' } });
    const res = await handlePeople(post({ action: 'join', t: TOKEN, email: 'taken@example.com', password: 'correct horse' }), f.deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_taken' });
    expect(f.state.invite.used_at).toBeNull();
    expect(f.repo.finishJoin).not.toHaveBeenCalled();
  });

  test('a password the project refuses as weak gives the link back with a clear reason', async () => {
    const f = fakes({ updateError: { code: 'weak_password', message: 'Password should contain at least one character of each' } });
    const res = await handlePeople(post({ action: 'join', t: TOKEN, email: 'g@x.co', password: 'aaaaaaaa' }), f.deps);
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toEqual({ password: 'weak' });
    expect(f.state.invite.used_at).toBeNull();
  });

  test('never claims an account whose role was changed to tutor or admin since the link was made', async () => {
    for (const role of ['tutor', 'admin', 'pending']) {
      const f = fakes();
      f.state.invite.profile.role = role;
      expect((await handlePeople(get(TOKEN), f.deps)).status, role).toBe(404);
      expect((await handlePeople(post({ action: 'join', t: TOKEN, email: 'g@x.co', password: 'correct horse' }), f.deps)).status, role).toBe(404);
      expect(f.auth.updateUserById).not.toHaveBeenCalled();
    }
  });

  test('two tabs racing: only the first claim goes through', async () => {
    const f = fakes();
    f.repo.claimInvite.mockResolvedValueOnce(false);
    expect((await handlePeople(post({ action: 'join', t: TOKEN, email: 'g@x.co', password: 'correct horse' }), f.deps)).status).toBe(410);
    expect(f.auth.updateUserById).not.toHaveBeenCalled();
  });

  test('unknown actions, bad JSON and other methods', async () => {
    expect((await handlePeople(post({ action: 'nope' }), fakes().deps)).status).toBe(400);
    expect((await handlePeople(new Request('https://x.test/api/people', { method: 'POST', body: '{' }), fakes().deps)).status).toBe(400);
    expect((await handlePeople(new Request('https://x.test/api/people', { method: 'DELETE' }), fakes().deps)).status).toBe(405);
  });
});

describe('the repo', () => {
  test('embeds the invited person by profile_id, not created_by (two foreign keys to profiles)', async () => {
    let selected = null;
    const chain = {
      select(cols) { selected = cols; return chain; },
      eq() { return chain; },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    await createPeopleRepo({ from: () => chain }).findInvite('a'.repeat(64));
    expect(selected).toContain('profile:profiles!portal_invites_profile_id_fkey(');
  });
});

describe('the Vercel function budget', () => {
  test('api/ holds exactly 12 functions (the Hobby limit)', () => {
    const dir = fileURLToPath(new URL('../../api/', import.meta.url));
    const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.js') && !String(f).startsWith('_lib'));
    expect(files.sort()).toHaveLength(12);
  });

  test('a form post to /api/referral reaches the email decision page, JSON reaches the referral form', async () => {
    const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const { POST, GET } = await import('../../api/referral.js');
      const form = await POST(new Request('https://x.test/api/referral', { method: 'POST', body: 'id=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
      expect(form.headers.get('content-type')).toContain('text/html');
      const jsonRes = await POST(new Request('https://x.test/api/referral', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
      expect(jsonRes.headers.get('content-type')).toContain('application/json');
      expect((await GET(new Request('https://x.test/api/referral-review?id=1'))).headers.get('content-type')).toContain('text/html');
    } finally {
      if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
      if (saved.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
    }
  }, 30000); // the first import of api/referral.js loads supabase-js, slow when the whole suite runs
});
