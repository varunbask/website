#!/usr/bin/env node
// Maps the answer checkers' findings to item ids, for the loader.
//
//   node tools/sat/holds.mjs --content OUT/content.json --checks <dir> --out OUT/holds.json
//
// Reads every *.json in <dir> shaped { group, findings: [{ file, where, q,
// verdict, severity, suggested, reason }] } (files that are missing or not
// finished yet are skipped and named). Writes { holds: [{ item, severity,
// verdict, suggested, reason, ... }], unmatched: [...], summary }. A finding
// on an item that was repaired by an override is kept but marked repaired;
// the loader does not hold repaired items.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mapFindings } from './lib/holds.mjs';

const args = {};
for (let k = 2; k < process.argv.length; k++) if (process.argv[k].startsWith('--')) args[process.argv[k].slice(2)] = process.argv[++k];
if (!args.content || !args.checks || !args.out) {
  console.error('Usage: node tools/sat/holds.mjs --content OUT/content.json --checks <dir> --out OUT/holds.json');
  process.exit(2);
}

const content = JSON.parse(readFileSync(resolve(args.content), 'utf8'));
const dir = resolve(args.checks);
const files = [];
const skipped = [];
for (const name of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []) {
  try {
    const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (!Array.isArray(data?.findings)) throw new Error('no findings list');
    files.push({ name, data });
  } catch (e) {
    skipped.push({ file: name, why: e.message });
  }
}
const result = mapFindings(files, content.items);
const out = { built_at: new Date().toISOString(), checks: dir, files: files.map((f) => f.name), skipped, ...result };
writeFileSync(resolve(args.out), JSON.stringify(out, null, 2));

const s = result.summary;
console.log(`findings: ${s.hold + s.fix + s.note} matched (hold ${s.hold}, fix ${s.fix}, note ${s.note}; ${s.repaired} on repaired items), ${s.unmatched} unmatched`);
console.log(`items held: ${s.items_held}`);
if (skipped.length) console.log(`skipped: ${skipped.map((f) => `${f.file} (${f.why})`).join(', ')}`);
for (const u of result.unmatched.slice(0, 30)) console.log(`  unmatched: ${u.file} | ${u.where} | Q${u.q}: ${u.why}`);
console.log(`wrote ${resolve(args.out)}`);
