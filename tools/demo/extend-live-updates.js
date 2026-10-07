/* Demo extension: live updates (portal/js/live.js, supabase/migrations/20261020120000_realtime.sql).
   Loaded by the local demo build right after demo-supabase.js. The demo client
   has no Realtime, so this gives it a stand-in for the part the portal uses:

     sb.channel(name).on('postgres_changes', { event, schema, table }, handler).subscribe(callback)
     sb.removeChannel(channel)

   Every write the demo makes (the page's own, a grader finishing, the checks
   below) is compared with the data as it was, and each row that changed is
   handed to the handlers that listen to that table, a moment later, the way
   the real service would:
     - an INSERT or UPDATE only reaches someone whose read rules show them the row
     - a DELETE reaches everyone who listens to the table and carries only the
       primary key (the old row is not sent)

   For checks, in the console or a driver:
     portalDemo.simulateChange('sessions', { id: 12, attendance: 'present' })
         another person's edit: merges the row into the demo data (adds it when
         there is none) and reports it. { type: 'DELETE' } as a third argument
         removes it.
     portalDemo.realtime.status('CHANNEL_ERROR')
         tells every open channel its state ('SUBSCRIBED', 'TIMED_OUT', 'CLOSED',
         'CHANNEL_ERROR'), to try the reconnect
     portalDemo.realtime.channels()
         names and tables of the channels now subscribed

   Where the demo differs from Supabase: messages are never lost or reordered,
   a channel is always accepted (the real one is refused when a table is not in
   the publication), and the update's old row is empty. */
(function () {
  'use strict';
  if (!window.portalDemo || !window.supabase) return;
  const demo = window.portalDemo;
  const sb = window.supabase.createClient();
  const { db } = demo;

  // Primary keys where the table is not keyed by id
  const KEYS = {
    tutor_students: ['tutor_id', 'student_id'],
    parent_students: ['parent_id', 'student_id'],
    grades: ['submission_id'],
    session_billing: ['session_id'],
    billing_contacts: ['parent_id'],
    statements: ['parent_id', 'period'],
    student_profiles: ['student_id'],
  };
  const keyFields = (table) => KEYS[table] ?? ['id'];
  const keyOf = (table, row) => {
    const parts = keyFields(table).map((k) => row[k]);
    return parts.every((p) => p === undefined) ? JSON.stringify(row) : parts.join('|');
  };
  const keyColumns = (table, row) => Object.fromEntries(keyFields(table).filter((k) => k in row).map((k) => [k, row[k]]));

  const channels = new Set();
  let snapshot = null;

  // table -> Map(key -> row as JSON), the data as the last report left it
  function take() {
    const out = new Map();
    for (const [table, rows] of Object.entries(db)) {
      if (!Array.isArray(rows)) continue;
      out.set(table, new Map(rows.map((r) => [keyOf(table, r), JSON.stringify(r)])));
    }
    return out;
  }

  // The rows this person may read in a table (the demo's own read rules)
  function readable(table) {
    try {
      return new Set(sb.from(table).rows());
    } catch (e) {
      return new Set();
    }
  }

  function deliver(table, eventType, row, oldRow) {
    const payload = {
      schema: 'public',
      table,
      commit_timestamp: new Date().toISOString(),
      eventType,
      new: eventType === 'DELETE' ? {} : { ...row },
      old: oldRow,
      errors: null,
    };
    for (const ch of channels) {
      for (const b of ch.bindings) {
        const f = b.filter ?? {};
        if (f.table !== table || (f.schema && f.schema !== 'public')) continue;
        if (f.event && f.event !== '*' && f.event !== eventType) continue;
        setTimeout(() => {
          if (!channels.has(ch)) return;
          try {
            b.handler(payload);
          } catch (e) { console.error(e); }
        }, 40);
      }
    }
  }

  // Compares the data with the last report and sends one message per changed row
  function report() {
    if (!snapshot) return;
    const before = snapshot;
    snapshot = take();
    const listened = new Set([...channels].flatMap((ch) => ch.bindings.map((b) => b.filter?.table)));
    for (const table of listened) {
      const now = snapshot.get(table) ?? new Map();
      const was = before.get(table) ?? new Map();
      const rows = db[table] ?? [];
      const visible = readable(table);
      for (const row of rows) {
        const key = keyOf(table, row);
        if (!was.has(key)) {
          if (visible.has(row)) deliver(table, 'INSERT', row, {});
        } else if (was.get(key) !== now.get(key) && visible.has(row)) {
          deliver(table, 'UPDATE', row, keyColumns(table, row));
        }
      }
      for (const [key, json] of was) {
        if (!now.has(key)) deliver(table, 'DELETE', {}, keyColumns(table, JSON.parse(json)));
      }
    }
  }

  demo.onChange(report);

  sb.channel = (name) => {
    const ch = {
      name,
      bindings: [],
      callback: null,
      on(type, filter, handler) {
        if (type === 'postgres_changes') ch.bindings.push({ filter, handler });
        return ch;
      },
      subscribe(callback) {
        if (!snapshot) snapshot = take();
        ch.callback = callback;
        channels.add(ch);
        setTimeout(() => { if (channels.has(ch)) callback?.('SUBSCRIBED'); }, 30);
        return ch;
      },
      unsubscribe() {
        channels.delete(ch);
        return Promise.resolve('ok');
      },
    };
    return ch;
  };
  sb.removeChannel = (ch) => {
    channels.delete(ch);
    return Promise.resolve('ok');
  };

  demo.realtime = {
    channels: () => [...channels].map((ch) => ({ name: ch.name, tables: ch.bindings.map((b) => b.filter?.table) })),
    status: (state) => { for (const ch of [...channels]) ch.callback?.(state); },
  };

  // Another person's change: merged into the data, then reported like any write
  demo.simulateChange = (table, row, { type } = {}) => {
    if (!snapshot) snapshot = take();
    if (!Array.isArray(db[table])) db[table] = [];
    const fields = keyFields(table);
    const match = db[table].find((r) => fields.every((k) => String(r[k]) === String(row[k])));
    if (type === 'DELETE') {
      if (match) db[table] = db[table].filter((r) => r !== match);
    } else if (match) {
      Object.assign(match, row);
      if (table === 'sessions') match.updated_at = new Date().toISOString();
    } else {
      db[table].push({ id: demo.helpers.id(), ...row });
    }
    demo.notify();
  };
}());
