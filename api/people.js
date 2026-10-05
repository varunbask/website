import { adminClient, verifyBearer } from './_lib/supabase.js';
import { handlePeople, createPeopleRepo } from './_lib/people.js';

// People without a sign-in and their personal join links (api/_lib/people.js)
async function run(request) {
  let db;
  try {
    db = adminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 500 });
  }
  const repo = createPeopleRepo(db);
  const verifyAdmin = async (req) => {
    const caller = await verifyBearer(req, db);
    return caller && (await repo.getRole(caller.id)) === 'admin' ? caller : null;
  };
  try {
    return await handlePeople(request, { repo, auth: db.auth.admin, verifyAdmin });
  } catch (error) {
    console.error('[people]', error?.message ?? error?.name ?? 'Error');
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
