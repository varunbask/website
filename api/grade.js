import { waitUntil } from '@vercel/functions';
import { adminClient, verifyBearer } from './_lib/supabase.js';
import { createRepo } from './_lib/repo.js';
import { handleGrade } from './_lib/http.js';

export async function POST(request) {
  let db;
  try {
    db = adminClient();
  } catch {
    return Response.json({ error: 'Grading is not configured.' }, { status: 500 });
  }
  return handleGrade(request, { repo: createRepo(db), verify: (req) => verifyBearer(req, db), waitUntil });
}
