// Answer keys: the keyed letter or grid-in value from a solution's LaTeX, and
// the forms a grid-in accepts under the digital SAT's entry rules (positive
// answers up to 5 characters, negative up to 6; a decimal that does not fit
// may be rounded or truncated but must fill the space: 2/3 -> .6666, .6667,
// 0.666, 0.667).

// The keyed letter of a multiple-choice solution, or null
export function mcAnswer(tex) {
  const head = tex.slice(0, 400);
  const patterns = [
    /\\textbf\s*\{\s*Answer\s*:?\s*\(?\s*([A-D])\s*\)/,
    /^\s*\\textbf\s*\{\s*\(?([A-D])\)?[.:]?\s*\}/,
    /Answer\s*:?\s*\}?\s*\(?\s*([A-D])\s*\)/,
    /\\textbf\s*\{\s*Correct(?: answer)?\s*:?\s*\(?\s*([A-D])\s*\)?/i,
  ];
  for (const re of patterns) {
    const m = re.exec(head);
    if (m) return m[1];
  }
  return null;
}

// One grid-in value written in LaTeX ($-\tfrac{2}{3}$, \textbf{.75}, 37/4)
// -> a plain string, or null when it is not a number
export function plainValue(tex) {
  let t = String(tex ?? '')
    .replace(/\\boldmath|\\mathbf|\\textbf|\\texttt|\\text|\\mathrm|\\displaystyle/g, '')
    .replace(/\\[td]?frac\s*\{\s*([^{}]+?)\s*\}\s*\{\s*([^{}]+?)\s*\}/g, '$1/$2')
    .replace(/\\[td]?frac\s*(\d)(\d)/g, '$1/$2')
    .replace(/\{,\}/g, '')
    .replace(/\\[,;:! ]/g, '')
    .replace(/[{}$\s]/g, '')
    .replace(/−/g, '-')
    .replace(/[.,;:]+$/, '');
  t = t.replace(/^\+/, '');
  return /^-?(\d+(\.\d+)?|\.\d+|\d+\/\d+)$/.test(t) ? t : null;
}

// Values written after "Grid in", "Enter" and the like, with their
// "(or ...)" alternatives -> [[value, ...], ...] per mention
const VALUE = String.raw`(\\textbf\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\\texttt\s*\{[^{}]*\}|\$[^$]*\$)`;
const GRID = new RegExp(String.raw`(?:^|[^a-zA-Z])(?:[Gg]rid(?:[- ]in)?(?: exactly)?|[Ee]nter)\s*:?\s+` + VALUE, 'g');
const ALT = new RegExp(String.raw`^\s*(?:\(\s*)?(?:or|,)\s+(?:the\s+(?:decimal|fraction|equivalent)\s+)?(?:as\s+)?` + VALUE + String.raw`\s*\)?`);

function gridMentions(tex) {
  const out = [];
  for (const m of tex.matchAll(GRID)) {
    const values = [plainValue(m[1])];
    let rest = tex.slice(m.index + m[0].length);
    for (;;) {
      const alt = ALT.exec(rest);
      if (!alt) break;
      values.push(plainValue(alt[1]));
      rest = rest.slice(alt[0].length);
    }
    if (values[0]) out.push(values.filter(Boolean));
  }
  return out;
}

// The value(s) in a leading bold label: \textbf{Answer: $3060$.},
// \textbf{Student-produced response: \texttt{15}.}, \textbf{Grid-in: \boldmath$12$.}
function leadValues(tex) {
  const m = /^\s*\\textbf\s*\{\s*(?:Answer|Student-produced response|Answer to grid|SPR|Grid-in|Grid in|Correct answer)\s*:\s*/i.exec(tex);
  if (!m) return null;
  // the rest of the bold group
  let depth = 1;
  let j = m.index + m[0].length;
  const start = j;
  for (; j < tex.length; j++) {
    if (tex[j] === '\\') { j++; continue; }
    if (tex[j] === '{') depth++;
    else if (tex[j] === '}' && --depth === 0) break;
  }
  const inner = tex.slice(start, j);
  const parts = inner.split(/\s+or\s+|\s*,\s+|\s*;\s*/);
  const values = parts.map((p) => plainValue(p.replace(/\(.*\)/, ''))).filter(Boolean);
  return values.length ? values : null;
}

// The grid-in answer of a solution -> { values: [canonical, ...alternatives], how } or null
export function sprAnswer(tex) {
  const lead = leadValues(tex);
  const grids = gridMentions(tex);
  if (lead) return { values: dedupe([...lead, ...(grids[0] ?? []).filter((v) => sameNumber(v, lead[0]) || lead.length > 1)]), how: 'label', grids };
  if (grids.length) return { values: dedupe(grids[0]), how: 'grid', grids };
  return null;
}

const dedupe = (list) => [...new Set(list)];

// A grid-in string -> { n, d } (a fraction in lowest terms, d > 0), or null
export function parseGrid(value) {
  const t = String(value ?? '').trim().replace(/\s+/g, '').replace(/^\+/, '');
  let m = /^(-?)(\d+)\/(\d+)$/.exec(t);
  if (m) {
    const d = Number(m[3]);
    if (!d) return null;
    return reduce((m[1] ? -1 : 1) * Number(m[2]), d);
  }
  m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const decimals = m[3] ?? '';
  const d = 10 ** decimals.length;
  return reduce((m[1] ? -1 : 1) * (Number(m[2] || 0) * d + Number(decimals || 0)), d);
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
function reduce(n, d) {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function sameNumber(a, b) {
  const x = parseGrid(a);
  const y = parseGrid(b);
  return Boolean(x && y && x.n === y.n && x.d === y.d);
}

// Whether a string can be entered in the SAT's grid-in box
export function enterable(value) {
  const t = String(value ?? '');
  if (!parseGrid(t)) return false;
  return t.startsWith('-') ? t.length <= 6 : t.length <= 5;
}

// The exact decimal of a fraction when it terminates, else null
function exactDecimal({ n, d }) {
  let q = d;
  while (q % 2 === 0) q /= 2;
  while (q % 5 === 0) q /= 5;
  if (q !== 1) return null;
  let digits = 0;
  while ((n * 10 ** digits) % d !== 0) digits++;
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / d);
  const frac = digits ? String(Math.round(((abs % d) * 10 ** digits) / d)).padStart(digits, '0') : '';
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

// The decimal digits of |n/d|: whole part and `count` digits after the point,
// truncated and rounded
function decimalDigits({ n, d }, count) {
  const abs = Math.abs(n);
  const whole = Math.floor(abs / d);
  let rem = abs % d;
  let digits = '';
  for (let k = 0; k < count + 1; k++) {
    rem *= 10;
    digits += String(Math.floor(rem / d));
    rem %= d;
  }
  const trunc = digits.slice(0, count);
  // round half up on the next digit (and on anything after it)
  let up = Number(digits[count]) >= 5;
  let rounded = trunc.split('').map(Number);
  let carryWhole = whole;
  if (up) {
    let k = rounded.length - 1;
    while (k >= 0) {
      if (rounded[k] === 9) {
        rounded[k] = 0;
        k--;
      } else {
        rounded[k]++;
        break;
      }
    }
    if (k < 0) carryWhole++;
  }
  return { whole, trunc, roundWhole: carryWhole, round: rounded.join('') };
}

// Every other form a grid-in accepts for this value: the exact decimal when it
// fits, and for a decimal that does not end (or does not fit) the rounded and
// truncated forms that fill the box
export function gridAccept(value) {
  const f = parseGrid(value);
  if (!f) return [];
  const neg = f.n < 0;
  const room = neg ? 6 : 5;
  const sign = neg ? '-' : '';
  const out = [];
  const exact = exactDecimal(f);
  if (f.d !== 1 && exact !== null && (exact.length <= room || exact.replace(/^(-?)0\./, '$1.').length <= room)) {
    out.push(exact.length <= room ? exact : exact.replace(/^(-?)0\./, '$1.'));
  }
  if (f.d !== 1 && (exact === null || exact.replace(/^(-?)0\./, '$1.').length > room)) {
    const whole = Math.floor(Math.abs(f.n) / f.d);
    const wholeText = String(whole);
    const forms = [];
    if (whole === 0) {
      // .dddd fills the box; so does 0.ddd
      for (const lead of ['', '0']) {
        const count = room - sign.length - lead.length - 1;
        if (count < 1) continue;
        const dd = decimalDigits(f, count);
        forms.push(`${sign}${lead}.${dd.trunc}`);
        forms.push(dd.roundWhole > 0 ? `${sign}${dd.roundWhole}${'.'}${dd.round}`.replace(/\.$/, '') : `${sign}${lead}.${dd.round}`);
      }
    } else {
      const count = room - sign.length - wholeText.length - 1;
      if (count >= 1) {
        const dd = decimalDigits(f, count);
        forms.push(`${sign}${wholeText}.${dd.trunc}`);
        forms.push(`${sign}${dd.roundWhole}.${dd.round}`);
      }
    }
    for (const form of forms) if (form.length <= room && !out.includes(form)) out.push(form);
  }
  return out.filter((v) => v !== value);
}

// The canonical answer and accept list of a grid-in from the values the key
// gives: the first value (with a leading zero added to ".5"), every other
// listed value, and the grid forms of each. A listed decimal that only
// approximates the answer must fill the box (2/3: .6667 yes, .667 no); the
// ones that do not are returned in `dropped`.
export function sprKey(values) {
  const canon = values[0].replace(/^(-?)\./, '$10.');
  const accept = [];
  const dropped = [];
  const add = (v) => {
    if (v !== canon && !accept.includes(v)) accept.push(v);
  };
  const distinct = [canon];
  for (const v of values.slice(1)) {
    if (!enterable(v)) dropped.push(v);
    else if (sameNumber(v, canon)) add(v);
    else if (approximates(v, canon)) {
      if (gridAccept(canon).includes(v)) add(v);
      else dropped.push(v);
    } else {
      add(v);
      distinct.push(v);
    }
  }
  for (const v of distinct) for (const form of gridAccept(v)) add(form);
  return { answer: canon, accept, dropped };
}

// Whether decimal v is a rounding or truncation of value (not equal to it)
export function approximates(v, value) {
  const a = parseGrid(v);
  const b = parseGrid(value);
  const m = /\.(\d+)$/.exec(String(v));
  if (!a || !b || !m || (a.n === b.n && a.d === b.d)) return false;
  return Math.abs(a.n / a.d - b.n / b.d) < 10 ** -m[1].length;
}

// The end of a braced group that opens at tex[open] === '{'
function groupEnd(tex, open) {
  let depth = 0;
  for (let j = open; j < tex.length; j++) {
    if (tex[j] === '\\') {
      j++;
      continue;
    }
    if (tex[j] === '{') depth++;
    else if (tex[j] === '}' && --depth === 0) return j + 1;
  }
  return -1;
}

const LEAD_LABEL = /^\s*\\textbf\s*\{\s*(?:Answer|Student-produced response|Answer to grid|SPR|Grid-in|Grid in|Correct answer)\b/i;

// An explanation without the answer label it opens with ("Answer: (B).",
// "Student-produced response: 15.", ...), which the portal already shows,
// and for a grid-in without a leading "Also accepted: ..." sentence that
// only lists forms the key accepts anyway. Everything after stays.
export function stripAnswerLead(tex, { answer = null, accept = [] } = {}) {
  let s = String(tex ?? '');
  const label = LEAD_LABEL.exec(s);
  if (label) {
    const open = s.indexOf('{', label.index);
    const end = groupEnd(s, open);
    if (end > 0) {
      s = s.slice(end);
      // "\textbf{Answer:} (D)." leaves its letter outside the bold
      s = s.replace(/^\s*\(?[A-D]\)?(?=[.\s]|$)\.?/, '').replace(/^\s*\.(?!\d)/, '');
    }
  } else {
    s = s.replace(/^\s*(?:\\(?:textbf|emph|textit)\s*\{\s*(?:Student-produced response|SPR)\.?\s*\}|(?:Student-produced response|SPR)\.)/, '');
  }
  s = s.replace(/^\s+/, '');
  if (answer !== null) {
    const also = /^(?:\\(?:textbf|emph|textit)\s*\{\s*)?Also accepted\s*:?\s*\}?\s*:?\s*/i.exec(s);
    if (also) {
      const rest = s.slice(also[0].length);
      // the sentence ends at a period followed by space and a capital, a command or the end
      const stop = /(?<![\s(])\.(?=\s+[A-Z\\$(]|\s*$)/.exec(rest);
      const list = stop ? rest.slice(0, stop.index) : rest;
      const values = list.split(/\s*,\s*|\s+or\s+|\s+and\s+/).map((v) => v.replace(/^(?:or|and)\s+/, '')).filter((v) => v.trim());
      const known = [answer, ...accept];
      const all = values.length > 0 && values.every((v) => {
        const p = plainValue(v);
        // the same number (68.80 for 68.8) is accepted anyway; so is a listed form
        return p !== null && known.some((k) => k === p || sameNumber(k, p));
      });
      if (all) s = (stop ? rest.slice(stop.index + 1) : '').replace(/^\s+/, '');
    }
  }
  return s;
}
