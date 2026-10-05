// People > Reviews (people.html, admin). Reviews families write through a
// personal link, for the landing page. Create a link for one parent or
// student (the token is made here; only its SHA-256 is stored, so the link
// shows once), approve or decline what comes back (also possible from the
// notification email), and remove a review to take it off the website.
// Approved reviews show on the landing page in all five languages.

import { sb } from '../supabase.js';
import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { avatar, button, pill, emptyState, errorCallout, skeletonRows, segmented } from '../ui.js';
import { relativeTime } from '../dates.js';
import {
  groupReviews, linkState, sortLinks, versions, base64url, reviewLink, inviteMessage,
} from '../reviews-model.js';

const REVIEW_FIELDS = 'id, invite_id, kind, name, quote, translations, status, created_at, reviewed_at';
const LINK_FIELDS = 'id, name, kind, created_at, expires_at, used_at';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function mount(ctx) {
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'People' },
    h('a', { class: 'tab', href: '#/pending' }, 'Waiting for approval'),
    h('a', { class: 'tab', href: '#/everyone' }, 'Everyone'),
    h('a', { class: 'tab', href: '#/referrals' }, 'Referrals'),
    h('a', { class: 'tab', href: '#/reviews', 'aria-current': 'page' }, 'Reviews'));
  ctx.setHeader({ title: 'People', tabs });

  const creator = buildCreator();
  const root = h('div', { class: 'ppl-root ref-root' });
  ctx.host.append(creator, root);
  let first = true;

  // ---- Create a link -------------------------------------------------------

  function buildCreator() {
    let kind = 'parent';
    const nameId = uid('rv-name');
    const name = h('input', { class: 'input', id: nameId, type: 'text', maxlength: '80', autocomplete: 'off', placeholder: 'Grace Lin' });
    const kindSeg = segmented({
      label: 'Review from',
      value: 'parent',
      options: [{ value: 'parent', label: 'Parent' }, { value: 'student', label: 'Student' }],
      onChange: (v) => { kind = v; },
    });
    const result = h('div', { class: 'rv-result', 'aria-live': 'polite' });
    const create = button({ label: 'Create review link', variant: 'primary', size: 'sm', icon: 'link-simple', onClick: () => makeLink() });

    async function makeLink() {
      const who = name.value.trim();
      result.replaceChildren();
      if (!who) {
        result.append(h('p', { class: 'field-error' }, icon('warning-circle'), h('span', {}, 'Add the name of the parent or student first.')));
        name.focus();
        return;
      }
      create.disabled = true;
      try {
        const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
        const token_hash = await sha256Hex(token);
        const { error } = await sb.from('review_invites').insert({ token_hash, name: who, kind });
        if (!ctx.alive()) return;
        if (error) {
          console.error(error);
          result.append(h('p', { class: 'field-error' }, icon('warning-circle'), h('span', {}, 'The link could not be created. Try again.')));
          return;
        }
        const link = reviewLink(token);
        const message = inviteMessage(who, link);
        const linkBox = h('input', { class: 'input rv-link', type: 'text', readonly: true, value: link, 'aria-label': `Review link for ${who}` });
        const copy = (text, label) => button({
          label, size: 'sm', icon: 'clipboard-text',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              ctx.toast({ text: 'Copied.' });
            } catch {
              linkBox.select();
              ctx.toast({ text: 'Select the link and copy it.' });
            }
          },
        });
        result.append(h('div', { class: 'card rv-made' },
          h('p', { class: 'rv-made-title' }, `Link for ${who}`),
          linkBox,
          h('div', { class: 'ref-actions' }, copy(link, 'Copy link'), copy(message, 'Copy message with link')),
          h('p', { class: 'rv-made-note' }, 'Copy it now: for safety the link is shown only once. It works once and lasts 60 days.')));
        name.value = '';
        linkBox.focus();
        linkBox.select();
        render();
      } finally {
        create.disabled = false;
      }
    }

    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        makeLink();
      }
    });

    return h('section', { class: 'card rv-create', 'aria-labelledby': `${nameId}-title` },
      h('h2', { class: 'ref-group-title', id: `${nameId}-title` }, 'Ask a family for a review'),
      h('p', { class: 'rv-help' }, 'Create a personal link, then text or email it. They write the review; you approve it from the email or below, and it appears on the website in every language.'),
      h('div', { class: 'rv-create-row' },
        h('div', { class: 'field rv-name-field' }, h('label', { class: 'field-label', for: nameId }, 'Their name'), name),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Review from'), kindSeg),
        create),
      result);
  }

  // ---- Lists ---------------------------------------------------------------

  async function render() {
    if (first) root.replaceChildren(skeletonRows(3));
    const [reviews, links] = await Promise.all([
      sb.from('site_reviews').select(REVIEW_FIELDS).order('created_at', { ascending: false }),
      sb.from('review_invites').select(LINK_FIELDS).order('created_at', { ascending: false }).limit(200),
    ]);
    if (!ctx.alive()) return;
    if (reviews.error || links.error) {
      console.error(reviews.error ?? links.error);
      root.replaceChildren(errorCallout({ title: 'We couldn’t load reviews.', text: 'Check your connection and try again.', onRetry: () => render() }));
      return;
    }
    const { pending, approved, declined } = groupReviews(reviews.data);
    if (first) {
      first = false;
      ctx.announce(`Reviews, ${pending.length} waiting`);
    }
    const nodes = [
      group('Waiting for approval', pending, 'No reviews waiting.'),
      approved.length ? group('On the website', approved, null) : null,
      declined.length ? group('Declined', declined, null) : null,
      linksSection(links.data ?? []),
    ];
    if (!reviews.data.length && !(links.data ?? []).length) {
      nodes.splice(0, 3, emptyState({ icon: 'chat-circle-text', text: 'No reviews yet. Create a link above and send it to a family.' }));
    }
    root.replaceChildren(...nodes.filter(Boolean));
  }

  function group(title, list, emptyText) {
    return h('section', { class: 'ref-group', 'aria-label': title },
      h('h2', { class: 'ref-group-title' }, title, h('span', { class: 'ref-group-count num' }, String(list.length))),
      list.length ? h('ul', { class: 'ppl-cards ref-cards' }, list.map(card)) : h('p', { class: 'ref-empty' }, emptyText));
  }

  function card(r) {
    const when = relativeTime(r.created_at, ctx.now);
    const decided = r.status === 'approved' || r.status === 'declined';
    const shown = versions(r);
    const translated = shown.length > 0;
    const actions = decided
      ? [button({ label: 'Move back to waiting', size: 'sm', variant: 'ghost', icon: 'arrow-counter-clockwise', onClick: () => setStatus(r, 'pending') })]
      : [
        button({ label: 'Approve and publish', size: 'sm', variant: 'secondary', icon: 'check', onClick: () => setStatus(r, 'approved') }),
        button({ label: 'Decline', size: 'sm', variant: 'ghost', icon: 'x', onClick: () => setStatus(r, 'declined') }),
      ];
    if (!translated) actions.push(button({ label: 'Translate', size: 'sm', variant: 'ghost', icon: 'arrow-counter-clockwise', onClick: (e) => retranslate(r, e.currentTarget) }));
    actions.push(button({ label: 'Remove', size: 'sm', variant: 'ghost', icon: 'trash', onClick: () => removeReview(r) }));

    return h('li', { class: `card ppl-card ref-card${decided ? ' is-decided' : ''}` },
      h('div', { class: 'ppl-card-head' },
        avatar(r.name, { size: 40 }),
        h('div', { class: 'ppl-id' },
          h('h3', { class: 'ppl-card-name' }, r.name),
          h('span', { class: 'ppl-email' }, r.kind === 'student' ? 'Student' : 'Parent')),
        h('time', { class: 'ppl-signed', datetime: r.created_at, title: when.full }, when.text)),
      h('div', { class: 'ppl-card-body' },
        h('blockquote', { class: 'quote ppl-note rv-quote' }, r.quote),
        translated
          ? h('details', { class: 'rv-versions' },
            h('summary', {}, 'See it in all five languages'),
            h('dl', {}, shown.flatMap((v) => [h('dt', {}, v.label), h('dd', {}, v.text)])))
          : pill({ label: 'Not translated yet: it would show as written in every language', tone: 'neutral', icon: 'info' })),
      h('div', { class: 'ref-actions' }, ...actions));
  }

  function linksSection(list) {
    if (!list.length) return null;
    const now = Date.now();
    const rows = sortLinks(list, now).map((l) => {
      const state = linkState(l, now);
      const label = { unused: 'Not used yet', used: 'Review received', expired: 'Expired' }[state];
      const tone = { unused: 'neutral', used: 'success', expired: 'neutral' }[state];
      return h('li', { class: 'rv-link-row' },
        h('span', { class: 'rv-link-name' }, l.name, h('span', { class: 'rv-link-kind' }, l.kind === 'student' ? ' · student' : ' · parent')),
        pill({ label, tone }),
        h('span', { class: 'rv-link-when' }, relativeTime(l.created_at, ctx.now).text),
        button({ label: 'Remove link', size: 'sm', variant: 'ghost', icon: 'trash', onClick: () => removeLink(l) }));
    });
    return h('section', { class: 'ref-group', 'aria-label': 'Review links' },
      h('h2', { class: 'ref-group-title' }, 'Review links', h('span', { class: 'ref-group-count num' }, String(list.length))),
      h('ul', { class: 'rv-links' }, rows));
  }

  // ---- Changes -------------------------------------------------------------

  async function setStatus(r, status) {
    const { data, error } = await sb.from('site_reviews').update({ status }).eq('id', r.id).select('id');
    if (!ctx.alive()) return;
    if (error || !data?.length) {
      ctx.toast({ text: 'That didn’t save. Refresh the page and try again.' });
      return;
    }
    const done = { approved: 'is now on the website', declined: 'declined', pending: 'moved back to waiting' }[status];
    ctx.toast({ text: `${r.name}’s review ${done}.` });
    render();
  }

  async function retranslate(r, btn) {
    if (btn) btn.disabled = true;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const response = await fetch('/api/testimonials', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'translate', id: r.id }),
      });
      if (!ctx.alive()) return;
      ctx.toast({ text: response.ok ? 'Translated.' : 'Translation failed. Try again later.' });
      if (response.ok) render();
    } catch {
      if (ctx.alive()) ctx.toast({ text: 'Translation failed. Check your connection.' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function removeReview(r) {
    const ok = await ctx.confirm({
      title: `Remove ${r.name}’s review?`,
      body: r.status === 'approved' ? 'It comes off the website. This can’t be undone.' : 'This can’t be undone.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok || !ctx.alive()) return;
    const { data, error } = await sb.from('site_reviews').delete().eq('id', r.id).select('id');
    if (!ctx.alive()) return;
    ctx.toast({ text: error || !data?.length ? 'That didn’t remove. Refresh the page and try again.' : 'Review removed.' });
    render();
  }

  async function removeLink(l) {
    const ok = await ctx.confirm({
      title: `Remove the review link for ${l.name}?`,
      body: 'The link stops working. A review already received stays.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok || !ctx.alive()) return;
    const { data, error } = await sb.from('review_invites').delete().eq('id', l.id).select('id');
    if (!ctx.alive()) return;
    ctx.toast({ text: error || !data?.length ? 'That didn’t remove. Refresh the page and try again.' : 'Link removed.' });
    render();
  }

  render();
}
