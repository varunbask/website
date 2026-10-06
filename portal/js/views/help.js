// Help view, #/help: who to contact and short answers for the signed-in role
// (students, parents, tutors and admins). Static text from help-model.js; the
// view only turns it into markup, so nothing here reads the database.
//
// Markup (portal/css/help.css, prefix hlp-):
//   div.hlp-layout
//     section.card.hlp-card[#hlp-<id>] > div.card-head > h2.card-title, then
//       p.read | ol.hlp-steps | ul.hlp-list | div.hlp-actions > a.btn
//     the Contact card also has .is-contact

import { h } from '../dom.js';
import { button } from '../ui.js';
import { helpSections, helpLede } from '../help-model.js';

// A sentence: strings stay text, links become anchors. Page links (#/...) stay
// in the app; the mail and privacy links open normally.
function sentence(parts) {
  return [].concat(parts).map((part) => (typeof part === 'string'
    ? part
    : h('a', { class: 'link', href: part.href }, part.text)));
}

function blockNode(block) {
  switch (block.type) {
    case 'steps':
      return h('ol', { class: 'hlp-steps read' }, block.items.map((item) => h('li', {}, sentence(item))));
    case 'list':
      return h('ul', { class: 'hlp-list read' }, block.items.map((item) => h('li', {}, sentence(item))));
    case 'actions':
      return h('div', { class: 'hlp-actions' }, block.actions.map((a) => button({
        label: a.label, href: a.href, icon: a.icon, variant: a.variant,
      })));
    default:
      return h('p', { class: 'read' }, sentence(block.parts));
  }
}

function sectionCard(section) {
  const titleId = `hlp-${section.id}-title`;
  return h('section', {
    class: section.id === 'contact' ? 'card hlp-card is-contact' : 'card hlp-card',
    id: `hlp-${section.id}`,
    'aria-labelledby': titleId,
  },
  h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: titleId }, section.title)),
  section.blocks.map(blockNode));
}

export function mount(ctx) {
  ctx.setHeader({ title: 'Help', lede: helpLede(ctx.role) });
  ctx.host.append(h('div', { class: 'hlp-layout' }, helpSections(ctx.role).map(sectionCard)));
  ctx.announce('Help');
}
