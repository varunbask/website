// The fixed SAT catalog: the eight domains, readable ids, the College Board
// skills (from the Question Bank folders or the research plan's taxonomy),
// and the topic rules that place a full-test question in a domain and skill.

export const DOMAINS = [
  { n: 1, slug: 'information-and-ideas', name: 'Information and Ideas', abbr: 'ii', section: 'rw' },
  { n: 2, slug: 'craft-and-structure', name: 'Craft and Structure', abbr: 'cs', section: 'rw' },
  { n: 3, slug: 'expression-of-ideas', name: 'Expression of Ideas', abbr: 'ei', section: 'rw' },
  { n: 4, slug: 'standard-english-conventions', name: 'Standard English Conventions', abbr: 'sec', section: 'rw' },
  { n: 5, slug: 'algebra', name: 'Algebra', abbr: 'alg', section: 'math' },
  { n: 6, slug: 'advanced-math', name: 'Advanced Math', abbr: 'am', section: 'math' },
  { n: 7, slug: 'problem-solving-and-data-analysis', name: 'Problem-Solving and Data Analysis', abbr: 'psda', section: 'math' },
  { n: 8, slug: 'geometry-and-trigonometry', name: 'Geometry and Trigonometry', abbr: 'geo', section: 'math' },
];
export const domainByN = (n) => DOMAINS.find((d) => d.n === Number(n)) ?? null;
export const domainBySlug = (slug) => DOMAINS.find((d) => d.slug === slug) ?? null;

export const MODULES = {
  rw: { minutes: 32, count: 27 },
  math: { minutes: 35, count: 22 },
};
export const FULL_MODULES = [
  { key: 'rw1', title: 'Reading and Writing, Module 1', minutes: 32, section: 'rw' },
  { key: 'rw2', title: 'Reading and Writing, Module 2', minutes: 32, section: 'rw' },
  { key: 'm1', title: 'Math, Module 1', minutes: 35, section: 'math' },
  { key: 'm2', title: 'Math, Module 2', minutes: 35, section: 'math' },
];

export const MAX_ID = 60;

// Text -> lowercase [a-z0-9-] slug
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A slug cut at a word boundary to at most max characters
export function trimSlug(slug, max = MAX_ID) {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1);
  const at = cut.lastIndexOf('-');
  return (at > 0 ? cut.slice(0, at) : slug.slice(0, max)).replace(/-+$/, '');
}

export const pad2 = (n) => String(n).padStart(2, '0');

// Ids (see the spec: stable, readable, at most 60 characters)
export const ids = {
  practice: (abbr, chapter) => `${abbr}-ch${chapter}`,
  skillTest: (abbr, n) => `${abbr}-t${n}`,
  fullTest: (n) => `full-${pad2(n)}`,
  item: (set, q, module = null) => (module ? `${set}-${module}-${pad2(q)}` : `${set}-${pad2(q)}`),
  skill: (abbr, name) => trimSlug(`${abbr}-${slugify(name)}`),
};

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'vs', 'with', 'nor']);

// "linear equations in one variable" -> "Linear Equations in One Variable"
export function titleCase(text) {
  let first = true;
  return String(text).split(/(\s+)/).map((word) => {
    if (/^\s+$/.test(word)) return word;
    const lower = word.toLowerCase();
    const out = !first && SMALL.has(lower)
      ? lower
      : word.split('-').map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part)).join('-');
    first = /[:.]$/.test(word);
    return out;
  }).join('');
}

