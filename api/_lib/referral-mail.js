import { reviewQuery } from './referral-review.js';

// The email the owner gets for each new referral, sent through Resend.
// Everything the visitor typed is escaped. Without RESEND_API_KEY nothing is
// sent (the referral is still saved and shows in the portal).

export const DEFAULT_TO = 'vbmgroupsllc@gmail.com';
export const DEFAULT_FROM = 'VP Education Group <referrals@varunbaskaran.com>';
const DEFAULT_SITE = 'https://www.varunbaskaran.com';
const LANGUAGE_NAMES = { en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French', ko: 'Korean' };

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const siteOf = (env) => String(env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, '');

export function reviewLinks(id, { env = process.env, now = Date.now() } = {}) {
  const base = `${siteOf(env)}/api/referral-review`;
  return {
    approve: `${base}?${reviewQuery({ id, action: 'approve', now }, env)}`,
    decline: `${base}?${reviewQuery({ id, action: 'decline', now }, env)}`,
    portal: `${siteOf(env)}/portal/people.html#/referrals`,
  };
}

export function buildReferralEmail(row, id, { env = process.env, now = Date.now() } = {}) {
  const links = reviewLinks(id, { env, now });
  const who = row.referrer_role === 'student' ? 'a student' : 'a parent';
  const lines = [
    ['Family', row.family_name],
    ['Email', row.family_email],
    ['Phone', row.family_phone],
    ['Grade', row.grade],
    ['Subjects', row.subjects],
    ['Note', row.note],
    ['Referred by', `${row.referrer_name}, ${who} (${row.referrer_email})`],
    ['Form language', LANGUAGE_NAMES[row.language] ?? 'English'],
  ].filter(([, v]) => v);

  const subject = `New referral: ${row.family_name}`.slice(0, 150);
  const text = [
    `New referral from the website.`,
    '',
    ...lines.map(([k, v]) => `${k}: ${v}`),
    '',
    `Approve: ${links.approve}`,
    `Decline: ${links.decline}`,
    `All referrals: ${links.portal}`,
    '',
    'Each link opens a page with a button to confirm. Links work for 30 days.',
  ].join('\n');

  const cell = 'padding:6px 12px 6px 0;vertical-align:top;';
  const rows = lines.map(([k, v]) => `<tr><td style="${cell}color:#6E585C;white-space:nowrap;">${escapeHtml(k)}</td><td style="${cell}color:#241619;white-space:pre-wrap;">${escapeHtml(v)}</td></tr>`).join('');
  const btn = (href, label, bg, fg) => `<a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 21px;margin:0 8px 8px 0;border:1px solid ${bg === '#FFFFFF' ? '#CDBFB8' : bg};border-radius:6px;background:${bg};color:${fg};font-weight:700;text-decoration:none;">${label}</a>`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#FBF8F5;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#241619;">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E6D9D2;border-radius:8px;padding:24px;">
<p style="margin:0 0 4px;color:#B3282D;font-weight:700;">VP Education Group</p>
<h1 style="margin:0 0 16px;font-size:20px;">New referral: ${escapeHtml(row.family_name)}</h1>
<table role="presentation" style="border-collapse:collapse;margin:0 0 20px;">${rows}</table>
<p style="margin:0 0 12px;">${btn(links.approve, 'Approve', '#B3282D', '#FFFFFF')}${btn(links.decline, 'Decline', '#FFFFFF', '#241619')}</p>
<p style="margin:0 0 8px;color:#6E585C;font-size:13px;">Each button opens a page where you confirm. Links work for 30 days. Reply to this email to write to ${escapeHtml(row.family_email ? 'the family' : 'the person who referred them')}.</p>
<p style="margin:0;font-size:13px;"><a href="${escapeHtml(links.portal)}" style="color:#B3282D;">See all referrals in the portal</a></p>
</div></body></html>`;

  return { subject, text, html, replyTo: row.family_email || row.referrer_email };
}

// Sends one email through Resend: to the business inbox, unless the mail names
// its own `to` (a family's portal invite) and `from`.
// -> 'sent' | 'skipped' (no key); throws when Resend refuses it
export async function sendMail(mail, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.RESEND_API_KEY) return 'skipped';
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: mail.from || env.REFERRAL_EMAIL_FROM || DEFAULT_FROM,
      to: [mail.to || env.REFERRAL_EMAIL_TO || DEFAULT_TO],
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend answered ${response.status}`);
  return 'sent';
}

export async function sendReferralEmail(row, id, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  return sendMail(buildReferralEmail(row, id, { env, now }), { env, fetchImpl });
}
