#!/usr/bin/env node
// Builds the SAT content bundle (see lib/build.mjs). The bundle stays outside
// the repo; holds.mjs maps checker findings to it and load.mjs uploads it.
//
//   node tools/sat/convert.mjs --sat <SAT dir> --qb <Question Bank dir> --out <OUT>
//        [--extra <dir>] [--plan <plan.json>] [--no-figures] [--no-lessons]
//        [--jobs 4] [--dashes all|passages] [--keep-explanation-dashes]
//
// OUT gets content.json, figures/*.png, lessons/*.pdf and report.json (and a
// .cache folder, so a rebuild only compiles what changed). Explanations lose
// their em and en dashes unless --keep-explanation-dashes. Needs pdflatex and
// xelatex, and python3 with PyMuPDF for drawing figures and counting pages.

import { buildBundle, printSummary } from './lib/build.mjs';

const opts = { jobs: 4, dashes: 'all', figures: true, lessons: true };
for (let k = 2; k < process.argv.length; k++) {
  const a = process.argv[k];
  if (a === '--no-figures') opts.figures = false;
  else if (a === '--no-lessons') opts.lessons = false;
  else if (a === '--keep-explanation-dashes') opts.keepExplanationDashes = true;
  else if (a.startsWith('--')) opts[a.slice(2)] = process.argv[++k];
}
if (!opts.sat || !opts.out) {
  console.error('Usage: node tools/sat/convert.mjs --sat <SAT dir> --qb <Question Bank dir> --out <OUT> [--extra <dir>] [--plan <plan.json>]');
  process.exit(2);
}
let result;
try {
  result = await buildBundle({ ...opts, log: console.log });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
printSummary(result, console.log);
