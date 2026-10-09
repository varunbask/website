// Em and en dashes out of answer explanations (the portal's copy uses none).
// Explanations only: passages, stems and choices keep theirs, since grammar
// questions test dashes. The rewrite is deterministic:
//
//   a pair in one sentence  "A — B — C"  -> "A, B, C", or "A (B) C" when B has a comma
//   a single dash           -> ": " after a complete clause that the rest explains,
//                              otherwise ", "
//   a range                 "3–5" -> "3 to 5" (a chain like 8–15–17 gets hyphens)
//   a compound              "subject–verb" -> "subject-verb"
//
// Left alone: math, quoted text (“…”), italic or underlined text (usually a
// quoted choice or passage; italic step labels are rewritten) and any
// sentence that talks about dashes.

const EM = '—';
const EN = '–';
const MATH = '';
const OTHER = '';

const AUX = new Set(('is are was were be been being am has have had do does did can could will would shall should may '
  + 'might must gives give gave makes make made shows show showed means mean meant says said need needs keep keeps fits '
  + 'fit get gets got put puts take takes took run runs ran see sees saw find finds found lose loses lost stop stops '
  + 'reads read tells told asks asked lands leaves left turns sets adds reverses').split(' '));
const DETERMINERS = new Set(('the a an its their his her our your my this that these those each every both all some many '
  + 'more most other few several two three four five six seven eight nine ten no any such which whose').split(' '));
const JOINING = /^(and|but|or|so|yet|nor|which|who|whom|whose|while|because|since|though|although|not|rather|especially|even|then|just|only|unless|until|when|where|if|as|with|without|plus|instead|including|like|from|to|for|than|that|whether)\b/i;
const LABEL_RUN = /^\s*(step|rule|part|case|one|two|three|four|five|check|goal)\b/i;
const LABEL = /^\s*(step|part|case|check|note|tip|trap|rule|goal|answer|one|two|three|four|five|first|second|third|finally|desmos)\b[^.]{0,24}$/i;

