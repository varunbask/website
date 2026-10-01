import { adminClient } from '../_lib/supabase.js';
import { createRepo } from '../_lib/repo.js';
import { handleSweep } from '../_lib/http.js';

// Vercel Cron calls this each hour with Authorization: Bearer $CRON_SECRET
export async function GET(request) {
  let db;
  try {
    db = adminClient();
  } catch {
    return Response.json({ error: 'Grading is not configured.' }, { status: 500 });
  }
  return handleSweep(request, { repo: createRepo(db) });
}
