import { adminClient } from './_lib/supabase.js';
import { handleReferral, createReferralRepo } from './_lib/referral.js';

export async function POST(request) {
  let db;
  try {
    db = adminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 500 });
  }
  try {
    return await handleReferral(request, { repo: createReferralRepo(db) });
  } catch (error) {
    console.error('[referral]', error?.message ?? error?.name ?? 'Error');
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
