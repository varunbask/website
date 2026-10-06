// Files dragged from the computer onto `target` go to onFiles, the same path
// as the file picker. While files are over it, the target is outlined and says
// `label` (div.drop-overlay, styled in app.css). A drop anywhere on the target
// counts, so a near miss never opens the file in the tab; while `enabled()` is
// false (an upload running) a drop does nothing. Dragged text or links are
// left alone.

import { h } from './dom.js';
import { icon } from './icons.js';

export function hasFiles(event) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

export function fileDrop(target, {
  onFiles, enabled = () => true, label = 'Drop files to add them', iconName = 'upload-simple', signal,
} = {}) {
  const opts = signal ? { signal } : undefined;
  const overlay = h('div', { class: 'drop-overlay', 'aria-hidden': 'true', hidden: true },
    icon(iconName, { size: 20 }), h('span', {}, label));
  target.classList.add('drop-target');
  target.append(overlay);
  let depth = 0;
  const over = (on) => {
    target.classList.toggle('is-drop-over', on);
    overlay.hidden = !on;
  };
  target.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    over(enabled());
  }, opts);
  target.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) over(false);
  }, opts);
  target.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = enabled() ? 'copy' : 'none';
  }, opts);
  target.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    over(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length && enabled()) onFiles(files);
  }, opts);
}
