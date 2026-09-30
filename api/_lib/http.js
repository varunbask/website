import { timingSafeEqual } from 'node:crypto';
import { gradeClaimed, sweep, STALE_GRADING_MS } from './grader.js';

const json = (status, body) => Response.json(body, { status });

// Which states the caller may start grading from, or null if they may not grade it at all
export function claimableStates(role, { callerId, sub, assigned }) {
  if (role === 'student') return sub.student_id === callerId ? ['pending'] : null;
  if (role === 'admin' || (role === 'tutor' && assigned)) return ['pending', 'failed', 'stale'];
  return null;
}

function canClaim(states, sub, now) {
  if (states.includes(sub.status)) return true;
  return sub.status === 'grading' && states.includes('stale')
    && now.getTime() - new Date(sub.status_changed_at).getTime() > STALE_GRADING_MS;
}

export async function handleGrade(request, {
  repo, verify, waitUntil, env = process.env, now = () => new Date(), fetchImpl = fetch,
}) {
  const caller = await verify(request);
  if (!caller) return json(401, { error: 'Sign in again.' });

  let body = null;
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  const id = body?.submission_id;
  if (!Number.isSafeInteger(id) || id <= 0) return json(400, { error: 'submission_id must be a positive integer' });
  if (!env.LLM_ENDPOINT || !env.LLM_KEY) return json(500, { error: 'Grading is not configured.' });

  const sub = await repo.getSubmission(id);
  if (!sub) return json(404, { error: 'Submission not found.' });
  const role = await repo.getRole(caller.id);
  const assigned = role === 'tutor' ? await repo.isAssigned(caller.id, sub.student_id) : false;
  const states = claimableStates(role, { callerId: caller.id, sub, assigned });
  if (!states) return json(404, { error: 'Submission not found.' });
  if (!canClaim(states, sub, now())) {
    return json(409, { error: 'This submission is not waiting to be graded.', status: sub.status });
  }

  const claimed = await repo.claim(sub, now());
  if (!claimed) return json(409, { error: 'Grading already started.', status: 'grading' });

  waitUntil(gradeClaimed(repo, claimed, { env, fetchImpl, now })
    .catch((err) => console.error(`[grade] submission ${id}: ${err.name}`)));
  return json(202, { id, status: 'grading' });
}

export async function handleSweep(request, { repo, env = process.env, now = () => new Date(), fetchImpl = fetch }) {
  if (!env.CRON_SECRET) return json(500, { error: 'CRON_SECRET is not set.' });
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return json(401, { error: 'Unauthorized' });
  }
  if (!env.LLM_ENDPOINT || !env.LLM_KEY) return json(500, { error: 'Grading is not configured.' });
  return json(200, await sweep(repo, { env, now, fetchImpl }));
}
