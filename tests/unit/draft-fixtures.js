// A model answer in the draft schema v2 (api/_lib/homework-draft.js): a
// factoring problem set with LaTeX, a worked example, practice, a word
// problem, a challenge and a reflect section, and an answer key whose refs
// follow the sections with problems (A warm-up, B practice, C apply...).
//   practice   how many Part B problems
//   challenge  include the challenge section
//   hint       a hint on each practice problem, or null
export function draftV2({ practice = 5, challenge = true, hint = null, warmup = 2 } = {}) {
  const sections = [
    {
      kind: 'warmup', heading: 'Warm-up', directions: 'Multiply. Write each answer in standard form.', example: null,
      problems: Array.from({ length: warmup }, (_, i) => ({ prompt: `Multiply $(x + ${i + 1})(x + ${i + 2})$.`, choices: null, hint: null, space: 'short' })),
    },
    {
      kind: 'example', heading: 'Worked example', directions: 'Read each step before you start Part B.',
      example: {
        problem: 'Factor $x^2 + 7x + 12$.',
        steps: ['Find two numbers that multiply to $12$ and add to $7$.', 'They are $3$ and $4$, since $3 \\cdot 4 = 12$ and $3 + 4 = 7$.', 'Write the factors.'],
        answer: '$(x + 3)(x + 4)$',
      },
      problems: [],
    },
    {
      kind: 'practice', heading: 'Practice', directions: 'Factor each trinomial. Check by multiplying.', example: null,
      problems: Array.from({ length: practice }, (_, i) => (i === 1
        ? { prompt: 'Which is a factor of $x^2 - x - 6$?', choices: ['$x - 2$', '$x + 2$', '$x + 3$', '$x - 6$'], hint, space: 'none' }
        : { prompt: `Factor $x^2 + ${i + 7}x + ${i + 10}$.`, choices: null, hint, space: 'medium' })),
    },
    {
      kind: 'apply', heading: 'Apply', directions: 'Show how you set it up.', example: null,
      problems: [{ prompt: 'A rectangle has area $x^2 + 5x + 6$ square feet. Write expressions for its length and width.', choices: null, hint: null, space: 'long' }],
    },
  ];
  if (challenge) {
    sections.push({
      kind: 'challenge', heading: 'Challenge', directions: 'Try this stretch problem.', example: null,
      problems: [{ prompt: 'Factor $2x^2 + 7x + 3$.', choices: null, hint: null, space: 'grid' }],
    });
  }
  sections.push({
    kind: 'reflect', heading: 'Check and reflect', directions: 'Answer in a sentence or two.', example: null,
    problems: [
      { prompt: 'Why must the two numbers multiply to $c$?', choices: null, hint: null, space: 'medium' },
      { prompt: 'Which problem was hardest for you, and why?', choices: null, hint: null, space: 'short' },
    ],
  });
  const answer_key = [];
  let letter = 0;
  for (const sec of sections) {
    if (!sec.problems.length) continue;
    const l = String.fromCharCode(65 + letter++);
    sec.problems.forEach((p, i) => answer_key.push({ ref: `${l}${i + 1}`, answer: `Answer ${l}${i + 1}: $x + ${i + 1}$`, steps: [`Step for ${l}${i + 1}.`] }));
  }
  return {
    title: 'Factoring trinomials',
    objective: 'You will be able to factor trinomials of the form $x^2 + bx + c$.',
    minutes: 25,
    materials: 'Pencil. No calculator.',
    sections,
    answer_key,
  };
}

