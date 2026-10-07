// Releasing a month's bills (Account > Families). A parent sees nothing about a
// month until the admin releases it, and at the end of the month that is one
// deliberate action for every family at once. Releasing a family is the same
// write as before (a statements row with its snapshot, built by
// billing-text.js statementSnapshot); this file works out who is ready, who is
// held back and why, who is already out, what the confirm dialog says, and
// runs the writes one family at a time so a retry only does what is left.
// No DOM, no network: the page passes the write in.

import {
  familyRows, familyBlockers, familyBalanceBefore, needsAttention, studentsWithoutPayer,
  monthEnd, monthName, billDate, dayText, shortDate, ATTENTION,
} from './billing-model.js';
import { sendAction } from './billing-text.js';

const same = (a, b) => String(a) === String(b);
const plural = (n, one, many) => (n === 1 ? one : many);
const familiesText = (n) => `${n} ${plural(n, 'family', 'families')}`;

// Why a family or student is held back
export const HELD_REASONS = Object.freeze({
  blocked: 'Open items on the calendar',
  nothing: 'Nothing owed',
  no_payer: 'No paying parent',
});

// A one-line list of what is open for a family: "Ended without attendance; No family rate"
function blockedDetail(gate) {
  const titles = [...new Set(gate.items.map((it) => ATTENTION[it.kind]?.title).filter(Boolean))];
  const n = gate.items.length;
  return `${n} ${plural(n, 'session needs', 'sessions need')} attention first (${titles.join('; ').toLowerCase()})`;
}

// Nothing to bill: no charges this month and nothing brought forward. A month
// with only a balance brought forward still goes out; so does a credit.
const nothingOwed = (f, previousCents) => f.owedCents === 0 && previousCents <= 0;

// Who a month's release would touch.
//   ready    families to write now (a statement not yet released, or one marked
//            sent before the portal kept copies, which only needs its copy
//            saved): { parentId, name, noLogin, f, previous, action }
//   already  families with a released statement, left exactly as they are;
//            changed says the month moved since (that is Release again, one
//            family at a time, because the parent sees the new version)
//   held     what stays back, with the reason: blocked by the same open items
//            as Record payment, nothing owed, or a student with no paying parent
//   monthEnded  false while the month is still running (releasing is allowed,
//            with a warning)
// noLogin is a Set of parent ids who have no login yet; their statement is
// released like the others and reaches them as copied text or a printout.
export function releasePlan(b, month, today, { families = null, noLogin = new Set() } = {}) {
  const rows = families ?? familyRows(b, month);
  const attention = needsAttention(b, month, monthEnd(month), { sessionsOnly: true });
  const ready = [];
  const already = [];
  const held = [];
  for (const f of rows) {
    const sent = (b.statements ?? []).find((x) => same(x.parent_id, f.parentId) && x.period === month) ?? null;
    const previous = familyBalanceBefore(b, f.parentId, month);
    const gate = familyBlockers(b, f.parentId, month, { attention });
    const action = sendAction(sent, f, previous, gate, today);
    const base = { parentId: f.parentId, name: f.name, noLogin: noLogin.has(String(f.parentId)) };
    if (sent && (action.kind === null || action.kind === 'again')) already.push({ ...base, sentOn: sent.sent_on, changed: action.kind === 'again' });
    else if (action.blocked) held.push({ ...base, reason: 'blocked', detail: blockedDetail(gate) });
    else if (nothingOwed(f, previous)) held.push({ ...base, reason: 'nothing', detail: 'nothing owed for the month' });
    else ready.push({ ...base, f, previous, action });
  }
  for (const studentId of studentsWithoutPayer(b, month, monthEnd(month))) {
    held.push({ parentId: null, studentId: String(studentId), name: b.nameOf(studentId), noLogin: false, reason: 'no_payer', detail: 'no paying parent is linked to this student' });
  }
  const byName = (x, y) => x.name.localeCompare(y.name);
  return {
    month,
    today,
    monthEnded: today > monthEnd(month),
    ready: ready.sort(byName),
    already: already.sort(byName),
    held: held.sort(byName),
  };
}

