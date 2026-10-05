import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, hasService } from './world.js';

// Needs supabase/migrations/20261010120000_billing.sql applied to the project
// the .env points at. Tests run in file order; later ones build on earlier ones.
// Money rows restrict deleting the people they name, so afterAll removes this
// file's rows with the service role before the world is cleaned up. The shared
// billing_settings row is read, never changed.

const HOUR = 3_600_000;
const slot = (hoursAhead, length = 1) => {
  const start = new Date(Math.ceil(Date.now() / HOUR) * HOUR + hoursAhead * HOUR);
  return { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + length * HOUR).toISOString() };
};
const TABLES = ['billing_settings', 'billing_policies', 'family_rates', 'tutor_rates', 'session_billing', 'session_edits',
  'payments', 'payouts', 'billing_adjustments', 'billing_contacts', 'statements'];

describe.skipIf(!hasService)('billing row-level security', () => {
  let w;
  let P;
  let past;
  const made = { payments: [], payouts: [], adjustments: [], rates: [], tutorRates: [] };

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
    await w.admin.from('parent_students').insert({ parent_id: P.parentA.id, student_id: P.studentA.id });
    past = (await w.admin.from('sessions')
      .insert({ student_id: P.studentA.id, tutor_id: P.tutorA.id, subject: 'Math', ...slot(-30) })
      .select('id, starts_at').single()).data;
  });

  afterAll(async () => {
    if (w) {
      await w.admin.from('payments').delete().in('id', made.payments);
      await w.admin.from('payouts').delete().in('id', made.payouts);
      await w.admin.from('billing_adjustments').delete().in('id', made.adjustments);
      await w.admin.from('billing_contacts').delete().eq('parent_id', P.parentA.id);
      await w.admin.from('statements').delete().eq('parent_id', P.parentA.id);
      if (past) {
        await w.admin.from('sessions').delete().eq('id', past.id);
        await w.admin.from('session_edits').delete().eq('session_id', past.id);
      }
    }
    await w?.cleanup();
  });

  test('only the admin reads the billing tables', async () => {
    for (const who of ['tutorA', 'studentA', 'parentA']) {
      for (const t of TABLES) {
        const { data } = await P[who].client.from(t).select('*').limit(5);
        expect(data ?? [], `${who} ${t}`).toEqual([]);
      }
    }
    const { data } = await P.admin.client.from('billing_settings').select('payroll_anchor').eq('id', 1).single();
    expect(new Date(`${data.payroll_anchor}T12:00:00Z`).getUTCDay()).toBe(0);
  });

  test('the first linked parent pays; only the admin moves the bill', async () => {
    const { data } = await P.admin.client.from('parent_students').select('bills').eq('parent_id', P.parentA.id).eq('student_id', P.studentA.id).single();
    expect(data.bills).toBe(true);
    const byParent = await P.parentA.client.from('parent_students').update({ bills: false }).eq('parent_id', P.parentA.id).select('bills');
    expect(byParent.data ?? []).toEqual([]);
  });

  test('rates: admin adds, nobody edits an amount, a parent cannot be priced as a student', async () => {
    const r = await P.admin.client.from('family_rates')
      .insert({ student_id: P.studentA.id, subject: 'Math', rate_cents: 4500, effective_from: '2026-11-01' }).select('id').single();
    expect(r.error).toBeNull();
    made.rates.push(r.data.id);
    expect((await P.admin.client.from('family_rates').update({ rate_cents: 1 }).eq('id', r.data.id)).error).not.toBeNull();
    expect((await P.admin.client.from('family_rates').insert({ student_id: P.parentA.id, rate_cents: 1, effective_from: '2026-11-01' })).error).not.toBeNull();
    expect((await P.tutorA.client.from('family_rates').insert({ student_id: P.studentA.id, rate_cents: 1, effective_from: '2026-11-01' })).error).not.toBeNull();
    const t = await P.admin.client.from('tutor_rates').insert({ tutor_id: P.tutorA.id, rate_cents: 3000, effective_from: '2026-11-01' }).select('id').single();
    expect(t.error).toBeNull();
  });

  test('a tutor still edits a past session that is not paid, and every change is audited', async () => {
    const c = P.tutorA.client;
    expect((await c.from('sessions').update({ attendance: 'present' }).eq('id', past.id).select('id')).data).toHaveLength(1);
    const later = new Date(Date.parse(past.starts_at) + HOUR).toISOString();
    const laterEnd = new Date(Date.parse(past.starts_at) + 2 * HOUR).toISOString();
    expect((await c.from('sessions').update({ starts_at: later, ends_at: laterEnd }).eq('id', past.id).select('id')).data).toHaveLength(1);
    expect((await c.from('sessions').update({ starts_at: past.starts_at, ends_at: later }).eq('id', past.id).select('id')).data).toHaveLength(1);
    const { data } = await P.admin.client.from('session_edits').select('editor, new_attendance').eq('session_id', past.id).order('id');
    expect(data).toHaveLength(3);
    expect(data.every((e) => e.editor === P.tutorA.id)).toBe(true);
  });

  test('payments: one per form, append only, and a paid month locks the tutor out', async () => {
    const month = `${new Date(past.starts_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)}-01`;
    const key = randomUUID();
    const row = { client_key: key, parent_id: P.parentA.id, period: month, amount_cents: 4500,
      lines: [{ session_id: String(past.id), student_id: P.studentA.id, amount_cents: 4500 }] };
    const first = await P.admin.client.from('payments').insert(row).select('id').single();
    expect(first.error).toBeNull();
    made.payments.push(first.data.id);
    expect((await P.admin.client.from('payments').insert(row)).error?.code).toBe('23505');
    expect((await P.admin.client.from('payments').update({ amount_cents: 1 }).eq('id', first.data.id)).error).not.toBeNull();
    expect((await P.tutorA.client.from('sessions').update({ attendance: 'absent' }).eq('id', past.id)).error?.code).toBe('VP002');
    expect((await P.tutorA.client.from('sessions').delete().eq('id', past.id)).error?.code).toBe('VP002');
    const v = await P.admin.client.from('payments').update({ voided_at: new Date().toISOString(), void_reason: 'test' }).eq('id', first.data.id).select('id');
    expect(v.data).toHaveLength(1);
    expect((await P.admin.client.from('payments').update({ voided_at: null, void_reason: null }).eq('id', first.data.id)).error).not.toBeNull();
    // voided: the month is open again, so a real change goes through
    expect((await P.tutorA.client.from('sessions').update({ attendance: 'late' }).eq('id', past.id).select('id')).data).toHaveLength(1);
  });

  test('only the admin moves the bill, in one call', async () => {
    expect((await P.parentA.client.rpc('set_payer', { p_student: P.studentA.id, p_parent: P.parentA.id })).error).not.toBeNull();
    expect((await P.admin.client.rpc('set_payer', { p_student: P.studentA.id, p_parent: P.parentA.id })).error).toBeNull();
  });

  test('a line for another family is refused', async () => {
    const { error } = await P.admin.client.from('payments').insert({
      client_key: randomUUID(), parent_id: P.parentA.id, amount_cents: 100,
      lines: [{ session_id: '1', student_id: P.studentB.id, amount_cents: 100 }],
    });
    expect(error).not.toBeNull();
  });
});
