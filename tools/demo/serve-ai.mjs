// Local use only: serves a demo build (like serve.py, nothing cached) and
// answers homework drafts with the real model, so the owner can try drafting
// in a browser before anything ships.
//
//   node tools/demo/serve-ai.mjs <port> <demo dir> [--env-file <path>]
//
// Open the demo with ?ai=live (for example
// http://127.0.0.1:4265/portal/staff.html?as=tutor&ai=live#/today): the demo
// client then sends POST /api/grade { action: 'draft_homework' | 'draft_status' }
// here, and this server calls draftHomework() from api/_lib/homework-draft.js
// directly. Jobs live in this process's memory: 202 with an id at once, then
// the status is asked for until the draft is ready or failed.
//
// There is no database and no sign-in check here, because this is the local
// demo: it listens on 127.0.0.1 only and must never be deployed (tools/ is in
// .vercelignore). Photos stay in memory for the one call and are never written
// to disk.
//
// The model settings come from --env-file, which is read for LLM_ENDPOINT,
// LLM_KEY, LLM_MODEL and HOMEWORK_MODEL only (nothing else in the file is
// read into this process), and otherwise from the environment. They are never
// printed or logged.
import http from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDraftRequest, draftHomework, draftOptions, DraftError, DRAFT_STALE_MS } from '../../api/_lib/homework-draft.js';

export const MODEL_KEYS = Object.freeze(['LLM_ENDPOINT', 'LLM_KEY', 'LLM_MODEL', 'HOMEWORK_MODEL']);
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;
const KEEP_JOBS_MS = 24 * 3_600_000;

// The model settings in an env file's text: only MODEL_KEYS, KEY=value lines
// (an optional "export ", quotes and a trailing comment after a quoted value
// are allowed). Every other line is skipped without being kept.
export function readModelEnv(text) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !MODEL_KEYS.includes(m[1])) continue;
    let value = m[2].trim();
    const quoted = /^(['"])(.*)\1(\s+#.*)?$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    out[m[1]] = value;
  }
  return out;
}

// The settings this server uses: the env file's, else the environment's
export function modelEnv({ fileText = null, processEnv = process.env } = {}) {
  const file = fileText === null ? {} : readModelEnv(fileText);
  const env = {};
  for (const key of MODEL_KEYS) {
    const value = file[key] ?? processEnv[key];
    if (value) env[key] = value;
  }
  return env;
}

