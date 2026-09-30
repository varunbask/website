// Stub with its final signature (foundation F10). U1 replaces this file.
import { emptyState } from '../ui.js';

export function mount(ctx) {
  const title = ({ todo: 'To do', 'in-review': 'In review', graded: 'Graded', archived: 'Archived' })[ctx.route.sub] ?? 'Assignments';
  ctx.setHeader({ title });
  ctx.host.append(emptyState({ icon: 'info', text: 'This view is being built.' }));
  ctx.announce(title);
}
