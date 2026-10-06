import { waitUntil } from '@vercel/functions';
import { adminClient } from './_lib/supabase.js';
import { handleReferral, createReferralRepo } from './_lib/referral.js';
import { sendReferralEmail } from './_lib/referral-mail.js';
import { handleReviewGet, handleReviewPost, createReviewRepo, reviewPage, isReviewPost, MAX_REVIEW_BODY } from './_lib/referral-review.js';
import { createTestimonialRepo } from './_lib/testimonials.js';

// One function for the "Refer a family" form and the approve or decline links
// in notification emails. /api/referral-review is rewritten here (vercel.json),
// so links already sent keep working; that frees a Vercel function slot.
//
//   POST (JSON)            a referral or consultation request from the landing page
//   POST (form, no JS)     the same two forms posted without JavaScript
//   GET  (?kind&id&...)    the confirm page behind an email's Approve or Decline
//   POST (form, signed)    the confirm page's button (carries id, action, exp, t)

const htmlError = (title, text) => new Response(reviewPage({ title, text }),
  { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });

async function review(handler, request) {
  let db;
  try {
    db = adminClient();
  } catch {
    return htmlError('These links are not set up', 'Open the portal instead.');
  }
  try {
    return await handler(request, { repos: { referral: createReviewRepo(db), testimonial: createTestimonialRepo(db) } });
  } catch (error) {
    console.error('[referral-review]', error?.message ?? error?.name ?? 'Error');
    return htmlError('Something went wrong', 'Try again, or open the portal.');
  }
}

export function GET(request) {
  return review(handleReviewGet, request);
}

// The confirm button's post is told from a native form post by its signed fields
async function isReviewButton(request) {
  if (!(request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) return false;
  if (Number(request.headers.get('content-length') ?? 0) > MAX_REVIEW_BODY) return false;
  return isReviewPost(await request.clone().text());
}

export async function POST(request) {
  if (await isReviewButton(request)) return review(handleReviewPost, request);
  let db;
  try {
    db = adminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 500 });
  }
  try {
    return await handleReferral(request, {
      repo: createReferralRepo(db),
      notify: (row, id) => sendReferralEmail(row, id),
      waitUntil,
    });
  } catch (error) {
    console.error('[referral]', error?.message ?? error?.name ?? 'Error');
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
