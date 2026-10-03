import { describe, test, expect, vi, afterEach } from 'vitest';
import { handleGrade, handleSweep, claimableStates, STUDENT_GRADES_PER_HOUR } from '../../api/_lib/http.js';
import { completion } from './fixtures.js';

const ENV = { LLM_ENDPOINT: 'https://llm.test/v1', LLM_KEY: 'k', CRON_SECRET: 'cron-secret' };
const NOW = new Date('2026-10-01T12:00:00Z');
const now = () => NOW;
const STUDENT = 'stu-1';

const sub = (over = {}) => ({
  id: 7, student_id: STUDENT, task_id: 3, storage_path: `${STUDENT}/a.txt`, file_type: 'text/plain',
  status: 'pending', attempts: 0, status_changed_at: NOW.toISOString(), task: { title: 'T', details: '' }, ...over,
});

function setup({ caller = { id: STUDENT }, role = 'student', submission = sub(), assigned = false, claimResult, startedThisHour = 0 } = {}) {
  const repo = {
    getSubmission: vi.fn(async () => submission),
    getRole: vi.fn(async () => role),
    isAssigned: vi.fn(async () => assigned),
    countStartedSince: vi.fn(async () => startedThisHour),
    claim: vi.fn(async (s) => (claimResult === undefined ? { ...s, status: 'grading', attempts: s.attempts + 1 } : claimResult)),
    download: vi.fn(async () => new TextEncoder().encode('x = 4')),
    saveAiGrade: vi.fn(async () => {}),
    setStatus: vi.fn(async () => {}),
  };
  const background = [];
  const deps = {
    repo,
    verify: vi.fn(async () => caller),
    waitUntil: vi.fn((p) => background.push(p)),
    env: ENV,
    now,
    fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => completion({ results: [{ id: 7, feedback: 'ok', score: 90 }] }) })),
  };
  return { repo, deps, background };
}

