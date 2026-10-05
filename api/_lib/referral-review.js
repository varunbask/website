import { createHmac, timingSafeEqual } from 'node:crypto';

// Approve or decline a referral from its notification email.
//
// Each email carries two signed links (an HMAC of the referral id, the
// action and an expiry). Opening a link only shows a confirmation page:
// mail security scanners and link previews fetch links on their own, so a
// GET never changes anything. The decision happens on the page's button
// (a POST with the same signed values). A decision only applies to a
// referral that is still new, so each link works once.

export const ACTIONS = Object.freeze(['approve', 'decline']);
export const LINK_DAYS = 30;
const DAY_MS = 86_400_000;
const STATUS_FOR = { approve: 'approved', decline: 'declined' };

const key = (env) => `referral-review:${env.CRON_SECRET ?? ''}`;

export function signReview({ id, action, exp }, env = process.env) {
  return createHmac('sha256', key(env)).update(`${id}.${action}.${exp}`).digest('hex');
}

// The query string of a review link: id, action, exp (ms) and the signature
export function reviewQuery({ id, action, now = Date.now() }, env = process.env) {
  const exp = now + LINK_DAYS * DAY_MS;
  const t = signReview({ id, action, exp }, env);
  return new URLSearchParams({ id: String(id), action, exp: String(exp), t }).toString();
}

// -> { ok, id, action, reason } for raw link or form values
export function verifyReview(values, { env = process.env, now = Date.now() } = {}) {
  const id = Number(values?.id);
  const exp = Number(values?.exp);
  const action = String(values?.action ?? '');
  const t = String(values?.t ?? '');
  if (!env.CRON_SECRET) return { ok: false, reason: 'not_configured' };
  if (!Number.isSafeInteger(id) || id <= 0 || !ACTIONS.includes(action) || !Number.isFinite(exp) || !/^[0-9a-f]{64}$/.test(t)) {
    return { ok: false, reason: 'invalid' };
  }
  const expected = Buffer.from(signReview({ id, action, exp }, env), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(t, 'hex'))) return { ok: false, reason: 'invalid' };
  if (now > exp) return { ok: false, reason: 'expired' };
  return { ok: true, id, action };
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A small page in the site's own style (the site CSP allows only its own
// stylesheet, so nothing inline)
export function reviewPage({ title, text, form = null, link = true }) {
  const body = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(text)}</p>`,
    form,
    link ? '<p><a class="text-link" href="/portal/people.html#/referrals">Open referrals in the portal</a></p>' : '',
  ].filter(Boolean).join('\n      ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} | VP Education Group</title>
  <link rel="stylesheet" href="/styles.css?v=10">
</head>
<body>
  <main class="review-page">
    <div class="review-card">
      <p class="review-brand">VP Education Group</p>
      ${body}
    </div>
  </main>
</body>
</html>`;
}

const html = (status, page) => new Response(page, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});

const FAIL = {
  invalid: ['This link does not work', 'The link is incomplete or was changed. Open the referral in the portal instead.'],
  expired: ['This link has expired', `Review links last ${LINK_DAYS} days. Open the referral in the portal instead.`],
  not_configured: ['Review links are not set up', 'Open the referral in the portal instead.'],
  missing: ['Referral not found', 'It may have been removed already.'],
};
const failPage = (reason, status = 400) => html(status, reviewPage({ title: FAIL[reason][0], text: FAIL[reason][1] }));

const describe = (r) => `${r.family_name}, referred by ${r.referrer_name}`;
const doneText = (r) => (r.status === 'approved' ? 'approved' : 'declined');

// GET: show what the button will do. Never changes anything.
export async function handleReviewGet(request, { repo, env = process.env, now = () => Date.now() }) {
  const values = Object.fromEntries(new URL(request.url).searchParams);
  const check = verifyReview(values, { env, now: now() });
  if (!check.ok) return failPage(check.reason);
  const r = await repo.get(check.id);
  if (!r) return failPage('missing', 404);
  if (r.status !== 'new') {
    return html(200, reviewPage({ title: `Already ${doneText(r)}`, text: `The referral for ${describe(r)} was already ${doneText(r)}.` }));
  }
  const verb = check.action === 'approve' ? 'Approve' : 'Decline';
  const hidden = ['id', 'action', 'exp', 't']
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(values[k])}">`).join('');
  const form = `<form method="post" action="/api/referral-review">${hidden}<button class="btn btn-primary" type="submit">${verb} this referral</button></form>`;
  return html(200, reviewPage({ title: `${verb} this referral?`, text: describe(r), form }));
}

// POST: apply the decision, only while the referral is still new
export async function handleReviewPost(request, { repo, env = process.env, now = () => Date.now() }) {
  const text = await request.text();
  if (text.length > 2048) return failPage('invalid');
  const values = Object.fromEntries(new URLSearchParams(text));
  const check = verifyReview(values, { env, now: now() });
  if (!check.ok) return failPage(check.reason);
  const changed = await repo.decide(check.id, STATUS_FOR[check.action]);
  if (changed) {
    const verb = check.action === 'approve' ? 'Approved' : 'Declined';
    return html(200, reviewPage({ title: verb, text: `The referral for ${describe(changed)} is ${doneText(changed)}.` }));
  }
  const r = await repo.get(check.id);
  if (!r) return failPage('missing', 404);
  return html(200, reviewPage({ title: `Already ${doneText(r)}`, text: `The referral for ${describe(r)} was already ${doneText(r)}.` }));
}

export function createReviewRepo(db) {
  const FIELDS = 'id, status, family_name, referrer_name';
  return {
    async get(id) {
      const { data, error } = await db.from('referrals').select(FIELDS).eq('id', id).maybeSingle();
      if (error) throw new Error(`get: ${error.message}`);
      return data;
    },
    // Compare-and-set: only a referral that is still new changes
    async decide(id, status) {
      const { data, error } = await db.from('referrals').update({ status })
        .eq('id', id).eq('status', 'new').select(FIELDS).maybeSingle();
      if (error) throw new Error(`decide: ${error.message}`);
      return data;
    },
  };
}
