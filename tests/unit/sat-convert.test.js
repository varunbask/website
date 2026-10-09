import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toDoc, docText, isCaption } from '../../tools/sat/lib/latex-doc.mjs';
import { stripComments, splitItems } from '../../tools/sat/lib/tex.mjs';
import { fileSets, setItems, setKeys, splitItem, testNumber, lessonPart, chapterTitle } from '../../tools/sat/lib/source.mjs';
import { mcAnswer, sprAnswer } from '../../tools/sat/lib/keys.mjs';
import { ids, slugify, trimSlug, titleCase, cleanName, classifyTopic } from '../../tools/sat/lib/catalog.mjs';
import { classifyRw, matchTopics } from '../../tools/sat/lib/classify.mjs';
import { repeatedWordSuspect } from '../../tools/sat/lib/checks.mjs';
import { qbDifficulty } from '../../tools/sat/lib/files.mjs';
import { buildBundle } from '../../tools/sat/lib/build.mjs';

// All LaTeX here is made up for the tests (never the books' own questions)
const doc = (tex, ctx) => toDoc(tex, ctx).blocks;

describe('LaTeX -> SAT doc', () => {
  test('marks: bold, italic, underline; math stays TeX', () => {
    const [p] = doc(String.raw`A \textbf{bold \emph{and italic}} word, \underline{tested part}, and $x^2+1$.`);
    expect(p).toEqual({
      t: 'p',
      c: [
        { x: 'A ' }, { x: 'bold ', m: ['b'] }, { x: 'and italic', m: ['b', 'i'] }, { x: ' word, ' },
        { x: 'tested part', m: ['u'] }, { x: ', and ' }, { tex: 'x^2+1' }, { x: '.' },
      ],
    });
  });

  test('quotes, dashes, dollars and spaces like the PDF', () => {
    const [p] = doc("``Cheap,'' she said --- it cost \\$5, not 3--4 dollars. It's~fine.");
    expect(p.c[0].x).toBe('“Cheap,” she said — it cost $5, not 3–4 dollars. It’s fine.');
  });

  test('a control word eats the space after it, a control space does not', () => {
    expect(docText({ blocks: doc(String.raw`wait\ldots now and e.g.\ this`) })).toBe('wait…now and e.g. this');
  });

  test('blank lines and \\par split paragraphs; \\\\ is a line break', () => {
    const blocks = doc('One.\n\nTwo\\\\ still two.\\par Three.');
    expect(blocks.map((b) => b.t)).toEqual(['p', 'p', 'p']);
    expect(blocks[1].c).toEqual([{ x: 'Two' }, { br: true }, { x: 'still two.' }]);
  });

  test('blanks: a thin \\rule and an underline over space', () => {
    const [p] = doc(String.raw`The kettle\rule[-0.2ex]{1.2em}{0.4pt}boiled and \underline{\hphantom{xx}} sang.`);
    expect(p.c).toEqual([{ x: 'The kettle' }, { blank: true }, { x: 'boiled and ' }, { blank: true }, { x: ' sang.' }]);
  });

  test('passages and data boxes become passage blocks with their labels', () => {
    const blocks = doc(String.raw`\begin{passage}[Text 1]
A made-up text about owls.
\end{passage}
\begin{databox}[Field Notes --- Week 2]
\begin{itemize}
\item Owls: 4
\item Hawks: \emph{none}
\end{itemize}
\end{databox}
Which choice is best?`);
    expect(blocks[0]).toEqual({ t: 'passage', label: 'Text 1', blocks: [{ t: 'p', c: [{ x: 'A made-up text about owls.' }] }] });
    expect(blocks[1]).toEqual({ t: 'passage', label: 'Field Notes — Week 2', blocks: [{ t: 'ul', items: [[{ x: 'Owls: 4' }], [{ x: 'Hawks: ' }, { x: 'none', m: ['i'] }]] }] });
    expect(blocks[2].c).toEqual([{ x: 'Which choice is best?' }]);
  });

  test('tables: header row from the rule after it, cells as inline runs', () => {
    const [table] = doc(String.raw`\begin{tabular}{lcc}
\toprule
Fruit & Mon & Tue \\
\midrule
Pears & \phantom{0}8 & $12$ \\
Plums & 10 & 9 \\
\bottomrule
\end{tabular}`);
    expect(table.t).toBe('table');
    expect(table.head).toBe(true);
    expect(table.rows).toEqual([
      [[{ x: 'Fruit' }], [{ x: 'Mon' }], [{ x: 'Tue' }]],
      [[{ x: 'Pears' }], [{ x: '8' }], [{ tex: '12' }]],
      [[{ x: 'Plums' }], [{ x: '10' }], [{ x: '9' }]],
    ]);
  });

  test('display math becomes a math block; align* is wrapped for MathJax', () => {
    const blocks = doc(String.raw`So \[ 2x = 8 \] and
\begin{align*} a &= 1 \\ b &= 2 \end{align*}`);
    expect(blocks[1]).toEqual({ t: 'math', tex: '2x = 8' });
    expect(blocks[3]).toEqual({ t: 'math', tex: '\\begin{aligned} a &= 1 \\\\ b &= 2 \\end{aligned}' });
  });

  test('a TikZ picture becomes an img block; its caption the alt text and a paragraph', () => {
    const seen = [];
    const blocks = doc(String.raw`\begin{center}\begin{minipage}{\linewidth}\centering
\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}
\figcaption{A made-up line.}
\end{minipage}\end{center}`, {
      figure: (source, img) => {
        seen.push(source);
        img.src = 'figures/x.png';
        return true;
      },
    });
    expect(seen).toEqual(['\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}']);
    expect(blocks[0]).toEqual({ t: 'img', src: 'figures/x.png', w: 0, h: 0, alt: 'A made-up line.' });
    expect(isCaption(blocks[1])).toBe(true);
    expect(JSON.stringify(blocks[1])).toBe('{"t":"p","c":[{"x":"A made-up line.","m":["i"]}]}');
  });

  test('unknown macros are counted, and their text kept', () => {
    const unknown = new Map();
    const [p] = doc(String.raw`Keep \mystery{this} text.`, { unknown });
    expect(docText({ blocks: [p] })).toBe('Keep this text.');
    expect(unknown.get('\\mystery')).toBe(1);
  });

  test('\\degree and the books’ math macros are spelled out for MathJax', () => {
    const [p] = doc(String.raw`It was $68\degree$F.`);
    expect(p.c[1]).toEqual({ tex: '68^{\\circ}' });
  });
});

