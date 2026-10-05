// People > Referrals (people.html, admin). Families recommended through the
// "Refer a family" form on the landing page, newest first: New, then
// Contacted. An admin marks one contacted (or back to new) and removes it.
// Rows reach the table only through /api/referral; RLS lets admins read,
// mark and remove them, and nobody else see them.
//
// The rules (order, groups, labels) live in referrals-model.js.

import { sb } from '../supabase.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { avatar, button, pill, emptyState, errorCallout, skeletonRows } from '../ui.js';
import { relativeTime } from '../dates.js';
import { groupReferrals, referrerLine, languageName } from '../referrals-model.js';

// ---------------------------------------------------------------------------
// View

const FIELDS = 'id, referrer_name, referrer_email, referrer_role, family_name, family_email, family_phone, grade, subjects, note, language, status, created_at';

export function mount(ctx) {
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'People' },
    h('a', { class: 'tab', href: '#/pending' }, 'Waiting for approval'),
    h('a', { class: 'tab', href: '#/everyone' }, 'Everyone'),
    h('a', { class: 'tab', href: '#/referrals', 'aria-current': 'page' }, 'Referrals'));
  ctx.setHeader({ title: 'People', tabs });

  const root = h('div', { class: 'ppl-root ref-root' });
  ctx.host.append(root);
  let firstRender = true;

  async function render() {
    if (firstRender) root.replaceChildren(skeletonRows(3));
    const { data, error } = await sb.from('referrals').select(FIELDS).order('created_at', { ascending: false });
    if (!ctx.alive()) return;
    if (error) {
      console.error(error);
      root.replaceChildren(errorCallout({
        title: 'We couldn’t load referrals.',
        text: 'Check your connection and try again.',
        onRetry: () => render(),
      }));
      return;
    }
    const { fresh, contacted } = groupReferrals(data);
    if (firstRender) {
      firstRender = false;
      ctx.announce(`Referrals, ${fresh.length} new`);
    }
    if (!fresh.length && !contacted.length) {
      root.replaceChildren(emptyState({
        icon: 'users-three',
        text: 'No referrals yet. They appear here when a family uses “Refer a family” on the website.',
      }));
      return;
    }
    root.replaceChildren(
      group('New', fresh, 'No new referrals.'),
      contacted.length ? group('Contacted', contacted, null) : null,
    );
  }

  function group(title, list, emptyText) {
    return h('section', { class: 'ref-group', 'aria-label': title },
      h('h2', { class: 'ref-group-title' }, title, h('span', { class: 'ref-group-count num' }, String(list.length))),
      list.length
        ? h('ul', { class: 'ppl-cards ref-cards' }, list.map(card))
        : h('p', { class: 'ref-empty' }, emptyText));
  }

  function contactLinks(r) {
    const links = [];
    if (r.family_email) links.push(h('a', { class: 'ref-contact', href: `mailto:${r.family_email}` }, icon('envelope-simple'), h('span', {}, r.family_email)));
    if (r.family_phone) links.push(h('a', { class: 'ref-contact', href: `tel:${r.family_phone.replace(/[^0-9+]/g, '')}` }, icon('chat-circle-text'), h('span', {}, r.family_phone)));
    return links;
  }

  function card(r) {
    const when = relativeTime(r.created_at, ctx.now);
    const contacted = r.status === 'contacted';
    const pills = [
      r.grade ? pill({ label: r.grade, tone: 'neutral', icon: 'book-open-text' }) : null,
      r.subjects ? pill({ label: r.subjects, tone: 'neutral', icon: 'clipboard-text' }) : null,
      r.language && r.language !== 'en' ? pill({ label: `Sent in ${languageName(r.language)}`, tone: 'neutral', icon: 'chat-circle-text' }) : null,
    ].filter(Boolean);

    const mark = button({
      label: contacted ? 'Mark as new' : 'Mark contacted',
      size: 'sm',
      variant: contacted ? 'ghost' : 'secondary',
      icon: contacted ? 'arrow-counter-clockwise' : 'check',
      onClick: () => setStatus(r, contacted ? 'new' : 'contacted'),
    });
    const remove = button({
      label: 'Remove',
      size: 'sm',
      variant: 'ghost',
      icon: 'trash',
      onClick: () => removeReferral(r),
    });

    return h('li', { class: `card ppl-card ref-card${contacted ? ' is-contacted' : ''}` },
      h('div', { class: 'ppl-card-head' },
        avatar(r.family_name, { size: 40 }),
        h('div', { class: 'ppl-id' },
          h('h3', { class: 'ppl-card-name' }, r.family_name),
          h('div', { class: 'ref-contacts' }, contactLinks(r))),
        h('time', { class: 'ppl-signed', datetime: r.created_at, title: when.full }, when.text)),
      h('div', { class: 'ppl-card-body' },
        h('p', { class: 'ref-referrer' }, referrerLine(r), ' (',
          h('a', { href: `mailto:${r.referrer_email}` }, r.referrer_email), ')'),
        pills.length ? h('div', { class: 'ref-pills' }, pills) : null,
        r.note ? h('blockquote', { class: 'quote ppl-note' }, r.note) : null),
      h('div', { class: 'ref-actions' }, mark, remove));
  }

  async function setStatus(r, status) {
    const { data, error } = await sb.from('referrals').update({ status }).eq('id', r.id).select('id');
    if (!ctx.alive()) return;
    if (error || !data?.length) {
      ctx.toast({ text: 'That didn’t save. Refresh the page and try again.' });
      return;
    }
    ctx.toast({ text: status === 'contacted' ? `${r.family_name} marked contacted.` : `${r.family_name} moved back to New.` });
    render();
  }

  async function removeReferral(r) {
    const ok = await ctx.confirm({
      title: `Remove the referral for ${r.family_name}?`,
      body: 'Their contact details are deleted. This can’t be undone.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok || !ctx.alive()) return;
    const { data, error } = await sb.from('referrals').delete().eq('id', r.id).select('id');
    if (!ctx.alive()) return;
    if (error || !data?.length) {
      ctx.toast({ text: 'That didn’t remove. Refresh the page and try again.' });
      return;
    }
    ctx.toast({ text: 'Referral removed.' });
    render();
  }

  render();
}
