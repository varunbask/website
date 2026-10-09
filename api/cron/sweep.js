import { adminClient } from '../_lib/supabase.js';
import { createRepo } from '../_lib/repo.js';
import { createGoogleRepo } from '../_lib/google/repo.js';
import { handleSweep } from '../_lib/http.js';

// Vercel Cron calls this once a day with Authorization: Bearer $CRON_SECRET.
// It deletes homework-draft lesson files left over a day (draft-sources), grades
// what is waiting, then (when Google is set up) tends each tutor's Google Calendar sync.
export async function GET(request) {
  let db;
  try {
    db = adminClient();
  } catch {
    return Response.json({ error: 'Grading is not configured.' }, { status: 500 });
  }
  return handleSweep(request, { repo: createRepo(db), googleRepo: createGoogleRepo(db) });
}
