import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// The worksheet and markup: the pieces that are DOM or canvas code, checked
// from their source. The rules are tested in worksheet-model.test.js,
// pdf-writer.test.js and markup-model.test.js.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Modules a module loads through static imports, and the ones it loads with import()
const staticSpecs = (file) => [
  ...strip(read(file)).matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/gm),
  ...strip(read(file)).matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
].map((m) => m[1]).filter((s) => s.startsWith('.')).map((s) => normalize(join(dirname(file), s)));
const dynamicSpecs = (file) => [...strip(read(file)).matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)]
  .map((m) => normalize(join(dirname(file), m[1])));

function staticGraph(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of staticSpecs(file)) walk(next);
  };
  walk(entry);
  return seen;
}
const entryOf = (page) => read(`portal/${page}`).match(/<script type="module" src="\/(portal\/js\/[\w/-]+\.js)"><\/script>/)[1];

const WORKSHEET_MODULES = ['portal/js/worksheet-ui.js', 'portal/js/worksheet.js', 'portal/js/worksheet-model.js', 'portal/js/pdf-writer.js', 'portal/js/markup.js', 'portal/js/markup-model.js'];

// The string literals of a source file, comments left out
function literals(source) {
  return [...strip(source).matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

describe('families never download answer-key code', () => {
  test('from student.html and parent.html, answer-key.js is not reachable statically', () => {
    for (const page of ['student.html', 'parent.html']) {
      const graph = staticGraph(entryOf(page));
      expect(graph.has('portal/js/worksheet-ui.js'), page).toBe(true);
      for (const staffOnly of ['portal/js/answer-key.js', 'portal/js/item-form.js', 'portal/js/homework-draft.js']) {
        expect(graph.has(staffOnly), `${page} ${staffOnly}`).toBe(false);
      }
      // the canvas code waits for a click
      expect(graph.has('portal/js/worksheet.js'), page).toBe(false);
      expect(graph.has('portal/js/markup.js'), page).toBe(false);
    }
  });

  test('what the worksheet loads later never reaches answer-key.js either', () => {
    const lazy = dynamicSpecs('portal/js/worksheet-ui.js');
    expect(lazy.sort()).toEqual(['portal/js/markup.js', 'portal/js/worksheet.js']);
    for (const file of lazy) {
      const graph = staticGraph(file);
      expect(graph.has('portal/js/answer-key.js'), file).toBe(false);
      expect([...graph].flatMap(dynamicSpecs)).not.toContain('portal/js/answer-key.js');
    }
    for (const file of WORKSHEET_MODULES) expect(strip(read(file)), file).not.toMatch(/answer-key|task_answer_keys/);
  });

  test('the only family-reachable import() of answer-key.js is the drawer, on the staff path', () => {
    const graph = [...staticGraph(entryOf('student.html'))];
    const importers = graph.filter((f) => dynamicSpecs(f).includes('portal/js/answer-key.js'));
    expect(importers).toEqual(['portal/js/item-drawer.js']);
    expect(read('portal/js/item-drawer.js')).toContain("const keyed = dctx.audience === 'staff' && found.task.kind !== 'task';");
  });
});

describe('copy', () => {
  const FORBIDDEN = /\bAI\b|grader|generated|language model|answer key/i;

  test('nothing a family can read in the worksheet or markup mentions AI or the answer key', () => {
    for (const file of WORKSHEET_MODULES) {
      const words = literals(read(file)).filter((t) => /[A-Za-z]{3,} [a-z]/.test(t));
      expect(words.filter((t) => FORBIDDEN.test(t)), file).toEqual([]);
    }
  });

  test('no em or en dashes', () => {
    for (const file of WORKSHEET_MODULES) expect(read(file), file).not.toMatch(/[–—]/);
  });

  test('the drawer line and the iPad note', () => {
    const ui = read('portal/js/worksheet-ui.js');
    expect(ui).toContain("'Print it and fill it in on paper, then take a photo or scan to hand it in. Or mark it up here.'");
    expect(ui).toContain('On iPad or iPhone, Open also lets you write on it with Markup from the Share menu. Save it, then add the file with Submit work.');
  });
});

describe('the drawer section', () => {
  const drawer = read('portal/js/item-drawer.js');

  test('assignments with details get it; only a student who can still submit hands in; parents never mark up', () => {
    expect(drawer).toContain('if (!isTask && hasWorksheet(task)) {');
    expect(drawer).toContain('const canHandIn = isStudent && item.canSubmit && item.attempts < MAX_SUBMISSIONS;');
    expect(drawer).toContain("role: staff ? 'staff' : (parent ? 'parent' : 'student'),");
    expect(drawer).toContain('canMarkUp: staff || canHandIn,');
    expect(drawer).toContain('onHandedIn: () => actions.submitted(found.studentId),');
  });

  test('staff get With answer key from answer-key.js, built only on the staff path', () => {
    expect(drawer).toMatch(/extra: staff && found\.answerKey\?\.body && found\.answerKey\.worksheetButton/);
    const key = read('portal/js/answer-key.js');
    expect(key).toContain("label: 'With answer key'");
    expect(key).toContain('appendix: body ? { heading: KEY_WORKSHEET_HEADING, text: body } : null');
  });

  test('Open, Print, Download and Mark up; the PDF is made in the browser', () => {
    const ui = read('portal/js/worksheet-ui.js');
    for (const label of ["label: 'Open'", "label: 'Print'", "label: 'Download'", "label: 'Mark up'"]) expect(ui).toContain(label);
    expect(ui).toContain("const loadWorksheet = () => import('./worksheet.js');");
    expect(ui).toContain("const loadMarkup = () => import('./markup.js');");
    expect(ui).toContain("win = window.open('', '_blank');");
  });

  test('Preview worksheet in the create form, after a draft fills it', () => {
    expect(read('portal/js/homework-draft.js')).toContain("label: 'Preview worksheet'");
    expect(read('portal/js/item-form.js')).toMatch(/onPreview: \(\) => openWorksheet\(/);
  });
});

describe('hand in goes through the one submit path', () => {
  test('submit-work.js has sendWork, and both the form and the worksheet use it', () => {
    const submit = read('portal/js/submit-work.js');
    expect(submit).toMatch(/export async function sendWork\(/);
    expect(submit.match(/from\('homework'\)\.upload\(/g)).toHaveLength(1);
    expect(submit.match(/from\('submissions'\)\.insert\(/g)).toHaveLength(1);
    expect(submit).toContain('const submissionId = await sendWork({');
    const ui = read('portal/js/worksheet-ui.js');
    expect(ui).toContain("await sendWork({ taskId: task.id, studentId, upload: { body: file, type: 'application/pdf' } });");
    expect(ui).toContain('const problemText = validateUpload(file);');
    for (const file of ['portal/js/markup.js', 'portal/js/worksheet-ui.js', 'portal/js/worksheet.js']) {
      expect(read(file), file).not.toMatch(/\.storage\.|from\('submissions'\)/);
    }
  });
});

describe('markup', () => {
  const markup = read('portal/js/markup.js');
  const css = read('portal/css/assignments.css');

  test('pointer events for pen, touch and mouse; two fingers zoom; Hand mode lets a finger scroll', () => {
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) expect(markup).toContain(`addEventListener('${ev}'`);
    expect(markup).toContain('getCoalescedEvents');
    expect(markup).toContain('pressureOf(ev.pointerType, ev.pressure)');
    expect(markup).toMatch(/if \(state\.touches\.size >= 2\) \{/);
    expect(markup).toContain("if (state.hand) return;");
    expect(css).toContain('.mk-ink { touch-action: none; cursor: crosshair; }');
    expect(css).toContain('.markup.is-hand .mk-ink { touch-action: pan-x pan-y pinch-zoom; }');
  });

  test('a labelled toolbar, described drawing pages, and keyboard undo', () => {
    expect(markup).toContain("role: 'toolbar', 'aria-label': 'Markup tools'");
    expect(markup).toContain("role: 'img',");
    expect(markup).toContain("'aria-describedby': descId,");
    expect(markup).toMatch(/if \(k === 'z' && !e\.shiftKey\)/);
  });

  test('saved on the device inside try and catch, and cleared after handing in', () => {
    expect(markup).toMatch(/try \{\n\s*const raw = localStorage\.getItem\(key\);/);
    expect(markup).toMatch(/try \{\n\s*if \(hasInk\(doc\)\) localStorage\.setItem\(key, JSON\.stringify\(toSaved\(doc\)\)\);/);
    expect(markup).toContain('try { localStorage.removeItem(key); } catch { /* nothing saved */ }');
  });

  test('works at phone width: pages scroll, the toolbar stays at the bottom', () => {
    expect(css).toMatch(/\.mk-inner \{ display: flex; flex-direction: column; height: 100%;/);
    expect(css).toMatch(/\.mk-scroll \{\n\s*flex: 1 1 auto;\n\s*min-height: 0;\n\s*overflow: auto;/);
  });
});
