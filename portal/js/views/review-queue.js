// Stub with its final signature (foundation F10). U6 replaces this file.
import { emptyState } from '../ui.js';

export function mount(ctx) {
  const title = 'Review queue';
  ctx.setHeader({ title });
  ctx.host.append(emptyState({ icon: 'info', text: 'This view is being built.' }));
  ctx.announce(title);
}
