import { waitUntil } from '@vercel/functions';
import { adminClient, verifyBearer } from './_lib/supabase.js';
import { handleTestimonials, createTestimonialRepo } from './_lib/testimonials.js';

async function run(request) {
  let db;
  try {
    db = adminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 500 });
  }
  const repo = createTestimonialRepo(db);
  const verifyAdmin = async (req) => {
    const caller = await verifyBearer(req, db);
    return caller && (await repo.getRole(caller.id)) === 'admin' ? caller : null;
  };
  try {
    return await handleTestimonials(request, { repo, verifyAdmin, waitUntil });
  } catch (error) {
    console.error('[testimonials]', error?.message ?? error?.name ?? 'Error');
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
