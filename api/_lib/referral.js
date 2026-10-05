import { createHmac } from 'node:crypto';

// The "Refer a family" form on the landing page posts here. Everything the
// visitor sends is checked again on the server; the table's own checks are
// the last line. Spam is filtered three ways: a hidden field people never
// fill (website), a minimum time on the page (started), and a per-address
// and overall rate limit.

export const LIMITS = Object.freeze({ name: 120, email: 254, phone: 30, grade: 40, subjects: 300, note: 1000 });
export const PER_ADDRESS_PER_HOUR = 5;
export const ALL_PER_DAY = 200;
export const MIN_FILL_MS = 3000;
export const MAX_BODY_BYTES = 16 * 1024;
const LANGS = ['en', 'zh', 'es', 'fr', 'ko'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+(). -]{7,30}$/;
const HOUR_MS = 3_600_000;

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const cleanNote = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');

/**
 * Raw form fields -> { ok, errors: { field: code }, row }. Codes, not
 * sentences: the page shows them in the visitor's language.
 */
export function validateReferral(input = {}) {
  const errors = {};
  const v = {
    referrer_name: clean(input.referrer_name),
    referrer_email: clean(input.referrer_email).toLowerCase(),
    referrer_role: clean(input.referrer_role),
    family_name: clean(input.family_name),
    family_email: clean(input.family_email).toLowerCase(),
    family_phone: clean(input.family_phone),
    grade: clean(input.grade),
    subjects: clean(input.subjects),
    note: cleanNote(input.note),
  };

  if (!v.referrer_name) errors.referrer_name = 'required';
  else if (v.referrer_name.length > LIMITS.name) errors.referrer_name = 'too_long';
  if (!v.referrer_email) errors.referrer_email = 'required';
  else if (v.referrer_email.length > LIMITS.email || !EMAIL_RE.test(v.referrer_email)) errors.referrer_email = 'email';
  if (!['parent', 'student'].includes(v.referrer_role)) errors.referrer_role = 'required';
  if (!v.family_name) errors.family_name = 'required';
  else if (v.family_name.length > LIMITS.name) errors.family_name = 'too_long';
  if (v.family_email && (v.family_email.length > LIMITS.email || !EMAIL_RE.test(v.family_email))) errors.family_email = 'email';
  if (v.family_phone && !PHONE_RE.test(v.family_phone)) errors.family_phone = 'phone';
  if (!v.family_email && !v.family_phone) errors.family_contact = 'required';
  if (v.grade.length > LIMITS.grade) errors.grade = 'too_long';
  if (v.subjects.length > LIMITS.subjects) errors.subjects = 'too_long';
  if (v.note.length > LIMITS.note) errors.note = 'too_long';
  if (input.consent !== true && input.consent !== 'on' && input.consent !== 'true') errors.consent = 'required';

  const row = {
    referrer_name: v.referrer_name,
    referrer_email: v.referrer_email,
    referrer_role: v.referrer_role,
    family_name: v.family_name,
    family_email: v.family_email || null,
    family_phone: v.family_phone || null,
    grade: v.grade || null,
    subjects: v.subjects || null,
    note: v.note || null,
    language: LANGS.includes(input.language) ? input.language : 'en',
  };
  return { ok: Object.keys(errors).length === 0, errors, row };
}

// A keyed hash of the caller's address, so the table never holds a raw IP
export function addressHash(request, key) {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return createHmac('sha256', key || 'vp-referrals').update(ip).digest('hex');
}

// Looks like a bot: the hidden field is filled, or the form was sent too fast
export function looksAutomated(input, now) {
  if (clean(input.website)) return true;
  const started = Number(input.started);
  return Number.isFinite(started) && started > 0 && now - started < MIN_FILL_MS;
}

const json = (status, body) => Response.json(body, { status });

async function readInput(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return { tooLarge: true };
  const type = request.headers.get('content-type') ?? '';
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  if (type.includes('application/json')) {
    try {
      const data = JSON.parse(text);
      return { data: data && typeof data === 'object' ? data : {} };
    } catch {
      return { data: null };
    }
  }
  return { data: Object.fromEntries(new URLSearchParams(text)), form: true };
}

/**
 * POST /api/referral. JSON in, JSON out ({ ok } or { error, errors }). A
 * plain form post (no JavaScript) is answered with a redirect back to the
 * page. A bot is told it worked, and nothing is saved.
 */
export async function handleReferral(request, { repo, env = process.env, now = () => Date.now() }) {
  const { data, form, tooLarge } = await readInput(request);
  const back = (state) => new Response(null, { status: 303, headers: { Location: `/?referral=${state}#refer` } });
  if (tooLarge) return form ? back('error') : json(413, { error: 'too_large' });
  if (!data) return json(400, { error: 'invalid' });

  if (looksAutomated(data, now())) return form ? back('sent') : json(200, { ok: true });

  const { ok, errors, row } = validateReferral(data);
  if (!ok) return form ? back('error') : json(422, { error: 'invalid', errors });

  const ipHash = addressHash(request, env.CRON_SECRET);
  const t = now();
  const [mine, all] = await Promise.all([
    repo.countSince({ ipHash, since: new Date(t - HOUR_MS) }),
    repo.countSince({ since: new Date(t - 24 * HOUR_MS) }),
  ]);
  if (mine >= PER_ADDRESS_PER_HOUR || all >= ALL_PER_DAY) return form ? back('busy') : json(429, { error: 'busy' });

  await repo.insert({ ...row, ip_hash: ipHash });
  return form ? back('sent') : json(201, { ok: true });
}

export function createReferralRepo(db) {
  return {
    async countSince({ ipHash = null, since }) {
      let query = db.from('referrals').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());
      if (ipHash) query = query.eq('ip_hash', ipHash);
      const { count, error } = await query;
      if (error) throw new Error(`countSince: ${error.message}`);
      return count ?? 0;
    },
    async insert(row) {
      const { error } = await db.from('referrals').insert(row);
      if (error) throw new Error(`insert: ${error.message}`);
    },
  };
}
