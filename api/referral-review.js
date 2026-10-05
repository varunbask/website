import { adminClient } from './_lib/supabase.js';
import { handleReviewGet, handleReviewPost, createReviewRepo, reviewPage } from './_lib/referral-review.js';

function run(handler) {
  return async (request) => {
    let db;
    try {
      db = adminClient();
    } catch {
      return new Response(reviewPage({ title: 'Review links are not set up', text: 'Open the referral in the portal instead.' }),
        { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    try {
      return await handler(request, { repo: createReviewRepo(db) });
    } catch (error) {
      console.error('[referral-review]', error?.message ?? error?.name ?? 'Error');
      return new Response(reviewPage({ title: 'Something went wrong', text: 'Try again, or open the referral in the portal.' }),
        { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  };
}

export const GET = run(handleReviewGet);
export const POST = run(handleReviewPost);
