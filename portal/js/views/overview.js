// Stub with its final signature (foundation F10). U4 replaces this file.
import { emptyState } from '../ui.js';

export function mount(ctx) {
  const title = 'Overview';
  ctx.setHeader({ title, display: true });
  ctx.host.append(emptyState({ icon: 'info', text: 'This view is being built.' }));
  ctx.announce(title);
}
