import { adminClient } from './_lib/supabase.js';
import { handleReviewGet, handleReviewPost, createReviewRepo, reviewPage } from './_lib/referral-review.js';
import { createTestimonialRepo } from './_lib/testimonials.js';

function run(handler) {
  return async (request) => {
    let db;
    try {
      db = adminClient();
    } catch {
      return new Response(reviewPage({ title: 'These links are not set up', text: 'Open the portal instead.' }),
        { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    try {
      return await handler(request, { repos: { referral: createReviewRepo(db), testimonial: createTestimonialRepo(db) } });
    } catch (error) {
      console.error('[referral-review]', error?.message ?? error?.name ?? 'Error');
      return new Response(reviewPage({ title: 'Something went wrong', text: 'Try again, or open the portal.' }),
        { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  };
}

export const GET = run(handleReviewGet);
export const POST = run(handleReviewPost);
