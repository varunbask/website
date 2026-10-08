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
