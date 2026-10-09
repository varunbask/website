// TikZ / pgfplots pictures -> PNG files. Each picture is set on its own page
// the size of the picture (as the standalone class would, which this TeX
// install lacks), many pictures to one pdflatex run, then every page is
// drawn at twice CSS size on white by PyMuPDF. A picture that breaks its
// batch is compiled alone, then with xelatex; one that still fails is
// reported. Results are cached by content, so a rebuild only compiles what
// changed.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readGroup } from './tex.mjs';

// Device pixels per PDF point: 2x a CSS pixel (96 px per 72 pt)
export const ZOOM = (2 * 96) / 72;
const BORDER = '3pt';
const SKIP_PACKAGES = /\{(geometry|fancyhdr|titlesec|titletoc|lastpage|hyperref|enumitem|needspace|tcolorbox|multicol)\}/;

// The preamble a picture needs, read from the book's own style.tex: its
// packages (less the page-layout ones), TikZ libraries, colours, plot styles
// and the few math and curve macros
export function figurePreamble(style) {
  const lines = ['\\documentclass{article}', '\\usepackage{lmodern}', '\\usepackage[T1]{fontenc}'];
  for (const line of style.split('\n')) {
    const t = line.replace(/(^|[^\\])%.*$/, '$1').trim();
    if (!t) continue;
    if (/^\\usepackage/.test(t) && !SKIP_PACKAGES.test(t)) lines.push(t);
    else if (/^\\(usetikzlibrary|usepgfplotslibrary|definecolor|colorlet|pgfplotsset\{compat)/.test(t)) lines.push(t);
    else if (/^\\(newcommand|providecommand|renewcommand)\{\\(fcurve|gcurve|hcurve|degree|dd|Re|faWarn)\}/.test(t)) lines.push(t);
    else if (/^\\let\\oldunderline|^\\renewcommand\{\\underline\}/.test(t)) lines.push(t);
  }
  // the plot styles (\pgfplotsset{ bioaxis/.style=..., calcaxis/.style=... })
  for (const m of style.matchAll(/\\pgfplotsset\s*\{(?!compat)/g)) {
    const g = readGroup(style, m.index + m[0].length - 1);
    if (g) lines.push(`\\pgfplotsset{${g.content}}`);
  }
  lines.push(
    '\\newsavebox\\satfig',
    `\\newlength\\satborder \\setlength\\satborder{${BORDER}}`,
    '\\hoffset=-1in \\voffset=-1in',
    '\\setlength\\textwidth{6.5in}\\setlength\\linewidth{6.5in}\\setlength\\hsize{6.5in}',
    // one page exactly the size of the picture
    '\\newcommand\\satship{\\ifdefined\\pdfpagewidth\\pdfpagewidth=\\dimexpr\\wd\\satfig+2\\satborder\\relax'
      + '\\pdfpageheight=\\dimexpr\\ht\\satfig+\\dp\\satfig+2\\satborder\\relax\\else'
      + '\\pagewidth=\\dimexpr\\wd\\satfig+2\\satborder\\relax\\pageheight=\\dimexpr\\ht\\satfig+\\dp\\satfig+2\\satborder\\relax\\fi'
      + '\\shipout\\vbox{\\kern\\satborder\\hbox{\\kern\\satborder\\usebox\\satfig\\kern\\satborder}\\kern\\dp\\satfig\\kern\\satborder}}',
  );
  return lines.join('\n');
}

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

// Runs async jobs with at most `limit` at once
export async function pool(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const k = next++;
      results[k] = await jobs[k]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

const RENDER = `
import sys, json, fitz
pdf, zoom = sys.argv[1], float(sys.argv[2])
outs = json.loads(sys.argv[3])
doc = fitz.open(pdf)
sizes = []
for i, out in enumerate(outs):
    if i >= doc.page_count:
        sizes.append(None); continue
    pix = doc[i].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    pix.save(out)
    sizes.append([pix.width, pix.height])
print(json.dumps(sizes))
`;

// PDF pages -> PNG files; returns [[w, h] | null] in device pixels
async function render(pdf, outs) {
  const r = await run('python3', ['-I', '-c', RENDER, pdf, String(ZOOM), JSON.stringify(outs)]);
  try {
    return JSON.parse(r.out.trim().split('\n').pop());
  } catch {
    return outs.map(() => null);
  }
}

export class Figures {
  // cacheDir: where compiled pictures are kept between builds
  constructor({ outDir, cacheDir, jobs = 4, batch = 40, log = () => {} }) {
    this.outDir = outDir;
    this.cacheDir = cacheDir;
    this.jobs = jobs;
    this.batch = batch;
    this.log = log;
    this.queue = [];
    this.failed = [];
    mkdirSync(join(outDir, 'figures'), { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
  }

  // Queues a picture; img (the doc block) gets src now and w, h once drawn
  add({ id, source, preamble, where, img }) {
    const hash = createHash('sha1').update(preamble).update('\0').update(source).digest('hex').slice(0, 20);
    img.src = `figures/${id}.png`;
    this.queue.push({ id, source, preamble, hash, img, where });
  }

  cached(job) {
    const png = join(this.cacheDir, `${job.hash}.png`);
    const meta = join(this.cacheDir, `${job.hash}.json`);
    if (!existsSync(png) || !existsSync(meta)) return false;
    const [w, h] = JSON.parse(readFileSync(meta, 'utf8'));
    this.place(job, png, w, h);
    return true;
  }

  place(job, png, w, h) {
    copyFileSync(png, join(this.outDir, job.img.src));
    job.img.w = Math.round(w / 2);
    job.img.h = Math.round(h / 2);
    job.done = true;
  }

  // Compiles a group of pictures in one run; returns the ones that did not come out
  async compile(jobs, engine = 'pdflatex') {
    const dir = join(this.cacheDir, `run-${jobs[0].hash}-${engine}-${jobs.length}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const body = jobs.map((j) => `\\sbox\\satfig{${j.source}}\\satship`).join('\n');
    writeFileSync(join(dir, 'f.tex'), `${jobs[0].preamble}\n\\begin{document}\n${body}\n\\end{document}\n`);
    const r = await run(engine, ['-interaction=nonstopmode', '-halt-on-error', 'f.tex'], { cwd: dir });
    const log = existsSync(join(dir, 'f.log')) ? readFileSync(join(dir, 'f.log'), 'utf8') : r.out;
    const errors = log.split('\n').filter((l) => l.startsWith('!'));
    if (!existsSync(join(dir, 'f.pdf')) || errors.length) {
      jobs.forEach((j) => { j.error = errors[0] ?? `${engine} produced no PDF`; });
      if (jobs.length === 1) rmSync(dir, { recursive: true, force: true });
      return jobs;
    }
    const outs = jobs.map((j) => join(this.cacheDir, `${j.hash}.png`));
    const sizes = await render(join(dir, 'f.pdf'), outs);
    const left = [];
    jobs.forEach((j, k) => {
      if (!sizes[k]) {
        j.error = 'page missing from the PDF';
        left.push(j);
        return;
      }
      writeFileSync(join(this.cacheDir, `${j.hash}.json`), JSON.stringify(sizes[k]));
      this.place(j, outs[k], sizes[k][0], sizes[k][1]);
    });
    rmSync(dir, { recursive: true, force: true });
    return left;
  }

  async run() {
    const todo = this.queue.filter((j) => !this.cached(j));
    this.log(`figures: ${this.queue.length} (${this.queue.length - todo.length} cached, ${todo.length} to draw)`);
    // the same picture twice is drawn once
    const byHash = new Map();
    for (const j of todo) {
      if (!byHash.has(j.hash)) byHash.set(j.hash, []);
      byHash.get(j.hash).push(j);
    }
    const unique = [...byHash.values()].map((list) => list[0]);
    const groups = new Map();
    for (const j of unique) {
      if (!groups.has(j.preamble)) groups.set(j.preamble, []);
      groups.get(j.preamble).push(j);
    }
    const batches = [];
    for (const list of groups.values()) for (let k = 0; k < list.length; k += this.batch) batches.push(list.slice(k, k + this.batch));
    const retry = (await pool(batches.map((b) => () => this.compile(b)), this.jobs)).flat();
    const again = (await pool(retry.map((j) => () => this.compile([j])), this.jobs)).flat();
    const last = (await pool(again.map((j) => () => this.compile([j], 'xelatex')), this.jobs)).flat();
    for (const j of last) this.failed.push({ id: j.id, where: j.where, error: j.error });
    // copies of a picture drawn once
    for (const list of byHash.values()) {
      const first = list[0];
      for (const j of list.slice(1)) {
        if (first.done) this.place(j, join(this.cacheDir, `${first.hash}.png`), first.img.w * 2, first.img.h * 2);
        else this.failed.push({ id: j.id, where: j.where, error: first.error });
      }
    }
    return { total: this.queue.length, failed: this.failed };
  }
}

// Years on a pgfplots axis print as "2,016" (pgfplots' thousands comma).
// For each axis whose x or y ticks (else limits, else plotted x/y values)
// are all whole numbers from 1700 to 2100, the tick labels of that
// direction lose the comma; every other number keeps it (12,000).
// -> { source, touched } (touched: how many axes were changed)
const YEAR_SEP = '/pgf/number format/1000 sep={}';
const isYear = (v) => Number.isInteger(v) && v >= 1700 && v <= 2100;

function optionValue(opts, key) {
  const m = new RegExp(`(?:^|[,\\s])${key}\\s*=\\s*`).exec(opts);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (opts[at] === '{') return readGroup(opts, at)?.content ?? null;
  return /^[^,\]]*/.exec(opts.slice(at))[0].trim();
}
const numbers = (text) => (text ?? '').split(',').map((t) => t.trim()).filter((t) => t && t !== '...' && t !== '\\ldots').map(Number);

function axisValues(opts, body, dir) {
  const ticks = optionValue(opts, `${dir}tick`);
  if (ticks && !/^(data|\\empty|\{\})$/.test(ticks)) return numbers(ticks);
  if (optionValue(opts, `symbolic ${dir} coords`)) return [];
  const limits = [optionValue(opts, `${dir}min`), optionValue(opts, `${dir}max`)].filter((v) => v !== null);
  if (limits.length) return limits.map(Number);
  const values = [];
  for (const m of body.matchAll(/coordinates\s*\{([^}]*)\}/g)) {
    for (const p of m[1].matchAll(/\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)/g)) values.push(Number(dir === 'x' ? p[1] : p[2]));
  }
  return values;
}

export function yearTicks(source) {
  let touched = 0;
  let out = '';
  let at = 0;
  const re = /\\begin\{(axis|semilogxaxis|semilogyaxis|loglogaxis)\}\s*\[/g;
  for (const m of source.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    // the option list, brackets inside braces not counted
    let depth = 0;
    let close = -1;
    for (let k = open + 1; k < source.length; k++) {
      const ch = source[k];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === ']' && depth === 0) {
        close = k;
        break;
      }
    }
    if (close < 0) continue;
    const opts = source.slice(open + 1, close);
    const end = source.indexOf(`\\end{${m[1]}}`, close);
    const body = source.slice(close + 1, end < 0 ? source.length : end);
    const add = [];
    for (const dir of ['x', 'y']) {
      const values = axisValues(opts, body, dir);
      if (values.length && values.every(isYear)) add.push(`${dir}ticklabel style={${YEAR_SEP}}`);
    }
    if (!add.length) continue;
    touched++;
    out += source.slice(at, close) + `${opts.trim().endsWith(',') ? '' : ','} ${add.join(', ')}`;
    at = close;
  }
  return { source: out + source.slice(at), touched };
}
