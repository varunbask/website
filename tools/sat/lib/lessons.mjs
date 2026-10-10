// Lesson PDFs: each chapter's teaching part (the chapter cut at its first
// \practiceheader, or a corrected lesson part from the extra folder) set
// in its own book's style with xelatex, the engine the books were made with.
// Cached by content like the figures.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pool } from './figures.mjs';
import { neutralName } from './catalog.mjs';

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => resolve({ code: -1, out: String(e) }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

// The wrapper document for one chapter's lesson part
export function lessonDocument({ title, chapter, body }) {
  return [
    `\\def\\sattitle{${neutralName(title) || 'SAT Guide'}}`,
    '\\documentclass[11pt,openany,oneside]{book}',
    '\\input{style.tex}',
    '\\begin{document}',
    `\\setcounter{chapter}{${Math.max(0, chapter - 1)}}`,
    body,
    '\\end{document}',
    '',
  ].join('\n');
}

// jobs: [{ id, bookDir, title, chapter, body, out }] -> { built, cached, failed: [{ id, error }] }
export async function buildLessons(jobs, { cacheDir, workers = 3, log = () => {} }) {
  mkdirSync(cacheDir, { recursive: true });
  const failed = [];
  let cached = 0;
  const work = jobs.map((job) => async () => {
    const tex = lessonDocument(job);
    const style = existsSync(join(job.bookDir, 'style.tex')) ? readFileSync(join(job.bookDir, 'style.tex'), 'utf8') : '';
    const hash = createHash('sha1').update(style).update('\0').update(tex).digest('hex').slice(0, 20);
    const hit = join(cacheDir, `${hash}.pdf`);
    if (existsSync(hit)) {
      copyFileSync(hit, job.out);
      cached++;
      return;
    }
    const dir = join(cacheDir, `run-${hash}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lesson.tex'), tex);
    // the book folder first, so \input{style.tex} and any \input of its parts resolve there
    const env = { ...process.env, TEXINPUTS: `${job.bookDir}//:` };
    let r = null;
    for (let pass = 0; pass < 2; pass++) {
      r = await run('xelatex', ['-interaction=nonstopmode', 'lesson.tex'], { cwd: dir, env });
    }
    const logText = existsSync(join(dir, 'lesson.log')) ? readFileSync(join(dir, 'lesson.log'), 'utf8') : r.out;
    const errors = logText.split('\n').filter((l) => l.startsWith('!'));
    if (!existsSync(join(dir, 'lesson.pdf'))) {
      failed.push({ id: job.id, error: errors[0] ?? 'xelatex produced no PDF' });
      return;
    }
    if (errors.length) failed.push({ id: job.id, error: `built with errors: ${errors[0]}`, partial: true });
    else copyFileSync(join(dir, 'lesson.pdf'), hit);
    copyFileSync(join(dir, 'lesson.pdf'), job.out);
    rmSync(dir, { recursive: true, force: true });
  });
  await pool(work, workers);
  log(`lessons: ${jobs.length} (${cached} cached, ${failed.length} with problems)`);
  return { built: jobs.length - failed.filter((f) => !f.partial).length, cached, failed };
}
