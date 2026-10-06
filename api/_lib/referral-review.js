import { createHmac, timingSafeEqual } from 'node:crypto';

// Approve or decline a referral, or a family's review for the landing page,
// from its notification email. `kind` says which: 'referral' (the default,
// so links already sent keep working) or 'testimonial'.
//
// Each email carries two signed links (an HMAC of the referral id, the
// action and an expiry). Opening a link only shows a confirmation page:
// mail security scanners and link previews fetch links on their own, so a
// GET never changes anything. The decision happens on the page's button
// (a POST with the same signed values). A decision only applies to a
// referral that is still new, so each link works once.

export const ACTIONS = Object.freeze(['approve', 'decline']);
export const KINDS = Object.freeze(['referral', 'testimonial']);
export const LINK_DAYS = 30;
const DAY_MS = 86_400_000;
const STATUS_FOR = { approve: 'approved', decline: 'declined' };

// What each kind is called and how a row is described on the pages
const COPY = {
  referral: { noun: 'referral', describe: (r) => `${r.family_name}, referred by ${r.referrer_name}`, portal: '/portal/people.html#/referrals', listName: 'referrals' },
  testimonial: { noun: 'review', describe: (r) => `the review from ${r.name}`, portal: '/portal/people.html#/reviews', listName: 'reviews' },
};
const kindOf = (k) => (KINDS.includes(k) ? k : 'referral');

const key = (env) => `referral-review:${env.CRON_SECRET ?? ''}`;

export function signReview({ kind = 'referral', id, action, exp }, env = process.env) {
  // Referral links keep their original form, so emails already sent still verify
  const message = kind === 'referral' ? `${id}.${action}.${exp}` : `${kind}.${id}.${action}.${exp}`;
  return createHmac('sha256', key(env)).update(message).digest('hex');
}

// The query string of a decision link: (kind,) id, action, exp (ms), signature
export function reviewQuery({ kind = 'referral', id, action, now = Date.now() }, env = process.env) {
  const exp = now + LINK_DAYS * DAY_MS;
  const t = signReview({ kind, id, action, exp }, env);
  const params = { id: String(id), action, exp: String(exp), t };
  return new URLSearchParams(kind === 'referral' ? params : { kind, ...params }).toString();
}

// -> { ok, kind, id, action, reason } for raw link or form values
export function verifyReview(values, { env = process.env, now = Date.now() } = {}) {
  const kind = values?.kind === undefined ? 'referral' : String(values.kind);
  const id = Number(values?.id);
  const exp = Number(values?.exp);
  const action = String(values?.action ?? '');
  const t = String(values?.t ?? '');
  if (!env.CRON_SECRET) return { ok: false, reason: 'not_configured' };
  if (!KINDS.includes(kind) || !Number.isSafeInteger(id) || id <= 0 || !ACTIONS.includes(action) || !Number.isFinite(exp) || !/^[0-9a-f]{64}$/.test(t)) {
    return { ok: false, reason: 'invalid' };
  }
  const expected = Buffer.from(signReview({ kind, id, action, exp }, env), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(t, 'hex'))) return { ok: false, reason: 'invalid' };
  if (now > exp) return { ok: false, reason: 'expired' };
  return kind === 'referral' ? { ok: true, id, action } : { ok: true, kind, id, action };
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A small page in the site's own style (the site CSP allows only its own
// stylesheet, so nothing inline)
export function reviewPage({ title, text, form = null, link = true, kind = 'referral' }) {
  const copy = COPY[kindOf(kind)];
  const body = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(text)}</p>`,
    form,
    link ? `<p><a class="text-link" href="${copy.portal}">Open ${copy.listName} in the portal</a></p>` : '',
  ].filter(Boolean).join('\n      ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} | VP Education Group</title>
  <link rel="stylesheet" href="/styles.css?v=11">
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
  invalid: ['This link does not work', 'The link is incomplete or was changed. Open the portal instead.'],
  expired: ['This link has expired', `These links last ${LINK_DAYS} days. Open the portal instead.`],
  not_configured: ['These links are not set up', 'Open the portal instead.'],
  missing: ['Not found', 'It may have been removed already.'],
};
const failPage = (reason, status = 400, kind = 'referral') => html(status, reviewPage({ title: FAIL[reason][0], text: FAIL[reason][1], kind }));

const doneText = (r) => (r.status === 'approved' ? 'approved' : 'declined');
const pickRepo = (kind, { repo, repos }) => (repos ? repos[kind] : (kind === 'referral' ? repo : null));

// GET: show what the button will do. Never changes anything.
export async function handleReviewGet(request, { repo, repos, env = process.env, now = () => Date.now() }) {
  const values = Object.fromEntries(new URL(request.url).searchParams);
  const check = verifyReview(values, { env, now: now() });
  if (!check.ok) return failPage(check.reason);
  const kind = kindOf(check.kind);
  const copy = COPY[kind];
  const store = pickRepo(kind, { repo, repos });
  const r = store ? await store.get(check.id) : null;
  if (!r) return failPage('missing', 404, kind);
  if (r.status === 'approved' || r.status === 'declined') {
    return html(200, reviewPage({ title: `Already ${doneText(r)}`, text: `The ${copy.noun} for ${copy.describe(r)} was already ${doneText(r)}.`, kind }));
  }
  const verb = check.action === 'approve' ? 'Approve' : 'Decline';
  const fields = kind === 'referral' ? ['id', 'action', 'exp', 't'] : ['kind', 'id', 'action', 'exp', 't'];
  const hidden = fields.map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(values[k])}">`).join('');
  const form = `<form method="post" action="/api/referral-review">${hidden}<button class="btn btn-primary" type="submit">${verb} this ${copy.noun}</button></form>`;
  const text = kind === 'testimonial' && check.action === 'approve'
    ? `${copy.describe(r)}. Approving shows it on the website, in every language, as it appeared in the email.`
    : copy.describe(r);
  return html(200, reviewPage({ title: `${verb} this ${copy.noun}?`, text, form, kind }));
}

// POST: apply the decision, only while it is still undecided
export async function handleReviewPost(request, { repo, repos, env = process.env, now = () => Date.now() }) {
  const text = await request.text();
  if (text.length > 2048) return failPage('invalid');
  const values = Object.fromEntries(new URLSearchParams(text));
  const check = verifyReview(values, { env, now: now() });
  if (!check.ok) return failPage(check.reason);
  const kind = kindOf(check.kind);
  const copy = COPY[kind];
  const store = pickRepo(kind, { repo, repos });
  if (!store) return failPage('missing', 404, kind);
  const changed = await store.decide(check.id, STATUS_FOR[check.action]);
  if (changed) {
    const verb = check.action === 'approve' ? 'Approved' : 'Declined';
    const extra = kind === 'testimonial' && changed.status === 'approved' ? ' It now shows on the website.' : '';
    return html(200, reviewPage({ title: verb, text: `The ${copy.noun} for ${copy.describe(changed)} is ${doneText(changed)}.${extra}`, kind }));
  }
  const r = await store.get(check.id);
  if (!r) return failPage('missing', 404, kind);
  return html(200, reviewPage({ title: `Already ${doneText(r)}`, text: `The ${copy.noun} for ${copy.describe(r)} was already ${doneText(r)}.`, kind }));
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
