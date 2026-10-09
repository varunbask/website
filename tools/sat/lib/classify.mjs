// Domain and skill for questions in mixed tests (the full tests).
//
// Reading and Writing questions say what they test in their own wording
// ("most logical transition", "conforms to the conventions of Standard
// English"), so they are read from the question itself.
//
// Math questions carry a topic comment ("% ----- Q4  Two-way table -----"),
// but in some modules the questions were reordered after the comments were
// written. When a module's grid-in marks in the comments do not line up
// with its grid-in questions, comments are matched to questions by the
// words they share (each comment to one question) before they are read.

const STOP = new Set(('the and for with from into that this then than what which when where while each every their there these those '
  + 'model context interpreting interpret value values given find using used figure diagram supplied transformed target '
  + 'abstract combined plus two one three four step steps after before over under between equation equations '
  + 'expression expressions function functions question form').split(' '));

function stem(word) {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function words(text) {
  const out = new Set();
  for (const w of String(text ?? '').toLowerCase().replace(/\\[a-z]+/g, ' ').split(/[^a-z]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

const isSprTopic = (topic) => /\bSPR\b/.test(topic ?? '');

// How strongly a math question's text points at each domain (keyword counts)
const DOMAIN_SIGNS = {
  'geometry-and-trigonometry': [[/\\(sin|cos|tan)\b|hypotenuse|right triangle|pythag/g, 3], [/circle|radius|radii|diameter|circumference|\barcs?\b|sector|radian/g, 3], [/triangle|\\triangle|\\angle|angle|parallel lines|transversal|similar|congruent|isosceles|equilateral/g, 2], [/\bvolume|surface area|cylinder|\bcones?\b|sphere|prism|pyramid|\bcube\b|perimeter|\barea\b|cubic/g, 2]],
  'problem-solving-and-data-analysis': [[/probabilit|at random|two-way table/g, 3], [/\bmean\b|median|standard deviation|\boutlier|data set|dot plot|histogram|box plot/g, 3], [/margin of error|sample|survey|population|confidence/g, 3], [/scatterplot|best fit/g, 3], [/percent|\\%/g, 2], [/ratio|\bper\b|convert|\bunits?\b|proportional|scale|density/g, 1]],
  'advanced-math': [[/\^\{?2\}?|\^\{?3\}?|quadratic|parabola|vertex|discriminant|polynomial|\\sqrt|radical|exponential|\^\{?t\b|\^\{?\\frac|\^\{?x\b|asymptote|zeros?\b|factor/g, 2], [/equivalent|rational/g, 1]],
  algebra: [[/slope|intercept|linear|\\begin\{cases\}|system|inequalit|\\leq?\b|\\geq?\b|\bat least\b|\bat most\b|no solution|infinitely many|xy-plane/g, 1.5]],
};
export function domainSigns(text) {
  const t = String(text ?? '').toLowerCase();
  const out = {};
  for (const [d, rules] of Object.entries(DOMAIN_SIGNS)) out[d] = rules.reduce((n, [re, w]) => n + (t.match(re) ?? []).length * w, 0);
  return out;
}

const JOINERS = new Set(['and', 'but', 'or', 'so', 'yet', 'for', 'nor', 'namely', 'however', 'therefore', 'thus', 'which', 'that', 'while', 'because', 'then', 'also', 'as', 'including', 'such', 'whereas', 'although', 'though', 'moreover', 'furthermore', 'instead', 'meanwhile', 'consequently', 'indeed', 'nevertheless', 'still', 'specifically', 'similarly']);

// questions: [{ q, text, spr }], topics: Map q -> topic
// -> { topics: Map q -> topic, reordered: boolean, weak: [q] }
export function matchTopics(questions, topics, { force = false, topicDomain = null } = {}) {
  const flagged = questions.filter((it) => topics.has(it.q) && isSprTopic(topics.get(it.q)));
  const mismatch = questions.some((it) => topics.has(it.q) && isSprTopic(topics.get(it.q)) !== it.spr);
  if (!force && (!flagged.length || !mismatch)) return { topics, reordered: false, weak: [] };

  const list = [...topics.entries()].map(([q, topic]) => ({ q, topic, words: words(topic.replace(/\\emph\{SPR\}|\(SPR\)/g, '')), spr: isSprTopic(topic), domain: topicDomain?.(topic) ?? null }));
  const texts = questions.map((it) => {
    const signs = domainSigns(it.text);
    const top = Math.max(1, ...Object.values(signs));
    return { ...it, words: words(it.text), signs, top };
  });
  // rarer shared words count for more
  const df = new Map();
  for (const t of texts) for (const w of t.words) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w) => Math.log(1 + texts.length / (df.get(w) ?? texts.length));
  const pairs = [];
  for (const c of list) {
    const total = [...c.words].reduce((n, w) => n + weight(w), 0) || 1;
    for (const t of texts) {
      let s = 0;
      for (const w of c.words) if (t.words.has(w)) s += weight(w);
      s /= total;
      s += c.spr === t.spr ? 0.5 : -1;
      // a comment whose domain the question's own words point at fits better
      if (c.domain) s += 0.6 * ((t.signs[c.domain] ?? 0) / t.top);
      pairs.push({ c, t, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  const usedC = new Set();
  const usedT = new Set();
  const out = new Map();
  const weak = [];
  for (const p of pairs) {
    if (usedC.has(p.c.q) || usedT.has(p.t.q)) continue;
    usedC.add(p.c.q);
    usedT.add(p.t.q);
    out.set(p.t.q, p.c.topic);
    if (p.s < 0.75) weak.push(p.t.q);
  }
  return { topics: out, reordered: true, weak };
}

// A Reading and Writing question's skill from its own wording
// -> { domain, skillName } or null
export function classifyRw({ stem, passage = '', choices = [] }) {
  const s = String(stem ?? '');
  const all = `${passage}\n${s}`;
  if (/conventions of standard english/i.test(s) || (!/[?]/.test(s) && choices.length === 4 && /____/.test(all) && choices.every((c) => c.length < 60) && choices.some((c) => /^[\s,.;:—–-]*$|no punctuation/i.test(c)))) {
    // boundary choices differ only in punctuation and the joining words that go with it
    const letters = choices.map((c) => c.toLowerCase().replace(/no punctuation/g, '').split(/[^a-z\u2019']+/).filter((w) => w && !JOINERS.has(w)).join(' '));
    const punctuationOnly = choices.some((c) => /^[\s,.;:—–()-]*$|no punctuation/i.test(c)) || letters.every((l) => l === letters[0]);
    return { domain: 'standard-english-conventions', skillName: punctuationOnly ? 'Boundaries' : 'Form, Structure, and Sense' };
  }
  if (/logical transition/i.test(s)) return { domain: 'expression-of-ideas', skillName: 'Transitions' };
  if (/\bnotes\b|the student wants|student wants/i.test(s)) return { domain: 'expression-of-ideas', skillName: 'Rhetorical Synthesis' };
  if (/logical and precise word|most nearly mean|as used in the text/i.test(s)) return { domain: 'craft-and-structure', skillName: 'Words in Context' };
  if (/text 1/i.test(all) && /text 2/i.test(all)) return { domain: 'craft-and-structure', skillName: 'Cross-Text Connections' };
  if (/main purpose|overall structure|function of the|best describes the function/i.test(s)) return { domain: 'craft-and-structure', skillName: 'Text Structure and Purpose' };
  if (/logically completes the text/i.test(s)) return { domain: 'information-and-ideas', skillName: 'Inferences' };
  if (/data from the|uses data|from the (table|graph|chart)/i.test(s)) return { domain: 'information-and-ideas', skillName: 'Command of Evidence: Quantitative' };
  if (/support|weaken|quotation|illustrate|would most directly|finding/i.test(s)) return { domain: 'information-and-ideas', skillName: 'Command of Evidence: Textual' };
  if (/main idea|according to the text|based on the text|best states|best describes|central/i.test(s)) return { domain: 'information-and-ideas', skillName: 'Central Ideas and Details' };
  return null;
}