// A real draft from Opus (schema v2), lightly trimmed: one-step and two-step
// equations with fractions. Its inline fractions ($\frac{x}{5}$, the
// $\frac{4x}{4} = \frac{28}{4}$ step) are what printed too small before.
export function opusEquationsDraft() {
  const P = (prompt, space = 'medium', extra = {}) => ({ prompt, choices: null, hint: null, space, ...extra });
  return {
    title: 'Solving equations with fractions',
    objective: 'You will be able to solve one-step and two-step equations that have fractions.',
    minutes: 30,
    materials: 'Pencil. No calculator.',
    sections: [
      {
        kind: 'warmup', heading: 'Warm-up', directions: 'Find each value.', example: null,
        problems: [P('What is $\\frac{1}{2}$ of $18$?', 'short'), P('Simplify $\\frac{28}{4}$.', 'short'), P('Solve $x + 9 = 15$.', 'short')],
      },
      {
        kind: 'example', heading: 'Worked example', directions: 'Read each step before you start Part B.',
        example: {
          problem: 'Solve $4x - 5 = 23$.',
          steps: ['Add $5$ to both sides: $4x = 28$.', '$\\frac{4x}{4} = \\frac{28}{4}$, which gives $x = 7$.', 'Check: $4(7) - 5 = 23$.'],
          answer: '$x = 7$',
        },
        problems: [],
      },
      {
        kind: 'practice', heading: 'Practice', directions: 'Solve each equation. Show your steps.', example: null,
        problems: [
          P('Solve $\\frac{x}{5} = 3$.'),
          P('Solve $3x + 4 = 19$.'),
          P('Which value of $x$ makes $\\frac{x}{3} - 2 = 4$ true?', 'none', { choices: ['$6$', '$12$', '$18$', '$2$'] }),
          P('Solve $\\frac{2x}{3} = 10$.'),
          P('Review: simplify $\\frac{3}{4} + \\frac{1}{8}$.', 'short'),
          P('Solve $\\frac{x - 4}{2} = 9$.', 'long'),
        ],
      },
      {
        kind: 'apply', heading: 'Apply', directions: 'Write an equation, then solve it.', example: null,
        problems: [P('A pizza is cut into equal slices. Maya eats $\\frac{1}{4}$ of it, which is $3$ slices. How many slices were there?', 'long')],
      },
      {
        kind: 'challenge', heading: 'Challenge', directions: 'A stretch problem.', example: null,
        problems: [P('Solve $\\frac{x}{2} + \\frac{x}{3} = 10$.', 'grid')],
      },
      {
        kind: 'reflect', heading: 'Check and reflect', directions: 'Answer in a sentence or two.', example: null,
        problems: [P('Why do you multiply both sides by $5$ to solve $\\frac{x}{5} = 3$?'), P('Which problem was hardest for you, and why?', 'short')],
      },
    ],
    answer_key: [
      { ref: 'A1', answer: '$9$', steps: ['$\\frac{1}{2} \\cdot 18 = 9$'] },
      { ref: 'A2', answer: '$7$', steps: ['$28 \\div 4 = 7$'] },
      { ref: 'A3', answer: '$x = 6$', steps: ['Subtract $9$ from both sides.'] },
      { ref: 'B1', answer: '$x = 15$', steps: ['Multiply both sides by $5$.'] },
      { ref: 'B2', answer: '$x = 5$', steps: ['$3x = 15$', '$x = 5$'] },
      { ref: 'B3', answer: '(C) $18$', steps: ['$\\frac{x}{3} = 6$, so $x = 18$.'] },
      { ref: 'B4', answer: '$x = 15$', steps: ['$2x = 30$', '$x = 15$'] },
      { ref: 'B5', answer: '$\\frac{7}{8}$', steps: ['$\\frac{6}{8} + \\frac{1}{8} = \\frac{7}{8}$'] },
      { ref: 'B6', answer: '$x = 22$', steps: ['$x - 4 = 18$', '$x = 22$'] },
      { ref: 'C1', answer: '$12$ slices', steps: ['$\\frac{1}{4}s = 3$', '$s = 12$'] },
      { ref: 'D1', answer: '$x = 12$', steps: ['$\\frac{5x}{6} = 10$', '$x = 12$'] },
      { ref: 'E1', answer: 'Multiplying by $5$ undoes dividing by $5$, so $x$ is left alone.', steps: [] },
      { ref: 'E2', answer: 'Answers vary.', steps: [] },
    ],
  };
}