describe('LaTeX scanning', () => {
  test('comments go with their line break; \\% stays', () => {
    expect(stripComments('50\\% off % a note\n   now')).toBe('50\\% off now');
  });

  test('list items split at their own \\item only', () => {
    const items = splitItems(String.raw`\item one \begin{itemize}\item inner\end{itemize} \item two`);
    expect(items.map((i) => i.text.trim())).toEqual([String.raw`one \begin{itemize}\item inner\end{itemize}`, 'two']);
  });
});

// A made-up file with two tests, each with its key
const TWO_TESTS = String.raw`\chapter{Practice Tests}
\testheader{Practice Test 1 --- Made Up}
\begin{mcq}% ----- Q1  Words in Context -----
\item \diff{Easy} First question? \choices{a}{b}{c}{d}
\item \diff{Hard} \emph{Student-produced response.} What is $1+1$?
\end{mcq}
\answerkeyheader[Practice Test 1 --- Answer Key]
\begin{solutions}
\sol{Question 1}
\textbf{Answer: (B).} Because.
\sol{Question 2}
Student-produced response. Add. Grid in \textbf{2}.
\end{solutions}
\testheader{Practice Test 2 --- Made Up}
\begin{mcq}
\item \diff{Medium} Second test? \choicesv{w}{x}{y}{z}
\end{mcq}
\answerkeyheader
\begin{solutions}
\sol{Question 1}
\textbf{Answer: (D) z.} Yes.
\end{solutions}`;

