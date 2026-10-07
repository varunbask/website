import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// How the pieces of "delete a person" are joined, read from the files: the page
// asks the server, the store is emptied, other tabs are told and listen
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

describe('People page', () => {
  const view = read('portal/js/views/people.js');

  test('every row but an admin’s has a Delete button that asks the server before it deletes', () => {
    expect(view).toContain('canDelete(person, me)');
    expect(view).toContain("variant: 'danger-ghost'");
    expect(view.indexOf("action: 'delete_preview'")).toBeGreaterThan(-1);
    expect(view.indexOf("action: 'delete_preview'")).toBeLessThan(view.indexOf("action: 'delete_person'"));
    expect(view).toContain('confirm_name: confirmName(person)');
  });

  test('the dialog asks for the name typed back and shows the preview', () => {
    expect(view).toContain('requireText: { label: typedLabel(person), match: (typed) => nameMatches(typed, person) }');
    expect(view).toContain('details: detailLines(preview)');
    expect(view).toContain('confirmLabel: null'); // a refusal has no Delete button
  });

  test('after a delete the row goes, every cache is dropped and the other tabs are told', () => {
    expect(view).toContain('withoutPerson(data, person.id)');
    expect(view).toContain('ctx.store.invalidateAll()');
    expect(view).toContain('announceDataChanged()');
    expect(view.indexOf('ctx.store.invalidateAll()')).toBeLessThan(view.indexOf('announceDataChanged()'));
    expect(view).toContain('ctx.toast({ text: doneText(person) })');
  });
});

describe('every page of the portal', () => {
  const app = read('portal/js/app.js');

  test('listens for another tab’s change, drops its caches and leaves a student who is gone', () => {
    expect(app).toMatch(/onDataChanged\(\(\) => \{\s*store\.invalidateAll\(\);\s*leaveDeletedScope\(\);\s*\}\);/);
    expect(app).toContain("from './data-sync.js'");
  });

  test('it does not echo: only the sender announces', () => {
    expect(app).not.toContain('announceDataChanged');
  });
});

describe('stylesheets', () => {
  const pages = readdirSync(join(ROOT, 'portal')).filter((f) => f.endsWith('.html'));

  // The sheets this change touched: a page that kept the old ?v= would keep the old file in the browser's cache
  test('app.css and people.css carry one ?v= on every page that links them', () => {
    const versions = new Map();
    for (const page of pages) {
      for (const [, name, v] of read(`portal/${page}`).matchAll(/\/portal\/css\/([\w-]+\.css)\?v=(\d+)/g)) {
        if (!versions.has(name)) versions.set(name, new Map());
        versions.get(name).set(page, v);
      }
    }
    for (const name of ['app.css', 'people.css']) {
      const byPage = versions.get(name);
      expect(new Set(byPage.values()).size, `${name}: ${JSON.stringify([...byPage])}`).toBe(1);
    }
    expect(versions.get('app.css').size).toBe(pages.length);
    expect([...versions.get('app.css').values()][0]).toBe('8');
    expect([...versions.get('people.css').values()][0]).toBe('14');
  });

  test('the confirm dialog styles for the typed name and the list exist', () => {
    const css = read('portal/css/app.css');
    for (const rule of ['.confirm-details', '.confirm-type', '.confirm-type-label']) expect(css).toContain(rule);
  });
});

describe('the function budget and the demo', () => {
  test('/api/people may run for a minute (a person with many files)', () => {
    const vercel = JSON.parse(read('vercel.json'));
    expect(vercel.functions['api/people.js'].maxDuration).toBe(60);
  });

  test('the endpoint wires Google, so a delete revokes the tutor’s calendar grant first', () => {
    const endpoint = read('api/people.js');
    expect(endpoint).toContain('disconnectUser(userId');
    expect(endpoint).toContain('disconnectGoogle');
  });

  test('the demo extension is valid script and answers both actions', () => {
    const source = read('tools/demo/extend-delete-person.js');
    expect(() => new Script(source)).not.toThrow();
    expect(source).toContain("'delete_preview'");
    expect(source).toContain("'delete_person'");
  });
});
