// Pure search model for the command palette (palette.js). No DOM, so it runs in
// unit tests.
//
// An item is a plain object:
//   key        stable id ('student:12'), used for recents and de-duplication
//   type       the group it belongs to ('page', 'student', 'assignment', ...)
//   title      what is shown and matched first
//   meta       the second line, matched too (student name, due date, ...)
//   keywords   extra words that match but are never shown ('homework')
//   weight     a small bonus (0 to 10) that breaks near ties between types
//   browse     true when it shows with an empty search box
//   group, groupLabel   optional group override (recents use group 'recent')
// The view adds whatever else it needs (icon, target); this module ignores it.
//
// normalize(text)               lower case, no accents, words joined by one space
// score(query, item)            0 for no match, else higher is better
// rank(items, query)            [{ item, score, index }] best first
// browse(items, { recent })     the same shape for an empty search box
// group(entries, { perGroup, total })
//                               { groups: [{ key, label, entries }], count, hidden }
//                               every entry gets `position`, its place in the
//                               flat list the keyboard walks

// ---------------------------------------------------------------------------
// Text

const SPECIAL = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ł': 'l', 'ı': 'i' };

// "Zoë O’Brien-Müller" -> "zoe obrien muller". Accents drop, apostrophes join
// the letters around them, every other symbol becomes a word break.
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđðþłı]/g, (c) => SPECIAL[c])
    .replace(/['‘’ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const field = (text) => {
  const norm = normalize(text);
  return { norm, words: norm ? norm.split(' ') : [] };
};

// ---------------------------------------------------------------------------
// Scoring

export const FIELD_WEIGHT = Object.freeze({ title: 1, meta: 0.6, keywords: 0.45 });
const MAX_SUBSEQUENCE = 40;

// Where the token sits among the words: the first word counts most
const positionPenalty = (i) => Math.min(i, 4) * 3;

// Whole word 100, word start 80 to 90 (more of the word typed is better),
// inside a word 40 (three letters or more: "gr" is not "progress"); 0 when no word matches
function wordScore(token, words) {
  let best = 0;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    let s = 0;
    if (w === token) s = 100 - positionPenalty(i);
    else if (w.startsWith(token)) s = 80 - positionPenalty(i) + Math.round((10 * token.length) / w.length);
    else if (token.length >= 3 && w.includes(token)) s = 40 - positionPenalty(i);
    if (s > best) best = s;
  }
  return best;
}

// The letters of `token` in order inside `norm` ("rq" in "review queue", "mth"
// in "math tutoring"). The first letter starts a word, the match must be
// compact (letters strewn across a long title are not what anyone meant), and
// it needs two letters. 0 to 40.
function alignFrom(letters, norm, start) {
  let at = start - 1;
  let run = 0;
  let points = 0;
  for (const ch of letters) {
    const next = norm.indexOf(ch, at + 1);
    if (next === -1) return 0;
    if (next === at + 1) {
      run += 1;
      points += 3 + Math.min(run, 3);
    } else {
      run = 0;
      points += 1;
    }
    if (next === 0 || norm[next - 1] === ' ') points += 4;
    at = next;
  }
  if (at - start + 1 > letters.length * 3 + 2) return 0;
  return Math.min(MAX_SUBSEQUENCE, 10 + points);
}

function subsequenceScore(token, norm) {
  const letters = Array.from(token);
  if (letters.length < 2) return 0;
  let best = 0;
  for (let start = norm.indexOf(letters[0]); start !== -1; start = norm.indexOf(letters[0], start + 1)) {
    if (start === 0 || norm[start - 1] === ' ') best = Math.max(best, alignFrom(letters, norm, start));
  }
  return best;
}

// Scattered letters only count in the title: in a second line or hidden
// keywords they would match nearly everything
function tokenScore(token, f, { fuzzy = false } = {}) {
  return wordScore(token, f.words) || (fuzzy ? subsequenceScore(token, f.norm) : 0);
}

// A search box value as { raw, norm, tokens }
export function prepareQuery(query) {
  if (query && typeof query === 'object' && Array.isArray(query.tokens)) return query;
  const norm = normalize(query);
  return { raw: String(query ?? ''), norm, tokens: norm ? norm.split(' ') : [] };
}

// Normalizing thousands of titles on every key press would add up: do it once per item
const prepared = new WeakMap();
function prepare(item) {
  let p = prepared.get(item);
  if (!p || p.title.raw !== item.title || p.metaRaw !== item.meta || p.keywordsRaw !== item.keywords) {
    p = {
      title: { raw: item.title, ...field(item.title) },
      meta: field(item.meta),
      keywords: field(item.keywords),
      metaRaw: item.meta,
      keywordsRaw: item.keywords,
    };
    prepared.set(item, p);
  }
  return p;
}

const TITLE_EXACT = 60;
const TITLE_STARTS = 30;

