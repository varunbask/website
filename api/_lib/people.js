import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './testimonials.js';
import { sendMail, escapeHtml, siteOf, DEFAULT_TO } from './referral-mail.js';
import { handleDelete, createDeleteRepo } from './people-delete.js';

// People without a sign-in, and the personal links that let them claim their
// account (supabase/migrations/20261012120000_portal_invites.sql).
//
// POST /api/people
//   { action: 'lookup', t }                      the join page: is this link usable?
//                                                -> { name, role, children, email }
//                                                (POST keeps the token out of request logs;
//                                                GET ?t= still answers for pages already open)
//   { action: 'create', full_name, role }        admin: a student or parent with no sign-in -> { id }
//   { action: 'email', t, to }                   admin: email the personal link to `to`
//   { action: 'join', t, email, password }       the person: choose an email and password (once)
//   { action: 'use_signup', signup_id, profile_id, chosen?, confirm_name? }
//                                                admin: someone signed up who was already added without
//                                                a login; remove the sign-up and email them a link to
//                                                that account instead. The pair must match by name
//                                                (signupMayBe) and be the only account that does, or be
//                                                picked by hand after a typed confirm: chosen true with
//                                                confirm_name, the account's name as People showed it
//   { action: 'delete_preview', id }             admin: what deleting a person would remove, and what
//                                                refuses it (api/_lib/people-delete.js)
//   { action: 'delete_person', id, confirm_name } admin: delete them for good, with everything of theirs
//
// The admin's browser makes the link (random token, SHA-256 stored in
// portal_invites, the link shown once), as with review links. Joining moves
// the same auth user to the chosen email, so everything already linked to the
// account (sessions, homework, bills) is there when they sign in.

export const ROLES = Object.freeze(['student', 'parent']);
export const NAME_MAX = 120;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const PLACEHOLDER_DOMAIN = 'people.varunbaskaran.com';
export const INVITE_FROM = 'VP Education Group <portal@varunbaskaran.com>';
const MAX_BODY_BYTES = 8 * 1024;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const tokenShape = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t);

// An address that can never receive mail, unique per person
export function placeholderEmail(id = randomUUID()) {
  return `no-login+${id}@${PLACEHOLDER_DOMAIN}`;
}

export function isPlaceholder(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

// '  Grace@Example.com ' -> 'grace@example.com', or null
export function normalizeEmail(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s || s.length > 254 || !EMAIL_RE.test(s) || isPlaceholder(s)) return null;
  return s;
}

export function normalizeName(value) {
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s && s.length <= NAME_MAX ? s : null;
}

export function inviteLink(token, env = process.env) {
  return `${siteOf(env)}/portal/join.html#t=${token}`;
}

// The rule People uses to flag a sign-up that may be someone added without a
// login (portal/js/invites-model.js signupMatches): the same full name, or the
// same first name when one of the two is only a first name, and the role they
// asked for. Notes in brackets are not part of a name ("Grace (Gordon's Mom)"
// is "Grace"). The server checks it again before removing a sign-up.
const lowerName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const bareName = (s) => lowerName(String(s ?? '').replace(/\([^()]*\)/g, ' '));

export function signupMayBe(signup, person) {
  if (signup?.requested_role && signup.requested_role !== person?.role) return false;
  const a = bareName(signup?.full_name);
  const b = bareName(person?.full_name);
  if (!a || !b) return false;
  if (a === b) return true;
  const [aw, bw] = [a.split(' '), b.split(' ')];
  return aw[0] === bw[0] && (aw.length === 1 || bw.length === 1);
}

// A pair the admin picked by hand (People > Waiting for approval > another
// account): any student or parent of the role asked for, when the request
// names the account exactly as it is now, so a stale page or an edited id
// cannot pair anyone else
export function signupChosen(signup, person, confirmName) {
  if (signup?.requested_role && signup.requested_role !== person?.role) return false;
  const named = lowerName(confirmName);
  return Boolean(named) && named === lowerName(person?.full_name);
}

// Why a link cannot be used, or null
export function inviteProblem(invite, now) {
  if (!invite || !invite.profile) return 'invalid';
  if (invite.used_at || !invite.profile.no_login) return 'used';
  // Only ever a student's or parent's account (never one whose role was changed since)
  if (!ROLES.includes(invite.profile.role)) return 'invalid';
  if (Date.parse(invite.expires_at) < now) return 'expired';
  return null;
}

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';

