// The question structure of one SAT book file: its question sets (a
// \begin{mcq} list paired with the \begin{solutions} key after it), each
// set's label from the header before it, the questions and the keys. Works
// on raw LaTeX and returns raw LaTeX pieces; latex-doc.mjs converts them.

import { stripComments, findEnvs, splitItems, readArg, readOptional, skipSpaces, readGroup } from './tex.mjs';

const HEADER = /\\(practiceheader|testheader|modulebanner|chapter|section)\*?\s*(\[[^\]]*\]|\{)?/g;

// The text of a header argument (\practiceheader[...] or \testheader{...})
function headerLabel(src, m) {
  const at = m.index + m[0].length;
  if (m[2]?.startsWith('[')) return m[2].slice(1, -1).trim();
  if (m[2] === '{') {
    const g = readGroup(src, at - 1);
    return g ? g.content.trim() : null;
  }
  return m[1] === 'practiceheader' ? 'Practice Set' : null;
}

// Every header in the file with its position
function headers(src) {
  const out = [];
  for (const m of src.matchAll(HEADER)) {
    const label = headerLabel(src, m);
    if (label !== null) out.push({ kind: m[1], label, at: m.index });
  }
  return out;
}

// Topic comments such as "% ----- Q4  Two-way table -----" -> Map q -> topic
export function topicComments(raw) {
  const out = new Map();
  for (const m of raw.matchAll(/%[ \t-]*Q(\d+)\b[ \t:.)]*(.*?)[ \t-]*$/gm)) {
    const topic = m[2].replace(/^\((.*)\)$/, '$1').trim();
    if (topic && !out.has(Number(m[1]))) out.set(Number(m[1]), topic);
  }
  return out;
}

// One file -> [{ label, header, mcq, solutions, topics, at }] in source order.
// mcq and solutions are comment-free LaTeX bodies.
export function fileSets(raw) {
  const mcqs = findEnvs(raw, 'mcq');
  const sols = findEnvs(raw, 'solutions');
  const heads = headers(raw);
  const sets = [];
  mcqs.forEach((env, k) => {
    const nextStart = mcqs[k + 1]?.start ?? raw.length;
    const sol = sols.find((s) => s.start > env.end && s.start < nextStart) ?? null;
    const prevEnd = k ? mcqs[k - 1].end : 0;
    const before = heads.filter((h) => h.at < env.start && h.at >= prevEnd && h.kind !== 'chapter' && h.kind !== 'section');
    const header = before[before.length - 1] ?? null;
    const chapter = heads.filter((h) => h.kind === 'chapter' && h.at < env.start).pop() ?? null;
    sets.push({
      label: header?.label ?? null,
      header: header?.kind ?? null,
      chapter: chapter?.label ?? null,
      mcq: stripComments(raw.slice(env.bodyStart, env.bodyEnd)),
      solutions: sol ? stripComments(raw.slice(sol.bodyStart, sol.bodyEnd)) : null,
      topics: topicComments(raw.slice(env.start, env.end)),
      at: env.start,
    });
  });
  return sets;
}

// The questions of an mcq body, numbered from 1 -> [{ q, tex }]
export function setItems(mcq) {
  return splitItems(mcq).map((it, k) => ({ q: k + 1, tex: it.text }));
}