const post = (body = { submission_id: 7 }) => new Request('https://site.test/api/grade', {
  method: 'POST',
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

async function call(options, body) {
  const ctx = setup(options);
  const res = await handleGrade(post(body), ctx.deps);
  await Promise.all(ctx.background);
  return { res, json: await res.json(), ...ctx };
}

describe('claimableStates', () => {
  test('matches the who-may-grade table', () => {
    const s = sub();
    expect(claimableStates('student', { callerId: STUDENT, sub: s, assigned: false })).toEqual(['pending']);
    expect(claimableStates('student', { callerId: 'other', sub: s, assigned: false })).toBeNull();
    expect(claimableStates('tutor', { callerId: 't', sub: s, assigned: true })).toEqual(['pending', 'failed', 'stale']);
    expect(claimableStates('tutor', { callerId: 't', sub: s, assigned: false })).toBeNull();
    expect(claimableStates('admin', { callerId: 'a', sub: s, assigned: false })).toEqual(['pending', 'failed', 'stale']);
    expect(claimableStates('parent', { callerId: 'p', sub: s, assigned: false })).toBeNull();
    expect(claimableStates('pending', { callerId: STUDENT, sub: s, assigned: false })).toBeNull();
  });
});

describe('handleGrade', () => {
  test('401 without a valid token', async () => {
    const { res } = await call({ caller: null });
    expect(res.status).toBe(401);
  });

  test('400 for a bad body', async () => {
    for (const body of ['not json', { submission_id: '7' }, { submission_id: 0 }, {}]) {
      const { res } = await call({}, body);
      expect(res.status).toBe(400);
    }
  });

  test('500 when the grader is not configured', async () => {
    const ctx = setup();
    const res = await handleGrade(post(), { ...ctx.deps, env: {} });
    expect(res.status).toBe(500);
  });

  test('404 for a missing submission, a parent, another student, or an unassigned tutor', async () => {
    expect((await call({ submission: null })).res.status).toBe(404);
    expect((await call({ role: 'parent', caller: { id: 'p' } })).res.status).toBe(404);
    expect((await call({ caller: { id: 'stu-2' } })).res.status).toBe(404);
    expect((await call({ role: 'tutor', caller: { id: 't' }, assigned: false })).res.status).toBe(404);
  });

  test('202 when a student starts grading their own pending work, and the draft is saved in the background', async () => {
    const { res, json, repo, deps } = await call({});
    expect(res.status).toBe(202);
    expect(json).toEqual({ id: 7, status: 'grading' });
    expect(deps.waitUntil).toHaveBeenCalledTimes(1);
    expect(repo.saveAiGrade).toHaveBeenCalledWith(7, { score: 90, feedback: 'ok' });
  });

  test('409 when a student retries failed work', async () => {
    const { res, json } = await call({ submission: sub({ status: 'failed' }) });
    expect(res.status).toBe(409);
    expect(json.status).toBe('failed');
  });

  test('an assigned tutor or an admin can retry failed work', async () => {
    expect((await call({ role: 'tutor', caller: { id: 't' }, assigned: true, submission: sub({ status: 'failed', attempts: 3 }) })).res.status).toBe(202);
    expect((await call({ role: 'admin', caller: { id: 'a' }, submission: sub({ status: 'failed' }) })).res.status).toBe(202);
  });

  test('grading that is still fresh cannot be restarted; stale grading can', async () => {
    const fresh = sub({ status: 'grading', status_changed_at: new Date(NOW.getTime() - 60_000).toISOString() });
    const stale = sub({ status: 'grading', status_changed_at: new Date(NOW.getTime() - 11 * 60_000).toISOString() });
    expect((await call({ role: 'admin', caller: { id: 'a' }, submission: fresh })).res.status).toBe(409);
    expect((await call({ role: 'admin', caller: { id: 'a' }, submission: stale })).res.status).toBe(202);
  });

  test('429 when a student started too many gradings this hour', async () => {
    const { res, repo } = await call({ startedThisHour: STUDENT_GRADES_PER_HOUR });
    expect(res.status).toBe(429);
    expect(repo.countStartedSince).toHaveBeenCalledWith(STUDENT, new Date(NOW.getTime() - 3_600_000));
    expect(repo.claim).not.toHaveBeenCalled();
  });

  test('the hourly limit does not apply to staff', async () => {
    const { res, repo } = await call({ role: 'admin', caller: { id: 'a' }, startedThisHour: 99 });
    expect(res.status).toBe(202);
    expect(repo.countStartedSince).not.toHaveBeenCalled();
  });

  test('409 when another caller claimed it first', async () => {
    const { res, deps } = await call({ claimResult: null });
    expect(res.status).toBe(409);
    expect(deps.waitUntil).not.toHaveBeenCalled();
  });
});

describe('handleSweep', () => {
  const get = (auth) => new Request('https://site.test/api/cron/sweep', { headers: auth ? { Authorization: auth } : {} });
  const repo = { listDue: vi.fn(async () => []), listOrphanFiles: vi.fn(async () => []), removeFiles: vi.fn(async () => {}) };

  test('500 when CRON_SECRET is not set', async () => {
    expect((await handleSweep(get('Bearer undefined'), { repo, env: { LLM_ENDPOINT: 'x', LLM_KEY: 'y' } })).status).toBe(500);
  });

  test('401 for a missing or wrong secret', async () => {
    expect((await handleSweep(get(), { repo, env: ENV })).status).toBe(401);
    expect((await handleSweep(get('Bearer nope'), { repo, env: ENV })).status).toBe(401);
  });

  test('200 with the sweep summary for the right secret', async () => {
    const res = await handleSweep(get('Bearer cron-secret'), { repo, env: ENV, now });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reset: 0, ai_graded: 0, pending: 0, failed: 0, skipped: 0, removed_files: 0 });
  });

  describe('Google Calendar maintenance', () => {
    afterEach(() => vi.restoreAllMocks());
    const GOOGLE_ENV = { ...ENV, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_KEY: 'key' };
    const GRADING = { reset: 0, ai_graded: 0, pending: 0, failed: 0, skipped: 0, removed_files: 0 };
    const googleRepo = (tutors = []) => ({
      listSyncTutors: vi.fn(async () => tutors),
      updateConnection: vi.fn(async () => {}),
    });

    test('runs after grading when Google is set up, and adds google to the summary', async () => {
      const gr = googleRepo();
      const gradingRepo = { listDue: vi.fn(async () => []), listOrphanFiles: vi.fn(async () => []), removeFiles: vi.fn(async () => {}) };
      const res = await handleSweep(get('Bearer cron-secret'), { repo: gradingRepo, googleRepo: gr, env: GOOGLE_ENV, now });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...GRADING, google: { tutors: 0, ok: 0, failed: 0 } });
      expect(gr.listSyncTutors).toHaveBeenCalledTimes(1);
      expect(gradingRepo.listOrphanFiles.mock.invocationCallOrder[0]).toBeLessThan(gr.listSyncTutors.mock.invocationCallOrder[0]);
    });

    test('counts what happened for each tutor with sync on', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const unreadable = { user_id: 't1', purpose: 'tutor', sync_enabled: true, refresh_token_enc: 'not an encrypted token' };
      const gr = googleRepo([unreadable]);
      const fetchImpl = vi.fn();
      const res = await handleSweep(get('Bearer cron-secret'), { repo, googleRepo: gr, env: GOOGLE_ENV, now, fetchImpl });
      expect((await res.json()).google).toEqual({ tutors: 1, ok: 0, failed: 1 });
      expect(gr.updateConnection).toHaveBeenCalledWith('t1', { last_error: 'google_error' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    describe('without the model variables', () => {
      const NO_LLM = { CRON_SECRET: 'cron-secret' };
      const GOOGLE_NO_LLM = { ...NO_LLM, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_KEY: 'key' };

      test('still runs the Google upkeep, and only skips grading', async () => {
        const gr = googleRepo();
        const gradingRepo = { listDue: vi.fn(async () => []), listOrphanFiles: vi.fn(async () => []), removeFiles: vi.fn(async () => {}) };
        const res = await handleSweep(get('Bearer cron-secret'), { repo: gradingRepo, googleRepo: gr, env: GOOGLE_NO_LLM, now });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ grading: 'not configured', google: { tutors: 0, ok: 0, failed: 0 } });
        expect(gr.listSyncTutors).toHaveBeenCalledTimes(1);
        expect(gradingRepo.listDue).not.toHaveBeenCalled();
        expect(gradingRepo.listOrphanFiles).not.toHaveBeenCalled();
      });

      test('one model variable is as good as none', async () => {
        const gr = googleRepo();
        for (const env of [{ ...GOOGLE_NO_LLM, LLM_ENDPOINT: 'x' }, { ...GOOGLE_NO_LLM, LLM_KEY: 'y' }]) {
          const res = await handleSweep(get('Bearer cron-secret'), { repo, googleRepo: gr, env, now });
          expect(res.status).toBe(200);
          expect((await res.json()).grading).toBe('not configured');
        }
      });

      test('is still a 500 when Google is not set up either: there is nothing to do', async () => {
        const gr = googleRepo();
        for (const options of [{ repo, env: NO_LLM }, { repo, googleRepo: gr, env: NO_LLM }]) {
          const res = await handleSweep(get('Bearer cron-secret'), { ...options, now });
          expect(res.status).toBe(500);
          expect(await res.json()).toEqual({ error: 'Grading is not configured.' });
        }
        expect(gr.listSyncTutors).not.toHaveBeenCalled();
      });

      test('a caller without the secret is still refused before anything runs', async () => {
        const gr = googleRepo();
        expect((await handleSweep(get('Bearer nope'), { repo, googleRepo: gr, env: GOOGLE_NO_LLM, now })).status).toBe(401);
        expect(gr.listSyncTutors).not.toHaveBeenCalled();
      });

      test('a failure in the Google run is reported there, not thrown', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const gr = { listSyncTutors: vi.fn(async () => { throw new Error('listSyncTutors: down'); }) };
        const res = await handleSweep(get('Bearer cron-secret'), { repo, googleRepo: gr, env: GOOGLE_NO_LLM, now });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ grading: 'not configured', google: { error: 'Google Calendar maintenance failed.' } });
      });
    });

    test('makes no Google call, and adds nothing, when Google is not set up', async () => {
      const gr = googleRepo();
      const res = await handleSweep(get('Bearer cron-secret'), { repo, googleRepo: gr, env: ENV, now });
      expect(await res.json()).toEqual(GRADING);
      expect(gr.listSyncTutors).not.toHaveBeenCalled();
    });

    test('makes no Google call for a caller without the secret', async () => {
      const gr = googleRepo();
      expect((await handleSweep(get('Bearer nope'), { repo, googleRepo: gr, env: GOOGLE_ENV, now })).status).toBe(401);
      expect(gr.listSyncTutors).not.toHaveBeenCalled();
    });

    test('a failure in the Google run does not lose the grading summary', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const gr = { listSyncTutors: vi.fn(async () => { throw new Error('listSyncTutors: down'); }) };
      const res = await handleSweep(get('Bearer cron-secret'), { repo, googleRepo: gr, env: GOOGLE_ENV, now });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...GRADING, google: { error: 'Google Calendar maintenance failed.' } });
    });
  });
});
