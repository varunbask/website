import { describe, test, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readModelEnv, modelEnv, createJobs, createServer, MODEL_KEYS } from '../../tools/demo/serve-ai.mjs';
import { draftV2 } from './draft-fixtures.js';
import { docx, wp, wr, pdf } from './source-fixtures.js';

// tools/demo/serve-ai.mjs: the local server for trying drafts in a browser.
// Everything here runs offline with a fake model; nothing reads a real .env.
const JPEG = `data:image/jpeg;base64,${'A'.repeat(400)}`;
const DRAFT = draftV2();
// A local mock of the Messages API, as the checks use; production allows only api.anthropic.com
const ENV = { LLM_ENDPOINT: 'http://127.0.0.1:9/v1/messages', LLM_KEY: 'test-key' };
const message = (body) => ({ type: 'message', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(body) }], stop_reason: 'end_turn' });
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => message(DRAFT) }));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

afterEach(() => vi.restoreAllMocks());

describe('the env file', () => {
  test('only the model settings are read; everything else in the file is skipped', () => {
    const text = [
      '# comment',
      'SUPABASE_URL=https://x.supabase.co',
      'SUPABASE_SERVICE_ROLE_KEY=never-read',
      'LLM_ENDPOINT=https://api.example.test/v1/chat/completions',
      'export LLM_KEY="sk-test-123"',
      "LLM_MODEL='grader-model' # the grader",
      'HOMEWORK_MODEL=claude-opus-5-5 # drafts',
      'CRON_SECRET=never-read-either',
    ].join('\n');
    expect(readModelEnv(text)).toEqual({
      LLM_ENDPOINT: 'https://api.example.test/v1/chat/completions',
      LLM_KEY: 'sk-test-123',
      LLM_MODEL: 'grader-model',
      HOMEWORK_MODEL: 'claude-opus-5-5',
    });
    expect(MODEL_KEYS).toEqual(['LLM_ENDPOINT', 'LLM_KEY', 'LLM_MODEL', 'HOMEWORK_MODEL']);
  });

  test('the file wins; the environment fills what the file lacks; nothing else is taken from either', () => {
    const env = modelEnv({ fileText: 'LLM_KEY=from-file', processEnv: { LLM_KEY: 'from-env', LLM_ENDPOINT: 'e', SUPABASE_SERVICE_ROLE_KEY: 'x' } });
    expect(env).toEqual({ LLM_KEY: 'from-file', LLM_ENDPOINT: 'e' });
    expect(modelEnv({ processEnv: { HOMEWORK_MODEL: 'm' } })).toEqual({ HOMEWORK_MODEL: 'm' });
  });

  test('the server never prints the settings, and listens on 127.0.0.1 only', () => {
    const source = readFileSync(new URL('../../tools/demo/serve-ai.mjs', import.meta.url), 'utf8');
    for (const call of source.match(/console\.(log|error)\([^;]*;/g) ?? []) expect(call).not.toMatch(/env\.|LLM_KEY|fileText|process\.env/);
    expect(source).toContain("server.listen(port, '127.0.0.1'");
    expect(source).not.toMatch(/['"]\.env['"]/);   // never opens the repo .env by itself
  });
});

describe('jobs', () => {
  const NOW = new Date('2026-10-08T18:00:00Z');

  test('202 with an id, drafting, then ready with the draft', async () => {
    const jobs = createJobs({ env: ENV, fetchImpl: okFetch(), now: () => NOW });
    const started = jobs.start({ action: 'draft_homework', images: [JPEG], count: 5, student_id: 'u-maya' });
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ id: 10_000_001, status: 'drafting', stage: 'drafting', created_at: NOW.toISOString() });
    expect(jobs.status({ id: 10_000_001 }).body.status).toBe('drafting');
    await started.done;
    const ready = jobs.status({ id: 10_000_001 });
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: 'ready', student_id: 'u-maya', options: { count: 5, photos: 1 } });
    expect(ready.body.result.title).toBe('Factoring trinomials');
    expect(JSON.stringify(jobs.jobs.get(10_000_001).options)).not.toContain('base64');
  });

  test('files sent inline (only this server takes them): the native call production makes, through the mock', async () => {
    const fetchImpl = okFetch();
    const jobs = createJobs({ env: ENV, fetchImpl, now: () => NOW });
    const started = jobs.start({
      action: 'draft_homework', count: 5, notes_text: 'Ratios.',
      inline_sources: [{ name: 'Worksheet.pdf', type: 'pdf', data: b64(pdf({ pages: 2 })) }, { name: 'Notes.docx', type: 'docx', data: b64(docx({ body: wp(wr('Unit rates')) })) }],
    });
    expect(started.status).toBe(202);
    expect(started.body.stage).toBe('reading');
    await started.done;
    expect(jobs.status({ id: started.body.id }).body).toMatchObject({ status: 'ready', options: { files: 2, pasted_notes: true } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9/v1/messages');
    expect(init.headers).toEqual({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
    const content = JSON.parse(init.body).messages[0].content;
    expect(content.map((b) => b.type)).toEqual(['document', 'text', 'text', 'text', 'text']);
    expect(content[0].title).toBe('Worksheet.pdf');
    expect(content[1].text).toContain('Unit rates');
    // paths need storage, which this server does not have
    expect(jobs.start({ action: 'draft_homework', sources: [{ path: '11111111-2222-4333-8444-555555555555/k3yAbc12/1-a.pdf', name: 'a.pdf' }] }).status).toBe(400);
  });

  test('like production, only api.anthropic.com or a loopback mock', async () => {
    const jobs = createJobs({ env: { LLM_ENDPOINT: 'https://llm.test/v1/chat/completions', LLM_KEY: 'k' }, fetchImpl: okFetch(), now: () => NOW });
    const started = jobs.start({ action: 'draft_homework', images: [JPEG] });
    await started.done;
    expect(jobs.status({ id: started.body.id }).body).toMatchObject({ status: 'failed', error: 'The AI service rejected the request. This is a setup problem, not your files: tell the admin.' });
  });

  test('a model failure is failed with a message; bad input is 400; no settings is 500', async () => {
    const jobs = createJobs({ env: ENV, fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })), now: () => NOW });
    const started = jobs.start({ action: 'draft_homework', images: [JPEG] });
    await started.done;
    expect(jobs.status({ id: started.body.id }).body).toMatchObject({ status: 'failed', error: 'The AI service did not answer. Try again.' });
    expect(jobs.start({ action: 'draft_homework', images: [] }).status).toBe(400);
    expect(jobs.start({ action: 'draft_homework', images: [JPEG], count: 99 }).status).toBe(400);
    expect(createJobs({ env: {} }).start({ action: 'draft_homework', images: [JPEG] }).status).toBe(500);
    expect(jobs.status({ id: 'x' }).status).toBe(400);
    expect(jobs.status({ id: 5 }).status).toBe(404);
  });

  test('a job still drafting after 6 minutes reads failed', () => {
    let t = NOW.getTime();
    const jobs = createJobs({ env: ENV, fetchImpl: vi.fn(() => new Promise(() => {})), now: () => new Date(t) });
    const { body } = jobs.start({ action: 'draft_homework', images: [JPEG] });
    t += 6 * 60_000 + 1000;
    expect(jobs.status({ id: body.id }).body).toMatchObject({ status: 'failed', error: 'This draft took too long. Try again.' });
  });
});

