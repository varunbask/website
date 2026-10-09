import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
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

// Every module a page loads through static imports (import ... from, export
// ... from, import '...'), starting at its module script. import() is left
// out: those load only when the code that calls them runs.
function staticGraph(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specs = [
      ...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/gm),
      ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ].map((m) => m[1]).filter((spec) => spec.startsWith('.'));
    for (const spec of specs) walk(normalize(join(dirname(file), spec)));
  };
  walk(entry);
  return seen;
}
const entryOf = (page) => read(`portal/${page}`).match(/<script type="module" src="\/(portal\/js\/[\w/-]+\.js)"><\/script>/)[1];

describe('families never download the staff modules', () => {
  const STAFF_ONLY = ['portal/js/item-form.js', 'portal/js/homework-draft.js', 'portal/js/homework-draft-model.js', 'portal/js/answer-key.js', 'portal/js/draft-sources-model.js', 'portal/js/pdf-pages.js'];

  test('student.html and parent.html reach none of them through static imports', () => {
    for (const page of ['student.html', 'parent.html']) {
      const graph = staticGraph(entryOf(page));
      expect(graph.size, page).toBeGreaterThan(20);
      expect(graph.has('portal/js/item-drawer.js'), page).toBe(true);   // the walk does reach the drawer
      expect(STAFF_ONLY.filter((f) => graph.has(f)), page).toEqual([]);
    }
  });

  test('the walk would catch a static import', () => {
    const graph = staticGraph(entryOf('staff.html'));
    expect(graph.has('portal/js/item-drawer.js')).toBe(true);
    // staff load them the same lazy way
    expect(STAFF_ONLY.filter((f) => graph.has(f))).toEqual([]);
    const form = staticGraph('portal/js/item-form.js');
    for (const f of STAFF_ONLY) expect(form.has(f), f).toBe(true);
  });

  test('the drawer imports them with import(), and only on staff paths', () => {
    const drawer = read('portal/js/item-drawer.js');
    expect(drawer).toContain("const staffForm = () => import('./item-form.js');");
    expect(drawer).toContain("const answerKeyModule = () => import('./answer-key.js');");
    expect(drawer).not.toMatch(/^import .*from '\.\/(item-form|answer-key|homework-draft)/m);
    // the create form after the staff check, the edit form from the staff menu, the key when keyed
    expect(drawer).toMatch(/if \(dctx\.audience !== 'staff' \|\| dctx\.readOnly\) \{\n {4}paintMissing\(dctx\);[\s\S]*?await staffForm\(\)/);
    expect(drawer).toMatch(/async function enterEdit\(\) \{[\s\S]*?await staffForm\(\)/);
    expect(drawer).toMatch(/keyed\n\s*\? answerKeyModule\(\)/);
  });
});

describe('answer keys never reach families', () => {
  test('only the staff modules touch the answer key table or the drafts table', () => {
    const touching = portalJs.filter((f) => /task_answer_keys|homework_drafts/.test(code(f))).sort();
    expect(touching).toEqual(['portal/js/answer-key.js', 'portal/js/homework-draft.js']);
    const importers = portalJs.filter((f) => /from '\.\/(answer-key|homework-draft)\.js'|import\('\.\/(answer-key|homework-draft)\.js'\)/.test(read(f))).sort();
    expect(importers).toEqual(['portal/js/item-drawer.js', 'portal/js/item-form.js']);
    // what families load as their data never asks for a key
    for (const f of ['portal/js/store.js', 'portal/js/student.js', 'portal/js/parent.js', 'portal/js/submit-work.js', 'portal/js/views/assignments.js']) {
      expect(read(f), f).not.toMatch(/answer.?key|homework.?draft/i);
    }
  });

  test('the item drawer loads and builds the key for staff only, never for a task', () => {
    const drawer = read('portal/js/item-drawer.js');
    expect(drawer).toContain("const keyed = dctx.audience === 'staff' && found.task.kind !== 'task';");
    expect(drawer).toContain('await loadAnswerKey(found.task.id)');
    expect(drawer).toContain('if (staff && !isTask && found.answerKey) {');
    expect(drawer).toContain('found.answerKey.build(dctx, { taskId: task.id, body: found.answerKey.body })');
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

  test('the form locks its student while a draft for it runs, and caps attachments', () => {
    const form = read('portal/js/item-form.js');
    expect(form).toMatch(/onBusy: \(on\) => \{\n\s*if \(!studentSelect\) return;\n\s*studentSelect\.disabled = on;/);
    expect(form).toContain('const tooMany = editing ? \'\' : attachmentsProblem(pendingFiles.length, drafted?.attachCount() ?? 0);');
    expect(form).toContain('attachRoom: () => MAX_ATTACHMENTS - pendingFiles.length,');
    expect(form).toContain('before.push({ title: titleInput.value, details: details.value, answerKey: answerKeyInput.value });');
    expect(form).toContain('const last = before.pop();');
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

  test('the panel: a picker for every kind, a camera input for phones, one request at a time, polling through the API', () => {
    const panel = read('portal/js/homework-draft.js');
    expect(panel).toContain("type: 'file', accept: SOURCE_ACCEPT, multiple: true");
    expect(panel).toContain("capture: 'environment'");
    expect(panel).toMatch(/async function start\(\) \{\n\s*if \(active \|\| adding \|\| starting\) return;\n\s*starting = true;/);
    // polling: only 404 is gone, the token is fresh for each call, a 401 forces a refresh
    expect(panel).toContain('const outcome = pollOutcome(res.status);');
    expect(panel).toContain("if (outcome === 'retry') continue;");
    expect(panel).toContain('const token = await bearer();');
    expect(panel).toContain('if (response.status === 401) refreshNext = true;');
    // a finished draft fills the form only for the student it was drafted for
    expect(panel).toContain('active = { id: res.body.id, studentId, startedAt: Date.now(), stage };');
    expect(panel).toMatch(/if \(status === 'ready' && !sameStudent\) \{\n\s*const text = elsewhereText\(/);
    // files added while the drawer closed have their links freed; files chosen mid-read wait in a queue
    expect(panel).toMatch(/if \(!alive\(\)\) \{\n\s*\/\/ stop\(\) ran[^\n]*\n\s*queue\.length = 0;\n\s*for \(const it of items\) if \(it\.url\) URL\.revokeObjectURL\(it\.url\);/);
    expect(panel).toMatch(/async function addFiles\(files\) \{\n\s*if \(starting\) return;\n\s*queue\.push\(\.\.\.files\);\n\s*if \(adding\) return;/);
    expect(panel).toContain("callApi({ action: 'draft_status', id })");
    expect(panel).toContain("fetch('/api/grade'");
    expect(panel).toContain("dctx.signal?.addEventListener('abort', stop, { once: true });");
    expect(panel).toContain("role: 'status', 'aria-live': 'polite'");
    expect(panel).not.toMatch(/90_?000|AbortSignal\.timeout/);   // no client timeout: drafts may take minutes
    // the attach box is off until there is something it can attach
    expect(panel).toMatch(/h\('input', \{ type: 'checkbox', class: 'checkbox', name: 'draft_attach', disabled: true \}\)/);
  });

  test('files go to Storage first, in the tutor\'s own folder, with progress; the request carries only their paths', () => {
    const panel = read('portal/js/homework-draft.js');
    expect(panel).toContain('const path = sourcePath(me, key, i + 1,');
    expect(panel).toContain('xhr.upload.onprogress = (e) =>');
    expect(panel).toContain("xhr.open('POST', `${base}/object/${SOURCE_BUCKET}/${path}`);");
    expect(panel).toContain("xhr.setRequestHeader('x-upsert', 'false');");
    expect(panel).toContain("role: 'progressbar'");
    // the demo client has no Storage address, so it never sends a request to the live project
    expect(panel).toContain("if (typeof base !== 'string' || !/^https:\\/\\//.test(base) || typeof XMLHttpRequest !== 'function') {");
    expect(panel).toContain('const res = await startDraft(draftRequest({ sources, notesText: pasted, options: checked.values, context, studentId }));');
    // turned down, or an upload failed: what went up is removed
    expect(panel).toMatch(/if \(res\.status !== 202[^\n]*\n\s*statusBox\.hidden = true;\n\s*await removeUploaded\(sources\.map\(\(s\) => s\.path\)\);/);
    expect(panel).toContain('await removeUploaded(done.map((s) => s.path));');
    // a refused file says why on its own chip
    expect(panel).toContain("it.error ? h('span', { class: 'hwd-chip-error' }, it.error) : null");
    expect(panel).toContain("if (kind.refused) return { id: uid('hwd-file'), name, kind: null, error: kind.refused };");
    // HEIC: the browser tries; where it can't, the message says what to do
    expect(panel).toContain('error: kind.heic ? REFUSED.heic :');
    // ticking Attach: only kinds an assignment can hold; the rest say so
    expect(panel).toContain("const canAttach = (it) => Boolean(materialType({ type: it.mime, name: it.name }));");
    expect(panel).toContain("h('span', { class: 'hwd-chip-note' }, 'Can’t be attached')");
    // pasted notes
    expect(panel).toContain("label: 'Or paste lesson notes'");
    expect(panel).toContain('maxlength: String(MAX_PASTED_NOTES)');
  });

  test('the panel\'s words: lesson materials, the stages, and no em or en dashes', () => {
    const panel = read('portal/js/homework-draft.js');
    expect(panel).toContain("'Draft homework from lesson materials'");
    expect(panel).toContain("label: 'Draft with AI from lesson materials'");
    for (const text of literals(panel)) expect(text, text).not.toMatch(/[\u2013\u2014]/);
    expect(panel).not.toMatch(/Lesson photos'|lesson photos\b/);
  });

  test('the staff help has the tip', () => {
    expect(helpSections('tutor').map((s) => s.title)).toContain('Draft homework from lesson materials');
  });

  test('the styles exist', () => {
    const css = read('portal/css/assignments.css');
    for (const rule of ['.hwd-panel', '.hwd-chips', '.hwd-chip.is-error', '.hwd-chip-fill', '.hwd-status-box', '.hwd-recent-item', '.asg-key-summary', '.asg-key-field[hidden]']) expect(css).toContain(rule);
    expect(css).toContain('transform: scaleX(var(--hwd-progress, 0));');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.hwd-spinner/);
  });
});