// 0 when any word of the query matches nothing in the item (every word must
// match somewhere), otherwise the average of each word's best field score plus
// a bonus when the title is, or starts with, what was typed
export function score(query, item) {
  const q = prepareQuery(query);
  if (!q.tokens.length || !item) return 0;
  const p = prepare(item);
  let sum = 0;
  for (const token of q.tokens) {
    const best = Math.max(
      tokenScore(token, p.title, { fuzzy: true }) * FIELD_WEIGHT.title,
      tokenScore(token, p.meta) * FIELD_WEIGHT.meta,
      tokenScore(token, p.keywords) * FIELD_WEIGHT.keywords,
    );
    if (best <= 0) return 0;
    sum += best;
  }
  let total = sum / q.tokens.length;
  if (p.title.norm === q.norm) total += TITLE_EXACT;
  else if (p.title.norm.startsWith(q.norm)) total += TITLE_STARTS;
  return Math.max(1, Math.round(total + (Number(item.weight) || 0)));
}

// Items that match, best first; equal scores keep their original order
export function rank(items, query) {
  const q = prepareQuery(query);
  if (!q.tokens.length) return [];
  const out = [];
  (items ?? []).forEach((item, index) => {
    const s = score(q, item);
    if (s > 0) out.push({ item, score: s, index });
  });
  return out.sort((a, b) => b.score - a.score || a.index - b.index);
}

// ---------------------------------------------------------------------------
// Empty search box, recents

// What shows before anything is typed: recent picks (as group 'recent'), then
// every browse item in the order given
export function browse(items, { recent = [], maxRecent = 5 } = {}) {
  const picked = recent.slice(0, maxRecent).map((item) => ({ ...item, group: 'recent', groupLabel: undefined }));
  const taken = new Set(picked.map((i) => i.key));
  const rest = (items ?? []).filter((i) => i.browse && !taken.has(i.key));
  return [...picked, ...rest].map((item, index) => ({ item, score: 0, index }));
}

// Newest first, no repeats, at most `max`
export function remember(keys, key, max = 8) {
  if (!key) return [...(keys ?? [])].slice(0, max);
  return [key, ...(keys ?? []).filter((k) => k !== key)].slice(0, max);
}

// The stored text back into a list of keys; anything odd gives []
export function parseRecent(raw, max = 8) {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter((k) => typeof k === 'string' && k))].slice(0, max);
  } catch {
    return [];
  }
}

// The items behind recent keys, newest first; keys that no longer exist drop out
export function resolveRecent(keys, items) {
  const byKey = new Map((items ?? []).map((i) => [i.key, i]));
  return (keys ?? []).map((k) => byKey.get(k)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Groups

export const GROUP_LABELS = Object.freeze({
  recent: 'Recent',
  page: 'Pages',
  action: 'Actions',
  student: 'Students',
  assignment: 'Assignments',
  task: 'Tasks',
  session: 'Upcoming sessions',
  child: 'Switch child',
});

// Takes entries best first: each group keeps its best `perGroup`, the list
// stops at `total`, and groups come in the order their best entry appeared
// (so the top result is always the first row). `hidden` counts matches left out.
export function group(entries, { perGroup = 8, total = 30, labels = GROUP_LABELS } = {}) {
  const buckets = new Map();
  let count = 0;
  for (const entry of entries ?? []) {
    if (count >= total) break;
    const key = entry.item.group ?? entry.item.type;
    let bucket = buckets.get(key);
    if (bucket && bucket.entries.length >= perGroup) continue;
    if (!bucket) {
      bucket = { key, label: entry.item.groupLabel ?? labels[key] ?? key, entries: [] };
      buckets.set(key, bucket);
    }
    bucket.entries.push({ ...entry, position: -1 });
    count += 1;
  }
  const groups = [...buckets.values()];
  let position = 0;
  for (const g of groups) for (const e of g.entries) e.position = position++;
  return { groups, count, hidden: Math.max(0, (entries?.length ?? 0) - count) };
}

// ---------------------------------------------------------------------------
// Keyboard

export function isApple(platform) {
  return /mac|iphone|ipad|ipod/i.test(String(platform ?? ''));
}

// The hint chip text: "⌘K" on Apple devices, "Ctrl K" elsewhere
export function shortcutHint(apple) {
  return apple ? '⌘K' : 'Ctrl K';
}

const NOT_TEXT_INPUT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'range', 'color']);

// Would a typed character land in this element as text? (a field, a select, an
// editor). Takes anything with tagName, type and isContentEditable.
export function isEditable(el) {
  if (!el) return false;
  const tag = String(el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TEXT_INPUT.has(String(el.type ?? 'text').toLowerCase());
  return Boolean(el.isContentEditable);
}

// 'open' for Cmd+K (Apple) or Ctrl+K (elsewhere), and for "/" when focus is not
// in a text field; null for everything else
export function shortcutAction(event, { apple = false } = {}) {
  if (!event || event.isComposing) return null;
  const key = String(event.key ?? '');
  if (key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey) {
    const chord = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (chord) return 'open';
  }
  if (key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditable(event.target)) return 'open';
  return null;
}