// The numbers the page and the dialog quote
export function releaseCounts(plan) {
  const heldFamilies = plan.held.filter((x) => x.reason !== 'no_payer').length;
  return {
    ready: plan.ready.length,
    readyNoLogin: plan.ready.filter((x) => x.noLogin).length,
    already: plan.already.length,
    changed: plan.already.filter((x) => x.changed).length,
    held: plan.held.length,
    heldFamilies,
    families: plan.ready.length + plan.already.length + heldFamilies,
  };
}

// The line above the family list: where the month stands
// -> { title, meta, tone: 'ready' | 'done' | 'waiting' }
// Counts are families; students with no paying parent are a separate clause
// (they are not a family, so nothing can be released for them).
export function releaseHeadline(plan) {
  const c = releaseCounts(plan);
  const month = monthName(plan.month);
  const noPayer = c.held - c.heldFamilies;
  const orphans = noPayer ? `${noPayer} ${plural(noPayer, 'student has', 'students have')} no paying parent.` : null;
  if (!c.ready && !c.heldFamilies) {
    return {
      title: `All ${familiesText(c.already)} released`,
      meta: [
        c.changed
          ? `${c.changed} ${plural(c.changed, 'family has', 'families have')} changed since release. Open ${plural(c.changed, 'its row', 'their rows')} and use Release again.`
          : 'Parents can read them under Billing in the portal.',
        orphans,
      ].filter(Boolean).join(' '),
      tone: 'done',
    };
  }
  const state = c.already ? `${c.already} of ${familiesText(c.families)} released` : `none of ${familiesText(c.families)} released yet`;
  const parts = [
    c.ready ? `${c.ready} ${plural(c.ready, 'is', 'are')} ready.` : 'None are ready.',
    c.heldFamilies ? `${c.heldFamilies} held back.` : null,
    c.changed ? `${c.changed} changed since release.` : null,
    orphans,
    // a month still running says when it is usually released; a finished one, that nothing is out yet
    plan.monthEnded
      ? (c.already ? null : 'Parents see nothing until you release.')
      : `${month} has not ended yet (usually released ${shortDate(billDate(plan.month))}).`,
  ].filter(Boolean);
  return { title: state.charAt(0).toUpperCase() + state.slice(1), meta: parts.join(' '), tone: plan.monthEnded ? 'ready' : 'waiting' };
}

// What the confirm dialog says
// -> { title, runningTitle, lines: [string], heldTitle, held: [string], warning: { title, text } | null, confirmLabel: string | null }
export function releaseCopy(plan) {
  const c = releaseCounts(plan);
  const month = monthName(plan.month);
  const lines = [];
  if (c.ready) {
    lines.push(`${familiesText(c.ready)} will be released. Each paying parent with a login can then read the bill under Billing in the portal.`);
    if (c.readyNoLogin) {
      lines.push(`${c.readyNoLogin} of them ${plural(c.readyNoLogin, 'has', 'have')} no login, so ${plural(c.readyNoLogin, 'that statement reaches them', 'those statements reach them')} as copied text or a printout, from ${plural(c.readyNoLogin, 'its row', 'their rows')} here.`);
    }
  } else {
    lines.push('No family is ready to release.');
  }
  if (c.already) {
    lines.push(`${familiesText(c.already)} ${plural(c.already, 'is', 'are')} already released and will not be touched.${c.changed ? ` ${c.changed} of them ${plural(c.changed, 'has', 'have')} changed since: use Release again on ${plural(c.changed, 'its row', 'their rows')}.` : ''}`);
  }
  const warning = plan.monthEnded ? null : {
    title: `${month} has not ended yet`,
    text: `Bills released now count only what has happened so far. A family whose month changes afterwards will need Release again. They are usually released on ${dayText(billDate(plan.month))}.`,
  };
  return {
    title: c.ready ? `Release ${month} bills?` : `Nothing to release for ${month}`,
    runningTitle: `Releasing ${month} bills`,
    lines,
    heldTitle: `Held back (${c.held})`,
    held: plan.held.map((x) => `${x.name}: ${x.detail}`),
    warning,
    confirmLabel: c.ready ? `Release ${c.ready} ${plural(c.ready, 'bill', 'bills')}` : null,
  };
}

