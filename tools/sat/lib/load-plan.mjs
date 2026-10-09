// What the loader writes, worked out without the network: table rows from
// the bundle and holds, and the decisions that protect what the admin did in
// the portal since the last load (a released question stays released; an
// answer the admin set stays set unless our own source for it changed).
// The loader keeps the last load's facts in OUT/.loaded.json.

export const BATCH = 200;

// Only these two keys are read from the env file; nothing else is kept
export function parseEnvFile(text, wanted = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || !wanted.includes(m[1])) continue;
    let v = m[2];
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function chunks(list, size = BATCH) {
  const out = [];
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size));
  return out;
}

const join = (parts) => (parts.length ? parts.join('\n') : null);
const line = (h) => `${h.verdict ?? h.severity}: ${h.reason}${h.suggested ? ` (suggested: ${h.suggested})` : ''}`.trim();

// holds.json entries -> Map item -> { hold: [...], fix: [...], note: [...] }
export function holdsByItem(holds) {
  const map = new Map();
  for (const h of holds?.holds ?? holds ?? []) {
    if (!map.has(h.item)) map.set(h.item, { hold: [], fix: [], note: [] });
    (map.get(h.item)[h.severity] ?? map.get(h.item).note).push(h);
  }
  return map;
}

// Rows for sat_items and sat_keys.
//   existing: Map id -> { held, answer, accept } read from the database (empty on a first load)
//   last:     { held: [ids], released: [ids], answers: { id: answer } } from the previous load, or null
//   rehold:   hold again questions the admin released
// -> { itemRows, keyRows, released: [ids kept released], keptAnswers: [ids], state }
export function planItems({ items, keys, holds = null, existing = new Map(), last = null, rehold = false }) {
  const byItem = holdsByItem(holds);
  const keyOf = new Map(keys.map((k) => [k.item, k]));
  const lastHeld = new Set(last?.held ?? []);
  const lastReleased = new Set(last?.released ?? []);
  const lastAnswers = last?.answers ?? {};
  const itemRows = [];
  const keyRows = [];
  const released = [];
  const keptAnswers = [];
  const state = { held: [], released: [], answers: {} };
  for (const it of items) {
    const h = byItem.get(it.id) ?? { hold: [], fix: [], note: [] };
    const repaired = Boolean(it.source?.repaired);
    let held = !repaired && h.hold.length > 0;
    let holdReason = held ? join(h.hold.map(line)) : null;
    const notes = [...(repaired ? h.hold : []), ...h.fix, ...h.note].map((x) => `${x.severity}, ${line(x)}`);
    if (repaired && h.hold.length) notes.unshift('repaired after these findings');
    const now = existing.get(it.id);
    // the admin released it since we held it: leave it released
    if (held && now && now.held === false && !rehold && (lastReleased.has(it.id) || lastHeld.has(it.id))) {
      held = false;
      holdReason = null;
      released.push(it.id);
      state.released.push(it.id);
    }
    if (held) state.held.push(it.id);
    itemRows.push({
      id: it.id,
      set_id: it.set,
      module: it.module ?? null,
      position: it.position,
      domain: it.domain,
      skill: it.skill ?? null,
      difficulty: it.difficulty ?? null,
      kind: it.kind,
      passage: it.passage ?? null,
      stem: it.stem,
      choices: it.choices ?? null,
      held,
      hold_reason: holdReason,
      review_note: join(notes),
      source: it.source ?? null,
    });
    const k = keyOf.get(it.id);
    if (!k) continue;
    let answer = k.answer;
    let accept = k.accept ?? [];
    const before = lastAnswers[it.id];
    // the admin set another answer and our source for it has not changed: keep theirs
    if (now && before !== undefined && now.answer !== before && k.answer === before && !rehold) {
      answer = now.answer;
      accept = now.accept ?? accept;
      keptAnswers.push(it.id);
    }
    state.answers[it.id] = k.answer;
    keyRows.push({ item_id: it.id, answer, accept, explanation: k.explanation ?? null });
  }
  return { itemRows, keyRows, released, keptAnswers, state };
}

export const skillRows = (content) => (content.skills ?? []).map(({ slug, domain, name, position }) => ({ slug, domain, name, position: position ?? 0 }));
export const setRows = (content) => (content.sets ?? []).map((s) => ({
  id: s.id, kind: s.kind, domain: s.domain ?? null, skill: s.skill ?? null, title: s.title, position: s.position ?? 0,
  modules: s.modules ?? [], origin: s.origin ?? 'matthew',
}));
export const fileRows = (content) => (content.files ?? []).map((f) => ({
  id: f.id, collection: f.collection, domain: f.domain ?? null, skill: f.skill ?? null, difficulty: f.difficulty ?? null,
  title: f.title, storage_path: f.path, bytes: f.bytes ?? null, pages: f.pages ?? null, staff_only: Boolean(f.staff_only), position: f.position ?? 0,
}));
export const guideRows = (content) => (content.guides ?? []).map((g) => ({ skill: g.skill, domain: g.domain, title: g.title, position: g.position ?? 0, body: g.body }));

// Every object to upload: the library PDFs and the figures the docs point at
// -> [{ local, path, type }]
export function uploads(content, outDir, joinPath) {
  const list = [];
  const seen = new Set();
  for (const f of content.files ?? []) {
    if (!f.local || seen.has(f.path)) continue;
    seen.add(f.path);
    list.push({ local: f.local, path: f.path, type: 'application/pdf' });
  }
  const walk = (blocks) => {
    for (const b of blocks ?? []) {
      if (b.t === 'img' && b.src && !seen.has(b.src)) {
        seen.add(b.src);
        list.push({ local: joinPath(outDir, b.src), path: b.src, type: 'image/png' });
      } else if (b.t === 'passage') walk(b.blocks);
    }
  };
  for (const it of content.items ?? []) {
    walk(it.passage?.blocks);
    walk(it.stem?.blocks);
    for (const c of it.choices ?? []) walk(c.blocks);
  }
  for (const k of content.keys ?? []) walk(k.explanation?.blocks);
  for (const g of content.guides ?? []) walk(g.body?.blocks);
  return list;
}

// Ids in the database that the bundle no longer has
export const stale = (dbIds, bundleIds) => {
  const keep = new Set(bundleIds);
  return [...dbIds].filter((id) => !keep.has(id));
};
