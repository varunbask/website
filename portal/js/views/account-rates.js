// Account > Rates (account.html, admin). What each family pays per hour (per
// student and subject, optionally per tutor), what each tutor earns, the
// billing settings and the no-show policy. Rates
// and policies apply from a date and are never edited: a new row takes over
// from its date, and a wrong one is voided with a reason.

import { sb } from '../supabase.js';
import { h } from '../dom.js';
import { button, field, select, emptyState, busy } from '../ui.js';
import { todayKey } from '../dates.js';
import { displayName } from '../format.js';
import {
  money, parseMoney, monthOf, monthName, addMonths, tutorRateFor, policyFor, periodText, dayText, shortDate, periodsOverlapping, billDate,
} from '../billing-model.js';
import { parseRateLines, matchRates, policyText } from '../billing-text.js';
import { setHeader, loadPriced, table, card, act, note, askReason } from './account-shared.js';

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mount(ctx) {
  setHeader(ctx, 'rates', { lede: 'Rates apply from the date you pick; earlier months keep the rate they had.' });
  const root = h('div', { class: 'acct-root acct-rates' });
  ctx.host.append(root);
  const focusStudent = ctx.route.params?.student ?? null;
  let query = '';

  return (async () => {
    const loaded = await loadPriced(ctx, root);
    if (!loaded || !ctx.alive()) return;
    const { b, data } = loaded;
    const today = todayKey(ctx.now);
    const students = data.people.filter((p) => p.role === 'student').sort((a, c) => displayName(a).localeCompare(displayName(c)));
    const parents = data.people.filter((p) => p.role === 'parent');
    const tutors = data.people.filter((p) => p.role === 'tutor' || p.role === 'admin').sort((a, c) => displayName(a).localeCompare(displayName(c)));
    const defaultFrom = monthOf(today) < b.settings.ledger_start ? b.settings.ledger_start : monthOf(today);

    const studentList = h('div', { class: 'acct-rate-list' });
    const search = h('input', { type: 'search', class: 'input', placeholder: 'Find a student', 'aria-label': 'Find a student', value: query });
    search.addEventListener('input', () => { query = search.value; paintStudents(); });

    function paintStudents() {
      const q = query.trim().toLowerCase();
      const withSessions = new Set(b.rows.map((r) => String(r.session.student_id)));
      const list = students
        .filter((s) => !q || displayName(s).toLowerCase().includes(q))
        .sort((a, c) => missing(c) - missing(a));
      function missing(s) {
        return withSessions.has(String(s.id)) && !b.familyRates.some((r) => !r.voided_at && String(r.student_id) === String(s.id)) ? 1 : 0;
      }
      studentList.replaceChildren(...(list.length ? list.map((s) => studentRates(s)) : [emptyState({ icon: 'users-three', text: 'No students match.' })]));
      if (focusStudent) studentList.querySelector(`[data-student="${CSS.escape(String(focusStudent))}"]`)?.scrollIntoView?.({ block: 'center' });
    }

    function studentRates(s) {
      const rows = b.familyRates.filter((r) => String(r.student_id) === String(s.id))
        .sort((a, c) => (a.voided_at ? 1 : 0) - (c.voided_at ? 1 : 0) || String(a.subject ?? '').localeCompare(String(c.subject ?? '')) || c.effective_from.localeCompare(a.effective_from));
      const linkedTutors = data.links.filter((l) => String(l.student_id) === String(s.id));
      const hasSessions = b.rows.some((r) => String(r.session.student_id) === String(s.id));
      const live = rows.filter((r) => !r.voided_at);
      const body = [];
      if (rows.length) {
        body.push(table({
          label: `Rates for ${displayName(s)}`,
          columns: [
            { key: 'subject', label: 'Subject' }, { key: 'tutor', label: 'Tutor' }, { key: 'rate', label: 'Per hour', num: true },
            { key: 'from', label: 'From' }, { key: 'note', label: 'Note' }, { key: 'actions', label: '' },
          ],
          rows: rows.map((r) => ({
            className: r.voided_at ? 'is-voided' : null,
            cells: {
              subject: r.subject ?? 'Any subject',
              tutor: r.tutor_id ? b.nameOf(r.tutor_id) : 'Any tutor',
              rate: money(r.rate_cents),
              from: shortDate(r.effective_from, today),
              note: r.voided_at ? `Voided: ${r.void_reason}` : (r.note ?? ''),
              actions: r.voided_at ? '' : button({ label: 'Void', size: 'sm', variant: 'ghost', onClick: () => voidRate('family_rates', r) }),
            },
          })),
        }));
      } else if (hasSessions) {
        body.push(note('This student has sessions but no rate yet, so they are priced at $0.', 'warning-circle'));
      }
      body.push(addFamilyRate(s, linkedTutors, live));
      return h('section', { class: 'card acct-card acct-student-rates', dataset: { student: String(s.id) } },
        h('div', { class: 'card-head' },
          h('h3', { class: 'card-title' }, displayName(s)),
          h('span', { class: 'card-meta' }, linkedTutors.length
            ? linkedTutors.map((l) => `${b.nameOf(l.tutor_id)}${l.subject ? ` (${l.subject})` : ''}`).join(', ')
            : 'No tutor linked')),
        h('div', { class: 'card-body' }, body));
    }

    function addFamilyRate(s, linkedTutors, live) {
      const subjects = [...new Set(linkedTutors.map((l) => l.subject).filter(Boolean))];
      const listId = `subj-${s.id}`;
      const subject = h('input', { class: 'input', name: 'subject', maxlength: '60', placeholder: subjects[0] ?? 'Math', list: listId, autocomplete: 'off', 'aria-label': 'Subject (blank for any)' });
      const datalist = h('datalist', { id: listId }, subjects.map((x) => h('option', { value: x })));
      const tutorWrap = select({ label: 'Tutor', options: [{ value: '', label: 'Any tutor' }, ...linkedTutors.map((l) => ({ value: String(l.tutor_id), label: b.nameOf(l.tutor_id) }))], value: '' });
      const rate = h('input', { class: 'input acct-money-input', name: 'rate', inputmode: 'decimal', placeholder: '45', 'aria-label': 'Per hour, in dollars' });
      const from = h('input', { type: 'date', class: 'input', name: 'from', value: defaultFrom, 'aria-label': 'Applies from' });
      const hint = h('p', { class: 'field-hint acct-form-hint' });
      const save = button({ label: 'Add rate', size: 'sm', variant: 'primary' });
      const checkHint = () => {
        const subj = subject.value.trim();
        const t = tutorWrap.querySelector('select').value;
        const specific = !t && subj && live.filter((r) => r.tutor_id && String(r.subject ?? '').toLowerCase() === subj.toLowerCase());
        hint.textContent = specific?.length
          ? `${displayName(s)} also has a ${subj} rate with ${specific.map((r) => b.nameOf(r.tutor_id)).join(' and ')}; that rate stays as it is.`
          : '';
      };
      subject.addEventListener('input', checkHint);
      tutorWrap.querySelector('select').addEventListener('change', checkHint);
      save.addEventListener('click', () => busy(save, 'Adding…', async () => {
        const cents = parseMoney(rate.value, { allowZero: true, max: 100000 });
        if (cents === null) { ctx.toast({ text: 'Enter the rate per hour, like 45 or 47.50.' }); rate.focus(); return; }
        if (!KEY_RE.test(from.value)) { ctx.toast({ text: 'Pick the date it applies from.' }); return; }
        const subj = subject.value.trim().replace(/\s+/g, ' ') || null;
        const tutorId = tutorWrap.querySelector('select').value || null;
        await act(ctx, () => sb.from('family_rates').insert({
          student_id: s.id, subject: subj, tutor_id: tutorId, rate_cents: cents, effective_from: from.value,
        }).select('id'), {
          done: `${displayName(s)}: ${subj ?? 'any subject'}${tutorId ? ` with ${b.nameOf(tutorId)}` : ''} at ${money(cents)} an hour from ${shortDate(from.value)}.`,
          failed: 'That rate didn’t save. Is there already one for that subject, tutor and date?',
        });
      }));
      return h('div', { class: 'acct-inline-form' },
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Subject'), subject, datalist),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Tutor'), tutorWrap),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'Per hour'), rate),
        h('label', { class: 'acct-inline-field' }, h('span', {}, 'From'), from),
        save, hint);
    }

    async function voidRate(tableName, r) {
      const reason = await askReason('Void this rate?', 'It stops applying. Months already paid keep it. Say why, for the record.');
      if (!reason) return;
      await act(ctx, () => sb.from(tableName).update({ voided_at: new Date().toISOString(), void_reason: reason }).eq('id', r.id).select('id'), {
        done: 'Rate voided.',
        failed: 'That rate couldn’t be voided. A paid month used it; add a new rate from a later date instead.',
      });
    }

    // -----------------------------------------------------------------------
    // Paste rates

    function pasteCard() {
      const text = h('textarea', { class: 'input textarea acct-paste', rows: '6', 'aria-label': 'Rates, one student per line', placeholder: 'Kevin (Alan): Math $45\nJayden (Stella): Ethan Math $45, Math $60' });
      const from = h('input', { type: 'date', class: 'input', value: defaultFrom, 'aria-label': 'Applies from' });
      const out = h('div', { class: 'acct-paste-result' });
      let ready = [];
      const preview = button({ label: 'Preview', size: 'sm', onClick: () => {
        if (!KEY_RE.test(from.value)) { ctx.toast({ text: 'Pick the date the rates apply from.' }); return; }
        const parsed = parseRateLines(text.value);
        const m = matchRates(parsed.rates, {
          students, parents, parentLinks: b.parentLinks, links: data.links, tutors, existing: b.familyRates, effectiveFrom: from.value,
        });
        ready = m.ready;
        const line = (r) => `${b.nameOf(r.student_id)}: ${r.subject}${r.tutor_id ? ` with ${b.nameOf(r.tutor_id)}` : ''}, ${money(r.cents)} an hour`;
        out.replaceChildren(
          h('h4', { class: 'acct-paste-title' }, `Ready (${m.ready.length})`),
          m.ready.length ? h('ul', {}, m.ready.map((r) => h('li', {}, line(r)))) : h('p', { class: 'card-meta' }, 'Nothing new to add.'),
          m.problems.length || parsed.errors.length ? h('h4', { class: 'acct-paste-title is-warning' }, `Needs attention (${m.problems.length + parsed.errors.length})`) : null,
          m.problems.length || parsed.errors.length ? h('ul', {}, [...parsed.errors.map((e) => h('li', {}, `${e.line}: ${e.error}`)), ...m.problems.map((p) => h('li', {}, `${p.line}: ${p.reason}`))]) : null,
          m.already.length ? h('h4', { class: 'acct-paste-title' }, `Already set (${m.already.length})`) : null,
          m.already.length ? h('ul', {}, m.already.map((r) => h('li', {}, line(r)))) : null,
          m.ready.length ? confirm : null);
      } });
      const confirm = button({ label: 'Add the ready rates', size: 'sm', variant: 'primary', onClick: () => busy(confirm, 'Adding…', async () => {
        if (!ready.length) return;
        await act(ctx, () => sb.from('family_rates').insert(ready.map((r) => ({
          student_id: r.student_id, subject: r.subject, tutor_id: r.tutor_id, rate_cents: r.cents, effective_from: from.value,
        }))).select('id'), { done: `${ready.length} ${ready.length === 1 ? 'rate' : 'rates'} added.`, expect: ready.length, failed: 'Those rates didn’t save. Try fewer at a time.' });
      }) });
      return h('details', { class: 'card acct-card acct-paste-card' },
        h('summary', { class: 'acct-range-summary' }, 'Paste rates from the old scheduler'),
        h('p', { class: 'card-meta' }, 'One student per line, as the scheduler lists them: Name (Parent): Subject $45, Subject $60. A tutor’s first name before the subject ("Ethan Math") makes a rate for that tutor only. Nothing is saved until you confirm.'),
        h('div', { class: 'acct-inline-form' }, h('label', { class: 'acct-inline-field' }, h('span', {}, 'Applies from'), from), preview),
        text, out);
    }

    // -----------------------------------------------------------------------
    // Tutor pay rates and opening balances

    function tutorCard() {
      const rows = tutors.map((t) => {
        const current = tutorRateFor(t.id, today, b.tutorRates);
        const history = b.tutorRates.filter((r) => String(r.tutor_id) === String(t.id)).sort((a, c) => c.effective_from.localeCompare(a.effective_from));
        const rate = h('input', { class: 'input acct-money-input', inputmode: 'decimal', placeholder: current ? (current.rate_cents / 100).toFixed(2) : '25', 'aria-label': `New rate for ${displayName(t)}` });
        const from = h('input', { type: 'date', class: 'input', value: defaultFrom, 'aria-label': 'Applies from' });
        const save = button({ label: 'Set rate', size: 'sm' });
        save.addEventListener('click', () => busy(save, 'Saving…', async () => {
          const cents = parseMoney(rate.value, { allowZero: true, max: 100000 });
          if (cents === null) { ctx.toast({ text: 'Enter the pay per hour, like 25.' }); return; }
          if (!KEY_RE.test(from.value)) { ctx.toast({ text: 'Pick the date it applies from.' }); return; }
          await act(ctx, () => sb.from('tutor_rates').insert({ tutor_id: t.id, rate_cents: cents, effective_from: from.value }).select('id'), {
            done: `${displayName(t)}: ${money(cents)} an hour from ${shortDate(from.value)}.`,
            failed: 'That rate didn’t save. Is there already one from that date?',
          });
        }));
        return {
          cells: {
            name: displayName(t),
            rate: current ? money(current.rate_cents) : h('span', { class: 'acct-missing' }, 'Not set'),
            from: current ? shortDate(current.effective_from, today) : '',
            set: h('div', { class: 'acct-inline-form is-tight' }, rate, from, save),
          },
          after: history.length > 1 ? h('details', { class: 'acct-history' }, h('summary', {}, `${history.length} rates`),
            h('ul', {}, history.map((r) => h('li', { class: r.voided_at ? 'is-voided' : null },
              `${money(r.rate_cents)} an hour, from ${shortDate(r.effective_from, today)}${r.voided_at ? ` (voided: ${r.void_reason})` : ''} `,
              r.voided_at ? null : button({ label: 'Void', size: 'sm', variant: 'ghost', onClick: () => voidRate('tutor_rates', r) }))))) : null,
        };
      });
      return card({
        title: 'Tutor standard hourly rates',
        meta: 'Each tutor is paid this rate for every hour they teach, whatever the student. A new rate applies from the date you pick.',
        body: [table({
          label: 'Tutor pay rates',
          columns: [
            { key: 'name', label: 'Tutor' }, { key: 'rate', label: 'Per hour', num: true },
            { key: 'from', label: 'Since' }, { key: 'set', label: 'New rate, from' },
          ],
          rows,
        })],
      });
    }

    // -----------------------------------------------------------------------
    // Settings and policy

    function settingsCard() {
      const s = b.settings;
      const name = h('input', { class: 'input', value: s.business_name, maxlength: '80', 'aria-label': 'Business name' });
      const due = h('input', { type: 'number', class: 'input acct-num-input', min: '1', max: '28', value: String(s.due_day), 'aria-label': 'Day of the month bills are due' });
      const payNote = h('textarea', { class: 'input textarea', rows: '3', maxlength: '2000', 'aria-label': 'How to pay, printed on statements' }, s.pay_note ?? '');
      const month = monthOf(today);
      const periods = periodsOverlapping(month, addMonths(month, 1)).slice(0, 3);
      const save = button({ label: 'Save settings', variant: 'primary', size: 'sm' });
      save.addEventListener('click', () => busy(save, 'Saving…', async () => {
        const fields = {
          business_name: name.value.trim() || 'VP Education Group',
          due_day: Math.min(28, Math.max(1, Number(due.value) || 15)),
          pay_note: payNote.value.trim() || null,
        };
        await act(ctx, () => sb.from('billing_settings').update(fields).eq('id', 1).select('id'), { done: 'Settings saved.' });
      }));
      return card({
        title: 'Settings',
        body: [
          h('div', { class: 'acct-settings' },
            field({ label: 'Business name', control: name, hint: 'Printed on statements and pay summaries.' }),
            h('p', { class: 'card-meta' }, `Tutor pay periods run the 1st to the 15th and the 16th to the end of the month: ${periods.map((p) => periodText(p)).join('; ')}.`),
            field({ label: 'Family bills due on day', control: due, hint: `Bills are dated the 1st of the next month (${monthName(month)} is billed ${dayText(billDate(month))}).` }),
            field({ label: 'How to pay', control: payNote, optional: true, hint: 'Printed at the bottom of every statement, like your Zelle email.' }),
            h('p', { class: 'card-meta' }, `Billing starts ${shortDate(s.ledger_start, today)}; sessions before it are left out.`)),
          save,
        ],
      });
    }

    function policyCard() {
      const current = policyFor(today, b.policies);
      const fam = h('input', { type: 'number', class: 'input acct-num-input', min: '0', max: '100', value: String(current.absent_family_pct), 'aria-label': 'No-show: percent the family pays' });
      const tut = h('input', { type: 'number', class: 'input acct-num-input', min: '0', max: '100', value: String(current.absent_tutor_pct), 'aria-label': 'No-show: percent the tutor is paid' });
      const unconf = h('input', { type: 'checkbox', class: 'checkbox', checked: current.count_unconfirmed });
      const lastPaid = (data.billing.payments ?? []).filter((p) => !p.voided_at && p.period).map((p) => p.period).sort().at(-1);
      const earliest = lastPaid ? addMonths(lastPaid, 1) : b.settings.ledger_start;
      const from = h('input', { type: 'date', class: 'input', value: defaultFrom > earliest ? defaultFrom : earliest, min: earliest, 'aria-label': 'Change applies from' });
      const save = button({ label: 'Save policy', size: 'sm' });
      save.addEventListener('click', () => busy(save, 'Saving…', async () => {
        const f = Number(fam.value);
        const t = Number(tut.value);
        if (![f, t].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) { ctx.toast({ text: 'Percentages are whole numbers from 0 to 100.' }); return; }
        if (!KEY_RE.test(from.value) || from.value < earliest) { ctx.toast({ text: `Pick a date on or after ${shortDate(earliest)}; paid months keep their policy.` }); return; }
        await act(ctx, () => sb.from('billing_policies').insert({
          effective_from: from.value, absent_family_pct: f, absent_tutor_pct: t, count_unconfirmed: unconf.checked,
        }).select('id'), { done: `Policy saved from ${shortDate(from.value)}.`, failed: 'That didn’t save. There may already be a policy from that date.' });
      }));
      const history = [...b.policies].sort((a, c) => c.effective_from.localeCompare(a.effective_from));
      return card({
        title: 'Policy',
        meta: `In force since ${current.effective_from ? shortDate(current.effective_from, today) : 'the start'}`,
        body: [
          h('p', { class: 'acct-policy-text' }, policyText(current, b.settings)),
          h('div', { class: 'acct-settings' },
            field({ label: 'No-show: family pays (percent)', control: fam }),
            field({ label: 'No-show: tutor is paid (percent)', control: tut }),
            h('label', { class: 'check' }, unconf, h('span', {}, 'Count sessions without attendance as attended on screen')),
            field({ label: 'Applies from', control: from, hint: 'Earlier months keep the policy they had.' })),
          save,
          history.length > 1 ? h('details', { class: 'acct-history' }, h('summary', {}, `${history.length} policies`),
            h('ul', {}, history.map((p) => h('li', {}, `From ${shortDate(p.effective_from, today)}: no-show ${p.absent_family_pct}% family, ${p.absent_tutor_pct}% tutor; unconfirmed ${p.count_unconfirmed ? 'counted' : 'not counted'}`)))) : null,
        ],
      });
    }

    paintStudents();
    root.replaceChildren(
      h('div', { class: 'grid-12' },
        h('div', { class: 'span-8 acct-stack' },
          h('div', { class: 'acct-section-head' }, h('h2', {}, 'What families pay'), search),
          pasteCard(),
          studentList),
        h('div', { class: 'span-4 acct-stack' }, settingsCard(), policyCard())),
      tutorCard(),
    );
  })();
}

