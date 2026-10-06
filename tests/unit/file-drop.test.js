import { describe, test, expect, vi } from 'vitest';

// Plain stand-ins for the DOM helpers: the overlay only needs `hidden`
vi.mock('../../portal/js/dom.js', () => ({
  h: (tag, props = {}, ...children) => ({ tag, ...props, children }),
}));
vi.mock('../../portal/js/icons.js', () => ({ icon: (name) => ({ tag: 'svg', name }) }));
const { fileDrop, hasFiles } = await import('../../portal/js/file-drop.js');

function fakeTarget() {
  const listeners = {};
  const classes = new Set();
  const children = [];
  return {
    children,
    classList: {
      add: (c) => classes.add(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    append: (el) => children.push(el),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    fire(type, { types = ['Files'], files = [] } = {}) {
      const event = {
        defaultPrevented: false,
        dataTransfer: { types, files, dropEffect: 'none' },
        preventDefault() { this.defaultPrevented = true; },
      };
      listeners[type]?.(event);
      return event;
    },
  };
}

describe('dragging files onto a section', () => {
  test('lights up while files are over it, through nested children', () => {
    const t = fakeTarget();
    fileDrop(t, { onFiles: () => {} });
    const overlay = t.children[0];
    expect(t.classList.contains('drop-target')).toBe(true);
    expect(overlay.hidden).toBe(true);
    t.fire('dragenter');
    t.fire('dragenter');               // into a child
    t.fire('dragleave');               // out of the child, still over the section
    expect(t.classList.contains('is-drop-over')).toBe(true);
    expect(overlay.hidden).toBe(false);
    t.fire('dragleave');
    expect(t.classList.contains('is-drop-over')).toBe(false);
    expect(overlay.hidden).toBe(true);
  });

  test('a drop hands the files over, the same path as the picker', () => {
    const t = fakeTarget();
    const onFiles = vi.fn();
    fileDrop(t, { onFiles });
    const a = { name: 'worksheet.pdf' };
    const b = { name: 'slides.pptx' };
    t.fire('dragenter');
    const over = t.fire('dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    const drop = t.fire('drop', { files: [a, b] });
    expect(drop.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([a, b]);
    expect(t.children[0].hidden).toBe(true);
  });

  test('while an upload runs a drop does nothing, and never opens the file in the tab', () => {
    const t = fakeTarget();
    const onFiles = vi.fn();
    fileDrop(t, { onFiles, enabled: () => false });
    t.fire('dragenter');
    expect(t.children[0].hidden).toBe(true);
    expect(t.fire('dragover').dataTransfer.dropEffect).toBe('none');
    expect(t.fire('drop', { files: [{ name: 'x.pdf' }] }).defaultPrevented).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  });

  test('dragged text or links are left alone', () => {
    const t = fakeTarget();
    const onFiles = vi.fn();
    fileDrop(t, { onFiles });
    expect(t.fire('dragover', { types: ['text/plain'] }).defaultPrevented).toBe(false);
    expect(t.fire('drop', { types: ['text/uri-list'] }).defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
    expect(hasFiles({ dataTransfer: { types: ['Files'] } })).toBe(true);
    expect(hasFiles({})).toBe(false);
  });
});