describe('file structure', () => {
  test('a file with two tests gives two sets with their labels, items and keys', () => {
    const sets = fileSets(TWO_TESTS);
    expect(sets.map((s) => s.label)).toEqual(['Practice Test 1 --- Made Up', 'Practice Test 2 --- Made Up']);
    expect(sets.map((s) => testNumber(s.label))).toEqual([1, 2]);
    expect(setItems(sets[0].mcq)).toHaveLength(2);
    expect([...setKeys(sets[0].solutions).keys.keys()]).toEqual([1, 2]);
    expect(sets[0].topics.get(1)).toBe('Words in Context');
  });

  test('a question splits into difficulty, stem and choices; a grid-in has none', () => {
    const [mc, spr] = setItems(fileSets(TWO_TESTS)[0].mcq).map((it) => splitItem(it.tex));
    expect(mc).toMatchObject({ difficulty: 'easy', stem: 'First question?', choices: ['a', 'b', 'c', 'd'], spr: false });
    expect(spr).toMatchObject({ difficulty: 'hard', stem: 'What is $1+1$?', choices: null, spr: true });
  });

  test('keys: the letter, and the grid-in value', () => {
    const keys = setKeys(fileSets(TWO_TESTS)[0].solutions).keys;
    expect(mcAnswer(keys.get(1))).toBe('B');
    expect(sprAnswer(keys.get(2)).values).toEqual(['2']);
    expect(mcAnswer(setKeys(fileSets(TWO_TESTS)[1].solutions).keys.get(1))).toBe('D');
    expect(sprAnswer(String.raw`\textbf{Answer: $23/17$.} Work. Grid in \texttt{23/17}.`).values).toEqual(['23/17']);
    expect(sprAnswer(String.raw`\textbf{Grid-in: \boldmath$12$.} Steps. Enter \texttt{12}.`).values).toEqual(['12']);
    expect(sprAnswer(String.raw`Gridding $6$ is the trap. Grid in \textbf{-2/3} (or the decimal \textbf{-.6667}).`).values).toEqual(['-2/3', '-.6667']);
    expect(sprAnswer(String.raw`Grid in \textbf{3/5} or \textbf{0.6} --- either works.`).values).toEqual(['3/5', '0.6']);
    expect(sprAnswer('No value is given here.')).toBeNull();
  });

  test('the lesson part stops at the practice set; the chapter title is read', () => {
    const raw = String.raw`\chapter{Made-Up Skill}
Teach.
\practiceheader[Chapter 1 Practice]
\begin{mcq}\item x \choices{a}{b}{c}{d}\end{mcq}`;
    expect(lessonPart(raw).trim()).toBe(String.raw`\chapter{Made-Up Skill}
Teach.`);
    expect(chapterTitle(raw)).toBe('Made-Up Skill');
  });
});

describe('ids and names', () => {
  test('ids follow the spec and stay within 60 characters', () => {
    expect(ids.practice('alg', 3)).toBe('alg-ch3');
    expect(ids.skillTest('geo', 2)).toBe('geo-t2');
    expect(ids.fullTest(7)).toBe('full-07');
    expect(ids.item('full-07', 4, 'rw2')).toBe('full-07-rw2-04');
    expect(ids.item('alg-ch3', 12)).toBe('alg-ch3-12');
    const long = ids.skill('am', 'Nonlinear equations in one variable and systems of equations in two variables');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(/^am-nonlinear-equations-in-one-variable/);
    expect(trimSlug('aaa-bbb-ccc', 9)).toBe('aaa-bbb');
  });

  test('names from the Question Bank folders', () => {
    expect(cleanName('3. One-variable data_ Distributions and spread ')).toBe('One-variable data: Distributions and spread');
    expect(titleCase('linear equations in one variable')).toBe('Linear Equations in One Variable');
    expect(slugify('Form, Structure, and Sense')).toBe('form-structure-and-sense');
    expect(qbDifficulty('Inferences - MEDIUM .pdf')).toBe('medium');
    expect(qbDifficulty(' MEDIUM - Command of Evidence.pdf')).toBe('medium');
    expect(qbDifficulty('EASY  - Something.pdf')).toBe('easy');
  });
});