// The keys of a solutions body -> Map q -> tex (the body after \sol{...}),
// plus the labels that carry no number
export function setKeys(solutions) {
  const keys = new Map();
  const odd = [];
  const dup = [];
  if (!solutions) return { keys, odd, dup };
  const marks = [...solutions.matchAll(/\\sol\s*\{/g)];
  marks.forEach((m, k) => {
    const g = readGroup(solutions, m.index + m[0].length - 1);
    const label = g.content.trim();
    const end = marks[k + 1]?.index ?? solutions.length;
    const body = solutions.slice(g.end, end);
    const num = /(?:Question|Q|Problem|Item)?\s*(\d+)\s*$/i.exec(label);
    if (!num) {
      odd.push(label);
      return;
    }
    const q = Number(num[1]);
    if (keys.has(q)) dup.push(q);
    else keys.set(q, body);
  });
  return { keys, odd, dup };
}

const SPR_MARK = /^\s*(?:\\(?:emph|textbf|textit)\s*\{\s*Student-produced response\.?\s*\}|Student-produced response\.?)\s*/;

// One question's LaTeX -> { difficulty, stem, choices: [4 tex] | null, spr, rest }
export function splitItem(tex) {
  let s = tex;
  let difficulty = null;
  const d = /\\diff\s*\{([^}]*)\}/.exec(s);
  if (d) {
    difficulty = d[1].trim().toLowerCase();
    s = s.slice(0, d.index) + s.slice(d.index + d[0].length);
  }
  let choices = null;
  let rest = '';
  const c = /\\choices(v?)(?![a-zA-Z])/.exec(s);
  if (c) {
    let at = c.index + c[0].length;
    const args = [];
    for (let k = 0; k < 4; k++) {
      const at2 = skipSpaces(s, at);
      const g = s[at2] === '{' ? readGroup(s, at2) : null;
      if (!g) break;
      args.push(g.content);
      at = g.end;
    }
    if (args.length === 4) {
      choices = args;
      rest = s.slice(at);
      s = s.slice(0, c.index);
    }
  }
  let spr = false;
  const mark = SPR_MARK.exec(s);
  if (mark) {
    spr = true;
    s = s.slice(mark[0].length);
  } else if (/Student-produced response/.test(s)) {
    spr = true;
    s = s.replace(/\\(?:emph|textbf|textit)\s*\{\s*Student-produced response\.?\s*\}\s*|Student-produced response\.\s*/, '');
  }
  return { difficulty, stem: s.trim(), choices, spr, rest: rest.trim(), choicesStyle: c ? (c[1] ? 'v' : 'grid') : null };
}

// What is left after the choices that is more than spacing commands
export function meaningfulRest(rest) {
  return rest.replace(/\\(needspace|vspace\*?)\s*\{[^}]*\}|\\(par|smallskip|medskip|bigskip|noindent|nopagebreak)(?![a-zA-Z])|\s+/g, '').length > 0;
}

// The number in a label such as "Practice Test 3 --- Algebra" (or null)
export function testNumber(label) {
  const m = /\b(?:Practice\s+)?Test\s+(\d+)/i.exec(label ?? '');
  return m ? Number(m[1]) : null;
}

// \def\sattitle{...} from a master.tex
export function bookTitle(master) {
  const m = /\\def\\sattitle\s*\{/.exec(master ?? '');
  if (!m) return null;
  return readGroup(master, m.index + m[0].length - 1)?.content ?? null;
}

// The \chapter{...} title of a chapter file
export function chapterTitle(raw) {
  const m = /\\chapter\*?\s*(\[[^\]]*\])?\s*\{/.exec(raw);
  if (!m) return null;
  return readGroup(raw, m.index + m[0].length - 1)?.content.trim() ?? null;
}

// The lesson part of a chapter: everything before its first \practiceheader
export function lessonPart(raw) {
  const at = raw.search(/\\practiceheader(?![a-zA-Z])/);
  return at === -1 ? raw : raw.slice(0, at);
}

// The \modulebanner labels and \testheader of a full test's exam-NN.tex
// -> { title, modules: [{ label, file }] }
export function fullTestIndex(raw) {
  const title = /\\testheader\s*\{/.exec(raw);
  const out = { title: title ? readGroup(raw, title.index + title[0].length - 1).content.trim() : null, modules: [] };
  const re = /\\modulebanner\s*\{/g;
  for (const m of raw.matchAll(re)) {
    const g = readGroup(raw, m.index + m[0].length - 1);
    const after = raw.slice(g.end);
    const input = /\\input\s*\{([^}]*)\}/.exec(after);
    out.modules.push({ label: g.content.trim(), file: input ? input[1].trim() : null });
  }
  return out;
}

export { readArg, readOptional };
