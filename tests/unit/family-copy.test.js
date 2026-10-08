import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { helpSections, partsText } from '../../portal/js/help-model.js';
import { familyStatus } from '../../portal/js/labels.js';
import { submissionStatus, itemStatus } from '../../portal/js/status.js';
import { deriveItems } from '../../portal/js/buckets.js';
import { pageItems, familyDataItems } from '../../portal/js/palette-items.js';

// Students and parents never learn how work is graded: nothing they can read
// mentions AI, a grader, automatic grading or grading that failed. Staff words
// ("AI draft", "Could not grade", the Review queue) are left alone.
const FORBIDDEN = /\bAI\b|grader|automatic|could not grade/i;

const NOW = new Date('2026-10-14T19:00:00Z');
const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

function textsOf(section) {
  const out = [section.title];
  for (const block of section.blocks) {
    if (block.type === 'p') out.push(partsText(block.parts));
    else if (block.type === 'steps' || block.type === 'list') out.push(...block.items.map(partsText));
    else if (block.type === 'actions') out.push(...block.actions.map((a) => a.label));
  }
  return out;
}

// The string literals of a source file, comments left out
function literals(source) {
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
}

const STATUSES = ['pending', 'grading', 'ai_graded', 'failed'];
const ERRORS = [null, 'The grader could not read this file.', 'Grading did not finish. Your tutor will grade this one.'];
const GRADES = [
  null,
  { result: 'completed', feedback: 'x', reviewed_at: null, released_at: null },
  { result: 'missing', feedback: 'x', reviewed_at: '2026-10-13T00:00:00Z', released_at: null },
  { result: 'completed', feedback: 'x', reviewed_at: '2026-10-13T00:00:00Z', released_at: '2026-10-13T00:00:00Z' },
  { result: 'missing', feedback: 'x', reviewed_at: '2026-10-13T00:00:00Z', released_at: '2026-10-13T00:00:00Z' },
  { result: 'extended', feedback: 'x', reviewed_at: '2026-10-13T00:00:00Z', released_at: '2026-10-13T00:00:00Z' },
];

function familyCopy() {
  const out = [];
  for (const role of ['student', 'parent']) out.push(...helpSections(role).flatMap(textsOf));
  for (const status of STATUSES) {
    for (const error of ERRORS) {
      for (const grade of GRADES) {
        const sub = { id: 1, task_id: 1, status, error, created_at: '2026-10-12T00:00:00Z', grade };
        out.push(familyStatus(sub, grade).text, submissionStatus(sub, grade, { audience: 'family' }).label);
        const task = { id: 1, kind: 'assignment', title: 'A', due_at: '2026-10-20T06:59:00Z', created_at: '2026-10-01T00:00:00Z' };
        const [item] = deriveItems([task], [sub], NOW, { audience: 'family' });
        out.push(itemStatus(item, { audience: 'family', now: NOW }).label);
      }
    }
  }
  // the student's handed-in confirmations (submit-work.js and the drawer)
  out.push(...literals(read('portal/js/submit-work.js')));
  const drawer = read('portal/js/item-drawer.js');
  out.push(drawer.match(/const SUBMITTED = '([^']+)'/)[1]);
  // the command palette for families
  for (const role of ['student', 'parent']) {
    for (const p of pageItems({ role, page: role })) out.push(p.title, p.meta ?? '', p.keywords ?? '');
  }
  const task = { id: 1, student_id: 's1', kind: 'assignment', title: 'A', due_at: '2026-10-20T06:59:00Z', created_at: '2026-10-01T00:00:00Z' };
  for (const grade of GRADES) {
    const data = { tasks: [task], submissions: [{ id: 1, task_id: 1, status: 'failed', error: 'x', created_at: '2026-10-12T00:00:00Z', grade }] };
    for (const p of familyDataItems({ data, sessions: [], now: NOW })) out.push(p.title, p.meta, p.keywords);
  }
  return out.filter(Boolean);
}

describe('family-facing copy never mentions how work is graded', () => {
  test('help, statuses, the submit confirmation and the palette', () => {
    const copy = familyCopy();
    expect(copy.length).toBeGreaterThan(100);
    expect(copy.filter((text) => FORBIDDEN.test(text))).toEqual([]);
  });

  test('the submit confirmation is the only message after handing in', () => {
    const source = read('portal/js/submit-work.js');
    expect(source).toContain("export const SUCCESS = 'Work submitted. Your tutor will review it soon.';");
    expect(source).not.toMatch(/GRADING_LATER|grading could not start/i);
    // the background grading call is silent whatever it answers
    expect(source).toMatch(/startGrading\(inserted\.data\.id, \{ keepalive: true \}\)\.catch\(\(\) => null\);/);
  });

  test('families never see why grading failed', () => {
    const drawer = read('portal/js/item-drawer.js');
    expect(drawer).toMatch(/staff && sub\.error && sub\.status === 'failed'/);
    expect(drawer).not.toMatch(/Needs attention/);
    expect(familyStatus({ status: 'failed', error: 'Unreadable' }, null)).toEqual({ text: 'Submitted, waiting for review', tone: 'wait' });
  });

  test('the check itself catches the words it is for', () => {
    for (const text of ['An AI assistant drafts it', 'The grader could not read this', 'Automatic grading', 'Could not grade']) {
      expect(FORBIDDEN.test(text), text).toBe(true);
    }
    expect(FORBIDDEN.test('Wait for your tutor to review it.')).toBe(false);
  });
});