describe('domains and skills of mixed-test questions', () => {
  test('Reading and Writing questions are read from their wording', () => {
    expect(classifyRw({ stem: 'Which choice completes the text with the most logical transition?', choices: ['So', 'Yet', 'Thus', 'Hence'] }).skillName).toBe('Transitions');
    expect(classifyRw({ stem: 'Which choice completes the text so that it conforms to the conventions of Standard English?', choices: ['hats, and the', 'hats and the', 'hats; and the', 'hats, the'] }).skillName).toBe('Boundaries');
    expect(classifyRw({ stem: 'Which choice completes the text so that it conforms to the conventions of Standard English?', choices: ['has', 'have', 'having', 'to have'] }).skillName).toBe('Form, Structure, and Sense');
    expect(classifyRw({ stem: 'Which choice most logically completes the text?' }).domain).toBe('information-and-ideas');
  });

  test('math topic comments map to domains', () => {
    expect(classifyTopic('Two-way table (conditional probability)', 'math').domain).toBe('problem-solving-and-data-analysis');
    expect(classifyTopic('Equation of a circle (radius)', 'math').skillName).toBe('Circles');
    expect(classifyTopic('Infinitely many solutions, transformed target', 'math').domain).toBe('algebra');
    expect(classifyTopic('Tangency of a line and a parabola \\emph{SPR}', 'math').skillName).toMatch(/^Nonlinear equations/);
  });

  test('comments that moved away from their questions are matched back by content', () => {
    const questions = [
      { q: 1, text: 'A cone and a sphere have equal volume.', spr: true },
      { q: 2, text: 'What is the probability that a marble chosen at random is red?', spr: false },
    ];
    const topics = new Map([[1, 'Probability of a random marble'], [2, 'Cone and sphere of equal volume \\emph{SPR}']]);
    const out = matchTopics(questions, topics);
    expect(out.reordered).toBe(true);
    expect(out.topics.get(1)).toMatch(/Cone/);
    expect(out.topics.get(2)).toMatch(/Probability/);
    // comments whose grid-in marks agree with the questions stay where they are
    const same = matchTopics(questions, new Map([[1, 'Cone \\emph{SPR}'], [2, 'Probability']]));
    expect(same.reordered).toBe(false);
  });
});

describe('checks', () => {
  test('a word next to the blank that every choice repeats is a suspect', () => {
    const item = {
      stem: { blocks: [{ t: 'p', c: [{ x: 'The weaver' }, { blank: true }, { x: 'finished.' }] }] },
      passage: null,
      choices: ['weaver, ', 'weaver; ', 'weaver ', 'weaver: '].map((x) => ({ blocks: [{ t: 'p', c: [{ x }] }] })),
    };
    expect(repeatedWordSuspect(item)).toEqual({ word: 'weaver', side: 'before', choices: 'start' });
    item.stem.blocks[0].c[0].x = 'The';
    expect(repeatedWordSuspect(item)).toBeNull();
  });
});

// ---------- a whole build on a tiny made-up book tree ----------
const CHAPTER = String.raw`\chapter{Made-Up Words}
A lesson.
\practiceheader[Chapter 1 Practice --- Made-Up Words]
\begin{mcq}
\item \diff{Easy}
\begin{passage}
A short made-up text about \underline{lanterns}.
\end{passage}
Which choice completes the text with the most logical and precise word?
\choices{bright}{dim}{tall}{wet}
\item \diff{Medium} The baker\rule[-0.2ex]{1.2em}{0.4pt}sold bread. \choices{,}{;}{:}{(no punctuation)}
\end{mcq}
\answerkeyheader
\begin{solutions}
\sol{Question 1}
\textbf{Answer: (A).} Lanterns are bright.
\sol{Question 2}
\textbf{Answer: (D).} No mark between subject and verb.
\end{solutions}`;

const MATH_CHAPTER = String.raw`\chapter{Made-Up Lines}
Lesson.
\practiceheader
\begin{mcq}
\item \diff{Hard} \emph{Student-produced response.} If $3x = 2$, what is $x$?
\item \diff{Easy} The table shows values.
\begin{databox}[Values]
\centering
\begin{tabular}{lc}
\toprule
$x$ & $y$ \\
\midrule
1 & 2 \\
\bottomrule
\end{tabular}
\end{databox}
Which is $y$ when $x=1$?
\choices{$1$}{$2$}{$3$}{$4$}
\end{mcq}
\begin{solutions}
\sol{Question 1}
\textbf{Answer: $2/3$.} Divide. Grid in \texttt{2/3}.
\sol{Question 2}
\textbf{Answer: (B).} Read the row.
\end{solutions}`;

const FULL_MODULE = (section) => String.raw`\begin{mcq}
% ----- Q1  ${section === 'rw' ? 'Transitions' : 'Volume of a cone'} -----
\item \diff{Easy} ${section === 'rw' ? 'Rain fell. \\rule[-0.2ex]{2em}{0.4pt}, the river rose. Which choice completes the text with the most logical transition?' : 'A cone has volume $12\\pi$. What is its height?'}
\choices{a}{b}{c}{d}
\end{mcq}
\begin{solutions}
\sol{Question 1}
\textbf{Answer: (C).} Made up.
\end{solutions}`;

