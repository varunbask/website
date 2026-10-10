// Small LaTeX scanning helpers shared by the SAT converter: comments, braced
// groups, optional arguments and matching \end{...}. They read source text
// only; nothing here knows about questions or SAT docs.

// Drops % comments the way TeX does: the comment, its line break and the
// spaces that start the next line all go. An escaped \% stays.
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      out += ch + (src[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch !== '%') {
      out += ch;
      continue;
    }
    let j = src.indexOf('\n', i);
    if (j === -1) break;
    j++;
    while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
    i = j - 1;
  }
  return out;
}

export const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

export function skipSpaces(s, i) {
  while (i < s.length && isSpace(s[i])) i++;
  return i;
}

// The group starting at s[i] === '{' -> { content, end } (end is just past
// the closing brace), or null when s[i] is not an opening brace
export function readGroup(s, i) {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return { content: s.slice(i + 1), end: s.length };
}

// A macro argument: a braced group, or a single token (TeX allows \frac12)
export function readArg(s, i) {
  const at = skipSpaces(s, i);
  if (s[at] === '{') return readGroup(s, at);
  if (s[at] === '\\') {
    const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(at));
    return m ? { content: m[0], end: at + m[0].length } : null;
  }
  if (at < s.length) return { content: s[at], end: at + 1 };
  return null;
}

// An optional [..] argument at s[i] (after spaces) -> { content, end } or null.
// Brackets inside braces do not count.
export function readOptional(s, i) {
  const at = skipSpaces(s, i);
  if (s[at] !== '[') return null;
  let depth = 0;
  for (let j = at + 1; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ']' && depth === 0) return { content: s.slice(at + 1, j), end: j + 1 };
  }
  return null;
}

// The index of the \end{name} matching a \begin{name} whose body starts at i,
// counting nested environments of the same name; -1 when there is none
export function findEnvEnd(s, i, name) {
  const begin = `\\begin{${name}}`;
  const end = `\\end{${name}}`;
  let depth = 1;
  let at = i;
  while (at < s.length) {
    const b = s.indexOf(begin, at);
    const e = s.indexOf(end, at);
    if (e === -1) return -1;
    if (b !== -1 && b < e) {
      depth++;
      at = b + begin.length;
      continue;
    }
    depth--;
    if (depth === 0) return e;
    at = e + end.length;
  }
  return -1;
}

// Every top-level environment named `name` in s -> [{ start, bodyStart, bodyEnd, end, opt }]
export function findEnvs(s, name) {
  const out = [];
  const begin = `\\begin{${name}}`;
  let at = 0;
  for (;;) {
    const start = s.indexOf(begin, at);
    if (start === -1) return out;
    let bodyStart = start + begin.length;
    const opt = readOptional(s, bodyStart);
    if (opt && name !== 'mcq' && name !== 'solutions') bodyStart = opt.end;
    const bodyEnd = findEnvEnd(s, bodyStart, name);
    if (bodyEnd === -1) return out;
    const end = bodyEnd + `\\end{${name}}`.length;
    out.push({ start, bodyStart, bodyEnd, end, opt: opt ? opt.content : null });
    at = end;
  }
}

// Splits a list body at its own \item commands, not at those of nested
// lists or inside braces -> [{ start, text }] (text starts just after \item)
export function splitItems(body) {
  const out = [];
  let depth = 0;
  let brace = 0;
  let current = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      const m = /^\\(begin|end)\{([^}]*)\}|^\\item(?![a-zA-Z])|^\\./.exec(body.slice(i, i + 40));
      if (m && m[1] === 'begin' && /^(itemize|enumerate|description|mcq|problems)$/.test(m[2])) depth++;
      else if (m && m[1] === 'end' && /^(itemize|enumerate|description|mcq|problems)$/.test(m[2])) depth--;
      else if (m && m[0] === '\\item' && depth === 0 && brace === 0) {
        if (current >= 0) out.push({ start: current, text: body.slice(current + 5, i) });
        current = i;
      }
      i += m ? m[0].length - 1 : 1;
      continue;
    }
    if (ch === '{') brace++;
    else if (ch === '}') brace--;
  }
  if (current >= 0) out.push({ start: current, text: body.slice(current + 5) });
  return out;
}

// Splits at a separator that sits at brace depth 0 and outside nested
// environments (table rows at \\, cells at &)
export function splitTopLevel(s, sep) {
  const parts = [];
  let brace = 0;
  let env = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      const rest = s.slice(i, i + 12);
      if (rest.startsWith('\\begin{')) env++;
      else if (rest.startsWith('\\end{')) env--;
      if (sep === '\\\\' && s[i + 1] === '\\' && brace === 0 && env === 0) {
        parts.push(s.slice(last, i));
        i++;
        last = i + 1;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '$') {
      // skip inline math so an & or \\ inside it is never a separator
      const close = findMathClose(s, i + 1);
      if (close > i) i = close;
    } else if (sep === '&' && ch === '&' && brace === 0 && env === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

// The index of the $ closing inline math that opened just before i, or -1
export function findMathClose(s, i) {
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '$') return j;
  }
  return -1;
}
