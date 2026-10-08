// App shell (spec 3.2 to 3.9): sidebar, rail with tooltips, the 768 to 1023
// overlay sheet, phone top bar, tab bar and More sheet, scope switcher, theme
// control, user row and sign out. Avatars carry the person's photo when they
// have one (photos.js): your own in the user row, the student or child on
// screen, and each person in the switcher. Every navigation surface renders from one
// nav model (nav-model.js), so they always show the same items and counts.
//
// mountShell({ me, page }) -> {
//   setNav(model), setScope({ kind, current, options, onSwitch, hrefFor, counts }),
//   setCrumbs(crumbs), setTopbarActions(nodes), setMode('workspace' | 'student'),
//   setTitle(text), setHome(href), setTabbarHidden(bool), setBack({ href, label } | null),
//   closeOverlays(), viewRoot
// }
// Markup follows the COMPONENT CLASS API comment at the top of portal/css/app.css.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { badge as badgeEl, newPill, iconButton, button } from './ui.js';
import { personAvatar } from './photos.js';
import { themeControl } from './theme.js';
import { signOut } from './session.js';
import { displayName, firstName } from './format.js';
import { filterPeople } from './app-model.js';

const ROLE_LABELS = { student: 'Student', parent: 'Parent', tutor: 'Tutor', admin: 'Admin' };
const BRAND_SUBS = { student: 'Student portal', parent: 'Family portal', tutor: 'Tutor workspace', admin: 'Admin workspace' };
const SIDEBAR_KEY = 'vb-sidebar';
const STAFF = new Set(['tutor', 'admin']);
const SEARCH_AFTER = 6;

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'rail';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed) {
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_KEY, 'rail');
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

