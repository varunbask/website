// Shows an assignment's instructions in the portal (the item drawer, the
// staff form's Preview): the homework format (homework-doc.js) as a problem
// set, with typeset math. Text that is not in the format shows as it was
// typed, with any math typeset.
//
// homeworkView(details) -> div.hw-doc (math typesets on its own when present)
//   header chips (objective, time, materials), each section as an h4 with its
//   directions, a shaded worked example with numbered steps, the problems as
//   a numbered list of cards: multiple choice as a list of options, a hint as
//   a small "Hint" disclosure. Nothing here is staff-only.
// richText(text) -> nodes: text, line breaks, and span.hw-math for each formula

import { h } from './dom.js';
import { icon } from './icons.js';
import { parseHomework, splitMath, hasMath } from './homework-doc.js';
import { typesetIn } from './math.js';

// Text with line breaks (or kept as typed, for a pre-wrap block), and a
// placeholder showing the TeX for each formula
export function richText(text, { breaks = true } = {}) {
  const nodes = [];
  for (const part of splitMath(text)) {
    if (part.type === 'math') {
      nodes.push(h('span', {
        class: part.display ? 'hw-math is-display' : 'hw-math',
        dataset: { tex: part.value },
      }, part.display ? `$$${part.value}$$` : `$${part.value}$`));
      continue;
    }
    if (!breaks) {
      nodes.push(part.value);
      continue;
    }
    part.value.split('\n').forEach((line, i) => {
      if (i) nodes.push(h('br'));
      if (line) nodes.push(line);
    });
  }
  return nodes;
}

function chip(iconName, label, value) {
  return h('li', { class: 'hw-chip' }, icon(iconName, { size: 14 }),
    h('span', { class: 'hw-chip-label' }, `${label}:`), h('span', {}, ...richText(value)));
}

const LETTERS = 'ABCDEFGH';

function problemCard(p) {
  const choices = p.choices?.length
    ? h('ul', { class: 'hw-choices', 'aria-label': 'Choices' }, p.choices.map((c, i) => h('li', { class: 'hw-choice' },
      h('span', { class: 'hw-choice-letter', 'aria-hidden': 'true' }, LETTERS[i]),
      h('span', { class: 'visually-hidden' }, `Choice ${LETTERS[i]}: `),
      h('span', { class: 'hw-choice-text' }, ...richText(c)))))
    : null;
  const hint = p.hint
    ? h('details', { class: 'hw-hint' }, h('summary', {}, 'Hint'), h('p', {}, ...richText(p.hint)))
    : null;
  return h('li', { class: 'hw-problem' },
    h('span', { class: 'hw-num', 'aria-hidden': 'true' }, String(p.number)),
    h('div', { class: 'hw-problem-body' }, h('p', { class: 'hw-prompt' }, ...richText(p.prompt)), choices, hint));
}

function exampleBox(ex) {
  return h('div', { class: 'hw-example' },
    h('p', { class: 'hw-example-label' }, 'Worked example'),
    h('p', { class: 'hw-example-problem' }, ...richText(ex.problem)),
    ex.steps.length ? h('ol', { class: 'hw-steps' }, ex.steps.map((s) => h('li', {}, ...richText(s)))) : null,
    ex.answer ? h('p', { class: 'hw-example-answer' }, h('strong', {}, 'Answer: '), ...richText(ex.answer)) : null);
}

export function homeworkView(details, { headingLevel = 4 } = {}) {
  const doc = parseHomework(details);
  const tag = `h${Math.min(Math.max(headingLevel, 2), 6)}`;
  // Text a tutor typed shows as it was typed (math typeset)
  if (!doc.structured) {
    const plain = h('div', { class: 'hw-doc' }, h('p', { class: 'read is-pre hw-plain' }, ...richText(details, { breaks: false })));
    if (hasMath(details)) typesetIn(plain).catch((error) => console.error(error));
    return plain;
  }
  const root = h('div', { class: 'hw-doc is-structured' });

  const chips = [
    doc.objective ? chip('check-circle', 'Objective', doc.objective) : null,
    doc.time ? chip('clock', 'Time', doc.time) : null,
    doc.materials ? chip('paperclip', 'Materials', doc.materials) : null,
  ].filter(Boolean);
  if (chips.length) root.append(h('ul', { class: 'hw-chips', 'aria-label': 'About this assignment' }, chips));

  for (const sec of doc.sections) {
    const part = h('section', { class: 'hw-section' });
    if (sec.heading) part.append(h(tag, { class: 'hw-heading' }, ...richText(sec.heading)));
    if (sec.directions) part.append(h('p', { class: 'hw-directions' }, ...richText(sec.directions)));
    for (const para of sec.text) part.append(h('p', { class: 'hw-text' }, ...richText(para)));
    if (sec.example) part.append(exampleBox(sec.example));
    if (sec.problems.length) {
      part.append(h('ol', { class: 'hw-problems', 'aria-label': sec.heading ? `${sec.heading}, problems` : 'Problems' },
        sec.problems.map(problemCard)));
    }
    root.append(part);
  }

  if (hasMath(details)) typesetIn(root).catch((error) => console.error(error));
  return root;
}
