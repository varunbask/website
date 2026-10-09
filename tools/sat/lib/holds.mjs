// Checker findings -> item ids. A finding names a source file, the set label
// as the checker read it ("Practice Test 3", "Chapter 2 Practice") and the
// question number in the key; content.json keeps the same three things in
// each item's source.

import { normFile, labelMatches } from './overrides.mjs';

export const SEVERITIES = ['hold', 'fix', 'note'];

// content.json items -> Map normalized file -> [{ id, set, q, module_label, repaired }]
export function sourceIndex(items) {
  const index = new Map();
  for (const it of items) {
    const s = it.source ?? {};
    if (!s.file) continue;
    const key = normFile(s.file);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ id: it.id, set: s.set ?? '', q: Number(s.q ?? it.position), module_label: s.module_label ?? null, repaired: Boolean(s.repaired) });
  }
  return index;
}

// One finding -> { item, repaired } or { why }
export function matchFinding(finding, index) {
  const list = index.get(normFile(finding.file));
  if (!list) return { why: 'no converted item comes from this file' };
  const q = Number(finding.q);
  if (!Number.isInteger(q)) return { why: 'the question number is missing' };
  let hits = list.filter((c) => c.q === q);
  if (!hits.length) return { why: `the file has no question ${q}` };
  if (hits.length > 1) {
    const byLabel = hits.filter((c) => labelMatches(finding.where, c.set) || (c.module_label && labelMatches(finding.where, c.module_label)));
    if (byLabel.length === 1) hits = byLabel;
    else return { why: `the file holds ${hits.length} sets with a question ${q} and "${finding.where}" does not pick one` };
  }
  return { item: hits[0].id, repaired: hits[0].repaired };
}

// checker files ({ group, findings }) + content items -> { holds, unmatched, summary }
export function mapFindings(checkFiles, items) {
  const index = sourceIndex(items);
  const holds = [];
  const unmatched = [];
  for (const { name, data } of checkFiles) {
    for (const f of data?.findings ?? []) {
      const severity = SEVERITIES.includes(f.severity) ? f.severity : 'note';
      const m = matchFinding(f, index);
      const base = { severity, verdict: f.verdict ?? null, suggested: f.suggested ?? null, reason: f.reason ?? '', file: f.file, where: f.where ?? null, q: f.q, keyed: f.keyed ?? null, group: data.group ?? name };
      if (m.item) holds.push({ item: m.item, ...base, ...(m.repaired ? { repaired: true } : {}) });
      else unmatched.push({ ...base, why: m.why });
    }
  }
  const summary = { hold: 0, fix: 0, note: 0, repaired: 0, unmatched: unmatched.length, items_held: 0 };
  for (const h of holds) {
    summary[h.severity]++;
    if (h.repaired) summary.repaired++;
  }
  summary.items_held = new Set(holds.filter((h) => h.severity === 'hold' && !h.repaired).map((h) => h.item)).size;
  return { holds, unmatched, summary };
}