const cssEscape = (s) => (globalThis.CSS?.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const modified = (e) => e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

// Focus goes back to `el` only if nothing else took it (a route change focuses the h1)
function restoreFocusTo(el) {
  const active = document.activeElement;
  if (!el?.isConnected) return;
  if (!active || active === document.body || active.closest?.('dialog:not([open])')) el.focus();
}

function tip(text, placement = 'right', railOnly = true) {
  const cls = ['tip', placement === 'bottom' ? null : `tip-${placement}`, railOnly ? 'rail-only' : null].filter(Boolean).join(' ');
  return h('span', { class: cls, 'aria-hidden': 'true' }, text);
}

export function mountShell({ me, page }) {
  const $ = (id) => document.getElementById(id);
  const appEl = $('app');
  const sidebar = $('sidebar');
  const nav = $('portal-nav');
  const scopeSlot = $('scope-slot');
  const tabbar = $('tabbar');
  const topbar = document.querySelector('.topbar');
  const topbarWrap = document.querySelector('.topbar-wrap');
  const crumbsEl = $('breadcrumb');
  const actionsEl = $('topbar-actions');
  const titleEl = $('topbar-title');
  const brandLinks = () => document.querySelectorAll('[data-home]');
  const railToggle = $('rail-toggle');
  const navOpen = $('nav-open');
  const back = $('topbar-back');
  const topBrand = $('topbar-brand');
  const chip = $('scope-chip');
  const sheet = $('nav-sheet');
  const switcher = $('switcher');
  const viewRoot = $('view');

  const mqPhone = matchMedia('(max-width: 767.98px)');
  const mqTablet = matchMedia('(min-width: 768px) and (max-width: 1023.98px)');
  const mqDesktop = matchMedia('(min-width: 1024px)');

  const staff = STAFF.has(me.role);
  const myName = displayName(me);

  let model = null;
  let scope = { kind: null, current: null, options: [], onSwitch: null, hrefFor: null, counts: null };
  let mode = 'workspace';
  let backLink = null;
  let home = '#/';
  let collapsed = readCollapsed();
  let sheetOpener = null;
  let switcherAnchor = null;
  let popoverOpener = null;

  const isRail = () => mqTablet.matches || (mqDesktop.matches && collapsed);

  // Skip link: move focus to main without touching the hash (the router owns it)
  document.querySelector('.skip-link')?.addEventListener('click', (e) => {
    const main = $('main');
    if (!main) return;
    e.preventDefault();
    main.focus();
  });

  // -------------------------------------------------------------------------
  // Static parts: brand, rail toggle, footer

  $('brand-sub')?.replaceChildren(BRAND_SUBS[me.role] ?? 'Portal');

  const toggleTip = tip('', 'end', false);
  railToggle.replaceChildren(icon('sidebar-simple'), toggleTip);
  railToggle.classList.add('has-tip');
  railToggle.addEventListener('click', () => {
    if (mqTablet.matches) {
      openSheet(railToggle);
      return;
    }
    collapsed = !collapsed;
    applyCollapsed();
  });
  navOpen?.replaceChildren(icon('list'));
  navOpen?.addEventListener('click', () => openSheet(navOpen));
  back?.replaceChildren(icon('caret-left'));

  function applyCollapsed() {
    if (collapsed) appEl.dataset.sidebar = 'rail';
    else delete appEl.dataset.sidebar;
    writeCollapsed(collapsed);
    updateRailState();
  }

  function updateRailState() {
    let label;
    if (mqTablet.matches) {
      label = 'Open menu';
      railToggle.setAttribute('aria-controls', 'nav-sheet');
      railToggle.setAttribute('aria-haspopup', 'dialog');
      railToggle.setAttribute('aria-expanded', sheet.open && sheetOpener === railToggle ? 'true' : 'false');
    } else {
      label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      railToggle.setAttribute('aria-controls', 'sidebar');
      railToggle.removeAttribute('aria-haspopup');
      railToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    railToggle.setAttribute('aria-label', label);
    toggleTip.textContent = label;
    toggleTip.className = isRail() ? 'tip tip-right' : 'tip tip-end';
    // Rail tips are placed with inline top/left; outside the rail the CSS places them
    if (!isRail()) {
      for (const t of sidebar.querySelectorAll('.tip')) {
        t.style.removeProperty('top');
        t.style.removeProperty('left');
      }
    }
    // Rail-only count bubbles (the Assignments icon carries the To do count)
    for (const b of sidebar.querySelectorAll('.badge.rail-only')) b.hidden = !isRail();
  }

  // Rail tooltips are position: fixed (app.css) so the scrolling nav does not
  // clip them; this puts each one beside its item when it is about to show.
  // The first write finds the containing block's offset (the viewport, or the
  // sidebar where containment makes it one), the second corrects for it.
  let tipOwner = null;
  function placeRailTip(owner) {
    tipOwner = owner;
    const tipEl = owner?.querySelector(':scope > .tip.tip-right');
    if (!tipEl || !isRail()) return;
    const r = owner.getBoundingClientRect();
    tipEl.style.left = '0px';
    tipEl.style.top = '0px';
    const origin = tipEl.getBoundingClientRect();
    const x = r.right + 8;
    const y = r.top + (r.height - origin.height) / 2;
    tipEl.style.left = `${Math.round(x - origin.left)}px`;
    tipEl.style.top = `${Math.round(y - origin.top)}px`;
  }
  const tipTarget = (e) => e.target.closest?.('.has-tip');
  sidebar.addEventListener('pointerover', (e) => {
    const owner = tipTarget(e);
    if (owner && owner !== tipOwner) placeRailTip(owner);
  });
  sidebar.addEventListener('focusin', (e) => placeRailTip(tipTarget(e)));
  nav.addEventListener('scroll', () => { if (tipOwner?.isConnected) placeRailTip(tipOwner); }, { passive: true });

  for (const mq of [mqPhone, mqTablet, mqDesktop]) {
    mq.addEventListener('change', () => {
      updateRailState();
      observeScroll();
      if (mqDesktop.matches && sheet.open) closeSheet();
    });
  }

  const doSignOut = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await signOut();
    } catch {
      btn.disabled = false;
    }
  };

  function userRow({ main = false } = {}) {
    const out = iconButton({ icon: 'sign-out', label: 'Sign out', tip: 'top', id: main ? 'sign-out' : undefined, onClick: doSignOut });
    // Above and right-aligned: centred, it would stick out past the sidebar edge
    out.querySelector('.tip')?.classList.add('tip-end');
    return h('div', { class: 'user-row', id: main ? 'portal-user' : undefined },
      personAvatar(me.id, myName, { size: 32 }),
      h('span', { class: 'user-meta' },
        h('span', { class: 'user-name' }, myName),
        h('span', { class: 'user-role' }, ROLE_LABELS[me.role] ?? '')),
      out);
  }

  const foot = sidebar.querySelector('.sidebar-foot');
  const railUser = h('button', {
    type: 'button',
    class: 'rail-user-btn has-tip',
    'aria-label': `${myName}, account and theme`,
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    onClick: () => openPopover(railUser),
  }, personAvatar(me.id, myName, { size: 32 }), tip('Account and theme'));
  foot.replaceChildren(themeControl({ id: 'theme-control' }), userRow({ main: true }), railUser);

  // Rail footer popover: the theme control and Sign out
  const popover = h('dialog', { class: 'popover', id: 'account-popover', 'aria-label': 'Account' });
  document.body.append(popover);

  function openPopover(from) {
    popoverOpener = from;
    popover.replaceChildren(h('div', { class: 'popover-inner' },
      h('div', { class: 'user-row' }, personAvatar(me.id, myName, { size: 32 }),
        h('span', { class: 'user-meta' },
          h('span', { class: 'user-name' }, myName),
          h('span', { class: 'user-role' }, ROLE_LABELS[me.role] ?? ''))),
      themeControl(),
      button({ label: 'Sign out', icon: 'sign-out', variant: 'secondary', block: true, onClick: doSignOut })));
    popover.showModal();
    from.setAttribute('aria-expanded', 'true');
    if (!mqPhone.matches) {
      const r = from.getBoundingClientRect();
      const top = Math.max(8, r.bottom - popover.offsetHeight);
      popover.style.left = `${Math.round(r.right + 8)}px`;
      popover.style.top = `${Math.round(top)}px`;
    }
    popover.querySelector('[aria-pressed="true"]')?.focus();
  }
  popover.addEventListener('close', () => {
    popoverOpener?.setAttribute('aria-expanded', 'false');
    restoreFocusTo(popoverOpener);
  });
  popover.addEventListener('click', (e) => { if (e.target === popover) popover.close(); });

  // -------------------------------------------------------------------------
  // Scope: the switcher button (staff, parents with 2+ children) or one child

  const noun = () => (scope.kind === 'child' ? 'child' : 'student');

  function scopeNode(place) {
    const { kind, current, options } = scope;
    if (!kind) return null;
    if (kind === 'child') {
      if (!current) return null;
      if ((options?.length ?? 0) < 2) {
        return h('div', { class: place === 'sidebar' ? 'scope-block has-tip' : 'scope-block' },
          personAvatar(current.id, displayName(current), { size: 24 }),
          h('span', { class: 'scope-name' }, displayName(current)),
          place === 'sidebar' ? tip(displayName(current)) : null);
      }
    }
    const name = current ? displayName(current) : 'Choose a student';
    const lead = current
      ? personAvatar(current.id, name, { size: 24 })
      : h('span', { class: 'avatar avatar-24', 'aria-hidden': 'true' }, icon('users-three', { size: 14 }));
    const caret = icon('caret-up-down');
    caret.classList.add('scope-caret');
    const btn = h('button', {
      type: 'button',
      class: ['scope-btn', current ? null : 'is-empty', place === 'sidebar' ? 'has-tip' : null].filter(Boolean).join(' '),
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': 'switcher',
      'aria-label': current ? `${name}, change ${noun()}` : 'Choose a student',
      dataset: { navKey: 'scope' },
    }, lead, h('span', { class: 'scope-name' }, name), caret, place === 'sidebar' ? tip(name) : null);
    btn.addEventListener('click', () => openSwitcher(btn));
    return btn;
  }

  // -------------------------------------------------------------------------
  // Navigation (sidebar and sheet share the markup)

  function trailingFor(it) {
    if (it.isNew) return newPill();
    return it.badge ? badgeEl(it.badge) : null;
  }

  function navItem(it, place) {
    const inSidebar = place === 'sidebar';
    const trailing = trailingFor(it);
    let railBadge = null;
    if (inSidebar && !trailing && it.railBadge) {
      railBadge = badgeEl(it.railBadge);
      railBadge?.classList.add('rail-only');
      if (railBadge) railBadge.hidden = !isRail();
    }
    const cls = ['nav-item', inSidebar ? 'has-tip' : null, it.ancestor ? 'is-parent-current' : null].filter(Boolean).join(' ');
    const link = h('a', {
      class: cls,
      href: it.href,
      'aria-current': it.current ? 'page' : undefined,
      dataset: { navKey: it.key },
    }, icon(it.icon), h('span', { class: 'nav-label' }, it.label), trailing, railBadge,
    inSidebar ? tip(it.label) : null);
    const children = it.children?.length
      ? h('ul', { class: 'nav-sub' }, it.children.map((c) => h('li', {},
        h('a', {
          class: 'nav-subitem',
          href: c.href,
          'aria-current': c.current ? 'page' : undefined,
          dataset: { navKey: `sub-${c.key}` },
        }, h('span', { class: 'nav-label' }, c.label), trailingFor(c)))))
      : null;
    return h('li', {}, link, children);
  }

  function navTree(place) {
    if (!model) return [];
    return model.groups.map((group) => {
      const section = h('div', { class: 'nav-section' });
      if (group.label) section.append(h('h2', { class: 'nav-group' }, group.label));
      if (group.switcher && scope.kind === 'student') {
        const node = scopeNode(place);
        if (node) section.append(node);
      }
      if (group.items.length) section.append(h('ul', { class: 'nav-list' }, group.items.map((it) => navItem(it, place))));
      return section;
    });
  }

  // Re-render a container, keeping keyboard focus on the same nav entry
  function rerender(container, build) {
    const active = document.activeElement;
    const key = active && container.contains(active) ? active.dataset?.navKey : null;
    container.replaceChildren(...build());
    if (key) container.querySelector(`[data-nav-key="${cssEscape(key)}"]`)?.focus({ preventScroll: true });
  }

  function renderSidebar() {
    rerender(nav, () => navTree('sidebar'));
    nav.removeAttribute('aria-busy');
    rerender(scopeSlot, () => [scope.kind === 'child' ? scopeNode('sidebar') : null].filter(Boolean));
  }

  function renderTabbar() {
    if (!model) return;
    rerender(tabbar, () => [h('ul', { class: 'tabbar-list' }, model.tabbar.map((slot) => {
      // The bubble stays on the icon; its hidden context goes after the label so
      // the accessible name reads "Assignments 3 to do", label first
      const bubble = slot.badge ? badgeEl(slot.badge) : null;
      const context = bubble?.querySelector('.visually-hidden') ?? null;
      context?.remove();
      bubble?.setAttribute('aria-hidden', 'true');
      const inner = [
        h('span', { class: 'tabbar-icon' }, icon(slot.icon, { size: 20 }), bubble),
        h('span', { class: 'tabbar-label' }, slot.label),
        context,
      ];
      const props = { class: 'tabbar-item', 'aria-current': slot.current ? 'page' : undefined, dataset: { navKey: `tab-${slot.key}` } };
      const el = slot.href
        ? h('a', { ...props, href: slot.href }, inner)
        : h('button', {
          ...props,
          type: 'button',
          'aria-haspopup': 'dialog',
          'aria-controls': 'nav-sheet',
          'aria-expanded': sheet.open && sheetOpener?.dataset?.navKey === `tab-${slot.key}` ? 'true' : 'false',
          onClick: () => openSheet(el),
        }, inner);
      return h('li', {}, el);
    }))]);
    // The More button that opened the sheet was just replaced: follow it
    if (sheet.open && sheetOpener && !sheetOpener.isConnected && sheetOpener.dataset?.navKey) {
      sheetOpener = tabbar.querySelector(`[data-nav-key="${cssEscape(sheetOpener.dataset.navKey)}"]`) ?? sheetOpener;
    }
  }

  // Phone top bar: brand, or a back button (the route's own, e.g. the review
  // page back to the queue, else staff in Student mode back to Students), and
  // the scope chip
  function renderTopbar() {
    const studentMode = staff && mode === 'student';
    const target = backLink ?? (studentMode ? { href: '#/students', label: 'Back to students' } : null);
    if (back) {
      back.hidden = !target;
      if (target) {
        back.setAttribute('href', target.href);
        back.setAttribute('aria-label', target.label);
      }
    }
    if (topBrand) topBrand.hidden = Boolean(target);
    const showChip = Boolean(scope.current) && ((studentMode && scope.kind === 'student')
      || (scope.kind === 'child' && (scope.options?.length ?? 0) >= 2));
    if (chip) {
      chip.hidden = !showChip;
      if (showChip) {
        const name = displayName(scope.current);
        chip.setAttribute('aria-label', `${name}, change ${noun()}`);
        chip.setAttribute('aria-expanded', switcher.open && switcherAnchor === chip ? 'true' : 'false');
        chip.replaceChildren(personAvatar(scope.current.id, name, { size: 24 }), h('span', {}, firstName(scope.current.full_name || name)));
      }
    }
  }
  chip?.addEventListener('click', () => openSwitcher(chip));

  function renderAll() {
    renderSidebar();
    renderTabbar();
    renderTopbar();
    updateRailState();
    if (sheet.open) renderSheet();
  }

  // -------------------------------------------------------------------------
  // Nav sheet: the full sidebar as a left overlay (768 to 1023) or a bottom
  // sheet (phones, "More"). Escape, Close, the backdrop, a link or a route
  // change closes it; focus returns to whatever opened it.

  function renderSheet() {
    const childBlock = scope.kind === 'child' ? scopeNode('sheet') : null;
    const inner = h('div', { class: 'sheet-inner' },
      h('div', { class: 'sheet-head' },
        h('a', { class: 'brand', href: home, dataset: { home: '' } },
          h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'VP'),
          h('span', { class: 'brand-text' },
            h('span', { class: 'brand-name' }, 'VP Education Group'),
            h('span', { class: 'brand-sub' }, BRAND_SUBS[me.role] ?? 'Portal'))),
        iconButton({ icon: 'x', label: 'Close menu', tip: false, onClick: () => closeSheet() })),
      childBlock ? h('div', { class: 'scope-slot' }, childBlock) : null,
      h('nav', { class: 'nav', 'aria-label': 'Portal' }, navTree('sheet')),
      h('div', { class: 'sidebar-foot' }, themeControl(), userRow()));
    rerender(sheet, () => [inner]);
  }

  function openSheet(from) {
    if (sheet.open) return;
    sheetOpener = from ?? null;
    renderSheet();
    sheet.showModal();
    sheetOpener?.setAttribute('aria-expanded', 'true');
    const current = sheet.querySelector('.nav [aria-current="page"]');
    (current ?? sheet.querySelector('.sheet-head .icon-btn'))?.focus();
  }

  function closeSheet() {
    if (sheet.open) sheet.close();
  }

  sheet.setAttribute('aria-label', 'Menu');
  sheet.addEventListener('close', () => {
    // The opener may have been re-rendered while the sheet was open
    let target = sheetOpener;
    if (target && !target.isConnected) {
      const key = target.dataset?.navKey;
      target = (key && tabbar.querySelector(`[data-nav-key="${cssEscape(key)}"]`))
        || (mqTablet.matches ? railToggle : null)
        || (navOpen?.isConnected && !mqPhone.matches ? navOpen : null)
        || tabbar.querySelector('[data-nav-key="tab-more"]');
    }
    target?.setAttribute('aria-expanded', 'false');
    sheetOpener?.setAttribute('aria-expanded', 'false');
    restoreFocusTo(target);
    updateRailState();
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet();
    else if (e.target.closest?.('a[href]') && !modified(e)) closeSheet();
  });

  // -------------------------------------------------------------------------
  // Scope switcher (spec 3.7): a popover under the button from 768px, a
  // bottom sheet on phones. Links are intercepted and handed to onSwitch.

  function openSwitcher(anchor) {
    if (!scope.kind || !scope.options?.length) return;
    if (switcher.open) switcher.close();
    switcherAnchor = anchor;
    const isChild = scope.kind === 'child';
    const list = h('ul', { class: 'switcher-list' });
    const empty = h('p', { class: 'switcher-empty', hidden: true }, `No ${noun()} matches that search.`);
    let search = null;
    let searchWrap = null;
    if (scope.options.length > SEARCH_AFTER) {
      const id = uid('switcher-search');
      search = h('input', { class: 'input', type: 'text', role: 'searchbox', inputmode: 'search', enterkeyhint: 'search', id, autocomplete: 'off', spellcheck: 'false', placeholder: isChild ? 'Find a child' : 'Find a student' });
      searchWrap = h('div', { class: 'switcher-search' },
        h('label', { class: 'visually-hidden', for: id }, isChild ? 'Find a child' : 'Find a student'),
        h('span', { class: 'input-icon' }, icon('magnifying-glass'), search));
      search.addEventListener('input', () => fill(search.value));
    }

    function link(person) {
      const name = displayName(person);
      const n = scope.counts?.get?.(person.id) ?? 0;
      const a = h('a', {
        class: 'switcher-item',
        href: scope.hrefFor ? scope.hrefFor(person.id) : `?${isChild ? 'child' : 'student'}=${encodeURIComponent(person.id)}`,
        'aria-current': person.id === scope.current?.id ? 'true' : undefined,
      }, personAvatar(person.id, name, { size: 24 }), h('span', { class: 'switcher-name' }, name),
      !isChild && n > 0 ? badgeEl({ n, context: plural(n, 'submission to review', 'submissions to review') }) : null);
      a.addEventListener('click', (e) => {
        if (modified(e)) return;
        e.preventDefault();
        switcher.close();
        if (person.id !== scope.current?.id) scope.onSwitch?.(person.id);
      });
      return a;
    }

    function fill(term) {
      const shown = filterPeople(scope.options, term);
      list.replaceChildren(...shown.map((p) => h('li', {}, link(p))));
      empty.hidden = shown.length > 0;
    }
    fill('');

    // The heading is hidden in the popover; on phones it heads the bottom
    // sheet with a Close button, like the More sheet
    const inner = h('div', { class: 'switcher-inner' },
      h('div', { class: 'switcher-head' },
        h('h2', { class: 'switcher-title' }, isChild ? 'Choose a child' : 'Choose a student'),
        iconButton({ icon: 'x', label: 'Close', tip: false, className: 'switcher-close', onClick: () => switcher.close() })),
      searchWrap, list, empty);
    inner.addEventListener('keydown', (e) => {
      const links = [...list.querySelectorAll('a.switcher-item')];
      if (e.target === search) {
        if (e.key === 'ArrowDown' && links.length) {
          e.preventDefault();
          links[0].focus();
        }
        return;
      }
      const i = links.indexOf(document.activeElement);
      if (i === -1) return;
      let next = null;
      if (e.key === 'ArrowDown') next = Math.min(i + 1, links.length - 1);
      else if (e.key === 'ArrowUp') {
        if (i === 0 && search) {
          e.preventDefault();
          search.focus();
          return;
        }
        next = Math.max(i - 1, 0);
      } else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = links.length - 1;
      else if (search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        search.focus();   // typing filters: the key lands in the search field
        return;
      }
      if (next !== null) {
        e.preventDefault();
        links[next].focus();
      }
    });

    switcher.replaceChildren(inner);
    switcher.setAttribute('aria-label', isChild ? 'Choose a child' : 'Choose a student');
    switcher.style.removeProperty('top');
    switcher.style.removeProperty('left');
    switcher.showModal();
    anchor.setAttribute('aria-expanded', 'true');
    if (!mqPhone.matches) {
      const r = anchor.getBoundingClientRect();
      const w = switcher.offsetWidth;
      const ht = switcher.offsetHeight;
      let left = r.left;
      let top = r.bottom + 4;
      if (isRail() && sidebar.contains(anchor)) {
        left = r.right + 8;
        top = r.top;
      }
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      if (top + ht > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ht - 8);
      switcher.style.left = `${Math.round(left)}px`;
      switcher.style.top = `${Math.round(top)}px`;
    }
    (search ?? list.querySelector('[aria-current="true"]') ?? list.querySelector('a'))?.focus();
  }

  switcher.addEventListener('close', () => {
    switcherAnchor?.setAttribute('aria-expanded', 'false');
    // The anchor may have been re-rendered while the switcher was open
    const target = switcherAnchor?.isConnected ? switcherAnchor
      : (switcherAnchor === chip ? chip : sidebar.querySelector('.scope-btn'));
    restoreFocusTo(target);
  });
  switcher.addEventListener('click', (e) => { if (e.target === switcher) switcher.close(); });

  // -------------------------------------------------------------------------
  // Scrolled hairline under the top bar (spec 3.3)

  const sentinel = document.querySelector('.scroll-sentinel');
  let observer = null;
  function observeScroll() {
    if (!sentinel || !topbarWrap || typeof IntersectionObserver === 'undefined') return;
    observer?.disconnect();
    const top = Math.round(topbarWrap.getBoundingClientRect().height);
    observer = new IntersectionObserver(([entry]) => {
      topbar?.classList.toggle('is-scrolled', !entry.isIntersecting);
    }, { rootMargin: `-${top}px 0px 0px 0px` });
    observer.observe(sentinel);
  }
  observeScroll();

  applyCollapsed();

  // -------------------------------------------------------------------------
  // API

  return {
    viewRoot,

    setNav(next) {
      model = next;
      renderAll();
    },

    setScope(next) {
      scope = { kind: null, current: null, options: [], onSwitch: null, hrefFor: null, counts: null, ...next };
      renderAll();
    },

    // [{ label, href }]; the last one is the current page
    setCrumbs(crumbs = []) {
      crumbsEl.replaceChildren(...crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        let sep = null;
        if (i > 0) {
          sep = icon('caret-right', { size: 12 });
          sep.classList.add('crumb-sep');
        }
        const node = last || !c.href
          ? h('span', { 'aria-current': last ? 'page' : undefined }, c.label)
          : h('a', { href: c.href }, c.label);
        return h('li', {}, sep, node);
      }));
    },

    setTopbarActions(nodes = []) {
      actionsEl.replaceChildren(...[].concat(nodes ?? []).filter(Boolean));
    },

    setMode(next) {
      mode = next === 'student' ? 'student' : 'workspace';
      renderTopbar();
    },

    // The phone top bar title
    setTitle(text) {
      titleEl.textContent = text ?? '';
    },

    // Where the brand lockups link (the page's default route)
    setHome(href) {
      home = href;
      for (const a of brandLinks()) a.setAttribute('href', href);
    },

    setTabbarHidden(hidden) {
      appEl.classList.toggle('is-tabbar-hidden', Boolean(hidden));
    },

    // A route's own phone back button, or null for the default (see renderTopbar)
    setBack(link) {
      backLink = link?.href ? { href: link.href, label: link.label || 'Back' } : null;
      renderTopbar();
    },

    // Route changes close the nav sheet, switcher and account popover
    closeOverlays() {
      for (const d of [sheet, switcher, popover]) if (d.open) d.close();
    },
  };
}
