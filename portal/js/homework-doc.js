// The homework format: how a structured assignment is written in plain text
// in tasks.details, and how its answer key is written in task_answer_keys.
// Pure (no DOM): the portal renders it (homework-view.js, worksheet.js) and
// the server writes it from a draft (api/_lib/homework-draft.js).
//
//   Objective: Factor trinomials of the form $x^2 + bx + c$.
//   Time: about 25 minutes
//   Materials: Pencil. No calculator.
//
//   ## Part A: Warm-up
//   Directions: Multiply. Write each answer in standard form.
//   1. Multiply $(x + 2)(x + 3)$. [space: short]
//
//   ## Worked example
//   Problem: Factor $x^2 + 7x + 12$.
//   Step 1: Find two numbers that multiply to $12$ and add to $7$.
//   Answer: $(x + 3)(x + 4)$
//
//   ## Part B: Practice
//   1. Factor $x^2 + 9x + 20$. [space: medium]
//      Hint: Which factors of $20$ add to $9$?
//   2. Which is a factor of $x^2 - x - 6$?
//      (A) $x - 2$  (B) $x + 2$  (C) $x + 3$  (D) $x - 6$
//
// parseHomework(text) -> { objective, time, materials, sections, structured }
//   sections [{ heading, letter, directions, text: [paragraph], example, problems }]
//   example  { problem, steps: [text], answer } or null
//   problems [{ number, prompt, choices: [text] | null, hint, space }]
//   letter   "A", "B"... for each section with problems, in order (or the
//            letter its heading names, "Part C: ..."): problem B3 is the third
//            problem of the second such section
// Text that is not in this format (an assignment a tutor typed) parses to one
// section without a heading: its paragraphs, then any problems numbered
// "1." / "1)" in order, as the worksheet always read them.
//
// serializeHomework(doc) writes the same format; parseHomework reads it back
// unchanged.
//
// The answer key: "A1. answer" lines with "Step 1: ..." under them, grouped
// under the same "## Part A: Warm-up" headings (parseKey, serializeKey).
//
// Math is LaTeX between dollar signs, read as Pandoc's tex_math_dollars does
// (splitMath): $$...$$ is display math; an opening $ must have a non-space
// right after it, and a closing $ a non-space right before it and no digit
// right after it, so "costs $5 and $10" stays text; \$ is a dollar sign.

export const SPACES = Object.freeze(['none', 'short', 'medium', 'long', 'grid']);
export const HEADER_FIELDS = Object.freeze(['objective', 'time', 'materials']);
const HEADER_LABELS = { objective: 'Objective', time: 'Time', materials: 'Materials' };

const HEADER = /^(Objective|Time|Materials):\s*(.*)$/i;
const HEADING = /^##\s+(.+?)\s*$/;
const PART = /^Part\s+([A-Z])\b/i;
const DIRECTIONS = /^Directions:\s*(.*)$/i;
const EX_PROBLEM = /^Problem:\s*(.*)$/i;
const EX_STEP = /^Step\s+(\d+)\s*[:.)]\s*(.*)$/i;
const EX_ANSWER = /^Answer:\s*(.*)$/i;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(\S.*)$/;
const HINT = /^Hint:\s*(.*)$/i;
const CHOICE = /^\(([A-H])\)\s/;
const SPACE_TAG = /\s*\[space:\s*(none|short|medium|long|grid)\]\s*$/i;
const KEY_ENTRY = /^\s{0,3}([A-Z])(\d{1,2})[.)]\s+(.*)$/;

// ---------------------------------------------------------------------------
// Math

// [{ type: 'text', value } | { type: 'math', value, display }]
export function splitMath(text) {
  const s = String(text ?? '');
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', value: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    if (ch !== '$') {
      buf += ch;
      i += 1;
      continue;
    }
    if (s[i + 1] === '$') {
      // Display math: up to the next $$ that is not escaped
      let j = i + 2;
      let end = -1;
      while (j < s.length - 1) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '$' && s[j + 1] === '$') { end = j; break; }
        j += 1;
      }
      const body = end === -1 ? '' : s.slice(i + 2, end);
      if (end !== -1 && body.trim()) {
        flush();
        out.push({ type: 'math', value: body.trim(), display: true });
        i = end + 2;
        continue;
      }
      buf += '$$';
      i += 2;
      continue;
    }
    // Inline: a non-space must follow the opening $
    const next = s[i + 1];
    if (next === undefined || /\s/.test(next)) {
      buf += '$';
      i += 1;
      continue;
    }
    let j = i + 1;
    let end = -1;
    while (j < s.length) {
      const c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') break;   // inline math stays on one line
      if (c === '$') {
        // The first unescaped $ decides: a closer, or this was not math
        if (!/\s/.test(s[j - 1]) && !/[0-9]/.test(s[j + 1] ?? '')) end = j;
        break;
      }
      j += 1;
    }
    if (end === -1) {
      buf += '$';
      i += 1;
      continue;
    }
    flush();
    out.push({ type: 'math', value: s.slice(i + 1, end), display: false });
    i = end + 1;
  }
  flush();
  return out;
}