describe('buildBundle on a made-up tree', () => {
  let root;
  let first;
  let second;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'sat-convert-'));
    const sat = join(root, 'SAT');
    const put = (path, text) => {
      mkdirSync(join(sat, path, '..'), { recursive: true });
      writeFileSync(join(sat, path), text);
    };
    put('style.tex', '% made-up style\n\\usepackage{amsmath}\n');
    put('02-craft-and-structure/style.tex', '% made-up style\n\\usepackage{amsmath}\n');
    put('02-craft-and-structure/master.tex', '\\def\\sattitle{Made Up}\n');
    put('02-craft-and-structure/01-words-in-context/chapter.tex', CHAPTER);
    put('02-craft-and-structure/practice-tests/tests.tex', TWO_TESTS);
    put('05-algebra/style.tex', '% made-up\n');
    put('05-algebra/01-lines/chapter.tex', MATH_CHAPTER);
    put('09-cumulative-master/style.tex', '% made-up\n');
    put('09-cumulative-master/practice-tests/exam-01.tex', String.raw`\testheader{Practice Test 1}
\modulebanner{Reading \& Writing --- Module 1}{x}
\input{practice-tests/exam-01-rw1.tex}
\modulebanner{Math --- Module 1}{x}
\input{practice-tests/exam-01-m1.tex}`);
    for (const key of ['rw1', 'rw2']) put(`09-cumulative-master/practice-tests/exam-01-${key}.tex`, FULL_MODULE('rw'));
    for (const key of ['m1', 'm2']) put(`09-cumulative-master/practice-tests/exam-01-${key}.tex`, FULL_MODULE('math'));
    const qb = join(root, 'QB');
    mkdirSync(join(qb, '2. Craft and Structure ', '1. Words in Context'), { recursive: true });
    writeFileSync(join(qb, '2. Craft and Structure ', '1. Words in Context', 'EASY - Words in Context .pdf'), 'not a real pdf');
    const extra = join(root, 'extra');
    mkdirSync(join(extra, 'overrides'), { recursive: true });
    writeFileSync(join(extra, 'overrides', 'fix.json'), JSON.stringify([
      { file: '02-craft-and-structure/practice-tests/tests.tex', set_label: 'Practice Test 2 — made up', q: 1, item_tex: '\\item \\diff{Easy} Repaired question? \\choices{w}{x}{y}{z}', key_tex: '\\textbf{Answer: (A).} Repaired.', reason: 'test' },
      { file: '02-craft-and-structure/01-words-in-context/chapter.tex', set_label: 'whatever', q: 2, item_tex: null, key_tex: null, difficulty: 'hard', reason: 'recalibrated' },
      { file: 'nowhere.tex', set_label: 'x', q: 9, item_tex: null, key_tex: '\\textbf{Answer: (A).}', reason: 'matches nothing' },
    ]));
    mkdirSync(join(extra, 'new', 'algebra'), { recursive: true });
    writeFileSync(join(extra, 'new', 'algebra', 'lines.tex'), String.raw`%SET id=vp-made-up-lines
%SET title=Made-Up Lines Extra
%SET skill=alg-linear-functions
%SET domain=algebra
%SET position=2
\begin{mcq}
\item \diff{Medium} Slope of $y=2x$? \choices{$0$}{$1$}{$2$}{$3$}
\end{mcq}
\begin{solutions}
\sol{Question 1}
\textbf{Answer: (C).} It is 2.
\end{solutions}`);
    mkdirSync(join(extra, 'guides'), { recursive: true });
    writeFileSync(join(extra, 'guides', 'cs-words-in-context.md'), '---\nskill: cs-words-in-context\ndomain: craft-and-structure\ntitle: Words in Context\nposition: 1\n---\n## Read around the blank\nPredict a **word** first.\n');
    const opts = { sat, qb, extra, out: join(root, 'out'), figures: false, lessons: false };
    first = await buildBundle(opts);
    second = await buildBundle(opts);
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('sets: practice per chapter, a skill test per test, full tests with four modules', () => {
    const byId = new Map(first.content.sets.map((s) => [s.id, s]));
    expect([...byId.keys()].sort()).toEqual(['alg-ch1', 'cs-ch1', 'cs-t1', 'cs-t2', 'full-01', 'vp-made-up-lines']);
    expect(byId.get('cs-t1')).toMatchObject({ kind: 'skill_test', domain: 'craft-and-structure', title: 'Craft and Structure Test 1', modules: [{ key: 'rw', minutes: 32 }], origin: 'matthew' });
    expect(byId.get('full-01').modules.map((m) => m.key)).toEqual(['rw1', 'rw2', 'm1', 'm2']);
    expect(byId.get('vp-made-up-lines')).toMatchObject({ kind: 'practice', origin: 'vp', skill: 'alg-linear-functions', position: 2 });
  });

  test('items: ids, kinds, passages, skill tests and full-test domains', () => {
    const items = new Map(first.content.items.map((i) => [i.id, i]));
    expect(items.get('cs-ch1-01').passage.blocks[0].t).toBe('passage');
    expect(items.get('cs-ch1-01').stem.blocks[0].c[0].x).toMatch(/most logical and precise word/);
    expect(items.get('cs-ch1-02').stem.blocks[0].c).toContainEqual({ blank: true });
    expect(items.get('alg-ch1-01')).toMatchObject({ kind: 'spr', choices: null, difficulty: 'hard' });
    expect(items.get('alg-ch1-02').stem.blocks.some((b) => b.t === 'passage' && b.blocks[0].t === 'table')).toBe(true);
    expect(items.get('cs-t1-02')).toMatchObject({ kind: 'spr', module: 'rw' });
    expect(items.get('full-01-rw1-01')).toMatchObject({ domain: 'expression-of-ideas', module: 'rw1' });
    expect(items.get('full-01-m2-01')).toMatchObject({ domain: 'geometry-and-trigonometry', module: 'm2' });
    expect(items.get('full-01-rw1-01').source).toMatchObject({ origin: 'matthew', file: '09-cumulative-master/practice-tests/exam-01-rw1.tex', set: 'Practice Test 1', q: 1 });
    expect(items.get('vp-made-up-lines-01').source).toMatchObject({ origin: 'vp', file: 'new/algebra/lines.tex' });
  });

  test('keys: one per item, letters A to D, grid-in forms', () => {
    const { items, keys } = first.content;
    expect(keys).toHaveLength(items.length);
    const key = new Map(keys.map((k) => [k.item, k]));
    expect(key.get('cs-t1-01').answer).toBe('B');
    expect(key.get('alg-ch1-01')).toMatchObject({ answer: '2/3', accept: ['.6666', '.6667', '0.666', '0.667'] });
    for (const it of items.filter((i) => i.kind === 'mc')) expect(key.get(it.id).answer).toMatch(/^[A-D]$/);
  });

  test('overrides: repairs replace the question and key; difficulty-only ones only recalibrate', () => {
    const items = new Map(first.content.items.map((i) => [i.id, i]));
    const keys = new Map(first.content.keys.map((k) => [k.item, k]));
    expect(items.get('cs-t2-01').source.repaired).toBe(true);
    expect(items.get('cs-t2-01').stem.blocks[0].c[0].x).toBe('Repaired question?');
    expect(keys.get('cs-t2-01').answer).toBe('A');
    expect(items.get('cs-ch1-02')).toMatchObject({ difficulty: 'hard' });
    expect(items.get('cs-ch1-02').source.repaired).toBeUndefined();
    expect(first.report.overrides).toMatchObject({ entries: 3, applied: 2, recalibrated: 1 });
    expect(first.report.overrides.unmatched).toEqual([expect.objectContaining({ file: 'nowhere.tex', q: 9 })]);
  });

  test('skills, files and guides', () => {
    const { skills, files, guides } = first.content;
    expect(skills.find((s) => s.slug === 'cs-words-in-context')).toMatchObject({ domain: 'craft-and-structure', name: 'Words in Context' });
    expect(files).toEqual([expect.objectContaining({ collection: 'question_bank', skill: 'cs-words-in-context', difficulty: 'easy', path: 'question-bank/craft-and-structure/words-in-context-easy.pdf', staff_only: false })]);
    expect(guides).toEqual([{ skill: 'cs-words-in-context', domain: 'craft-and-structure', title: 'Words in Context', position: 1, body: { v: 1, blocks: [{ t: 'h3', c: [{ x: 'Read around the blank' }] }, { t: 'p', c: [{ x: 'Predict a ' }, { x: 'word', m: ['b'] }, { x: ' first.' }] }] } }]);
  });

  test('the report: no failures, and a rebuild gives the same ids', () => {
    expect(first.report.parse_failures).toEqual([]);
    expect(second.content.items.map((i) => i.id)).toEqual(first.content.items.map((i) => i.id));
    expect(second.content.sets.map((s) => s.id)).toEqual(first.content.sets.map((s) => s.id));
    expect(JSON.parse(readFileSync(join(root, 'out', 'content.json'), 'utf8')).items).toHaveLength(first.content.items.length);
  });
});