// "Maya", "Maya and Leo", "Maya, Leo and Ava"
export function namesText(names) {
  const list = (names ?? []).map((n) => firstName(n)).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export function buildInviteEmail({ name, role, children = [], link, to }) {
  const kids = namesText(children);
  const what = role === 'parent' && kids
    ? `${kids}’s lessons, homework and monthly statements`
    : 'your lessons, homework and progress';
  const subject = 'Your VP Education Group portal account';
  const text = [
    `Hi ${firstName(name)},`,
    '',
    `Your VP Education Group portal account is ready. Use this personal link to choose your email and password, then see ${what} in one place:`,
    '',
    link,
    '',
    'The link works once and expires in 30 days. If it has expired, reply to this email and we will send a new one.',
    '',
    'VP Education Group',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F6F2EE;font-family:Arial,Helvetica,sans-serif;color:#2A1F22;">
<div style="max-width:520px;margin:0 auto;padding:28px 22px;">
<p style="margin:0 0 6px;font-size:13px;color:#6E585C;">VP Education Group</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Your portal account is ready</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Hi ${escapeHtml(firstName(name))},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Use this personal link to choose your email and password, then see ${escapeHtml(what)} in one place.</p>
<p style="margin:0 0 22px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#B3282D;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;">Set up my account</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6E585C;">The link works once and expires in 30 days. If it has expired, reply to this email and we will send a new one.</p>
</div></body></html>`;
  return { subject, text, html, to, from: INVITE_FROM, replyTo: DEFAULT_TO };
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    const data = JSON.parse(text);
    return { data: data && typeof data === 'object' ? data : null };
  } catch {
    return { data: null };
  }
}

// Supabase Auth's answer when the project's password rules refuse it
function weakPassword(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('weak_password') || text.includes('password should');
}

// Supabase Auth's answer when the address belongs to another account
function emailTaken(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('email_exists') || text.includes('already been registered') || text.includes('already registered')
    || text.includes('already exists');
}

export async function handlePeople(request, {
  repo, auth, verifyAdmin, env = process.env, now = () => Date.now(), fetchImpl = fetch, send = sendMail,
  disconnectGoogle, log, warn,
}) {
  const lookup = async (token) => {
    if (!tokenShape(token)) return json(404, { error: 'invalid' });
    const invite = await repo.findInvite(hashToken(token));
    const problem = inviteProblem(invite, now());
    if (problem) return json(problem === 'invalid' ? 404 : 410, { error: problem });
    const children = invite.profile.role === 'parent' ? await repo.childrenOf(invite.profile_id) : [];
    // The address the link was emailed to fills the join form's email
    return json(200, { ok: true, name: invite.profile.full_name, role: invite.profile.role, children, email: invite.emailed_to ?? null });
  };
  if (request.method === 'GET') return lookup(new URL(request.url).searchParams.get('t'));
  if (request.method !== 'POST') return json(405, { error: 'method' });

  const { data, tooLarge } = await readJson(request);
  if (tooLarge) return json(413, { error: 'too_large' });
  if (!data) return json(400, { error: 'invalid' });

  if (data.action === 'lookup') return lookup(data.t);

  if (data.action === 'create') {
    if (!(await verifyAdmin(request))) return json(401, { error: 'unauthorized' });
    const name = normalizeName(data.full_name);
    if (!name) return json(422, { error: 'invalid', errors: { full_name: 'required' } });
    if (!ROLES.includes(data.role)) return json(422, { error: 'invalid', errors: { role: 'invalid' } });
    const created = await auth.createUser({ email: placeholderEmail(), email_confirm: true, user_metadata: { full_name: name } });
    if (created.error || !created.data?.user?.id) throw new Error(`createUser: ${created.error?.message ?? 'no user'}`);
    const id = created.data.user.id;
    try {
      await repo.markNoLogin(id, data.role, name);
    } catch (error) {
      await auth.deleteUser(id).catch(() => {});
      throw error;
    }
    return json(201, { ok: true, id });
  }

  if (data.action === 'email') {
    if (!(await verifyAdmin(request))) return json(401, { error: 'unauthorized' });
    if (!tokenShape(data.t)) return json(404, { error: 'invalid' });
    const to = normalizeEmail(data.to);
    if (!to) return json(422, { error: 'invalid', errors: { to: 'invalid' } });
    const invite = await repo.findInvite(hashToken(data.t));
    const problem = inviteProblem(invite, now());
    if (problem) return json(problem === 'invalid' ? 404 : 410, { error: problem });
    const children = invite.profile.role === 'parent' ? await repo.childrenOf(invite.profile_id) : [];
    const mail = buildInviteEmail({ name: invite.profile.full_name, role: invite.profile.role, children, link: inviteLink(data.t, env), to });
    const result = await send(mail, { env, fetchImpl });
    if (result === 'skipped') return json(503, { error: 'email_not_configured' });
    await repo.markEmailed(invite.id, to, new Date(now()).toISOString());
    return json(200, { ok: true });
  }

  if (data.action === 'use_signup') {
    const caller = await verifyAdmin(request);
    if (!caller) return json(401, { error: 'unauthorized' });
    if (!env.RESEND_API_KEY) return json(503, { error: 'email_not_configured' });
    const [signup, person] = await Promise.all([repo.getProfile(data.signup_id), repo.getProfile(data.profile_id)]);
    if (!signup || signup.role !== 'pending') return json(409, { error: 'not_pending' });
    if (!person || !person.no_login || !ROLES.includes(person.role)) return json(409, { error: 'not_no_login' });
    // The pair is checked here too, so a stale or edited request cannot pair anyone else
    if (data.chosen === true) {
      if (!signupChosen(signup, person, data.confirm_name)) return json(409, { error: 'no_match' });
    } else {
      if (!signupMayBe(signup, person)) return json(409, { error: 'no_match' });
      // Two people with one name ("Grace" twice): only a confirmed pick by hand may choose
      const others = (await repo.noLoginPeople(person.role)).filter((p) => p.id !== person.id && signupMayBe(signup, p));
      if (others.length) return json(409, { error: 'ambiguous' });
    }
    // A sign-up still waiting has nothing linked to it; anything linked means it is not a bare sign-up
    if (await repo.hasLinks(signup.id)) return json(409, { error: 'has_links' });
    const found = await auth.getUserById(signup.id);
    const to = normalizeEmail(found.data?.user?.email);
    if (found.error || !to) return json(409, { error: 'no_email' });
    // Still waiting right before it goes (not approved in another tab meanwhile)
    if ((await repo.getProfile(signup.id))?.role !== 'pending') return json(409, { error: 'not_pending' });
    // The sign-up holds their address; remove it first so the link can move the account to it
    const removed = await auth.deleteUser(signup.id);
    if (removed?.error) throw new Error(`deleteUser: ${removed.error.message ?? 'failed'}`);
    const token = randomBytes(32).toString('base64url');
    const invite = await repo.createInvite(person.id, hashToken(token), caller.id);
    const children = person.role === 'parent' ? await repo.childrenOf(person.id) : [];
    const mail = buildInviteEmail({ name: person.full_name, role: person.role, children, link: inviteLink(token, env), to });
    try {
      if ((await send(mail, { env, fetchImpl })) === 'skipped') throw new Error('skipped');
    } catch {
      return json(502, { error: 'email_failed' });
    }
    await repo.markEmailed(invite.id, to, new Date(now()).toISOString());
    // Only the link just emailed opens the account now: older unused links stop.
    // After the send, so a failure here never costs them the new link.
    try {
      await repo.dropOpenInvites(person.id, invite.id);
    } catch (error) {
      warn?.('[people] dropOpenInvites', error?.message ?? error);
    }
    return json(200, { ok: true, to });
  }

  if (data.action === 'delete_preview' || data.action === 'delete_person') {
    const caller = await verifyAdmin(request);
    if (!caller) return json(401, { error: 'unauthorized' });
    return handleDelete(data.action, data, caller, { repo, auth, now, disconnectGoogle, log, warn });
  }

  if (data.action === 'join') {
    if (!tokenShape(data.t)) return json(404, { error: 'invalid' });
    const invite = await repo.findInvite(hashToken(data.t));
    const problem = inviteProblem(invite, now());
    if (problem) return json(problem === 'invalid' ? 404 : 410, { error: problem });
    const email = normalizeEmail(data.email);
    const password = typeof data.password === 'string' ? data.password : '';
    const errors = {};
    if (!email) errors.email = 'invalid';
    if (password.length < PASSWORD_MIN) errors.password = 'too_short';
    else if (password.length > PASSWORD_MAX) errors.password = 'too_long';
    if (Object.keys(errors).length) return json(422, { error: 'invalid', errors });

    // The link works once: claim it before changing the account
    if (!(await repo.claimInvite(invite.id))) return json(410, { error: 'used' });
    const updated = await auth.updateUserById(invite.profile_id, { email, password, email_confirm: true });
    if (updated.error) {
      await repo.releaseInvite(invite.id).catch(() => {});
      if (emailTaken(updated.error)) return json(409, { error: 'email_taken' });
      if (weakPassword(updated.error)) return json(422, { error: 'invalid', errors: { password: 'weak' } });
      throw new Error(`updateUserById: ${updated.error.message ?? 'failed'}`);
    }
    await repo.finishJoin(invite.profile_id, email);
    return json(200, { ok: true, email });
  }

  return json(400, { error: 'invalid' });
}

export function createPeopleRepo(db) {
  const check = ({ data, error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };
  return {
    ...createDeleteRepo(db),
    async findInvite(tokenHash) {
      // portal_invites points at profiles twice (profile_id, created_by): name the one to embed
      return check(await db.from('portal_invites')
        .select('id, profile_id, expires_at, used_at, emailed_to, profile:profiles!portal_invites_profile_id_fkey(full_name, role, no_login)')
        .eq('token_hash', tokenHash).maybeSingle(), 'findInvite');
    },
    async childrenOf(parentId) {
      const links = check(await db.from('parent_students').select('student_id').eq('parent_id', parentId), 'childrenOf') ?? [];
      if (!links.length) return [];
      const kids = check(await db.from('profiles').select('full_name').in('id', links.map((l) => l.student_id)), 'childrenOf') ?? [];
      return kids.map((k) => k.full_name).filter(Boolean).sort();
    },
    async claimInvite(id) {
      const rows = check(await db.from('portal_invites').update({ used_at: new Date().toISOString() })
        .eq('id', id).is('used_at', null).select('id'), 'claimInvite');
      return (rows ?? []).length === 1;
    },
    async releaseInvite(id) {
      check(await db.from('portal_invites').update({ used_at: null }).eq('id', id), 'releaseInvite');
    },
    async markEmailed(id, to, at) {
      check(await db.from('portal_invites').update({ emailed_to: to, emailed_at: at }).eq('id', id), 'markEmailed');
    },
    // A new account with no sign-in: its role is set at once (no approval) and it is marked no_login
    async markNoLogin(id, role, name) {
      const rows = check(await db.from('profiles').update({ role, no_login: true, full_name: name, requested_role: null })
        .eq('id', id).select('id'), 'markNoLogin');
      if (!rows?.length) throw new Error('markNoLogin: no profile');
    },
    async finishJoin(id, email) {
      check(await db.from('profiles').update({ email, no_login: false }).eq('id', id), 'finishJoin');
    },
    async getProfile(id) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
      return check(await db.from('profiles').select('id, full_name, email, role, requested_role, no_login').eq('id', id).maybeSingle(), 'getProfile');
    },
    // Any tutor or parent link or session on this account (id is a checked uuid)
    async hasLinks(id) {
      const count = async (table, cols) => {
        const { count: n, error } = await db.from(table).select('*', { count: 'exact', head: true })
          .or(cols.map((c) => `${c}.eq.${id}`).join(','));
        if (error) throw new Error(`hasLinks ${table}: ${error.message}`);
        return n ?? 0;
      };
      const counts = await Promise.all([
        count('parent_students', ['parent_id', 'student_id']),
        count('tutor_students', ['tutor_id', 'student_id']),
        count('sessions', ['student_id', 'tutor_id']),
      ]);
      return counts.some((n) => n > 0);
    },
    // Removes a person's unused links older than `keepId` (a removed link no
    // longer opens); a newer one made meanwhile in another tab stays
    async dropOpenInvites(profileId, keepId) {
      check(await db.from('portal_invites').delete().eq('profile_id', profileId).is('used_at', null)
        .lt('id', keepId), 'dropOpenInvites');
    },
    // Everyone of a role added without a login, for telling same-name accounts apart
    async noLoginPeople(role) {
      return check(await db.from('profiles').select('id, full_name, role, no_login')
        .eq('no_login', true).eq('role', role), 'noLoginPeople') ?? [];
    },
    async createInvite(profileId, tokenHash, createdBy) {
      return check(await db.from('portal_invites').insert({ profile_id: profileId, token_hash: tokenHash, created_by: createdBy })
        .select('id').single(), 'createInvite');
    },
    async getRole(userId) {
      return check(await db.from('profiles').select('role').eq('id', userId).maybeSingle(), 'getRole')?.role ?? null;
    },
  };
}