// Text for a one-line preview (a list row, a card): math as its TeX without
// the dollar signs, a structured assignment as its objective
export function plainMath(text) {
  return splitMath(text).map((p) => p.value).join('');
}

export function detailsSummary(details) {
  const doc = parseHomework(details);
  if (doc.structured) {
    const first = doc.objective
      ?? doc.sections.map((s) => s.directions ?? s.text[0] ?? s.heading).find(Boolean) ?? '';
    return plainMath(first).replace(/\s+/g, ' ').trim();
  }
  const line = String(details ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  return plainMath(line).trim();
}

export function hasMath(text) {
  return splitMath(text).some((part) => part.type === 'math');
}

// Every formula in a text: [{ tex, display }]
export function mathIn(text) {
  return splitMath(text).filter((p) => p.type === 'math').map((p) => ({ tex: p.value, display: p.display }));
}

// ---------------------------------------------------------------------------
// Parsing

const blankSection = (heading = null, letter = null) => ({
  heading, letter, directions: null, text: [], example: null, problems: [],
});

export function parseHomework(details) {
  const lines = String(details ?? '').replace(/\r\n?/g, '\n').split('\n');
  const doc = { objective: null, time: null, materials: null, sections: [], structured: false };
  let section = null;
  let problem = null;
  let paragraph = null;
  let started = false;   // past the header lines

  const ensureSection = () => {
    if (!section) {
      section = blankSection();
      doc.sections.push(section);
    }
    return section;
  };
  const endParagraph = () => {
    if (paragraph !== null) ensureSection().text.push(paragraph.replace(/\s+$/, ''));
    paragraph = null;
  };
  const addChoices = (line) => {
    const parts = line.trim().split(/\s*\(([A-H])\)\s+/).slice(1);
    problem.choices ??= [];
    for (let k = 0; k < parts.length; k += 2) problem.choices.push(parts[k + 1].trim());
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (!started) {
      const header = HEADER.exec(trimmed);
      if (header) {
        doc[header[1].toLowerCase()] = header[2].trim() || null;
        doc.structured = true;
        continue;
      }
      if (!trimmed) continue;
      started = true;
    }

    const heading = HEADING.exec(trimmed);
    if (heading && !/^\s/.test(line)) {
      endParagraph();
      problem = null;
      const part = PART.exec(heading[1]);
      section = blankSection(heading[1], part ? part[1].toUpperCase() : null);
      doc.sections.push(section);
      doc.structured = true;
      continue;
    }

    if (!trimmed) {
      endParagraph();
      continue;
    }

    const s = ensureSection();
    const numbered = NUMBERED.exec(line);
    if (numbered && Number(numbered[1]) === s.problems.length + 1) {
      endParagraph();
      let first = numbered[2];
      let space = null;
      const tag = SPACE_TAG.exec(first);
      if (tag) {
        space = tag[1].toLowerCase();
        first = first.slice(0, tag.index);
      }
      problem = { number: s.problems.length + 1, prompt: first.trim(), choices: null, hint: null, space };
      s.problems.push(problem);
      continue;
    }

    if (problem) {
      const hint = HINT.exec(trimmed);
      if (hint) {
        problem.hint = problem.hint ? `${problem.hint}\n${hint[1]}` : hint[1];
      } else if (CHOICE.test(trimmed)) {
        addChoices(trimmed);
      } else {
        const tag = SPACE_TAG.exec(trimmed);
        if (tag && !problem.space) problem.space = tag[1].toLowerCase();
        const rest = tag ? trimmed.slice(0, tag.index).trim() : trimmed;
        if (rest) problem.prompt = problem.prompt ? `${problem.prompt}\n${rest}` : rest;
      }
      continue;
    }

    const directions = DIRECTIONS.exec(trimmed);
    if (directions && s.directions === null && !s.text.length && paragraph === null) {
      s.directions = directions[1];
      doc.structured = true;
      continue;
    }
    const exProblem = EX_PROBLEM.exec(trimmed);
    if (exProblem && !s.example) {
      endParagraph();
      s.example = { problem: exProblem[1], steps: [], answer: null };
      doc.structured = true;
      continue;
    }
    if (s.example && !s.problems.length) {
      const step = EX_STEP.exec(trimmed);
      if (step) {
        endParagraph();
        s.example.steps.push(step[2]);
        continue;
      }
      const answer = EX_ANSWER.exec(trimmed);
      if (answer) {
        endParagraph();
        s.example.answer = answer[1];
        continue;
      }
    }
    paragraph = paragraph === null ? trimmed : `${paragraph}\n${trimmed}`;
  }
  endParagraph();

  // Letters for the sections with problems: the one a heading names, else the next
  let next = 0;
  for (const sec of doc.sections) {
    if (!sec.problems.length) continue;
    if (sec.letter) next = sec.letter.charCodeAt(0) - 64;
    else {
      next += 1;
      sec.letter = String.fromCharCode(64 + Math.min(next, 26));
    }
  }
  return doc;
}

// "B3" for the third problem of section B
export function problemRefs(doc) {
  return doc.sections.flatMap((sec) => sec.problems.map((p) => `${sec.letter}${p.number}`));
}

// ---------------------------------------------------------------------------
// Writing

// One line: hints and choices are single lines in the format
const oneLine = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();

// The format above. Within a section: the heading and directions, then each
// part (a paragraph, the worked example, the problems) after a blank line.
export function serializeHomework(doc) {
  const blocks = [];
  const header = HEADER_FIELDS.filter((k) => doc[k]).map((k) => `${HEADER_LABELS[k]}: ${oneLine(doc[k])}`);
  if (header.length) blocks.push(header.join('\n'));
  for (const sec of doc.sections ?? []) {
    const head = [];
    if (sec.heading) head.push(`## ${oneLine(sec.heading)}`);
    if (sec.directions) head.push(`Directions: ${oneLine(sec.directions)}`);
    const parts = (sec.text ?? []).map((para) => String(para).trim()).filter(Boolean);
    if (sec.example) {
      const ex = [`Problem: ${oneLine(sec.example.problem)}`];
      (sec.example.steps ?? []).forEach((step, i) => ex.push(`Step ${i + 1}: ${oneLine(step)}`));
      if (sec.example.answer) ex.push(`Answer: ${oneLine(sec.example.answer)}`);
      parts.push(ex.join('\n'));
    }
    if (sec.problems?.length) {
      const probs = [];
      sec.problems.forEach((p, i) => {
        const [first, ...rest] = String(p.prompt).trim().split('\n');
        probs.push(`${i + 1}. ${first.trim()}${p.space ? ` [space: ${p.space}]` : ''}`);
        for (const l of rest) if (l.trim()) probs.push(`   ${l.trim()}`);
        if (p.choices?.length) probs.push(`   ${p.choices.map((c, k) => `(${String.fromCharCode(65 + k)}) ${oneLine(c)}`).join('  ')}`);
        if (p.hint) probs.push(`   Hint: ${oneLine(p.hint)}`);
      });
      parts.push(probs.join('\n'));
    }
    const body = parts.join('\n\n');
    blocks.push([head.join('\n'), body].filter(Boolean).join('\n'));
  }
  return blocks.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// The answer key (staff only)

// [{ heading, entries: [{ ref, answer, steps: [text] }] }], or null when the
// text is not in this format (a key a tutor typed: shown as it is)
export function parseKey(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const groups = [];
  let group = null;
  let entry = null;
  let found = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const heading = HEADING.exec(trimmed);
    if (heading) {
      group = { heading: heading[1], entries: [] };
      groups.push(group);
      entry = null;
      continue;
    }
    const m = KEY_ENTRY.exec(raw);
    if (m) {
      if (!group) {
        group = { heading: null, entries: [] };
        groups.push(group);
      }
      entry = { ref: `${m[1]}${Number(m[2])}`, answer: m[3].trim(), steps: [] };
      group.entries.push(entry);
      found = true;
      continue;
    }
    if (!entry) continue;
    const step = EX_STEP.exec(trimmed);
    if (step) entry.steps.push(step[2]);
    else entry.answer = `${entry.answer}\n${trimmed}`;
  }
  return found ? groups.filter((g) => g.entries.length || g.heading) : null;
}

export function serializeKey(groups) {
  return groups.map((g) => {
    const lines = g.heading ? [`## ${g.heading}`] : [];
    for (const e of g.entries) {
      const [first, ...rest] = String(e.answer).split('\n');
      lines.push(`${e.ref}. ${first}`);
      for (const l of rest) lines.push(`   ${l}`);
      e.steps.forEach((s, i) => lines.push(`   Step ${i + 1}: ${s}`));
    }
    return lines.join('\n');
  }).join('\n\n');
}
