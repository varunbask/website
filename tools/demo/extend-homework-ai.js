/* Demo extension: homework drafted from lesson photos, and answer keys
   (api/_lib/homework-draft.js, supabase/migrations/20261026120000_homework_drafts.sql).
   Loaded by the local demo build right after demo-supabase.js.

   It adds the two tables with simplified rules:
     task_answer_keys  staff who teach the student (and the admin) read and write
     homework_drafts   the person who asked (and the admin) read; they delete
                       their own; only the "server" (this file) adds or changes rows
   and answers POST /api/grade { action: 'draft_homework' | 'draft_status' }:
     by default        a made-up draft after about 8 seconds: factoring
                       trinomials, as many problems as asked, with an answer key
     ?ai=live          both actions go to the real network on this origin, so
                       tools/demo/serve-ai.mjs answers them with the real model;
                       the drafts it makes are mirrored into the table above so
                       Recent drafts lists them
   Grading requests (submission_id) still go to the demo client as before.

   Seeded for Daniel (?as=tutor): an assignment for Maya with an answer key
   ("Factoring trinomials, set 1"), a ready draft from yesterday, and a failed
   one for Leo. For the worksheet, Maya also has "Exponents and roots
   practice", written by hand with x², √ and − in it, long enough for two
   pages (?as=student and ?as=parent see its Worksheet section).

   Try it
     ?as=tutor   Calendar: Maya's last Algebra lesson > Make homework from this lesson
                 or New assignment > Draft with AI from lesson photos
                 Open "Factoring trinomials, set 1": the answer key, collapsed, with Edit
     ?as=student the same assignment shows no answer key and no AI wording */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { db, helpers: h, notify } = window.portalDemo;
  const LIVE = new URLSearchParams(location.search).get('ai') === 'live';
  const DRAFT_DELAY_MS = 8000;
  const STALE_MS = 6 * 60_000;
  const MAX_CHARS = Math.floor(3.5 * 1024 * 1024);
  const taskOf = (id) => db.tasks.find((t) => String(t.id) === String(id));
  const teachesTask = (r) => {
    const t = taskOf(r.task_id);
    return Boolean(t) && h.canTeach(t.student_id);
  };

  // ---------------------------------------------------------------------------
  // The canned draft: factoring trinomials, like the lesson photos would show

  const BANK = [
    ['x² + 7x + 12', '(x + 3)(x + 4)', 'Find two numbers that multiply to 12 and add to 7.', '3 × 4 = 12 and 3 + 4 = 7.'],
    ['x² - 2x - 15', '(x - 5)(x + 3)', 'Find two numbers that multiply to -15 and add to -2.', '-5 × 3 = -15 and -5 + 3 = -2.'],
    ['x² + x - 20', '(x + 5)(x - 4)', 'Which pair of factors of -20 adds to 1?', '5 × -4 = -20 and 5 + (-4) = 1.'],
    ['x² - 9x + 18', '(x - 3)(x - 6)', 'Both numbers are negative, because they add to -9 and multiply to a positive.', '-3 × -6 = 18 and -3 + (-6) = -9.'],
    ['x² + 10x + 21', '(x + 3)(x + 7)', 'List the factor pairs of 21.', '3 × 7 = 21 and 3 + 7 = 10.'],
    ['x² - 4x - 32', '(x - 8)(x + 4)', 'The larger number is negative, because the middle term is negative.', '-8 × 4 = -32 and -8 + 4 = -4.'],
    ['x² + 2x - 35', '(x + 7)(x - 5)', 'Which pair of factors of 35 is 2 apart?', '7 × -5 = -35 and 7 + (-5) = 2.'],
    ['x² - 11x + 28', '(x - 4)(x - 7)', 'Look for a pair that multiplies to 28 and adds to -11.', '-4 × -7 = 28 and -4 + (-7) = -11.'],
    ['x² + 13x + 40', '(x + 5)(x + 8)', 'List the factor pairs of 40.', '5 × 8 = 40 and 5 + 8 = 13.'],
    ['x² - x - 42', '(x - 7)(x + 6)', 'Which pair of factors of 42 is 1 apart?', '-7 × 6 = -42 and -7 + 6 = -1.'],
    ['2x² + 7x + 3', '(2x + 1)(x + 3)', 'Multiply 2 × 3 = 6 and find two numbers that multiply to 6 and add to 7.', '1 and 6 work: 2x² + x + 6x + 3 = x(2x + 1) + 3(2x + 1).'],
    ['3x² - 10x + 8', '(3x - 4)(x - 2)', 'Multiply 3 × 8 = 24 and look for two negatives that add to -10.', '-4 and -6: 3x² - 6x - 4x + 8 = 3x(x - 2) - 4(x - 2).'],
    ['2x² - x - 15', '(2x + 5)(x - 3)', 'Multiply 2 × -15 = -30 and find a pair that adds to -1.', '5 and -6: 2x² + 5x - 6x - 15 = x(2x + 5) - 3(2x + 5).'],
    ['x² - 16', '(x - 4)(x + 4)', 'This is a difference of two squares.', 'x² - 16 = x² - 4², so it factors as (x - 4)(x + 4).'],
    ['x² + 6x + 9', '(x + 3)²', 'Is this a perfect square trinomial?', '3 × 3 = 9 and 3 + 3 = 6, so (x + 3)(x + 3) = (x + 3)².'],
  ];

  function cannedDraft({ count = 5, difficulty = 'same', hints = false } = {}) {
    const order = difficulty === 'harder' ? [...BANK.slice(10), ...BANK.slice(0, 10)]
      : difficulty === 'easier' ? [BANK[0], BANK[4], BANK[8], BANK[14], ...BANK.slice(1, 4), ...BANK.slice(5, 8), ...BANK.slice(9, 14)]
        : BANK;
    const picked = order.slice(0, Math.max(1, Math.min(15, count)));
    const instructions = 'Factor each expression completely. For each one, write the two numbers you used before you write the factors.';
    const problems = picked.map(([expr, , hint]) => ({ prompt: `Factor ${expr}.`, hint: hints ? hint : null }));
    const answerKey = picked.map(([expr, answer, , why]) => ({ answer: `${expr} = ${answer}`, explanation: why }));
    const indent = (text) => text.split('\n').join('\n   ');
    const details = [instructions, ...problems.map((p, i) => `${i + 1}. ${indent(p.prompt)}${p.hint ? `\n   Hint: ${indent(p.hint)}` : ''}`)].join('\n\n');
    const answerText = answerKey.map((a, i) => `${i + 1}. ${a.answer}\n   ${a.explanation}`).join('\n\n');
    return { title: 'Factoring trinomials practice', instructions, problems, answer_key: answerKey, details, answer_key_text: answerText };
  }

  // ---------------------------------------------------------------------------
  // Tables and sample rows

  window.portalDemo.extend({
    tables: {
      task_answer_keys: {
        keys: ['task_id'],
        read: teachesTask,
        insert: teachesTask,
        write: (r) => {
          if (!teachesTask(r)) return false;
          r.updated_by = h.meId;
          r.updated_at = new Date().toISOString();
          return true;
        },
        defaults: () => ({ updated_by: h.meId, updated_at: new Date().toISOString() }),
      },
      homework_drafts: {
        read: (r) => r.created_by === h.meId || h.adminOnly(),
        insert: () => false,
        // The portal only deletes its own; the server makes every other change
        write: (r) => r.created_by === h.meId,
      },
    },
  });

  const keyed = {
    id: h.id(), student_id: 'u-maya', created_by: 'u-daniel', kind: 'assignment', title: 'Factoring trinomials, set 1',
    details: 'Factor each expression completely.\n\n1. Factor x² + 5x + 6.\n\n2. Factor x² - 3x - 10.\n\n3. Factor x² - 8x + 15.',
    due_at: h.dueAt(2), completed_at: null, created_at: h.ago(1), session_id: null, series_id: null, extended_from: null,
  };
  db.tasks.push(keyed);
  db.task_answer_keys.push({
    task_id: keyed.id,
    body: '1. (x + 2)(x + 3)\n   2 × 3 = 6 and 2 + 3 = 5.\n\n2. (x - 5)(x + 2)\n   -5 × 2 = -10 and -5 + 2 = -3.\n\n3. (x - 3)(x - 5)\n   -3 × -5 = 15 and -3 + (-5) = -8.',
    updated_by: 'u-daniel', updated_at: h.ago(1),
  });
  // A hand-written assignment for the worksheet: numbered, with unicode math and a hint
  db.tasks.push({
    id: h.id(), student_id: 'u-maya', created_by: 'u-daniel', kind: 'assignment', title: 'Exponents and roots practice',
    details: [
      'Simplify each expression. Show every step, and box your final answer.',
      '',
      '1. Simplify x² · x³.',
      '',
      '2. Simplify (2a³)².',
      '',
      '3. Find √49 + √16.',
      '',
      '4. Solve 3x − 7 = 11.',
      '',
      '5. Evaluate (−3)² − 4.',
      '   Hint: square first, then subtract.',
      '',
      '6. Write 0.000045 in scientific notation.',
      '',
      '7. Simplify √(x²) when x ≥ 0.',
    ].join('\n'),
    due_at: h.dueAt(4), completed_at: null, created_at: h.ago(0.5), session_id: null, series_id: null, extended_from: null,
  });

  db.homework_drafts.push(
    {
      id: h.id(), created_by: 'u-daniel', student_id: 'u-maya', status: 'ready',
      options: { count: 5, difficulty: 'same', hints: false, notes: null, subject: 'Algebra', grade: '9th grade', photos: 2 },
      result: cannedDraft({ count: 5 }), error: null, created_at: h.ago(1, '17:10'), finished_at: h.ago(1, '17:11'),
    },
    {
      id: h.id(), created_by: 'u-daniel', student_id: 'u-leo', status: 'failed',
      options: { count: 6, difficulty: 'easier', hints: true, notes: null, subject: 'Math', grade: null, photos: 1 },
      result: null, error: 'No homework was drafted. The photo is too blurry to read.', created_at: h.ago(2, '18:40'), finished_at: h.ago(2, '18:41'),
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/grade, the two draft actions

  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const view = (row) => {
    let { status, error } = row;
    if (status === 'drafting' && Date.now() - Date.parse(row.created_at) > STALE_MS) {
      Object.assign(row, { status: 'failed', error: 'This draft took too long. Try again.', finished_at: new Date().toISOString() });
      ({ status, error } = row);
    }
    return {
      id: row.id, status, student_id: row.student_id, options: row.options, created_at: row.created_at, finished_at: row.finished_at,
      ...(status === 'ready' ? { result: row.result } : {}),
      ...(status === 'failed' ? { error } : {}),
    };
  };
  const optionsOf = (b) => ({
    count: b.count ?? 5, difficulty: b.difficulty ?? 'same', hints: Boolean(b.hints), notes: b.notes ?? null,
    subject: b.subject ?? null, grade: b.grade ?? null, photos: Array.isArray(b.images) ? b.images.length : 0,
  });

  function cannedStart(b) {
    if (!h.meId) return reply(401, { error: 'Sign in again.' });
    if (!h.isStaff()) return reply(403, { error: 'Only tutors and admins can draft homework.' });
    const images = Array.isArray(b.images) ? b.images : [];
    if (images.length < 1 || images.length > 6) return reply(400, { error: 'Add 1 to 6 photos of the lesson.' });
    if (!images.every((x) => typeof x === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(x))) return reply(400, { error: 'Each photo must be a JPG, PNG or WebP image.' });
    if (images.reduce((t, x) => t + x.length - x.indexOf(',') - 1, 0) > MAX_CHARS) return reply(400, { error: 'These photos are too large together. Remove one or use smaller photos.' });
    if (!Number.isInteger(b.count) || b.count < 1 || b.count > 15) return reply(400, { error: 'Choose 1 to 15 problems.' });
    if (b.student_id && !h.canTeach(b.student_id)) return reply(403, { error: 'You can draft homework only for your own students.' });
    const day = Date.now() - 86_400_000;
    if (db.homework_drafts.filter((r) => r.created_by === h.meId && Date.parse(r.created_at) >= day).length >= 30) {
      return reply(429, { error: 'You have made 30 drafts in the last day. Try again tomorrow.' });
    }
    const row = {
      id: h.id(), created_by: h.meId, student_id: b.student_id ?? null, status: 'drafting', options: optionsOf(b),
      result: null, error: null, created_at: new Date().toISOString(), finished_at: null,
    };
    db.homework_drafts.push(row);
    setTimeout(() => {
      if (row.status !== 'drafting') return;
      Object.assign(row, { status: 'ready', result: cannedDraft(row.options), finished_at: new Date().toISOString() });
      notify();
    }, DRAFT_DELAY_MS);
    notify();
    return reply(202, { id: row.id, status: 'drafting', created_at: row.created_at });
  }

  function cannedStatus(b) {
    if (!h.meId) return reply(401, { error: 'Sign in again.' });
    const row = db.homework_drafts.find((r) => r.id === b.id);
    if (!row || !(row.created_by === h.meId || h.adminOnly())) return reply(404, { error: 'Draft not found.' });
    return reply(200, view(row));
  }

  // ?ai=live: the real network on this origin (the demo client answers every
  // /api call itself, so this goes around it with XMLHttpRequest)
  function network(url, init) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      for (const [name, value] of Object.entries(init.headers ?? {})) xhr.setRequestHeader(name, value);
      xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status || 502, headers: { 'Content-Type': 'application/json' } }));
      xhr.onerror = () => resolve(reply(502, { error: 'The local AI server did not answer. Is tools/demo/serve-ai.mjs running?' }));
      xhr.send(init.body ?? null);
    });
  }

  // Keeps Recent drafts (read from the demo table) in step with the live server
  async function mirror(b, res) {
    let data = null;
    try { data = await res.clone().json(); } catch (e) { return; }
    if (b.action === 'draft_homework' && res.status === 202 && data?.id) {
      db.homework_drafts = db.homework_drafts.filter((r) => r.id !== data.id);
      db.homework_drafts.push({
        id: data.id, created_by: h.meId, student_id: b.student_id ?? null, status: 'drafting', options: optionsOf(b),
        result: null, error: null, created_at: data.created_at ?? new Date().toISOString(), finished_at: null,
      });
    }
    if (b.action === 'draft_status' && res.status === 200 && data?.id) {
      const row = db.homework_drafts.find((r) => r.id === data.id);
      if (row) Object.assign(row, { status: data.status, result: data.result ?? null, error: data.error ?? null, finished_at: data.finished_at ?? null });
    }
  }

  const demoFetch = window.fetch;
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/grade' || String(init.method ?? 'GET').toUpperCase() !== 'POST') {
      return demoFetch(input, init);
    }
    let b = {};
    try { b = JSON.parse(init.body ?? '{}'); } catch (e) { b = {}; }
    if (b.action !== 'draft_homework' && b.action !== 'draft_status') return demoFetch(input, init);
    if (LIVE) {
      const res = await network(url.href, init);
      await mirror(b, res);
      return res;
    }
    await sleep(150);
    return b.action === 'draft_homework' ? cannedStart(b) : cannedStatus(b);
  };
})();
