// Repairs from the extra folder: overrides/*.json, each an array of
// { file, set_label, q, item_tex, key_tex, difficulty?, reason }. An entry is
// matched on file and question number, and on set_label only when the file
// holds several sets (labels compared loosely: dashes, spaces and case).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const normFile = (f) => String(f ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^.*?\/SAT\//, '').trim();

export function normLabel(label) {
  return String(label ?? '')
    .replace(/\\&/g, '&')
    .replace(/\\[a-zA-Z]+\s*/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s*(---|--|—|–|-)\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const testNo = (label) => {
  const m = /\btest\s+(\d+)/i.exec(String(label ?? ''));
  return m ? Number(m[1]) : null;
};

// Whether an entry's set_label names this set
export function labelMatches(entryLabel, setLabel) {
  if (normLabel(entryLabel) === normLabel(setLabel)) return true;
  const a = testNo(entryLabel);
  return a !== null && a === testNo(setLabel);
}

// dir -> { take(file, setLabel, q, { multi }), unused() }; stats gets counts and errors
export function loadOverrides(dir, stats = { files: 0, entries: 0, errors: [] }) {
  const entries = [];
  if (dir && existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      stats.files++;
      let list;
      try {
        list = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch (e) {
        stats.errors.push({ file: f, error: `not JSON: ${e.message}` });
        continue;
      }
      if (!Array.isArray(list)) list = Array.isArray(list?.overrides) ? list.overrides : [];
      list.forEach((e, k) => {
        const ok = e && typeof e.file === 'string' && Number.isInteger(Number(e.q))
          && (typeof e.item_tex === 'string' || typeof e.key_tex === 'string' || typeof e.difficulty === 'string');
        if (!ok) {
          stats.errors.push({ file: f, entry: k, error: 'needs file, q and one of item_tex, key_tex or difficulty' });
          return;
        }
        if (e.difficulty && !['easy', 'medium', 'hard'].includes(String(e.difficulty).toLowerCase())) {
          stats.errors.push({ file: f, entry: k, error: `unknown difficulty ${e.difficulty}` });
          return;
        }
        entries.push({ ...e, q: Number(e.q), from: f, used: false });
      });
    }
  }
  stats.entries = entries.length;
  return {
    take(file, setLabel, q, { multi = false } = {}) {
      const nf = normFile(file);
      let hits = entries.filter((e) => normFile(e.file) === nf && e.q === q);
      if (hits.length && multi) hits = hits.filter((e) => labelMatches(e.set_label, setLabel));
      // several entries for one question: later files and later entries win, field by field
      hits.forEach((e) => { e.used = true; });
      return hits;
    },
    unused() {
      return entries.filter((e) => !e.used).map(({ file, set_label, q, reason, from }) => ({ file, set_label, q, reason, from }));
    },
  };
}
