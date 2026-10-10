import { adminClient, verifyBearer } from './_lib/supabase.js';
import { handlePeople, createPeopleRepo } from './_lib/people.js';
import { googleConfig } from './_lib/google/config.js';
import { createGoogleRepo } from './_lib/google/repo.js';
import { disconnectUser } from './_lib/google/handlers.js';

// People without a sign-in and their personal join links, and deleting a person
// for good (api/_lib/people.js, api/_lib/people-delete.js)
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
  // Deleting a person revokes and removes their Google Calendar connection first
  const disconnectGoogle = (userId) => disconnectUser(userId, { repo: createGoogleRepo(db), config: googleConfig(), fetchImpl: fetch });
  try {
    // Logs carry actions, roles and counts, never names or addresses
    const log = (line) => console.log(line);
    const warn = (...parts) => console.warn(...parts);
    return await handlePeople(request, { repo, auth: db.auth.admin, verifyAdmin, disconnectGoogle, log, warn });
  } catch (error) {
    console.error('[people]', error?.message ?? error?.name ?? 'Error');
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