describe('the server', () => {
  async function withServer(jobs, run) {
    const dir = mkdtempSync(join(tmpdir(), 'serve-ai-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>demo</title>');
    const server = createServer({ root: dir, jobs });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      await run(base);
    } finally {
      await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const post = (base, body) => fetch(`${base}/api/grade`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  test('serves the demo uncached, refuses paths outside it, and answers both actions', async () => {
    const fetchImpl = okFetch();
    const jobs = createJobs({ env: ENV, fetchImpl });
    await withServer(jobs, async (base) => {
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(await page.text()).toContain('<title>demo</title>');
      expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/hosts`)).status).toBe(404);
      expect((await fetch(`${base}/missing.js`)).status).toBe(404);

      const started = await post(base, { action: 'draft_homework', images: [JPEG], count: 5 });
      expect(started.status).toBe(202);
      const { id } = await started.json();
      await Promise.all([...jobs.jobs.values()].map(() => new Promise((r) => setTimeout(r, 20))));
      const status = await (await post(base, { action: 'draft_status', id })).json();
      expect(status.status).toBe('ready');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('claude-opus-5-5');

      expect((await post(base, { submission_id: 7 })).status).toBe(404);
      expect((await fetch(`${base}/api/grade`)).status).toBe(405);
      const bad = await fetch(`${base}/api/grade`, { method: 'POST', body: 'not json' });
      expect(bad.status).toBe(400);
    });
  });

  test('the demo extension sends both actions to the network only with ?ai=live', () => {
    const ext = readFileSync(new URL('../../tools/demo/extend-homework-ai.js', import.meta.url), 'utf8');
    expect(ext).toContain("new URLSearchParams(location.search).get('ai') === 'live'");
    expect(ext).toMatch(/if \(LIVE\) \{\n[^}]*const res = await network\(url\.href, \{ \.\.\.init, body \}\);/);
    // the uploaded files go inline, and the demo's storage deletes them when the draft is done
    expect(ext).toContain('return { ...rest, inline_sources: inline };');
    expect(ext).toContain("if (data.status !== 'drafting') { dropSources(livePaths.get(data.id)); livePaths.delete(data.id); }");
    expect(ext).toContain("if (b.action !== 'draft_homework' && b.action !== 'draft_status') return demoFetch(input, init);");
    expect(readdirSync(new URL('../../tools/demo/', import.meta.url))).toContain('extend-homework-ai.js');
  });
});