// A Question Bank folder or file name, tidied: "3. One-variable data_ Distributions " -> "One-variable data: Distributions"
export function cleanName(name) {
  return String(name)
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/_\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words of a name, for matching names written slightly differently
export function nameKey(name) {
  return cleanName(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function overlap(a, b) {
  const x = new Set(nameKey(a).split(' '));
  const y = new Set(nameKey(b).split(' '));
  const common = [...x].filter((w) => y.has(w)).length;
  return common / Math.max(x.size, y.size);
}
// The best match for a name among candidates (by their .name), or null
export function matchName(name, candidates, min = 0.6) {
  const exact = candidates.find((c) => nameKey(c.name) === nameKey(name));
  if (exact) return exact;
  let best = null;
  let score = 0;
  for (const c of candidates) {
    const s = overlap(name, c.name);
    if (s > score) {
      best = c;
      score = s;
    }
  }
  return score >= min ? best : null;
}

// Reading and Writing topic comments -> official skill names
const RW_RULES = [
  [/words in context/i, 'craft-and-structure', 'Words in Context'],
  [/text structure/i, 'craft-and-structure', 'Text Structure and Purpose'],
  [/cross[- ]text/i, 'craft-and-structure', 'Cross-Text Connections'],
  [/central idea/i, 'information-and-ideas', 'Central Ideas and Details'],
  [/command of evidence/i, 'information-and-ideas', 'Command of Evidence'],
  [/inference/i, 'information-and-ideas', 'Inferences'],
  [/boundar/i, 'standard-english-conventions', 'Boundaries'],
  [/form, structure|form structure|structure, and sense/i, 'standard-english-conventions', 'Form, Structure, and Sense'],
  [/transition/i, 'expression-of-ideas', 'Transitions'],
  [/rhetorical synthesis/i, 'expression-of-ideas', 'Rhetorical Synthesis'],
];

const NL_EQ = 'Nonlinear equations in one variable and systems of equations in two variables';
// Math topic comments -> official skill names (first match wins)
const MATH_RULES = [
  [/circle|sector|\barcs?\b|semicircle|radian/i, 'geometry-and-trigonometry', 'Circles'],
  [/trig|right-triangle|right triangle|special right|pythag|30-60-90/i, 'geometry-and-trigonometry', 'Right triangles and trigonometry'],
  [/two-way table|probabilit/i, 'problem-solving-and-data-analysis', 'Probability and conditional probability'],
  [/margin of error|inference|sample/i, 'problem-solving-and-data-analysis', 'Inference from sample statistics and margin of error'],
  [/observational|experiment|statistical claim|causation|random assignment/i, 'problem-solving-and-data-analysis', 'Evaluating statistical claims: Observational studies and experiments'],
  [/\bmean\b|median|standard deviation|outlier|dot plot|histogram|box plot|one-variable data/i, 'problem-solving-and-data-analysis', 'One-variable data: Distributions and measures of center and spread'],
  [/exponential|half-life|doubling|growth factor|\bdecay\b/i, 'advanced-math', 'Nonlinear functions'],
  [/equivalent expression|radicals and rational exponents|polynomial factor|rational expression/i, 'advanced-math', 'Equivalent expressions'],
  [/quadratic|parabola|vertex|radical|rational|absolute|nonlinear|discriminant|tangen|zeros|cubic|asymptote|leading coefficient/i, 'advanced-math', null],
  [/function transformation|function notation|composition|transformation\b|translated|compression|piecewise/i, 'advanced-math', 'Nonlinear functions'],
  [/volume|surface area|cylinder|\bcones?\b|sphere|prism|pyramid|\barea\b|perimeter|trapezoid|parallelogram|border|\bbox\b|\btank\b/i, 'geometry-and-trigonometry', 'Area and volume'],
  [/triangle|angle|transversal|similar|isosceles|altitude/i, 'geometry-and-trigonometry', 'Lines, angles, and triangles'],
  [/best fit|scatter|line graph|bar chart|two-series|distance-+time graph|two-variable data/i, 'problem-solving-and-data-analysis', 'Two-variable data: Models and scatterplots'],
  [/percent|markup|discount/i, 'problem-solving-and-data-analysis', 'Percentages'],
  [/inequalit|budget|boundary reasoning|at least|at most/i, 'algebra', 'Linear inequalities in one or two variables'],
  [/slope|linear model|linear function|linear expression|intercept|rate of change|rate of decrease|rate in a linear|decreasing linear|constant term|coefficient in a two-variable|linear graph|input value|stated output/i, 'algebra', 'Linear functions'],
  [/ratio|\brates?\b|\bunits?\b|proportion|\bscale\b/i, 'problem-solving-and-data-analysis', 'Ratios, rates, proportional relationships, and units'],
  [/system|break-even|intersection of two|two plans|two linear plans|two companies|two-condition|mixture|investment|fuel model/i, 'algebra', 'Systems of two linear equations in two variables'],
  [/one variable|with fractions|clearing fractions|rearrange, solve/i, 'algebra', 'Linear equations in one variable'],
  [/infinitely many|no solution|parameter/i, 'algebra', 'Systems of two linear equations in two variables'],
  [/two variables|\blines?\b|perpendicular|parallel|xy-plane|coordinate/i, 'algebra', 'Linear equations in two variables'],
];

// A full-test topic comment -> { domain, skillName } or null
export function classifyTopic(topic, section) {
  const t = String(topic ?? '')
    .replace(/\\emph\{SPR\}|\(SPR\)/g, '')
    .replace(/(,|with a|plus a|then a)?\s*transformed target/gi, '')
    .replace(/\(no diagram supplied\)|no diagram|\(figure\)|figure not to scale/gi, '');
  if (!t.trim()) return null;
  const rules = section === 'rw' ? RW_RULES : MATH_RULES;
  for (const [re, domain, name] of rules) {
    if (!re.test(t)) continue;
    if (name) return { domain, skillName: name };
    const equation = /equation|system|solution|solve|tangen|intersect|discriminant|shared point|undefined/i.test(t);
    return { domain, skillName: equation ? NL_EQ : 'Nonlinear functions' };
  }
  return null;
}

// The Question Bank tree -> official skills [{ domain, name, position, folder }]
// (folders "5. Algebra/1. Linear equations in one variable")
export function qbSkills(entries) {
  const out = [];
  for (const { domainFolder, skillFolder } of entries) {
    const dn = /^\s*(\d+)/.exec(domainFolder);
    const sn = /^\s*(\d+)/.exec(skillFolder);
    const domain = dn ? domainByN(dn[1]) : null;
    if (!domain) continue;
    const name = cleanName(skillFolder);
    if (out.some((s) => s.domain === domain.slug && nameKey(s.name) === nameKey(name))) continue;
    out.push({ domain: domain.slug, name, position: sn ? Number(sn[1]) : out.length + 1, folder: `${domainFolder}/${skillFolder}` });
  }
  return out;
}