// The words for one family's Release control and its toasts
export function releaseDoneText({ name, noLogin, dueDay, again = false }) {
  if (noLogin) return `${again ? 'Released again' : 'Released'}. ${name} has no login yet, so copy or print the statement to send it.`;
  return again
    ? `Released again. ${name} now sees the new bill, due ${dueDay}.`
    : `Released. ${name} can read the bill under Billing in the portal, due ${dueDay}.`;
}

// How a write came back: 'released', 'skipped' (the family already has a
// statement for the month: a retry, or another tab got there first) or
// 'failed' (an error, or no row came back because row security refused it)
export function outcomeOf(result) {
  if (result?.error) return result.error.code === '23505' ? 'skipped' : 'failed';
  const rows = Array.isArray(result?.data) ? result.data.length : (result?.data ? 1 : 0);
  return rows > 0 ? 'released' : 'failed';
}

// Writes the ready families one at a time. write(item) returns the database
// result. Safe to run again: whoever is already released comes back as a
// duplicate and is skipped, and the plan for a retry leaves them out anyway.
// -> { released: [item], skipped: [item], failed: [{ ...item, message }] }
export async function releaseAll(items, write, { onProgress } = {}) {
  const out = { released: [], skipped: [], failed: [] };
  let done = 0;
  for (const item of items) {
    let outcome;
    let message = null;
    try {
      const result = await write(item);
      outcome = outcomeOf(result);
      if (outcome === 'failed') message = result?.error?.message ?? 'The database did not save it';
    } catch (error) {
      outcome = 'failed';
      message = error?.message ?? 'The write did not go through';
    }
    out[outcome].push(outcome === 'failed' ? { ...item, message } : item);
    done += 1;
    onProgress?.({ done, total: items.length, item, outcome });
  }
  return out;
}

// What the dialog says when the run is over
// -> { title, lines: [string], failed: [string] }
export function releaseResultCopy(result, plan) {
  const month = monthName(plan.month);
  const n = result.released.length;
  const total = n + result.failed.length;
  const lines = [];
  if (result.skipped.length) {
    lines.push(`${familiesText(result.skipped.length)} ${plural(result.skipped.length, 'was', 'were')} already released and ${plural(result.skipped.length, 'was', 'were')} left alone.`);
  }
  if (n) lines.push('Parents with a login can now read their bills under Billing in the portal.');
  const noLogin = result.released.filter((x) => x.noLogin).length;
  if (noLogin) lines.push(`${noLogin} ${plural(noLogin, 'has', 'have')} no login yet: copy or print ${plural(noLogin, 'that statement', 'those statements')} from ${plural(noLogin, 'its row', 'their rows')}.`);
  if (result.failed.length) lines.push('Close this and press Release bills again to retry them. Families already released are skipped.');
  return {
    title: result.failed.length
      ? `Released ${n} of ${total} ${month} bills`
      : (n ? `Released ${n} ${month} ${plural(n, 'bill', 'bills')}` : `${month} bills were already released`),
    lines,
    failed: result.failed.map((x) => `${x.name}: did not save`),
  };
}

// "Released Oct 1" and "Not released yet" for a family row's control
export function releaseLabel(sent, today) {
  return sent ? `Released ${shortDate(sent.sent_on, today)}` : 'Not released yet';
}
