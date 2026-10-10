// The PDF library: Question Bank files, official practice tests, the books'
// printable tests and answer keys, and the built lessons. Each becomes a
// sat_files row: { id, collection, domain, skill, difficulty, title, local,
// path, bytes, pages, staff_only, position }.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { DOMAINS, domainByN, slugify, trimSlug, titleCase, cleanName, pad2, MAX_ID } from './catalog.mjs';

const DIFFICULTIES = ['easy', 'medium', 'hard'];

// "EASY - Central Ideas And Details .pdf", "Inferences - MEDIUM .pdf" -> 'easy' | 'medium' | 'hard' | null
export function qbDifficulty(fileName) {
  const words = basename(fileName, '.pdf').toLowerCase().split(/[^a-z]+/);
  return DIFFICULTIES.find((d) => words.includes(d)) ?? null;
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const pdfsIn = (dir) => (isDir(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf') && !f.startsWith('.')).sort() : []);

// The Question Bank tree -> [{ domainFolder, skillFolder, file, local, difficulty }]
export function scanQuestionBank(root) {
  const out = [];
  if (!root || !isDir(root)) return out;
  for (const domainFolder of readdirSync(root).sort()) {
    if (!isDir(join(root, domainFolder))) continue;
    for (const skillFolder of readdirSync(join(root, domainFolder)).sort()) {
      const dir = join(root, domainFolder, skillFolder);
      for (const file of pdfsIn(dir)) out.push({ domainFolder, skillFolder, file, local: join(dir, file), difficulty: qbDifficulty(file) });
    }
  }
  return out;
}

// Question Bank files -> rows. skillFor(entry) -> skill { slug, name, position } | null
export function questionBankFiles(entries, skillFor) {
  const rows = [];
  const order = { easy: 1, medium: 2, hard: 3 };
  for (const e of entries) {
    const dn = /^\s*(\d+)/.exec(e.domainFolder);
    const domain = dn ? domainByN(dn[1]) : null;
    const skill = skillFor(e);
    const name = cleanName(e.skillFolder);
    const slug = slugify(name);
    const diff = e.difficulty ?? 'unknown';
    rows.push({
      id: trimSlug(`qb-${domain?.abbr ?? 'x'}-${slug}`, MAX_ID - diff.length - 1) + `-${diff}`,
      collection: 'question_bank',
      domain: domain?.slug ?? null,
      skill: skill?.slug ?? null,
      difficulty: e.difficulty,
      title: `${titleCase(name)}, ${titleCase(diff)}`,
      local: e.local,
      path: `question-bank/${domain?.slug ?? 'other'}/${slug}-${diff}.pdf`,
      staff_only: false,
      position: (domain?.n ?? 9) * 1000 + (skill?.position ?? 0) * 10 + (order[diff] ?? 9),
    });
  }
  return rows;
}

// SAT References/Bluebook N.pdf -> official tests
export function officialFiles(satRoot) {
  const dir = join(satRoot, 'SAT References');
  return pdfsIn(dir).map((file) => {
    const n = /(\d+)/.exec(file)?.[1] ?? null;
    const slug = slugify(basename(file, '.pdf'));
    return {
      id: `official-${slug}`,
      collection: 'official_test',
      domain: null,
      skill: null,
      difficulty: null,
      title: n ? `Official Practice Test ${n} (Bluebook)` : basename(file, '.pdf'),
      local: join(dir, file),
      path: `official/${slug}.pdf`,
      staff_only: false,
      position: n ? Number(n) : 99,
    };
  });
}

// The books' printable tests and keys: practice-tests/Test N/Test N.pdf and
// "Test N Answer Key.pdf", practice-tests.pdf, master.pdf and the Master Guide
export function bookFiles(satRoot) {
  const rows = [];
  for (const book of readdirSync(satRoot).sort()) {
    const m = /^(\d\d)-/.exec(book);
    if (!m || !isDir(join(satRoot, book))) continue;
    const n = Number(m[1]);
    const domain = domainByN(n);
    const full = n === 9;
    const tag = full ? 'full' : domain.abbr;
    const folder = full ? 'full' : domain.slug;
    const name = full ? 'Full-Length Practice' : domain.name;
    const tests = join(satRoot, book, 'practice-tests');
    for (const sub of isDir(tests) ? readdirSync(tests).sort() : []) {
      const t = /^Test (\d+)$/.exec(sub);
      if (!t || !isDir(join(tests, sub))) continue;
      const k = Number(t[1]);
      for (const file of pdfsIn(join(tests, sub))) {
        const key = /answer key/i.test(file);
        rows.push({
          id: `${key ? 'key' : 'testpdf'}-${tag}-t${pad2(k)}`,
          collection: key ? 'answer_key' : 'test_pdf',
          domain: full ? null : domain.slug,
          skill: null,
          difficulty: null,
          title: `${name} Test ${k}${key ? ' Answer Key' : ''}`,
          local: join(tests, sub, file),
          path: `${key ? 'answer-keys' : 'test-pdfs'}/${folder}/test-${pad2(k)}${key ? '-answer-key' : ''}.pdf`,
          staff_only: true,
          position: n * 100 + k,
        });
      }
    }
    if (existsSync(join(tests, 'practice-tests.pdf'))) {
      rows.push({
        id: `testpdf-${tag}-all`,
        collection: 'test_pdf',
        domain: full ? null : domain.slug,
        skill: null,
        difficulty: null,
        title: `${name} Tests (all, with keys)`,
        local: join(tests, 'practice-tests.pdf'),
        path: `test-pdfs/${folder}/practice-tests.pdf`,
        staff_only: true,
        position: n * 100 + 99,
      });
    }
    if (existsSync(join(satRoot, book, 'master.pdf'))) {
      rows.push({
        id: `key-${tag}-guide`,
        collection: 'answer_key',
        domain: full ? null : domain.slug,
        skill: null,
        difficulty: null,
        title: full ? 'Ultimate SAT Master Guide (full book, with keys)' : `${domain.name} Guide (full book, with keys)`,
        local: join(satRoot, book, 'master.pdf'),
        path: `answer-keys/${folder}/guide.pdf`,
        staff_only: true,
        position: n * 100,
      });
    }
    for (const file of pdfsIn(join(satRoot, book))) {
      if (!/master guide/i.test(file)) continue;
      // the Master Guide is the cumulative book's master.pdf under another name
      const master = join(satRoot, book, 'master.pdf');
      if (existsSync(master) && statSync(master).size === statSync(join(satRoot, book, file)).size) continue;
      rows.push({
        id: 'key-master-guide',
        collection: 'answer_key',
        domain: null,
        skill: null,
        difficulty: null,
        title: 'Ultimate SAT Master Guide',
        local: join(satRoot, book, file),
        path: 'answer-keys/full/master-guide.pdf',
        staff_only: true,
        position: n * 100 + 98,
      });
    }
  }
  return rows;
}

// Sizes and page counts for every row with a local file (pages via PyMuPDF,
// one process for all of them; left null when it is not installed)
export async function measure(rows) {
  for (const r of rows) r.bytes = existsSync(r.local) ? statSync(r.local).size : null;
  const script = 'import sys, json, fitz\nout = []\nfor p in json.loads(sys.stdin.read()):\n    try:\n        out.append(fitz.open(p).page_count)\n    except Exception:\n        out.append(None)\nprint(json.dumps(out))\n';
  const pages = await new Promise((resolve) => {
    const child = spawn('python3', ['-I', '-c', script], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(null);
      }
    });
    child.stdin.end(JSON.stringify(rows.map((r) => r.local)));
  });
  rows.forEach((r, k) => { r.pages = pages?.[k] ?? null; });
  return rows;
}

export { DOMAINS };
