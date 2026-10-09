import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Grading by result (Completed, Missing, Extended): the pieces that are DOM or
// network code, checked from their source. The rules themselves are tested in
// results.test.js, review-model.test.js, buckets.test.js and status.test.js.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const files = (dir, ext) => readdirSync(join(ROOT, dir), { recursive: true })
  .filter((f) => f.endsWith(ext)).map((f) => join(dir, f));

describe('no score left behind', () => {
  test('portal code and styles never show a score', () => {
    for (const file of [...files('portal/js', '.js'), ...files('portal/css', '.css')]) {
      if (file.endsWith('palette-model.js')) continue;   // a search relevance score, not a grade
      // code only: comments may say what the result replaced
      const text = read(file).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
      expect(text, file).not.toMatch(/score-chip|scoreChip|rvw-score|asg-score|ovw-score|cal-chip-score|previousScore|out of 100|['"`]\/ ?100['"`]/);
      expect(text, file).not.toMatch(/ovw-chart|rpt-chart|scoreChart|chartModel|scoreSeries/);
    }
  });

  test('every query reads the result, never the score', () => {
    for (const file of ['portal/js/store.js', 'portal/js/views/review.js']) {
      const text = read(file);
      expect(text, file).toMatch(/grades\(result,/);
      expect(text, file).not.toMatch(/grades\(score/);
      expect(text, file).toContain('extended_from');
    }
    expect(read('api/_lib/repo.js')).toContain("update({ result, feedback })");
  });
});

describe('the review page', () => {
  const editor = read('portal/js/grade-editor.js');

  test('the result is a radio group in a fieldset with a legend, styled as a segmented control', () => {
    expect(editor).toContain("h('fieldset', { class: 'rvw-result-field' }");
    expect(editor).toContain("h('legend', { class: 'field-label' }, 'Result')");
    expect(editor).toContain("type: 'radio', name: 'result'");
    expect(editor).toContain("class: 'segmented is-block rvw-result'");
  });

  test('Extended asks for the new due date; feedback is optional', () => {
    expect(editor).toContain("label: 'New due date'");
    expect(editor).toContain("dueField.hidden = start.result !== 'extended'");
    expect(editor).toMatch(/label: 'Feedback for the student and family', optional: true/);
  });

  test('releasing an Extended moves the due date first and puts it back if the grade does not save', () => {
    expect(editor).toContain('taskWrite(extensionChanges(assignment, dueAt), assignment.due_at)');
    expect(editor).toContain('taskWrite({ due_at: assignment.due_at, extended_from: assignment.extended_from }, dueAt)');
  });

  test('the focus key is rvw-result, here and in the page that redraws the editor', () => {
    expect(editor).toContain("'rvw-result'");
    const view = read('portal/js/views/review.js');
    expect(view).toContain('[data-focus-key="rvw-result"]');
    for (const file of files('portal/js', '.js')) expect(read(file), file).not.toContain('rvw-score');
  });
});

describe('the item drawer', () => {
  const drawer = read('portal/js/item-drawer.js');

  test('Extend is for staff, on work still waiting on the student', () => {
    expect(drawer).toMatch(/if \(staff && !dctx\.readOnly && waiting && task\.due_at\) nodes\.push\(extendSection/);
    expect(drawer).toContain("item.bucket === 'todo' || (item.bucket === 'archived' && item.archiveReason === 'missed')");
    expect(drawer).toContain('extensionChanges(task, check.dueAt)');
  });
});

describe('stylesheets', () => {
  const pages = readdirSync(join(ROOT, 'portal')).filter((f) => f.endsWith('.html'));
  const TOUCHED = {
    'app.css': '10', 'assignments.css': '10', 'calendar.css': '10', 'overview.css': '9', 'people.css': '16', 'report.css': '2', 'review.css': '5',
  };

  test('the sheets this change touched carry one new ?v= on every page that links them', () => {
    const versions = new Map();
    for (const page of pages) {
      for (const [, name, v] of read(`portal/${page}`).matchAll(/\/portal\/css\/([\w-]+\.css)\?v=(\d+)/g)) {
        if (!versions.has(name)) versions.set(name, new Set());
        versions.get(name).add(v);
      }
    }
    for (const [name, v] of Object.entries(TOUCHED)) expect([...versions.get(name)], name).toEqual([v]);
  });

  test('the result and Extend styles exist', () => {
    expect(read('portal/css/review.css')).toContain('.rvw-result-field');
    expect(read('portal/css/assignments.css')).toContain('.asg-extend');
    expect(read('portal/css/overview.css')).toContain('.ovw-result');
    expect(read('portal/css/people.css')).toContain('.stu-done');
  });
});
