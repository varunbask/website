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
  // The canned draft: a factoring problem set in the homework format
  // (portal/js/homework-doc.js), LaTeX math, with a worked example, practice,
  // a word problem, a challenge and a reflect section, and its answer key

  // [prompt, answer, hint, steps]; practice gets harder down the list
  const PRACTICE = [
    ['Factor $x^2 + 5x + 6$.', '$(x + 2)(x + 3)$', 'Which two numbers multiply to $6$ and add to $5$?', ['$2 \\cdot 3 = 6$ and $2 + 3 = 5$.']],
    ['Factor $x^2 + 9x + 20$.', '$(x + 4)(x + 5)$', 'List the factor pairs of $20$.', ['$4 \\cdot 5 = 20$ and $4 + 5 = 9$.']],
    ['Factor $x^2 - 2x - 15$.', '$(x - 5)(x + 3)$', 'One number is negative, because $c$ is negative.', ['$-5 \\cdot 3 = -15$ and $-5 + 3 = -2$.']],
    ['Review: solve $3x - 7 = 11$.', '$x = 6$', 'Undo the subtraction first.', ['$3x = 18$', '$x = 6$']],
    ['Factor $x^2 - 9x + 18$.', '$(x - 3)(x - 6)$', 'Both numbers are negative here.', ['$(-3)(-6) = 18$ and $-3 + (-6) = -9$.']],
    ['Factor $x^2 + x - 42$.', '$(x + 7)(x - 6)$', 'Look for factors of $42$ that are $1$ apart.', ['$7 \\cdot (-6) = -42$ and $7 - 6 = 1$.']],
    ['Factor $x^2 - 16$.', '$(x - 4)(x + 4)$', 'This is a difference of two squares.', ['$x^2 - 4^2 = (x - 4)(x + 4)$.']],
    ['Review: simplify $(2a^3)^2$.', '$4a^6$', 'Square the $2$ and double the exponent.', ['$2^2 = 4$', '$(a^3)^2 = a^6$']],
    ['Factor $x^2 - 11x + 28$.', '$(x - 4)(x - 7)$', 'Which negative pair adds to $-11$?', ['$(-4)(-7) = 28$ and $-4 + (-7) = -11$.']],
    ['Factor $x^2 + 13x + 40$.', '$(x + 5)(x + 8)$', 'List the factor pairs of $40$.', ['$5 \\cdot 8 = 40$ and $5 + 8 = 13$.']],
  ];
  const MC = ['Which is a factor of $x^2 - x - 6$?', ['$x - 2$', '$x + 2$', '$x + 3$', '$x - 6$'], '(B) $x + 2$', ['$x^2 - x - 6 = (x - 3)(x + 2)$.']];

  function cannedDraft({ count = 5, difficulty = 'same', hints = false, challenge = true } = {}) {
    const n = Math.max(1, Math.min(15, count));
    const bank = difficulty === 'harder' ? [...PRACTICE.slice(4), ...PRACTICE.slice(0, 4)] : PRACTICE;
    const practice = [];
    for (let i = 0; i < n; i += 1) practice.push(i === 1 ? null : bank[i % bank.length]);   // the second one is multiple choice
    const lines = [
      'Objective: You will be able to factor trinomials of the form $x^2 + bx + c$.',
      `Time: about ${10 + n * 3} minutes`,
      'Materials: Pencil. No calculator.',
      '',
      '## Part A: Warm-up',
      'Directions: Multiply. Write each answer in standard form.',
      '1. Multiply $(x + 2)(x + 3)$. [space: short]',
      '2. Multiply $(x - 4)(x + 1)$. [space: short]',
      '',
      '## Worked example',
      'Directions: Read each step before you start Part B.',
      'Problem: Factor $x^2 + 7x + 12$.',
      'Step 1: Find two numbers that multiply to $c = 12$ and add to $b = 7$.',
      'Step 2: They are $3$ and $4$, since $3 \\cdot 4 = 12$ and $3 + 4 = 7$.',
      'Step 3: Write each number in a factor: $(x + 3)(x + 4)$. Check by multiplying.',
      'Answer: $(x + 3)(x + 4)$',
      '',
      '## Part B: Practice',
      'Directions: Factor each trinomial. Check each answer by multiplying.',
    ];
    const key = [
      '## Part A: Warm-up',
      'A1. $x^2 + 5x + 6$',
      '   Step 1: $x \\cdot x + 3x + 2x + 6$',
      'A2. $x^2 - 3x - 4$',
      '   Step 1: $x \\cdot x + x - 4x - 4$',
      '',
      '## Part B: Practice',
    ];
    practice.forEach((p, i) => {
      if (!p) {
        lines.push(`${i + 1}. ${MC[0]} [space: none]`, `   ${MC[1].map((c, k) => `(${'ABCD'[k]}) ${c}`).join('  ')}`);
        key.push(`B${i + 1}. ${MC[2]}`, ...MC[3].map((st, k) => `   Step ${k + 1}: ${st}`));
        return;
      }
      lines.push(`${i + 1}. ${p[0]} [space: medium]`);
      if (hints) lines.push(`   Hint: ${p[2]}`);
      key.push(`B${i + 1}. ${p[1]}`, ...p[3].map((st, k) => `   Step ${k + 1}: ${st}`));
    });
    lines.push(
      '',
      '## Part C: Apply',
      'Directions: Show how you set up each problem.',
      '1. A rectangular garden has an area of $x^2 + 8x + 15$ square feet. Write expressions for its length and width, then find both when $x = 4$. [space: long]',
    );
    key.push('', '## Part C: Apply', 'C1. Length $x + 5$, width $x + 3$; when $x = 4$: $9$ feet by $7$ feet.', '   Step 1: $x^2 + 8x + 15 = (x + 5)(x + 3)$', '   Step 2: $4 + 5 = 9$ and $4 + 3 = 7$');
    let letter = 'D';
    if (challenge) {
      lines.push('', '## Part D: Challenge', 'Directions: A stretch problem. Show every step.', '1. Factor $2x^2 + 7x + 3$. [space: grid]');
      key.push('', '## Part D: Challenge', 'D1. $(2x + 1)(x + 3)$', '   Step 1: $2 \\cdot 3 = 6$; the pair $1$ and $6$ adds to $7$.', '   Step 2: $2x^2 + x + 6x + 3 = x(2x + 1) + 3(2x + 1)$');
      letter = 'E';
    }
    lines.push(
      '',
      `## Part ${letter}: Check and reflect`,
      'Directions: Answer in a sentence or two.',
      '1. Why must the two numbers multiply to $c$ and add to $b$? [space: medium]',
      '2. Which problem was hardest for you, and why? [space: short]',
    );
    key.push('', `## Part ${letter}: Check and reflect`, `${letter}1. Because $(x + m)(x + n) = x^2 + (m + n)x + mn$.`, `${letter}2. Answers vary.`);
    return {
      title: 'Factoring trinomials practice',
      details: lines.join('\n'),
      answer_key_text: key.join('\n'),
      dropped: 0,
      notice: null,
    };
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
  // A drafted problem set, saved: the structure and LaTeX the drawer and worksheet render
  const structured = cannedDraft({ count: 5, hints: true });
  const structuredTask = {
    id: h.id(), student_id: 'u-maya', created_by: 'u-daniel', kind: 'assignment', title: 'Factoring trinomials practice set',
    details: structured.details, due_at: h.dueAt(5), completed_at: null, created_at: h.ago(0.3), session_id: null, series_id: null, extended_from: null,
  };
  db.tasks.push(structuredTask);
  db.task_answer_keys.push({ task_id: structuredTask.id, body: structured.answer_key_text, updated_by: 'u-daniel', updated_at: h.ago(0.3) });

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
    count: b.count ?? 5, difficulty: b.difficulty ?? 'same', hints: Boolean(b.hints), challenge: b.challenge !== false, notes: b.notes ?? null,
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