// In-memory draft jobs, answered like the real /api/grade actions
export function createJobs({ env, fetchImpl = fetch, now = () => new Date(), log = () => {} } = {}) {
  const jobs = new Map();
  let nextId = 10_000_001;

  function tidy() {
    const cutoff = now().getTime() - KEEP_JOBS_MS;
    for (const [id, job] of jobs) if (Date.parse(job.created_at) < cutoff) jobs.delete(id);
  }

  function view(job) {
    if (job.status === 'drafting' && now().getTime() - Date.parse(job.created_at) > DRAFT_STALE_MS) {
      Object.assign(job, { status: 'failed', error: 'This draft took too long. Try again.', finished_at: now().toISOString() });
    }
    return {
      id: job.id, status: job.status, student_id: job.student_id, options: job.options, created_at: job.created_at, finished_at: job.finished_at,
      ...(job.status === 'ready' ? { result: job.result } : {}),
      ...(job.status === 'failed' ? { error: job.error } : {}),
    };
  }

  return {
    jobs,
    // { action: 'draft_homework', ... } -> { status, body, done } (done: the background promise)
    start(body) {
      if (!env.LLM_ENDPOINT || !env.LLM_KEY) return { status: 500, body: { error: 'Homework drafts are not set up. Pass --env-file with LLM_ENDPOINT and LLM_KEY.' } };
      const checked = checkDraftRequest(body);
      if (checked.error) return { status: 400, body: { error: checked.error } };
      tidy();
      const job = {
        id: nextId++, status: 'drafting', student_id: checked.values.studentId, options: draftOptions(checked.values),
        result: null, error: null, created_at: now().toISOString(), finished_at: null,
      };
      jobs.set(job.id, job);
      const done = draftHomework(checked.values, { env, fetchImpl }).then((result) => {
        if (job.status !== 'drafting') return;
        Object.assign(job, { status: 'ready', result, finished_at: now().toISOString() });
        log(`[draft] ${job.id}: ready`);
      }, (err) => {
        if (job.status !== 'drafting') return;
        const message = err instanceof DraftError ? err.message : 'The draft did not finish. Try again.';
        Object.assign(job, { status: 'failed', error: message, finished_at: now().toISOString() });
        log(`[draft] ${job.id}: failed ${err instanceof DraftError ? err.code : err?.name ?? 'Error'}`);
      });
      return { status: 202, body: { id: job.id, status: 'drafting', created_at: job.created_at }, done };
    },
    // { action: 'draft_status', id } -> { status, body }
    status(body) {
      const id = body?.id;
      if (!Number.isSafeInteger(id) || id <= 0) return { status: 400, body: { error: 'id must be a positive integer' } };
      const job = jobs.get(id);
      if (!job) return { status: 404, body: { error: 'Draft not found.' } };
      return { status: 200, body: view(job) };
    },
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf', '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// The static demo (no caching) and the two draft actions
// cspFor(pathname) returns the Content-Security-Policy to send for a page, or
// null. With --csp-from <vercel.json> the demo sends the same policies the
// live site does, so blob PDFs, frames and images behave as they will there.
export function vercelCsp(config) {
  const rules = (config?.headers ?? []).flatMap((h) => (h.headers ?? [])
    .filter((x) => x.key === 'Content-Security-Policy')
    .map((x) => ({ re: new RegExp(`^${h.source}$`), value: x.value })));
  return (pathname) => rules.find((r) => r.re.test(pathname))?.value ?? null;
}

export function createServer({ root, jobs, cspFor = () => null }) {
  const base = resolve(root);
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/grade') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        let body = {};
        try {
          body = JSON.parse(await readBody(req) || '{}');
        } catch (err) {
          return send(res, err?.status === 413 ? 413 : 400, { error: err?.status === 413 ? 'The request is too large.' : 'The body must be JSON.' });
        }
        if (body?.action === 'draft_homework') {
          const out = jobs.start(body);
          return send(res, out.status, out.body);
        }
        if (body?.action === 'draft_status') {
          const out = jobs.status(body);
          return send(res, out.status, out.body);
        }
        return send(res, 404, { error: 'Only homework drafts are answered here; the demo client answers grading.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      let path = resolve(join(base, decodeURIComponent(url.pathname)));
      if (path !== base && !path.startsWith(base + sep)) return send(res, 404, 'Not found', 'text/plain');
      let info;
      try {
        info = statSync(path);
        if (info.isDirectory()) {
          path = join(path, 'index.html');
          info = statSync(path);
        }
      } catch {
        return send(res, 404, 'Not found', 'text/plain');
      }
      const csp = cspFor(url.pathname);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        ...(csp ? { 'Content-Security-Policy': csp } : {}),
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(path).pipe(res);
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
      else res.end();
    }
  });
}

function main(argv) {
  const args = argv.slice(2);
  let envFile = null;
  let cspFrom = null;
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--env-file') { envFile = args[i + 1] ?? null; i += 1; } else if (args[i] === '--csp-from') { cspFrom = args[i + 1] ?? null; i += 1; } else rest.push(args[i]);
  }
  const [portArg, dirArg] = rest;
  const port = Number(portArg);
  if (!Number.isInteger(port) || port <= 0 || !dirArg) {
    console.error('Usage: node tools/demo/serve-ai.mjs <port> <demo dir> [--env-file <path>] [--csp-from <vercel.json>]');
    process.exit(2);
  }
  const fileText = envFile ? readFileSync(envFile, 'utf8') : null;
  const env = modelEnv({ fileText });
  const jobs = createJobs({ env, log: (line) => console.log(line) });
  const cspFor = cspFrom ? vercelCsp(JSON.parse(readFileSync(cspFrom, 'utf8'))) : undefined;
  const server = createServer({ root: dirArg, jobs, cspFor });
  server.listen(port, '127.0.0.1', () => {
    const ready = env.LLM_ENDPOINT && env.LLM_KEY ? 'set' : 'NOT set (drafts will fail)';
    console.log(`demo with live drafts on http://127.0.0.1:${port}/portal/staff.html?as=tutor&ai=live#/today (model settings ${ready})`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv);
