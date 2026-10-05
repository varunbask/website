import { createHash } from 'node:crypto';
import { reviewQuery } from './referral-review.js';
import { sendMail, escapeHtml, siteOf } from './referral-mail.js';
import { translateReview, plainText, LANGS } from './translate.js';

// Reviews from families for the landing page, through personal links.
//
// GET  /api/testimonials            approved reviews for the landing page
//                                   (display name, kind, text in 5 languages)
// GET  /api/testimonials?t=TOKEN    is this personal link still usable?
// POST /api/testimonials            { action: 'submit', t, name, quote, consent }
//                                   a family sends their review (once per link)
//      { action: 'translate', id }  an admin retries a failed translation
//
// A submitted review is pending until the owner approves it from the email
// (or the portal). It is translated when submitted, so the email shows every
// language that will be published. Only approved reviews are ever public.

export const LIMITS = Object.freeze({ name: 80, quoteMin: 20, quoteMax: 2000 });
export const MIN_FILL_MS = 3000;
const MAX_BODY_BYTES = 16 * 1024;
const LANGUAGE_NAMES = { en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French', ko: 'Korean' };

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
const tokenShape = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t);

const json = (status, body, headers = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

// Raw form fields -> { ok, errors: { field: code }, row: { name, quote } }
export function validateSubmission(input = {}) {
  const errors = {};
  const name = plainText(input.name).replace(/\s+/g, ' ');
  const quote = plainText(input.quote).replace(/\n{3,}/g, '\n\n');
  if (!name) errors.name = 'required';
  else if (name.length > LIMITS.name) errors.name = 'too_long';
  if (!quote) errors.quote = 'required';
  else if (quote.length < LIMITS.quoteMin) errors.quote = 'too_short';
  else if (quote.length > LIMITS.quoteMax) errors.quote = 'too_long';
  if (input.consent !== true && input.consent !== 'on' && input.consent !== 'true') errors.consent = 'required';
  return { ok: Object.keys(errors).length === 0, errors, row: { name, quote } };
}

// Why a link cannot be used, or null when it can
export function inviteProblem(invite, now) {
  if (!invite) return 'invalid';
  if (invite.used_at) return 'used';
  if (Date.parse(invite.expires_at) < now) return 'expired';
  return null;
}

// What the landing page shows for one approved review
export function publicReview(r) {
  const text = {};
  for (const l of LANGS) text[l] = (r.translations && typeof r.translations[l] === 'string' && r.translations[l]) || r.quote;
  return { kind: r.kind, name: r.name, quote: text };
}

export function buildTestimonialEmail(review, id, translations, { env = process.env, now = Date.now() } = {}) {
  const site = siteOf(env);
  const link = (action) => `${site}/api/referral-review?${reviewQuery({ kind: 'testimonial', id, action, now }, env)}`;
  const who = review.kind === 'student' ? 'a student' : 'a parent';
  const versions = translations
    ? LANGS.map((l) => [LANGUAGE_NAMES[l], translations[l]])
    : [['As written (translation failed; it shows like this in every language)', review.quote]];
  const subject = `New review to approve: ${review.name}`.slice(0, 150);
  const text = [
    `${review.name} (${who}) wrote a review for the website.`,
    '',
    ...versions.flatMap(([label, body]) => [`${label}:`, body, '']),
    `Approve (shows it on the website): ${link('approve')}`,
    `Decline: ${link('decline')}`,
    `All reviews: ${site}/portal/people.html#/reviews`,
    '',
    'Each link opens a page with a button to confirm. Links work for 30 days.',
  ].join('\n');
  const blocks = versions.map(([label, body]) => `<p style="margin:16px 0 4px;color:#6E585C;font-size:13px;">${escapeHtml(label)}</p><p style="margin:0;white-space:pre-wrap;">${escapeHtml(body)}</p>`).join('');
  const btn = (href, label, bg, fg) => `<a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 21px;margin:0 8px 8px 0;border:1px solid ${bg === '#FFFFFF' ? '#CDBFB8' : bg};border-radius:6px;background:${bg};color:${fg};font-weight:700;text-decoration:none;">${label}</a>`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#FBF8F5;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#241619;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E6D9D2;border-radius:8px;padding:24px;">
<p style="margin:0 0 4px;color:#B3282D;font-weight:700;">VP Education Group</p>
<h1 style="margin:0 0 8px;font-size:20px;">New review to approve</h1>
<p style="margin:0;color:#3A2429;">From <strong>${escapeHtml(review.name)}</strong>, ${who}. This is exactly what will show on the website if you approve it.</p>
${blocks}
<p style="margin:24px 0 12px;">${btn(link('approve'), 'Approve and publish', '#B3282D', '#FFFFFF')}${btn(link('decline'), 'Decline', '#FFFFFF', '#241619')}</p>
<p style="margin:0 0 8px;color:#6E585C;font-size:13px;">Each button opens a page where you confirm. Links work for 30 days.</p>
<p style="margin:0;font-size:13px;"><a href="${escapeHtml(`${site}/portal/people.html#/reviews`)}" style="color:#B3282D;">See all reviews in the portal</a></p>
</div></body></html>`;
  return { subject, text, html, replyTo: null };
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

// Translates a saved review and emails the owner; never throws
export async function afterSubmit(repo, id, review, { env, fetchImpl, now, translate = translateReview, send = sendMail }) {
  let translations = null;
  try {
    translations = await translate(review.quote, { env, fetchImpl });
    if (translations) await repo.setTranslations(id, translations);
  } catch (error) {
    console.error('[testimonials] translate:', error?.message ?? 'Error');
  }
  try {
    await send(buildTestimonialEmail(review, id, translations, { env, now: now() }), { env, fetchImpl });
  } catch (error) {
    console.error('[testimonials] email:', error?.message ?? 'Error');
  }
}

export async function handleTestimonials(request, {
  repo, verifyAdmin, env = process.env, now = () => Date.now(), fetchImpl = fetch, waitUntil = (p) => p,
  translate = translateReview, send = sendMail,
}) {
  if (request.method === 'GET') {
    const token = new URL(request.url).searchParams.get('t');
    if (token === null) {
      const list = await repo.listApproved();
      return json(200, { reviews: list.map(publicReview) }, { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' });
    }
    if (!tokenShape(token)) return json(404, { error: 'invalid' });
    const invite = await repo.findInvite(hashToken(token));
    const problem = inviteProblem(invite, now());
    if (problem) return json(problem === 'invalid' ? 404 : 410, { error: problem });
    return json(200, { ok: true, name: invite.name, kind: invite.kind });
  }

  if (request.method !== 'POST') return json(405, { error: 'method' });
  const { data, tooLarge } = await readJson(request);
  if (tooLarge) return json(413, { error: 'too_large' });
  if (!data) return json(400, { error: 'invalid' });

  if (data.action === 'translate') {
    const admin = await verifyAdmin(request);
    if (!admin) return json(401, { error: 'unauthorized' });
    const id = Number(data.id);
    if (!Number.isSafeInteger(id) || id <= 0) return json(400, { error: 'invalid' });
    const review = await repo.getReview(id);
    if (!review) return json(404, { error: 'missing' });
    const translations = await translate(review.quote, { env, fetchImpl });
    if (!translations) return json(502, { error: 'translation_failed' });
    await repo.setTranslations(id, translations);
    return json(200, { ok: true, translations });
  }

  if (data.action !== 'submit') return json(400, { error: 'invalid' });
  // A bot: the hidden field is filled, or the form was sent too fast
  const started = Number(data.started);
  if (String(data.website ?? '').trim() || (Number.isFinite(started) && started > 0 && now() - started < MIN_FILL_MS)) {
    return json(200, { ok: true });
  }
  if (!tokenShape(data.t)) return json(404, { error: 'invalid' });
  const invite = await repo.findInvite(hashToken(data.t));
  const problem = inviteProblem(invite, now());
  if (problem) return json(problem === 'invalid' ? 404 : 410, { error: problem });
  const { ok, errors, row } = validateSubmission(data);
  if (!ok) return json(422, { error: 'invalid', errors });

  // The link works once: claim it before saving
  if (!(await repo.claimInvite(invite.id))) return json(410, { error: 'used' });
  let id;
  try {
    id = await repo.insertReview({ invite_id: invite.id, kind: invite.kind, name: row.name, quote: row.quote });
  } catch (error) {
    await repo.releaseInvite(invite.id).catch(() => {});
    throw error;
  }
  const review = { kind: invite.kind, name: row.name, quote: row.quote };
  waitUntil(afterSubmit(repo, id, review, { env, fetchImpl, now, translate, send }));
  return json(201, { ok: true });
}

export function createTestimonialRepo(db) {
  const check = ({ data, error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };
  return {
    // For the email decision page (api/referral-review.js)
    async get(id) {
      return check(await db.from('site_reviews').select('id, status, name').eq('id', id).maybeSingle(), 'get');
    },
    async decide(id, status) {
      return check(await db.from('site_reviews').update({ status })
        .eq('id', id).eq('status', 'pending').select('id, status, name').maybeSingle(), 'decide');
    },
    async getReview(id) {
      return check(await db.from('site_reviews').select('id, quote').eq('id', id).maybeSingle(), 'getReview');
    },
    async listApproved() {
      return check(await db.from('site_reviews').select('kind, name, quote, translations')
        .eq('status', 'approved').order('created_at', { ascending: true }).limit(100), 'listApproved') ?? [];
    },
    async findInvite(tokenHash) {
      return check(await db.from('review_invites').select('id, name, kind, expires_at, used_at')
        .eq('token_hash', tokenHash).maybeSingle(), 'findInvite');
    },
    async claimInvite(id) {
      const data = check(await db.from('review_invites').update({ used_at: new Date().toISOString() })
        .eq('id', id).is('used_at', null).select('id'), 'claimInvite');
      return (data ?? []).length === 1;
    },
    async releaseInvite(id) {
      check(await db.from('review_invites').update({ used_at: null }).eq('id', id), 'releaseInvite');
    },
    async insertReview(row) {
      return check(await db.from('site_reviews').insert(row).select('id').single(), 'insertReview').id;
    },
    async setTranslations(id, translations) {
      check(await db.from('site_reviews').update({ translations }).eq('id', id), 'setTranslations');
    },
    async getRole(userId) {
      return check(await db.from('profiles').select('role').eq('id', userId).maybeSingle(), 'getRole')?.role ?? null;
    },
  };
}