// Whether text reads as a complete clause (it has something that works as a verb)
export function isClause(text) {
  const words = text.toLowerCase().replace(/\([a-d]\)/g, ' choice ').split(/[^a-z’']+/).filter(Boolean);
  if (words.length < 3) return false;
  return words.some((w, k) => AUX.has(w) || (/^[a-z]{3,}(s|ed)$/.test(w) && !/(ss|us|is|ous)$/.test(w) && !DETERMINERS.has(words[k - 1] ?? '') && !/^\d/.test(words[k - 1] ?? '')));
}

// A run list -> the same list with its dashes rewritten.
// Returns { c, changed, kept, edits: [{ before, after }] }.
export function rewriteRuns(c) {
  let flat = '';
  const owner = [];
  c.forEach((n, run) => {
    if (n.x !== undefined) {
      // italic text is usually a quoted choice or passage; an italic step label ("Step 2 — ...") is not
      const prot = Boolean(n.m?.includes('u') || (n.m?.includes('i') && !LABEL_RUN.test(n.x)));
      for (let k = 0; k < n.x.length; k++) owner.push({ run, off: k, prot });
      flat += n.x;
    } else {
      owner.push(null);
      flat += n.tex !== undefined ? MATH : n.br ? '\n' : OTHER;
    }
  });
  if (!flat.includes(EM) && !flat.includes(EN)) return { c, changed: 0, kept: 0 };

  // quoted spans and sentences
  const quoted = [];
  let inQuote = false;
  for (let k = 0; k < flat.length; k++) {
    if (flat[k] === '“') inQuote = true;
    quoted.push(inQuote);
    if (flat[k] === '”') inQuote = false;
  }
  const sentenceOf = [];
  let sentence = 0;
  for (let k = 0; k < flat.length; k++) {
    sentenceOf.push(sentence);
    if (flat[k] === '\n' || (/[.!?]/.test(flat[k]) && /^[”’)]*(\s|$)/.test(flat.slice(k + 1, k + 4)) && !/\b(e\.g|i\.e|vs|etc|approx)$/i.test(flat.slice(Math.max(0, k - 6), k)))) sentence++;
  }
  const sentenceText = (s) => {
    const from = sentenceOf.indexOf(s);
    const to = sentenceOf.lastIndexOf(s);
    return { from, to: to + 1, text: flat.slice(from, to + 1) };
  };

  const edits = [];
  let kept = 0;
  const span = (d) => {
    let from = d;
    while (from > 0 && (flat[from - 1] === ' ' || flat[from - 1] === ' ')) from--;
    let to = d + 1;
    while (to < flat.length && (flat[to] === ' ' || flat[to] === ' ')) to++;
    return { from, to };
  };
  const protectedAt = (d) => !owner[d] || owner[d].prot || quoted[d] || /\bdash(es)?\b/i.test(sentenceText(sentenceOf[d]).text);
  const termish = (ch) => ch === MATH || /[0-9]/.test(ch ?? '');

  // en dashes between terms: ranges and compounds
  const dashes = [];
  for (let d = 0; d < flat.length; d++) {
    const ch = flat[d];
    if (ch !== EM && ch !== EN) continue;
    if (protectedAt(d)) {
      kept++;
      continue;
    }
    if (ch === EN && flat[d - 1] !== ' ' && flat[d + 1] !== ' ') {
      const chain = (flat[d - 2] === EN || flat[d + 2] === EN || /[\d]–[\d]+–/.test(flat.slice(Math.max(0, d - 4), d + 8)) || /–[\d]+–[\d]/.test(flat.slice(Math.max(0, d - 8), d + 4)));
      const range = termish(flat[d - 1]) && termish(flat[d + 1]) && !chain;
      edits.push({ from: d, to: d + 1, at: d, text: range ? ' to ' : '-' });
      continue;
    }
    dashes.push(d);
  }

  // em dashes (and spaced en dashes): pairs within a sentence, then singles
  const bySentence = new Map();
  for (const d of dashes) {
    const s = sentenceOf[d];
    if (!bySentence.has(s)) bySentence.set(s, []);
    bySentence.get(s).push(d);
  }
  for (const [s, list] of bySentence) {
    const { from: start, to: end } = sentenceText(s);
    let k = 0;
    while (k < list.length) {
      const d = list[k];
      const a = span(d);
      if (k + 1 < list.length) {
        const e = list[k + 1];
        const b = span(e);
        const inner = flat.slice(a.to, b.from);
        const next = flat[b.to] ?? '';
        const punctAfter = !next || /[.,;:!?)”\n]/.test(next);
        if (inner.includes(',')) {
          edits.push({ ...a, at: d, text: a.from === 0 ? '(' : ' (' });
          // a clause hanging off the aside still needs its comma: "(B, C), which ..."
          const relative = /^(which|who|whom|whose|neither|none|both|all|each|most|many|some|one)\b/i.test(flat.slice(b.to));
          edits.push({ ...b, at: e, text: punctAfter ? ')' : relative ? '), ' : ') ' });
        } else {
          edits.push({ ...a, at: d, text: a.from === 0 ? '' : ', ' });
          edits.push({ ...b, at: e, text: punctAfter ? '' : ', ' });
        }
        k += 2;
        continue;
      }
      const before = flat.slice(start, a.from);
      const after = flat.slice(a.to, end);
      const prev = flat[a.from - 1] ?? '';
      let text;
      if (!after.trim() || /^[.,;:!?)”]/.test(after)) text = '';
      else if (!before.trim() || /[,;:(]$/.test(prev)) text = before.trim() ? ' ' : '';
      else if (!JOINING.test(after) && !before.includes(':') && (isClause(before) || LABEL.test(before))) text = ': ';
      else text = ', ';
      edits.push({ ...a, at: d, text });
      k++;
    }
  }
  if (!edits.length) return { c, changed: 0, kept };

  // apply: characters in an edit's span go, its text goes where the dash was
  const drop = new Set();
  const insertAt = new Map();
  for (const ed of edits) {
    for (let k = ed.from; k < ed.to; k++) drop.add(k);
    insertAt.set(ed.at, ed.text);
  }
  const texts = c.map((n) => (n.x !== undefined ? '' : null));
  for (let k = 0; k < flat.length; k++) {
    const o = owner[k];
    if (!o) continue;
    if (insertAt.has(k)) texts[o.run] += insertAt.get(k);
    else if (!drop.has(k)) texts[o.run] += flat[k];
  }
  const out = [];
  c.forEach((n, run) => {
    if (n.x === undefined) out.push(n);
    else if (texts[run]) out.push({ ...n, x: texts[run] });
  });
  const plain = (runs) => runs.map((n) => (n.x !== undefined ? n.x : n.tex !== undefined ? `$${n.tex}$` : n.br ? '\n' : '____')).join('');
  return { c: out, changed: edits.length, kept, edits: [{ before: plain(c), after: plain(out) }] };
}

// A whole explanation doc -> { doc, changed, kept, samples }
export function rewriteExplanation(doc) {
  let changed = 0;
  let kept = 0;
  const samples = [];
  const fix = (c) => {
    const r = rewriteRuns(c);
    changed += r.changed;
    kept += r.kept;
    if (r.changed) samples.push(...r.edits);
    return r.c;
  };
  const walk = (blocks) => blocks.map((b) => {
    if (b.t === 'passage' || b.t === 'math' || b.t === 'img') return b;
    if (b.c) return { ...b, c: fix(b.c) };
    if (b.items) return { ...b, items: b.items.map(fix) };
    if (b.rows) return { ...b, rows: b.rows.map((row) => row.map(fix)) };
    return b;
  });
  return { doc: { ...doc, blocks: walk(doc?.blocks ?? []) }, changed, kept, samples };
}
