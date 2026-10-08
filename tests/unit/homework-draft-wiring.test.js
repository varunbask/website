import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpSections, partsText } from '../../portal/js/help-model.js';

// Drafting homework from lesson photos, and answer keys: the pieces that are
// DOM or network code, checked from their source. The rules are tested in
// homework-draft-model.test.js and homework-draft.test.js.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const portalJs = readdirSync(join(ROOT, 'portal/js'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `portal/js/${f}`);
const code = (path) => read(path).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

// The string literals of a source file, comments left out
function literals(source) {
  const text = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

describe('answer keys never reach families', () => {
  test('only the staff modules touch the answer key table or the drafts table', () => {
    const touching = portalJs.filter((f) => /task_answer_keys|homework_drafts/.test(code(f))).sort();
    expect(touching).toEqual(['portal/js/answer-key.js', 'portal/js/homework-draft.js']);
    const importers = portalJs.filter((f) => /from '\.\/(answer-key|homework-draft)\.js'/.test(read(f))).sort();
    expect(importers).toEqual(['portal/js/item-drawer.js', 'portal/js/item-form.js']);
    // what families load as their data never asks for a key
    for (const f of ['portal/js/store.js', 'portal/js/student.js', 'portal/js/parent.js', 'portal/js/submit-work.js', 'portal/js/views/assignments.js']) {
      expect(read(f), f).not.toMatch(/answer.?key|homework.?draft/i);
    }
  });

  test('the item drawer loads and builds the key for staff only, never for a task', () => {
    const drawer = read('portal/js/item-drawer.js');
    expect(drawer).toContain("const keyed = dctx.audience === 'staff' && found.task.kind !== 'task';");
    expect(drawer).toMatch(/keyed \? loadAnswerKey\(found\.task\.id\)/);
    expect(drawer).toContain('if (staff && !isTask && found.answerKey) {');
    expect(drawer.match(/answerKeySection\(/g)).toHaveLength(1);
    expect(drawer.match(/loadAnswerKey\(/g)).toHaveLength(1);
  });

  test('the create form (with the draft panel and the key field) is staff only', () => {
    const drawer = read('portal/js/item-drawer.js');
    expect(drawer).toMatch(/async function renderCreate\(dctx\) \{\n {2}if \(dctx\.audience !== 'staff' \|\| dctx\.readOnly\) \{\n {4}paintMissing\(dctx\);/);
    expect(drawer).toContain("draft: dctx.params?.draft === '1',");
  });

  test('the drawer heading says only staff see it', async () => {
    const key = read('portal/js/answer-key.js');
    expect(key).toContain("export const ANSWER_KEY_HEADING = 'Answer key (only staff see this)';");
    expect(key).toMatch(/h\('details', \{ class: 'asg-key' \}\)/);   // collapsed until opened
  });
});

describe('family copy', () => {
  const FORBIDDEN = /\bAI\b|grader|generated|language model|answer key/i;

  test('the family help never mentions AI, drafts or answer keys', () => {
    for (const role of ['student', 'parent']) {
      const text = helpSections(role).flatMap((s) => [s.title, ...s.blocks.flatMap((b) => (b.parts ? [partsText(b.parts)] : (b.items ?? []).map(partsText)))]).join('\n');
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(/lesson photos|Recent drafts/i);
    }
  });

  test('what the item drawer can show a family has no AI wording (the staff-only words live in the staff modules)', () => {
    const shown = literals(read('portal/js/item-drawer.js')).filter((t) => /[A-Za-z]{3,} [a-z]/.test(t));
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.filter((t) => FORBIDDEN.test(t))).toEqual([]);
  });

  test('the drafting prompt keeps AI out of what the student reads, and the server scrubs it again', () => {
    const server = read('api/_lib/homework-draft.js');
    expect(server).toContain('Never mention AI, a model, or that the homework was generated.');
    expect(server).toContain('withoutSelfReference(');
  });
});

describe('the entry points', () => {
  test('the session drawer offers Make homework from this lesson once the lesson has happened, to staff who may change it', () => {
    const ses = read('portal/js/session-drawer.js');
    expect(ses).toContain("label: 'Make homework from this lesson',");
    expect(ses).toMatch(/if \(editable && !cancelled\) \{[\s\S]*started \? button\(\{\n\s*label: 'Make homework from this lesson'/);
    expect(ses).toMatch(/newHomeworkHref\(hash, \{ due, sessionId: session\.id, draft: true \}\)/);
    expect(ses).toContain("${draft ? '&draft=1' : ''}");
  });

  test('the create form drafts only while creating, fills the fields, and saves the key after the task', () => {
    const form = read('portal/js/item-form.js');
    expect(form).toMatch(/if \(!editing\) \{\n\s*drafted = draftPanel\(dctx,/);
    expect(form).toContain('titleInput.value = values.title;');
    expect(form).toContain('details.value = values.details;');
    expect(form).toContain('answerKeyInput.value = values.answerKey;');
    const insert = form.indexOf("await sb.from('tasks').insert(inserts)");
    const keys = form.indexOf('await addAnswerKeys(made.map((t) => t.id), keyText)');
    const upload = form.indexOf('attached = await uploadMaterialFiles({ studentId, owner: { task_id: first.id }, files });');
    expect(insert).toBeGreaterThan(0);
    expect(keys).toBeGreaterThan(insert);
    expect(upload).toBeGreaterThan(keys);
    expect(form).toContain("const files = [...pendingFiles, ...(drafted?.attachFiles() ?? [])];");
  });

  test('the panel: an image picker, a camera input for phones, one request at a time, polling through the API', () => {
    const panel = read('portal/js/homework-draft.js');
    expect(panel).toContain("type: 'file', accept: 'image/*', multiple: true");
    expect(panel).toContain("capture: 'environment'");
    expect(panel).toMatch(/async function start\(\) \{\n\s*if \(active \|\| adding \|\| starting\) return;\n\s*starting = true;/);
    expect(panel).toContain("callApi({ action: 'draft_status', id })");
    expect(panel).toContain("fetch('/api/grade'");
    expect(panel).toContain("dctx.signal?.addEventListener('abort', stop, { once: true });");
    expect(panel).toContain("role: 'status', 'aria-live': 'polite'");
    expect(panel).not.toMatch(/90_?000|AbortSignal\.timeout/);   // no client timeout: drafts may take minutes
    // the attach box is off until ticked
    expect(panel).toMatch(/h\('input', \{ type: 'checkbox', class: 'checkbox', name: 'draft_attach', disabled: true \}\)/);
  });

  test('the staff help has the tip', () => {
    expect(helpSections('tutor').map((s) => s.title)).toContain('Draft homework from lesson photos');
  });

  test('the styles exist', () => {
    const css = read('portal/css/assignments.css');
    for (const rule of ['.hwd-panel', '.hwd-thumbs', '.hwd-status-box', '.hwd-recent-item', '.asg-key-summary', '.asg-key-field[hidden]']) expect(css).toContain(rule);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.hwd-spinner/);
  });
});
