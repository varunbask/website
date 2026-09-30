// Stub with its final signature (foundation F10). U1 replaces this file.
// renderItemDrawer(dctx) fills the drawer for open=<taskId> or open=new
// (see drawer.js for everything dctx carries).
import { h } from './dom.js';
import { emptyState } from './ui.js';

export function renderItemDrawer(dctx) {
  const creating = dctx.taskId === 'new';
  const kind = dctx.params?.kind === 'task' ? 'Task' : 'Assignment';
  dctx.body.replaceChildren(h('p', { class: 'drawer-kind' }, creating ? kind : 'Details'));
  dctx.setTitle(creating ? `New ${kind.toLowerCase()}` : 'This view is being built');
  dctx.body.append(emptyState({ icon: 'info', text: 'This view is being built.' }));
}
