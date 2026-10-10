/* Demo extension: the SAT tab (#/sat). Loaded by the local demo build right
   after demo-supabase.js. Adds the SAT tables with their access rules, the
   RPCs (sat_start, sat_answer, sat_submit, sat_review, sat_release_item,
   sat_held_items) and the private sat-files bucket.

   Every question, guide and PDF here is made up for the demo. The real SAT
   material is loaded into Supabase by the content loader and never goes in git.

   Try it
     student.html?as=student#/sat                   Maya: SAT is on, with some history
     student.html?as=student#/sat/learn/alg-linear-equations-one-variable
     student.html?as=student#/sat/practice/alg-ch1  practice: mc, grid-in, a table, a held question
     student.html?as=student#/sat/practice/geo-area-ch1   a figure
     student.html?as=student#/sat/test/alg-t1       a 3 question skill test, 2 minutes
     student.html?as=student#/sat/test/full-01      a tiny full test: four 2 minute modules
     student.html?as=student2#/sat                  Leo: SAT is not turned on
     staff.html?as=admin&student=u-maya#/sat        the access switch, attempts, held questions
     staff.html?as=tutor&student=u-maya#/sat        Daniel: read-only

   The real content, locally (never in git): build with
     node tools/demo/build.mjs <folder outside the repo> --sat-content <bundle>
   and the converter's content.json, figures and lesson PDFs replace the
   sample (see the end of this file). Other PDFs open a placeholder.

   Where the demo differs from the database: scoring and the rules are a copy
   in plain JavaScript, items come back with every column (the portal never
   asks for the staff-only ones), and the PDFs and the figure are drawn here. */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { db, helpers: hp } = window.portalDemo;
  // The real converted content, when the build was given --sat-content
  const local = window.portalDemoSatLocal ?? null;
  let ready = null;

  // ---------------------------------------------------------------------------
  // Building SAT documents

  const t = (x, ...m) => (m.length ? { x, m } : { x });
  const tex = (s) => ({ tex: s });
  const blank = { blank: true };
  const p = (...c) => ({ t: 'p', c });
  const doc = (...blocks) => ({ v: 1, blocks });
  const para = (...c) => doc(p(...c));
  const choices = (...list) => list.map((c) => (typeof c === 'string' ? para(t(c)) : para(c)));

  // ---------------------------------------------------------------------------
  // Content

  const skills = [
    ['central-ideas-and-details', 'information-and-ideas', 'Central Ideas and Details', 1],
    ['command-of-evidence', 'information-and-ideas', 'Command of Evidence', 2],
    ['words-in-context', 'craft-and-structure', 'Words in Context', 1],
    ['cross-text-connections', 'craft-and-structure', 'Cross-Text Connections', 2],
    ['transitions', 'expression-of-ideas', 'Transitions', 1],
    ['boundaries', 'standard-english-conventions', 'Boundaries', 1],
    ['form-structure-and-sense', 'standard-english-conventions', 'Form, Structure, and Sense', 2],
    ['alg-linear-equations-one-variable', 'algebra', 'Linear Equations in One Variable', 1],
    ['alg-linear-functions', 'algebra', 'Linear Functions', 2],
    ['nonlinear-functions', 'advanced-math', 'Nonlinear Functions', 1],
    ['ratios-rates-proportions-units', 'problem-solving-and-data-analysis', 'Ratios, Rates, Proportional Relationships, and Units', 1],
    ['area-and-volume', 'geometry-and-trigonometry', 'Area and Volume', 1],
    ['lines-angles-triangles', 'geometry-and-trigonometry', 'Lines, Angles, and Triangles', 2],
  ].map(([slug, domain, name, position]) => ({ slug, domain, name, position }));

  const sets = [
    { id: 'rw-words-ch1', kind: 'practice', domain: 'craft-and-structure', skill: 'words-in-context', title: 'Words in Context', position: 1, modules: [], origin: 'matthew' },
    { id: 'rw-words-sb1', kind: 'practice', domain: 'craft-and-structure', skill: 'words-in-context', title: 'Words in Context: Skill Builder', position: 2, modules: [], origin: 'vp' },
    { id: 'sec-boundaries-ch1', kind: 'practice', domain: 'standard-english-conventions', skill: 'boundaries', title: 'Boundaries', position: 1, modules: [], origin: 'matthew' },
    { id: 'alg-ch1', kind: 'practice', domain: 'algebra', skill: 'alg-linear-equations-one-variable', title: 'Linear Equations in One Variable', position: 1, modules: [], origin: 'matthew' },
    { id: 'alg-sb1', kind: 'practice', domain: 'algebra', skill: 'alg-linear-equations-one-variable', title: 'Linear Equations: Skill Builder', position: 2, modules: [], origin: 'vp' },
    { id: 'geo-area-ch1', kind: 'practice', domain: 'geometry-and-trigonometry', skill: 'area-and-volume', title: 'Area and Volume', position: 1, modules: [], origin: 'matthew' },
    { id: 'alg-t1', kind: 'skill_test', domain: 'algebra', skill: null, title: 'Algebra Test 1', position: 1, modules: [{ key: 'm', title: 'Algebra', minutes: 2 }], origin: 'matthew' },
    {
      id: 'full-01', kind: 'full_test', domain: null, skill: null, title: 'Full Practice Test 1', position: 1, origin: 'matthew',
      modules: [
        { key: 'rw1', title: 'Reading and Writing, Module 1', minutes: 2 },
        { key: 'rw2', title: 'Reading and Writing, Module 2', minutes: 2 },
        { key: 'm1', title: 'Math, Module 1', minutes: 2 },
        { key: 'm2', title: 'Math, Module 2', minutes: 2 },
      ],
    },
  ];

  const items = [];
  const keys = [];
  const holds = new Map();   // item id -> { hold_reason, review_note } (staff only, as in the database)
  function item(setId, module, position, { domain, skill, difficulty = 'medium', kind = 'mc', passage = null, stem, choices: ch = null, answer, accept = [], explanation, held = null }) {
    const id = `${setId}-${module ? `${module}-` : ''}${String(position).padStart(2, '0')}`;
    items.push({ id, set_id: setId, module, position, domain, skill, difficulty, kind, passage, stem, choices: kind === 'mc' ? ch : null, held: Boolean(held) });
    keys.push({ item_id: id, answer, accept, explanation });
    if (held) holds.set(id, held);
    return id;
  }
  const CHOOSE_WORD = para(t('Which choice completes the text with the most logical and precise word or phrase?'));
  const CONVENTIONS = para(t('Which choice completes the text so that it conforms to the conventions of Standard English?'));

  // Words in Context (guide practice)
  const wic = { domain: 'craft-and-structure', skill: 'words-in-context' };
  item('rw-words-ch1', null, 1, {
    ...wic, difficulty: 'easy',
    passage: para(t('The beekeeper Lena Ortiz noticed that her hives grew calmer when she visited them at dawn. Rather than disturbing the colonies, her early visits seemed to '), blank, t(' the bees, which returned to their work within minutes.')),
    stem: CHOOSE_WORD,
    choices: choices('agitate', 'reassure', 'multiply', 'relocate'),
    answer: 'B',
    explanation: doc(p(t('The text says the hives grew calmer and the bees went back to work quickly, so the visits must have '), t('reassured', 'i'), t(' them.')), p(t('Agitate means the opposite, and multiply and relocate do not describe calmer bees.'))),
  });
  item('rw-words-ch1', null, 2, {
    ...wic, difficulty: 'medium',
    passage: para(t('Architect Sun-Hee Park designs libraries with tall, narrow windows. She argues that the light they let in is '), blank, t(': bright enough to read by at midday, yet soft enough that no reader is dazzled by glare.')),
    stem: CHOOSE_WORD,
    choices: choices('balanced', 'fleeting', 'artificial', 'scarce'),
    answer: 'A',
    explanation: para(t('The light is bright enough but also soft enough: it is '), t('balanced', 'i'), t(' between two extremes. Nothing in the text says it is brief, made by people or hard to find.')),
  });
  item('rw-words-ch1', null, 3, {
    domain: 'craft-and-structure', skill: 'cross-text-connections', difficulty: 'hard',
    passage: doc(
      { t: 'passage', label: 'Text 1', blocks: [p(t('Some historians describe the town’s 1890s rail station as a purely practical building, designed only to move freight quickly.'))] },
      { t: 'passage', label: 'Text 2', blocks: [p(t('Records kept by the station’s first manager show that he ordered decorative tiles and a clock tower so that travelers would see the town as prosperous.'))] },
    ),
    stem: para(t('Based on the texts, how would the author of Text 2 most likely respond to the historians described in Text 1?')),
    choices: choices(
      'By agreeing that the station was designed mainly to move freight',
      'By noting that the station was also meant to shape how visitors saw the town',
      'By arguing that the station manager kept unreliable records',
      'By claiming that the station rarely carried any freight',
    ),
    answer: 'B',
    explanation: para(t('Text 2 shows the manager chose tiles and a clock tower to impress travelers, so the station was not '), t('purely', 'i'), t(' practical. It does not deny that freight moved through it.')),
  });
  // Words in Context (Skill Builder)
  item('rw-words-sb1', null, 1, {
    ...wic, difficulty: 'easy',
    passage: para(t('After weeks of rain, the hikers were '), blank, t(' to see the sun again, and several of them cheered when it finally appeared over the ridge.')),
    stem: CHOOSE_WORD,
    choices: choices('indifferent', 'relieved', 'reluctant', 'confused'),
    answer: 'B',
    explanation: para(t('Cheering at the sun after weeks of rain shows the hikers were '), t('relieved', 'i'), t('.')),
  });
  item('rw-words-sb1', null, 2, {
    ...wic, difficulty: 'medium',
    passage: para(t('The chef’s new menu was intentionally '), blank, t(': each dish used only three or four ingredients, so diners could taste every one of them.')),
    stem: CHOOSE_WORD,
    choices: choices('elaborate', 'minimal', 'expensive', 'unpredictable'),
    answer: 'B',
    explanation: para(t('Dishes with only a few ingredients are '), t('minimal', 'i'), t('. Elaborate means the opposite.')),
  });

  // Boundaries (with an underlined portion, as Standard English Conventions marks it)
  const bnd = { domain: 'standard-english-conventions', skill: 'boundaries' };
  item('sec-boundaries-ch1', null, 1, {
    ...bnd, difficulty: 'medium',
    passage: para(t('The robotics team spent three weeks testing its new arm '), blank, t(' the final version could lift twice as much as the first prototype.')),
    stem: CONVENTIONS,
    choices: choices('design, and', 'design and,', 'design and', 'design, and,'),
    answer: 'A',
    explanation: para(t('Two complete sentences joined by '), t('and', 'i'), t(' need a comma before the conjunction and nothing after it.')),
  });
  item('sec-boundaries-ch1', null, 2, {
    domain: 'standard-english-conventions', skill: 'form-structure-and-sense', difficulty: 'easy',
    passage: para(t('In the spring, the members of the city choir '), t('decides', 'u'), t(' which local composers to feature at the summer concert.')),
    stem: para(t('Which choice should replace the underlined word so that the text conforms to the conventions of Standard English?')),
    choices: choices('decide', 'decides', 'has decided', 'is deciding'),
    answer: 'A',
    explanation: para(t('The subject is '), t('members', 'i'), t(', which is plural, so the verb is '), t('decide', 'i'), t('.')),
  });

  // Linear equations (guide practice): mc, grid-in, a table, and one held back
  const lin = { domain: 'algebra', skill: 'alg-linear-equations-one-variable' };
  item('alg-ch1', null, 1, {
    ...lin, difficulty: 'easy',
    stem: para(t('If '), tex('3x + 7 = 22'), t(', what is the value of '), tex('x'), t('?')),
    choices: choices('3', '5', '7', '15'),
    answer: 'B',
    explanation: doc(p(t('Subtract 7 from both sides: '), tex('3x = 15'), t('. Divide both sides by 3: '), tex('x = 5'), t('.'))),
  });
  item('alg-ch1', null, 2, {
    ...lin, difficulty: 'medium', kind: 'spr',
    stem: para(t('What value of '), tex('x'), t(' satisfies the equation '), tex('2(x - 1) = 5'), t('?')),
    answer: '7/2', accept: ['3.5'],
    explanation: doc(p(t('Distribute: '), tex('2x - 2 = 5'), t('. Add 2: '), tex('2x = 7'), t('. Divide by 2:')), { t: 'math', tex: 'x = \\frac{7}{2} = 3.5' }, p(t('Either 7/2 or 3.5 is correct.'))),
  });
  item('alg-ch1', null, 3, {
    domain: 'algebra', skill: 'alg-linear-functions', difficulty: 'medium',
    stem: doc(
      p(t('The table shows the cost '), tex('C'), t(', in dollars, of renting a kayak for '), tex('h'), t(' hours.')),
      { t: 'table', head: true, rows: [[[tex('h')], [tex('C')]], [[t('1')], [t('18')]], [[t('2')], [t('26')]], [[t('3')], [t('34')]]] },
      p(t('Which equation gives '), tex('C'), t(' in terms of '), tex('h'), t('?')),
    ),
    choices: [para(tex('C = 8h + 10')), para(tex('C = 10h + 8')), para(tex('C = 18h')), para(tex('C = 8h + 18'))],
    answer: 'A',
    explanation: para(t('Each extra hour adds 8 dollars, so the slope is 8. At '), tex('h = 1'), t(', '), tex('8(1) + 10 = 18'), t(', which matches the table.')),
  });
  item('alg-ch1', null, 4, {
    ...lin, difficulty: 'hard', kind: 'spr',
    stem: para(t('A number is tripled and then decreased by 4. The result is 2 more than the number. What is the number?')),
    answer: '3',
    explanation: para(t('Write '), tex('3n - 4 = n + 2'), t('. Then '), tex('2n = 6'), t(', so '), tex('n = 3'), t('.')),
  });
  item('alg-ch1', null, 5, {
    ...lin, difficulty: 'hard',
    stem: para(t('If '), tex('5x - 3 = 2x + 9'), t(', what is the value of '), tex('2x'), t('?')),
    choices: choices('4', '8', '8', '12'),
    answer: 'B',
    explanation: para(t('Solve: '), tex('3x = 12'), t(', so '), tex('x = 4'), t(' and '), tex('2x = 8'), t('.')),
    held: { hold_reason: 'Choices B and C are the same number.', review_note: 'Change C to 16.' },
  });

  // Linear equations (Skill Builder)
  item('alg-sb1', null, 1, {
    ...lin, difficulty: 'easy',
    stem: para(t('What is the solution to '), tex('\\frac{x}{4} = 3'), t('?')),
    choices: [para(tex('\\frac{3}{4}')), para(t('7')), para(t('12')), para(t('16'))],
    answer: 'C',
    explanation: para(t('Multiply both sides by 4: '), tex('x = 12'), t('.')),
  });
  item('alg-sb1', null, 2, {
    ...lin, difficulty: 'medium', kind: 'spr',
    stem: para(t('If '), tex('5 - 2x = -9'), t(', what is the value of '), tex('x'), t('?')),
    answer: '7',
    explanation: para(t('Subtract 5: '), tex('-2x = -14'), t('. Divide by '), tex('-2'), t(': '), tex('x = 7'), t('.')),
  });
  item('alg-sb1', null, 3, {
    ...lin, difficulty: 'medium',
    stem: para(t('What value of '), tex('x'), t(' satisfies '), tex('4(x + 3) = 2x + 20'), t('?')),
    choices: choices('2', '4', '8', '16'),
    answer: 'B',
    explanation: para(t('Distribute: '), tex('4x + 12 = 2x + 20'), t('. Then '), tex('2x = 8'), t(', so '), tex('x = 4'), t('.')),
  });

  // Area and volume: a figure
  const area = { domain: 'geometry-and-trigonometry', skill: 'area-and-volume' };
  item('geo-area-ch1', null, 1, {
    ...area, difficulty: 'easy',
    stem: doc(
      { t: 'img', src: 'figures/geo-area-ch1-01.png', w: 240, h: 150, alt: 'A rectangle labeled 8 centimeters along the bottom and 5 centimeters along the side.' },
      p(t('What is the area, in square centimeters, of the rectangle shown?')),
    ),
    choices: choices('13', '26', '40', '80'),
    answer: 'C',
    explanation: para(t('Area is length times width: '), tex('8 \\times 5 = 40'), t(' square centimeters. 26 is the perimeter.')),
  });
  item('geo-area-ch1', null, 2, {
    ...area, difficulty: 'medium', kind: 'spr',
    stem: para(t('A cube has a volume of 64 cubic inches. What is the length, in inches, of one edge of the cube?')),
    answer: '4',
    explanation: para(t('The volume of a cube is '), tex('s^3'), t('. Since '), tex('4^3 = 64'), t(', each edge is 4 inches.')),
  });

  // Algebra Test 1 (one 2 minute module)
  item('alg-t1', 'm', 1, {
    ...lin, difficulty: 'easy',
    stem: para(t('If '), tex('x + 9 = 4'), t(', what is the value of '), tex('x'), t('?')),
    choices: choices('-13', '-5', '5', '13'), answer: 'B',
    explanation: para(t('Subtract 9 from both sides: '), tex('x = -5'), t('.')),
  });
  item('alg-t1', 'm', 2, {
    ...lin, difficulty: 'medium', kind: 'spr',
    stem: para(t('What is the solution to '), tex('6x = 9'), t('?')),
    answer: '3/2', accept: ['1.5'],
    explanation: para(t('Divide by 6: '), tex('x = \\frac{9}{6} = \\frac{3}{2}'), t(', which is 1.5.')),
  });
  item('alg-t1', 'm', 3, {
    ...lin, difficulty: 'medium',
    stem: para(t('Which value of '), tex('y'), t(' satisfies '), tex('2y - 3 = y + 4'), t('?')),
    choices: choices('1', '3.5', '7', '-7'), answer: 'C',
    explanation: para(t('Subtract '), tex('y'), t(' and add 3: '), tex('y = 7'), t('.')),
  });

  // Full Practice Test 1: four tiny modules
  item('full-01', 'rw1', 1, {
    ...wic, difficulty: 'easy',
    passage: para(t('Each spring the river near the village rises, and farmers have learned to plant only after the water '), blank, t(', leaving rich soil behind.')),
    stem: CHOOSE_WORD, choices: choices('recedes', 'freezes', 'stagnates', 'overflows'), answer: 'A',
    explanation: para(t('The water must go down to leave soil behind: it '), t('recedes', 'i'), t('.')),
  });
  item('full-01', 'rw1', 2, {
    domain: 'expression-of-ideas', skill: 'transitions', difficulty: 'medium',
    passage: para(t('The museum closed for repairs in March. '), blank, t(' it reopened in June with two new galleries.')),
    stem: para(t('Which choice completes the text with the most logical transition?')),
    choices: choices('Similarly,', 'For example,', 'Afterward,', 'In contrast,'), answer: 'C',
    explanation: para(t('The reopening comes later in time than the closing, so '), t('Afterward', 'i'), t(' fits.')),
  });
  item('full-01', 'rw2', 1, {
    domain: 'information-and-ideas', skill: 'central-ideas-and-details', difficulty: 'medium',
    passage: para(t('Marine biologist Amara Diallo tracked sea turtles for a decade. She found that the turtles returned to the same nesting beaches year after year, even when nearby beaches were warmer.')),
    stem: para(t('Which choice best states the main idea of the text?')),
    choices: choices('Sea turtles prefer the warmest beaches.', 'Sea turtles tend to return to the same nesting beaches.', 'Diallo studied sea turtles for one season.', 'Nesting beaches are becoming warmer.'),
    answer: 'B',
    explanation: para(t('The text is about turtles returning to the same beaches year after year.')),
  });
  item('full-01', 'rw2', 2, {
    ...bnd, difficulty: 'medium',
    passage: para(t('Our class planted twelve trees last '), blank, t(' all of them survived the winter.')),
    stem: CONVENTIONS, choices: choices('fall, and', 'fall and,', 'fall, and,', 'fall and'), answer: 'A',
    explanation: para(t('A comma goes before '), t('and', 'i'), t(' when it joins two complete sentences.')),
  });
  item('full-01', 'm1', 1, {
    ...lin, difficulty: 'easy',
    stem: para(t('If '), tex('2x = 18'), t(', what is the value of '), tex('x + 1'), t('?')),
    choices: choices('8', '9', '10', '19'), answer: 'C',
    explanation: para(tex('x = 9'), t(', so '), tex('x + 1 = 10'), t('.')),
  });
  item('full-01', 'm1', 2, {
    domain: 'problem-solving-and-data-analysis', skill: 'ratios-rates-proportions-units', difficulty: 'medium', kind: 'spr',
    stem: para(t('A recipe uses 3 cups of flour for every 2 cups of sugar. How many cups of flour are needed for 8 cups of sugar?')),
    answer: '12',
    explanation: para(t('8 cups of sugar is 4 times 2 cups, so use '), tex('4 \\times 3 = 12'), t(' cups of flour.')),
  });
  item('full-01', 'm2', 1, {
    domain: 'advanced-math', skill: 'nonlinear-functions', difficulty: 'medium',
    stem: para(t('If '), tex('f(x) = x^2 - 4'), t(', what is the value of '), tex('f(3)'), t('?')),
    choices: choices('-1', '5', '9', '13'), answer: 'B',
    explanation: para(tex('f(3) = 3^2 - 4 = 5'), t('.')),
  });
  item('full-01', 'm2', 2, {
    domain: 'geometry-and-trigonometry', skill: 'lines-angles-triangles', difficulty: 'easy', kind: 'spr',
    stem: para(t('Two angles of a triangle measure 50 degrees and 60 degrees. What is the measure, in degrees, of the third angle?')),
    answer: '70',
    explanation: para(t('The angles of a triangle add to 180 degrees: '), tex('180 - 50 - 60 = 70'), t('.')),
  });

  const guides = [
    {
      skill: 'alg-linear-equations-one-variable', domain: 'algebra', title: 'Linear Equations in One Variable', position: 1,
      body: doc(
        { t: 'h3', c: [t('What the SAT asks')] },
        p(t('You solve an equation with one unknown, such as '), tex('4x - 3 = 2x + 9'), t(', or write one from a short story and solve it. The answer may be a choice or a number you enter yourself.')),
        { t: 'h3', c: [t('The method')] },
        { t: 'ol', items: [[t('Clear parentheses by distributing.')], [t('Collect the '), tex('x'), t(' terms on one side and the numbers on the other.')], [t('Divide by the number in front of '), tex('x'), t('.')]] },
        { t: 'math', tex: 'ax + b = c \\quad\\Longrightarrow\\quad x = \\frac{c - b}{a}' },
        { t: 'h3', c: [t('Worked example')] },
        p(t('Solve '), tex('4x - 3 = 2x + 9'), t('. Subtract '), tex('2x'), t(' from both sides: '), tex('2x - 3 = 9'), t('. Add 3: '), tex('2x = 12'), t('. So '), tex('x = 6'), t('.')),
        { t: 'h3', c: [t('Watch out for')] },
        { t: 'ul', items: [[t('Questions that ask for something other than '), tex('x'), t(', like '), tex('2x'), t(' or '), tex('x + 1'), t('.')], [t('Sign mistakes when you move a negative term.')], [t('Grid-in answers: 7/2 and 3.5 are both fine, but the box holds at most 5 characters.')]] },
      ),
    },
    {
      skill: 'words-in-context', domain: 'craft-and-structure', title: 'Words in Context', position: 1,
      body: doc(
        { t: 'h3', c: [t('What the SAT asks')] },
        p(t('A short text has a blank, and you choose the word or phrase that fits best. The right answer is both '), t('logical', 'b'), t(' (it matches what the text says) and '), t('precise', 'b'), t(' (it means exactly that).')),
        { t: 'h3', c: [t('The method')] },
        { t: 'ol', items: [[t('Cover the choices and read the whole text.')], [t('Say your own word for the blank, based on the clues around it.')], [t('Pick the choice closest to your word.')]] },
        { t: 'quote', c: [t('Clue words such as '), t('rather than', 'i'), t(', '), t('yet', 'i'), t(' and '), t('because', 'i'), t(' tell you whether the blank agrees with the rest of the text or contrasts with it.')] },
      ),
    },
    {
      skill: 'boundaries', domain: 'standard-english-conventions', title: 'Boundaries', position: 1,
      body: doc(
        { t: 'h3', c: [t('What the SAT asks')] },
        p(t('Boundaries questions test the punctuation between parts of a sentence: where one complete thought ends and the next begins.')),
        { t: 'table', head: true, rows: [
          [[t('To join two complete sentences')], [t('Use')], [t('Example')]],
          [[t('with and, but, or, so')], [t('a comma before the word')], [t('It rained, so we stayed in.')]],
          [[t('with no joining word')], [t('a period or a semicolon')], [t('It rained; we stayed in.')]],
          [[t('when the second explains the first')], [t('a colon')], [t('We stayed in: it was raining.')]],
        ] },
        { t: 'ul', items: [[t('A comma alone cannot join two complete sentences.')], [t('Never put a comma right after '), t('and', 'i'), t(' when it joins two sentences.')]] },
      ),
    },
  ];

  const files = [
    { id: 'lesson-alg-ch1', collection: 'lesson', domain: 'algebra', skill: 'alg-linear-equations-one-variable', difficulty: null, title: 'Linear Equations in One Variable: lesson', storage_path: 'lessons/alg-ch1.pdf', pages: 1, staff_only: false, position: 1 },
    { id: 'lesson-rw-words-ch1', collection: 'lesson', domain: 'craft-and-structure', skill: 'words-in-context', difficulty: null, title: 'Words in Context: lesson', storage_path: 'lessons/rw-words-ch1.pdf', pages: 1, staff_only: false, position: 1 },
    { id: 'qb-alg-linear-easy', collection: 'question_bank', domain: 'algebra', skill: 'alg-linear-equations-one-variable', difficulty: 'easy', title: 'Linear Equations in One Variable, Easy', storage_path: 'question-bank/algebra/linear-easy.pdf', pages: 1, staff_only: false, position: 1 },
    { id: 'qb-alg-linear-medium', collection: 'question_bank', domain: 'algebra', skill: 'alg-linear-equations-one-variable', difficulty: 'medium', title: 'Linear Equations in One Variable, Medium', storage_path: 'question-bank/algebra/linear-medium.pdf', pages: 1, staff_only: false, position: 2 },
    { id: 'qb-alg-linear-hard', collection: 'question_bank', domain: 'algebra', skill: 'alg-linear-equations-one-variable', difficulty: 'hard', title: 'Linear Equations in One Variable, Hard', storage_path: 'question-bank/algebra/linear-hard.pdf', pages: 1, staff_only: false, position: 3 },
    { id: 'qb-wic-easy', collection: 'question_bank', domain: 'craft-and-structure', skill: 'words-in-context', difficulty: 'easy', title: 'Words in Context, Easy', storage_path: 'question-bank/craft/words-easy.pdf', pages: 1, staff_only: false, position: 1 },
    { id: 'official-practice-5', collection: 'official_test', domain: null, skill: null, difficulty: null, title: 'Official Practice Test 5', storage_path: 'official/practice-5.pdf', pages: 1, staff_only: false, position: 1 },
    { id: 'test-pdf-1', collection: 'test_pdf', domain: null, skill: null, difficulty: null, title: 'Test 1, printable', storage_path: 'tests/test-1.pdf', pages: 1, staff_only: true, position: 1 },
    { id: 'answer-key-1', collection: 'answer_key', domain: null, skill: null, difficulty: null, title: 'Test 1 Answer Key', storage_path: 'keys/test-1-key.pdf', pages: 1, staff_only: true, position: 2 },
  ].map((f) => ({ bytes: 900, ...f }));

  // ---------------------------------------------------------------------------
  // Maya has SAT on and a little history; Leo does not

  const attempts = [];
  const responses = [];
  function history(student, setId, module, daysAgo, answers, mode) {
    const id = hp.id();
    const startedAt = hp.ago(daysAgo, '16:00');
    const submittedAt = new Date(Date.parse(startedAt) + 9 * 60_000).toISOString();
    const set = sets.find((s) => s.id === setId);
    attempts.push({
      id, student_id: student, set_id: setId, module, sitting: null, mode, started_at: startedAt,
      deadline_at: mode === 'test' ? new Date(Date.parse(startedAt) + (set.modules[0]?.minutes ?? 35) * 60_000).toISOString() : null,
      submitted_at: submittedAt, correct: null, total: null,
    });
    for (const [itemId, response] of Object.entries(answers)) {
      responses.push({ attempt_id: id, item_id: itemId, response, correct: null, flagged: false, answered_at: submittedAt });
    }
    return id;
  }
  history('u-maya', 'rw-words-ch1', null, 3, { 'rw-words-ch1-01': 'B', 'rw-words-ch1-02': 'C', 'rw-words-ch1-03': 'B' }, 'practice');
  history('u-maya', 'alg-t1', 'm', 2, { 'alg-t1-m-01': 'B', 'alg-t1-m-02': '1.5', 'alg-t1-m-03': 'A' }, 'test');

  // ---------------------------------------------------------------------------
  // Scoring (a copy of private.sat_spr_correct and sat_is_correct)

  const clean = (s) => String(s ?? '').replace(/\s/g, '').replace(/^\+/, '');
  // An entry as an exact fraction (BigInt), or null
  function parts(s) {
    const c = clean(s);
    const d = c.match(/^(-?)(\d*)\.?(\d*)$/);
    if (d && /^-?(\d+\.?\d*|\.\d+)$/.test(c)) return { num: BigInt(`${d[1]}${d[2] || '0'}${d[3]}`), den: 10n ** BigInt(d[3].length) };
    const m = c.match(/^(-?\d+)\/(\d+)$/);
    return !m || BigInt(m[2]) === 0n ? null : { num: BigInt(m[1]), den: BigInt(m[2]) };
  }
  const same = (a, b) => a.num * b.den === b.num * a.den;
  const abs = (n) => (n < 0n ? -n : n);
  // Exact answers match by value; listed roundings of one match as typed
  function sprCorrect(response, answer, accept) {
    const c = clean(response);
    const r = parts(c);
    if (!r || c.length > (c.startsWith('-') ? 6 : 5)) return false;
    const entries = (Array.isArray(accept) ? accept : []).map(String);
    const exact = [parts(answer), ...entries.filter((e) => !clean(e).includes('.')).map(parts)].filter(Boolean);
    const approx = [];
    for (const e of entries) {
      const ce = clean(e);
      const p = parts(e);
      if (!p || !ce.includes('.') || exact.some((x) => same(p, x))) continue;
      const scale = 10n ** BigInt(ce.split('.')[1].length);
      if (exact.some((x) => abs(p.num * x.den - x.num * p.den) * scale < abs(p.den * x.den))) approx.push(ce);
      else exact.push(p);
    }
    return exact.some((x) => same(r, x)) || approx.includes(c);
  }
  function isCorrect(kind, response, answer, accept) {
    if (!response || !String(response).trim() || !answer) return false;
    return kind === 'mc' ? String(response).trim().toUpperCase() === String(answer).toUpperCase() : sprCorrect(response, answer, accept);
  }

  const itemById = (id) => db.sat_items.find((i) => i.id === id);
  const keyOf = (id) => db.sat_keys.find((k) => k.item_id === id) ?? null;
  const byPos = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
  const itemsOf = (a) => db.sat_items.filter((i) => i.set_id === a.set_id && (a.module == null || i.module == null || i.module === a.module) && !i.held).sort(byPos);
  const responseOf = (a, itemId) => db.sat_responses.find((r) => r.attempt_id === a.id && r.item_id === itemId) ?? null;

  // Score the sample history the way sat_submit would have
  function score(a) {
    for (const r of responses.filter((x) => x.attempt_id === a.id)) {
      const it = items.find((i) => i.id === r.item_id);
      const k = keys.find((x) => x.item_id === r.item_id);
      r.correct = isCorrect(it.kind, r.response, k.answer, k.accept);
    }
    const list = items.filter((i) => i.set_id === a.set_id && (a.module == null || i.module == null || i.module === a.module) && !i.held);
    a.total = list.length;
    a.correct = list.filter((i) => responses.some((r) => r.attempt_id === a.id && r.item_id === i.id && r.correct)).length;
  }
  attempts.forEach(score);

  // ---------------------------------------------------------------------------
  // Tables and their rules (a simplified mirror of the migration's policies)

  const role = () => hp.role();
  const allowed = (uid) => Boolean(uid) && db.profiles.some((p0) => p0.id === uid && p0.role === 'student') && db.sat_access.some((a) => a.student_id === uid);
  const reader = () => hp.isStaff() || allowed(hp.meId);
  const nobody = () => false;
  const attemptVisible = (a) => Boolean(a) && (a.student_id === hp.meId || hp.canSee(a.student_id));

  window.portalDemo.extend({
    tables: {
      sat_access: {
        rows: [{ student_id: 'u-maya', granted_by: 'u-admin', granted_at: hp.ago(14) }],
        keys: ['student_id'],
        read: (r) => role() === 'admin' || hp.canSee(r.student_id),
        insert: (r) => role() === 'admin' && db.profiles.some((p0) => p0.id === r.student_id && p0.role === 'student'),
        write: () => role() === 'admin',
        defaults: (v, helpers) => ({ granted_by: helpers.meId, granted_at: new Date().toISOString() }),
      },
      sat_sets: { rows: sets, read: reader, insert: nobody, write: nobody },
      sat_skills: { rows: skills, read: reader, insert: nobody, write: nobody },
      sat_guides: { rows: guides, read: reader, insert: nobody, write: nobody },
      // a test's questions only once the reader has started that module
      sat_items: { rows: items, read: (r) => hp.isStaff() || (!r.held && allowed(hp.meId) && itemOpen(r)), insert: nobody, write: nobody },
      sat_keys: { rows: keys, read: () => hp.isStaff(), insert: nobody, write: nobody },
      sat_files: { rows: files, read: (r) => hp.isStaff() || (!r.staff_only && allowed(hp.meId)), insert: nobody, write: nobody },
      sat_attempts: { rows: attempts, read: attemptVisible, insert: nobody, write: nobody },
      sat_responses: { rows: responses, read: (r) => attemptVisible(db.sat_attempts.find((a) => a.id === r.attempt_id)), insert: nobody, write: nobody },
    },
    rpc: {
      sat_start: (args) => satStart(args),
      sat_item_index: () => satIndex(),
      sat_settle: (args) => satSettle(args),
      sat_answer: (args) => satAnswer(args),
      sat_submit: (args) => satSubmit(args),
      sat_review: (args) => satReview(args),
      sat_release_item: (args) => satRelease(args),
      sat_held_items: () => satHeld(),
    },
  });

  // ---------------------------------------------------------------------------
  // The RPCs

  const ok = (data) => ({ data, error: null });
  const fail = (message, code = 'P0001') => ({ data: null, error: { code, message, details: null, hint: null } });
  const now = () => new Date().toISOString();
  const RW = ['information-and-ideas', 'craft-and-structure', 'expression-of-ideas', 'standard-english-conventions'];

  function reviewJson(a, all) {
    const list = itemsOf(a).filter((i) => all || responseOf(a, i.id)?.response);
    return {
      attempt: {
        id: a.id, student_id: a.student_id, set_id: a.set_id, module: a.module, sitting: a.sitting, mode: a.mode,
        started_at: a.started_at, deadline_at: a.deadline_at, submitted_at: a.submitted_at,
      },
      correct: a.correct,
      total: a.total,
      items: list.map((i) => {
        const r = responseOf(a, i.id);
        const k = keyOf(i.id);
        return {
          item: i.id, response: r?.response ?? null, correct: r?.correct ?? (a.submitted_at ? false : null), flagged: Boolean(r?.flagged),
          answer: k?.answer ?? null, accept: k?.accept ?? [], explanation: k?.explanation ?? null,
        };
      }),
    };
  }

  function itemOpen(r) {
    const set = db.sat_sets.find((x) => x.id === r.set_id);
    if (set?.kind === 'practice') return true;
    return db.sat_attempts.some((a) => a.student_id === hp.meId && a.set_id === r.set_id && (a.module == null || r.module == null || a.module === r.module));
  }

  function satIndex() {
    if (!(hp.isStaff() || allowed(hp.meId))) return ok([]);
    return ok(db.sat_items.filter((i) => hp.isStaff() || !i.held).map((i) => ({
      id: i.id, set_id: i.set_id, module: i.module, position: i.position, domain: i.domain, skill: i.skill, difficulty: i.difficulty, kind: i.kind, held: i.held,
    })));
  }

  // Test modules left open 30 seconds past their deadline count as submitted
  function closeExpired(student) {
    let n = 0;
    for (const a of db.sat_attempts.filter((x) => x.student_id === student && x.mode === 'test' && !x.submitted_at
      && Date.parse(x.deadline_at) + 30_000 < Date.now())) {
      finish(a);
      n += 1;
    }
    return n;
  }

  function satSettle({ p_student: student }) {
    if (!student || !(student === hp.meId || hp.canSee(student))) return fail('not_allowed', '42501');
    return ok(closeExpired(student));
  }

  function satStart({ p_set: setId, p_module: moduleArg = null, p_sitting: sittingArg = null }) {
    const me = hp.meId;
    if (!me || !(hp.isStaff() || allowed(me))) return fail('not_allowed', '42501');
    const s = db.sat_sets.find((x) => x.id === setId);
    if (!s) return fail('no_such_set', 'P0002');
    closeExpired(me);
    const mine = db.sat_attempts.filter((a) => a.student_id === me && a.set_id === s.id).sort((x, y) => y.started_at.localeCompare(x.started_at) || y.id - x.id);
    let a;
    if (s.kind === 'practice') {
      a = mine.find((x) => x.mode === 'practice' && !x.submitted_at);
      if (!a) {
        a = { id: hp.id(), student_id: me, set_id: s.id, module: null, sitting: null, mode: 'practice', started_at: now(), deadline_at: null, submitted_at: null, correct: null, total: null };
        db.sat_attempts.push(a);
      }
    } else {
      const mods = Array.isArray(s.modules) ? s.modules : [];
      if (s.kind === 'full_test' && !moduleArg) return fail('module_required', '22023');
      const key = moduleArg ?? mods[0]?.key ?? null;
      let idx = mods.findIndex((m) => m.key === key);
      let minutes = mods[idx]?.minutes;
      if (idx === -1) {
        if (s.kind === 'skill_test' && !mods.length && !moduleArg) {
          idx = 0;
          minutes = RW.includes(s.domain) ? 32 : 35;
        } else return fail('no_such_module', 'P0002');
      }
      // the open module of this set is always resumed
      a = mine.find((x) => (x.module ?? null) === key && !x.submitted_at);
      let sitting = null;
      if (!a && s.kind === 'full_test' && idx === 0) {
        if (sittingArg) return mine.some((x) => x.sitting === sittingArg) ? fail('already_taken', '22023') : fail('no_such_sitting', 'P0002');
        sitting = crypto.randomUUID();
      } else if (!a && s.kind === 'full_test') {
        if (!sittingArg) return fail('sitting_required', '22023');
        const prev = mods[idx - 1].key;
        if (!mine.some((x) => x.sitting === sittingArg && x.module === prev && x.submitted_at)) return fail('previous_module_open', '22023');
        if (mine.some((x) => x.sitting === sittingArg && x.module === key)) return fail('already_taken', '22023');
        sitting = sittingArg;
      }
      if (!a) {
        const started = now();
        a = {
          id: hp.id(), student_id: me, set_id: s.id, module: key,
          sitting,
          mode: 'test', started_at: started, deadline_at: new Date(Date.parse(started) + (minutes ?? 35) * 60_000).toISOString(),
          submitted_at: null, correct: null, total: null,
        };
        db.sat_attempts.push(a);
      }
    }
    return ok({
      attempt_id: a.id, sitting: a.sitting, deadline_at: a.deadline_at, mode: a.mode, module: a.module,
      started_at: a.started_at, server_now: now(), items: itemsOf(a).map((i) => i.id),
    });
  }

  function satAnswer({ p_attempt: attemptId, p_item: itemId, p_response: raw = null, p_flagged: flagged = null }) {
    if (!(hp.isStaff() || allowed(hp.meId))) return fail('not_allowed', '42501');
    const a = db.sat_attempts.find((x) => x.id === Number(attemptId) && x.student_id === hp.meId);
    if (!a) return fail('no_such_attempt', 'P0002');
    if (a.submitted_at) return fail('submitted');
    const it = itemsOf(a).find((i) => i.id === itemId);
    if (!it) return fail('no_such_item', 'P0002');
    let resp = raw === null || raw === undefined ? null : String(raw).trim() || null;
    if (resp && resp.length > 12) return fail('bad_response', '22023');
    if (resp && it.kind === 'mc') {
      resp = resp.toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(resp)) return fail('bad_response', '22023');
    }
    let r = responseOf(a, it.id);
    const k = keyOf(it.id);
    if (a.mode === 'practice') {
      if (r?.response) {
        if (flagged !== null) r.flagged = flagged;
        return ok({ correct: r.correct, answer: k?.answer ?? null, accept: k?.accept ?? [], explanation: k?.explanation ?? null, response: r.response });
      }
      if (!r) {
        r = { attempt_id: a.id, item_id: it.id, response: null, correct: null, flagged: false, answered_at: now() };
        db.sat_responses.push(r);
      }
      if (flagged !== null) r.flagged = flagged;
      if (!resp) return ok({ saved: true });
      Object.assign(r, { response: resp, correct: isCorrect(it.kind, resp, k?.answer, k?.accept), answered_at: now() });
      return ok({ correct: r.correct, answer: k?.answer ?? null, accept: k?.accept ?? [], explanation: k?.explanation ?? null, response: resp });
    }
    if (Date.now() > Date.parse(a.deadline_at) + 30_000) return fail('time_up');
    if (!r) {
      r = { attempt_id: a.id, item_id: it.id, response: null, correct: null, flagged: false, answered_at: now() };
      db.sat_responses.push(r);
    }
    if (raw !== null && raw !== undefined) Object.assign(r, { response: resp, answered_at: now() });
    if (flagged !== null) r.flagged = flagged;
    return ok({ saved: true });
  }

  function finish(a) {
    if (a.submitted_at) return;
    if (a.mode === 'test') {
      for (const r of db.sat_responses.filter((x) => x.attempt_id === a.id)) {
        const it = itemById(r.item_id);
        const k = keyOf(r.item_id);
        r.correct = isCorrect(it?.kind, r.response, k?.answer, k?.accept);
      }
    }
    const list = itemsOf(a);
    a.total = list.length;
    a.correct = list.filter((i) => responseOf(a, i.id)?.correct).length;
    a.submitted_at = now();
  }

  function satSubmit({ p_attempt: attemptId }) {
    if (!(hp.isStaff() || allowed(hp.meId))) return fail('not_allowed', '42501');
    const a = db.sat_attempts.find((x) => x.id === Number(attemptId) && x.student_id === hp.meId);
    if (!a) return fail('no_such_attempt', 'P0002');
    finish(a);
    return ok(reviewJson(a, true));
  }

  function satReview({ p_attempt: attemptId }) {
    const a = db.sat_attempts.find((x) => x.id === Number(attemptId));
    if (!a) return fail('no_such_attempt', 'P0002');
    if (a.student_id === hp.meId) {
      if (!(hp.isStaff() || allowed(hp.meId))) return fail('not_allowed', '42501');
      if (a.submitted_at) return ok(reviewJson(a, true));
      if (a.mode === 'practice') return ok(reviewJson(a, false));
      return fail('not_submitted');
    }
    if (hp.canTeach(a.student_id)) return ok(reviewJson(a, true));
    return fail('not_allowed', '42501');
  }

  function satRelease({ p_item: itemId, p_answer: raw = null }) {
    if (role() !== 'admin') return fail('admin_only', '42501');
    const it = itemById(itemId);
    if (!it) return fail('no_such_item', 'P0002');
    let ans = raw === null || raw === undefined ? null : String(raw).trim() || null;
    if (ans) {
      if (it.kind === 'mc') {
        ans = ans.toUpperCase();
        if (!['A', 'B', 'C', 'D'].includes(ans)) return fail('bad_answer', '22023');
      } else if (!sprCorrect(ans, ans, [])) return fail('bad_answer', '22023');
      const k = keyOf(it.id);
      if (k) k.answer = ans;
      else db.sat_keys.push({ item_id: it.id, answer: ans, accept: [], explanation: null });
    } else if (!keyOf(it.id)) return fail('no_answer', '22023');
    it.held = false;
    holds.delete(it.id);
    return ok(null);
  }

  function satHeld() {
    if (role() !== 'admin') return fail('admin_only', '42501');
    const rows = db.sat_items.filter((i) => i.held).sort(byPos).map((i) => {
      const s = db.sat_sets.find((x) => x.id === i.set_id);
      return {
        id: i.id, set_id: i.set_id, set_title: s?.title ?? i.set_id, module: i.module, position: i.position, kind: i.kind,
        hold_reason: holds.get(i.id)?.hold_reason ?? null, review_note: holds.get(i.id)?.review_note ?? null, answer: keyOf(i.id)?.answer ?? null,
      };
    });
    return ok(rows);
  }

  // ---------------------------------------------------------------------------
  // The sat-files bucket: tiny PDFs and the figure, drawn here

  function pdf(title, lines) {
    const esc = (s) => String(s).replace(/[\\()]/g, '\\$&');
    const content = ['BT', '/F1 22 Tf', '72 700 Td', `(${esc(title)}) Tj`, '/F1 12 Tf',
      ...lines.flatMap((l) => ['0 -26 Td', `(${esc(l)}) Tj`]), 'ET'].join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let out = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Blob([out], { type: 'application/pdf' });
  }

  function figurePng() {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 300;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 480, 300);
    g.strokeStyle = '#16181d';
    g.lineWidth = 4;
    g.strokeRect(80, 50, 320, 200);
    g.fillStyle = '#16181d';
    g.font = '28px sans-serif';
    g.textAlign = 'center';
    g.fillText('8 cm', 240, 290);
    g.save();
    g.translate(50, 150);
    g.rotate(-Math.PI / 2);
    g.fillText('5 cm', 0, 0);
    g.restore();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  const blobUrls = new Map();
  async function fileBlob(path) {
    if (path.startsWith('figures/')) return figurePng();
    const f = db.sat_files.find((x) => x.storage_path === path);
    return pdf(f?.title ?? 'SAT file', local
      ? ['This PDF was not copied into the local demo.', 'Only lesson PDFs and figures are.']
      : ['A made-up file for the local demo.', 'The real PDFs live in the private sat-files bucket.']);
  }
  // The bucket's read policy
  const canRead = (path) => hp.isStaff() || (allowed(hp.meId)
    && (/^figures\/[a-z0-9-]{1,80}\.png$/.test(path) || db.sat_files.some((f) => f.storage_path === path && !f.staff_only)));

  // With the real content, figures and lesson PDFs are the copies in sat-local/
  function localUrl(path) {
    if (!local) return null;
    if (path.startsWith('figures/')) return `${local.figures}${path.slice('figures/'.length)}`;
    const f = db.sat_files.find((x) => x.storage_path === path);
    if (f?.collection === 'lesson' && path.startsWith('lessons/')) return `${local.lessons}${path.slice('lessons/'.length)}`;
    return null;
  }

  const client = window.supabase.createClient();
  const from = client.storage.from;
  client.storage.from = (bucket) => {
    if (bucket !== 'sat-files') return from(bucket);
    return {
      createSignedUrl: async (path) => {
        await new Promise((r) => setTimeout(r, 40));
        if (ready) await ready;
        if (!canRead(path)) return { data: null, error: { statusCode: '400', message: 'Object not found' } };
        const direct = localUrl(path);
        if (direct) return { data: { signedUrl: direct }, error: null };
        if (!blobUrls.has(path)) blobUrls.set(path, URL.createObjectURL(await fileBlob(path)));
        return { data: { signedUrl: blobUrls.get(path) }, error: null };
      },
    };
  };

  // ---------------------------------------------------------------------------
  // The real content, for looking at it locally (build.mjs --sat-content)
  //
  // sat-local.js (written by the build, outside the repo) says where the
  // converter's content.json is. It is fetched at startup and replaces the
  // sample sets, skills, guides, items, keys and files; the sample history is
  // dropped (it was about sample questions). Questions the converter's
  // holds.json holds back are held, as the loader would hold them. The SAT
  // tables and RPCs wait for it, so pages show their usual loading state.

  function useLocal(content, holdsFile) {
    const replace = (name, rows) => {
      db[name].length = 0;
      for (const row of rows) db[name].push(row);
    };
    const holdLines = new Map();
    for (const h of holdsFile?.holds ?? []) {
      if (!holdLines.has(h.item)) holdLines.set(h.item, { hold: [], other: [] });
      const text = `${h.verdict ?? h.severity}: ${h.reason ?? ''}`.trim();
      holdLines.get(h.item)[h.severity === 'hold' ? 'hold' : 'other'].push(h.severity === 'hold' ? text : `${h.severity}, ${text}`);
    }
    holds.clear();
    replace('sat_skills', (content.skills ?? []).map((x) => ({ slug: x.slug, domain: x.domain, name: x.name, position: x.position ?? 0 })));
    replace('sat_sets', (content.sets ?? []).map((x) => ({
      id: x.id, kind: x.kind, domain: x.domain ?? null, skill: x.skill ?? null, title: x.title, position: x.position ?? 0,
      modules: x.modules ?? [], origin: x.origin ?? 'matthew',
    })));
    replace('sat_guides', (content.guides ?? []).map((g) => ({ skill: g.skill, domain: g.domain, title: g.title, position: g.position ?? 0, body: g.body })));
    replace('sat_items', (content.items ?? []).map((it) => {
      const lines = holdLines.get(it.id);
      const held = Boolean(lines?.hold.length) && !it.source?.repaired;
      if (held || lines?.other.length) holds.set(it.id, { hold_reason: held ? lines.hold.join('\n') : null, review_note: lines.other.join('\n') || null });
      return {
        id: it.id, set_id: it.set, module: it.module ?? null, position: it.position, domain: it.domain, skill: it.skill ?? null,
        difficulty: it.difficulty ?? null, kind: it.kind, passage: it.passage ?? null, stem: it.stem, choices: it.choices ?? null, held,
      };
    }));
    replace('sat_keys', (content.keys ?? []).map((k) => ({ item_id: k.item, answer: k.answer, accept: k.accept ?? [], explanation: k.explanation ?? null })));
    replace('sat_files', (content.files ?? []).map((f) => ({
      id: f.id, collection: f.collection, domain: f.domain ?? null, skill: f.skill ?? null, difficulty: f.difficulty ?? null, title: f.title,
      storage_path: f.path, bytes: f.bytes ?? null, pages: f.pages ?? null, staff_only: Boolean(f.staff_only), position: f.position ?? 0,
    })));
    replace('sat_attempts', []);
    replace('sat_responses', []);
    console.info(`SAT demo: real content from ${content.built_at ?? 'a content bundle'} (${db.sat_items.length} questions, ${db.sat_sets.length} sets)`);
  }

  if (local) {
    const getJson = async (url) => {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    };
    ready = Promise.all([getJson(local.content), local.holds ? getJson(local.holds).catch(() => null) : null])
      .then(([content, holdsFile]) => useLocal(content, holdsFile))
      .catch((error) => console.error('SAT demo: the local content could not load, so the sample shows', error));

    // The content tables and the SAT RPCs answer once it is in
    const WAIT = new Set(['sat_sets', 'sat_skills', 'sat_guides', 'sat_items', 'sat_keys', 'sat_files', 'sat_attempts', 'sat_responses']);
    const proto = Object.getPrototypeOf(client.from('sat_sets'));
    const then = proto.then;
    proto.then = function (resolve, reject) {
      if (!WAIT.has(this.table)) return then.call(this, resolve, reject);
      return ready.then(() => then.call(this, resolve, reject));
    };
    const rpcCall = client.rpc;
    client.rpc = async (name, args) => {
      if (String(name).startsWith('sat_')) await ready;
      return rpcCall(name, args);
    };
  }
})();
