import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  newInviteToken, inviteLink, inviteMessage, namesText, readToken, joinCopy, joinProblem, joinError, inviteState,
  parseFamilyLines, planFamilies, signupMatches, signupChoices, bareName, confirmWordFor, confirmMatches, familyText,
} from '../../portal/js/invites-model.js';

describe('invite links', () => {
  test('a 43-character token, carried after #', () => {
    const t = newInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newInviteToken()).not.toBe(t);
    expect(inviteLink(t, 'https://www.varunbaskaran.com')).toBe(`https://www.varunbaskaran.com/portal/join.html#t=${t}`);
  });

  test('the token is read from # or ?, and only in the right shape', () => {
    const t = 'A'.repeat(43);
    expect(readToken({ hash: `#t=${t}`, search: '' })).toBe(t);
    expect(readToken({ hash: '', search: `?t=${t}` })).toBe(t);
    expect(readToken({ hash: '#t=short', search: '' })).toBeNull();
    expect(readToken({ hash: '#t=<script>', search: '' })).toBeNull();
    expect(readToken({})).toBeNull();
  });

  test('the message names the parent and their children', () => {
    expect(namesText(['Maya Lin', 'Leo Park'])).toBe('Maya and Leo');
    const msg = inviteMessage('Grace Lin', 'https://l.test/j', { role: 'parent', children: ['Maya Lin'] });
    expect(msg).toBe('Hi Grace, your VP Education Group portal account is ready. Set your email and password here to see Maya’s lessons, homework and monthly statements: https://l.test/j (the link works once, for 30 days)');
    expect(inviteMessage('Leo Park', 'https://l.test/j', { role: 'student' })).toContain('see your lessons, homework and progress');
    expect(msg).not.toMatch(/[–—]/);
  });
});

describe('the join page', () => {
  test('welcome copy', () => {
    expect(joinCopy({ name: 'Grace Lin', role: 'parent', children: ['Maya Lin'] })).toEqual({
      first: 'Grace',
      lede: 'VP Education Group set up an account for you. Choose the email and password you will sign in with, then see Maya’s lessons, homework and monthly statements.',
    });
    expect(joinCopy({ name: 'Leo', role: 'student' }).lede).toContain('your lessons, homework and progress');
  });

  test('problems and errors', () => {
    expect(joinProblem('used').title).toBe('This link was already used');
    expect(joinProblem('expired').title).toBe('This link has expired');
    expect(joinProblem('whatever').title).toBe('This link doesn’t work');
    expect(joinError(409)).toContain('already has a portal account');
    expect(joinError(422, { errors: { password: 'too_short' } })).toBe('Use a password of 8 to 72 characters.');
    expect(joinError(422, { errors: { password: 'weak' } })).toContain('stronger password');
    expect(joinError(500)).toBe('Something went wrong. Try again in a moment.');
  });
});

describe('a person’s latest invite', () => {
  const NOW = Date.parse('2026-10-05T19:00:00Z');
  test('none, open, used, expired', () => {
    expect(inviteState([], NOW).key).toBe('none');
    const a = { created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-31T00:00:00Z', used_at: null };
    const b = { created_at: '2026-09-01T00:00:00Z', expires_at: '2026-10-01T00:00:00Z', used_at: null };
    expect(inviteState([b, a], NOW)).toEqual({ key: 'open', invite: a });
    expect(inviteState([b], NOW).key).toBe('expired');
    expect(inviteState([{ ...a, used_at: '2026-10-02T00:00:00Z' }], NOW).key).toBe('used');
  });
});

describe('adding families from a list', () => {
  const REFERENCE = readFileSync(new URL('../../docs/account-view/reference-rates.txt', import.meta.url), 'utf8');

  test('reads the scheduler lines, with or without a parent and rates', () => {
    const { rows, errors } = parseFamilyLines('Amy (Ryan): Math $45\n  Mason  (Sunny) \nLeo\n\n(Ryan)\nRachel (Mrs. Manyala): Math $60');
    expect(rows.map((r) => [r.student, r.parent])).toEqual([['Amy', 'Ryan'], ['Mason', 'Sunny'], ['Leo', null], ['Rachel', 'Mrs. Manyala']]);
    expect(errors).toEqual([{ line: '(Ryan)', error: 'Write it as Student (Parent)' }]);
    expect(parseFamilyLines(`${'x'.repeat(121)} (Ryan)`).errors).toHaveLength(1);
  });

  test('the whole old scheduler into an empty portal: 27 students, 19 parents, 27 links', () => {
    const { rows, errors } = parseFamilyLines(REFERENCE);
    expect(errors).toEqual([]);
    const plan = planFamilies(rows, { people: [] });
    expect(plan.problems).toEqual([]);
    expect(plan.add.filter((p) => p.role === 'student')).toHaveLength(27);
    expect(plan.add.filter((p) => p.role === 'parent')).toHaveLength(19);
    expect(plan.links).toHaveLength(27);
    // Sunny's three children share one parent
    const sunny = plan.add.find((p) => p.name === 'Sunny');
    expect(plan.links.filter((l) => l.parent === sunny.key)).toHaveLength(3);
    // Jayden and Jayden Lieu are two students
    expect(plan.add.filter((p) => p.name.startsWith('Jayden')).map((p) => p.name)).toEqual(['Jayden', 'Jayden Lieu']);
  });

  test('reuses an exact name, skips links that exist, and never guesses from a first name', () => {
    const people = [
      { id: 's1', full_name: 'Amy', role: 'student' },
      { id: 'p1', full_name: 'ryan', role: 'parent' },
      { id: 'p2', full_name: 'Grace Lin', role: 'parent' },
      { id: 's2', full_name: 'Kevin', role: 'student' },
      { id: 's3', full_name: 'Kevin', role: 'student' },
      { id: 't1', full_name: 'Sunny', role: 'tutor' },
    ];
    const { rows } = parseFamilyLines('Amy (Ryan)\nCamila (Grace)\nKevin (Alan)\nMason (Sunny)\nGordon (Grace Lin)');
    const plan = planFamilies(rows, { people, parentLinks: [{ parent_id: 'p1', student_id: 's1' }] });
    expect(plan.found.map((p) => p.id).sort()).toEqual(['p1', 'p2', 's1']);
    expect(plan.problems).toEqual([
      { line: 'Camila (Grace)', reason: 'Is this Grace Lin? Write the full name to use that account' },
      { line: 'Kevin (Alan)', reason: 'There are 2 students named Kevin in the portal; link this one by hand' },
    ]);
    // Camila is not added because her line needs attention; a tutor named Sunny is not a parent
    expect(plan.add.map((p) => `${p.role} ${p.name}`)).toEqual(['student Mason', 'parent Sunny', 'student Gordon']);
    expect(plan.links).toEqual([
      { parent: 'new:parent:sunny', student: 'new:student:mason' },
      { parent: 'id:p2', student: 'new:student:gordon' },
    ]);
  });
});

describe('a sign-up that may be someone added without a login', () => {
  const people = [
    { id: 'a', full_name: 'Amy', role: 'student', no_login: true },
    { id: 'b', full_name: 'Amy Chen', role: 'student', no_login: true },
    { id: 'c', full_name: 'Mary', role: 'parent', no_login: true },
    { id: 'd', full_name: 'Mary', role: 'student', no_login: true },
    { id: 'e', full_name: 'Leo Park', role: 'student', no_login: false },
    { id: 'f', full_name: 'Sunny', role: 'tutor', no_login: true },
  ];
  const ids = (signup) => signupMatches(signup, people).map((m) => `${m.person.id}${m.exact ? '!' : ''}`);

  test('same full name first, then a first name against a first name only', () => {
    expect(ids({ id: 'x', full_name: 'Amy Chen', requested_role: 'student' })).toEqual(['b!', 'a']);
    expect(ids({ id: 'x', full_name: '  amy ', requested_role: null })).toEqual(['a!', 'b']);
  });

  test('two different surnames never match', () => {
    expect(ids({ id: 'x', full_name: 'Amy Park', requested_role: 'student' })).toEqual(['a']);
  });

  test('only the role they asked for, and never tutors, admins or people who already sign in', () => {
    expect(ids({ id: 'x', full_name: 'Mary Smith', requested_role: 'parent' })).toEqual(['c']);
    expect(ids({ id: 'x', full_name: 'Mary', requested_role: null })).toEqual(['c!', 'd!']);
    expect(ids({ id: 'x', full_name: 'Sunny', requested_role: 'tutor' })).toEqual([]);
    expect(ids({ id: 'x', full_name: 'Leo Park', requested_role: 'student' })).toEqual([]);
    expect(ids({ id: 'x', full_name: '', requested_role: 'student' })).toEqual([]);
  });
});

describe('two parents with one name (the Grace case)', () => {
  // Camila's mom and Gordon's mom were both added without a login; Gordon's mom signs up as Grace Young
  const people = [
    { id: 'camila-mom', full_name: 'Grace', role: 'parent', no_login: true },
    { id: 'gordon-mom', full_name: 'Grace (Gordon’s Mom)', role: 'parent', no_login: true },
    { id: 'kim', full_name: 'Mrs. Kim', role: 'parent', no_login: true },
    { id: 'gordon', full_name: 'Gordon', role: 'student', no_login: true },
  ];
  const signup = { id: 'x', full_name: 'Grace Young', email: 'grace@example.com', requested_role: 'parent' };

  test('notes in brackets are not part of a name', () => {
    expect(bareName('Grace (Gordon’s Mom)')).toBe('grace');
    expect(bareName('  Mason  (Sunny)  Lee ')).toBe('mason lee');
    expect(bareName(null)).toBe('');
  });

  test('both Graces are offered, neither is picked as certain', () => {
    const found = signupMatches(signup, people);
    expect(found.map((m) => m.person.id)).toEqual(['camila-mom', 'gordon-mom']);
    expect(found.every((m) => m.reason === 'first' && !m.exact)).toBe(true);
  });

  test('a link already emailed to the sign-up address is the strongest match, whatever the name', () => {
    const invites = [{ profile_id: 'kim', emailed_to: 'GRACE@example.com' }, { profile_id: 'camila-mom', emailed_to: 'other@example.com' }];
    const found = signupMatches(signup, people, { invites });
    expect(found[0]).toMatchObject({ person: { id: 'kim' }, reason: 'email', exact: true });
    expect(found.map((m) => m.person.id)).toEqual(['kim', 'camila-mom', 'gordon-mom']);
  });

  test('any account of the role they asked for can be picked by hand', () => {
    expect(signupChoices(signup, people).map((p) => p.id)).toEqual(['camila-mom', 'gordon-mom', 'kim']);
    expect(signupChoices({ ...signup, requested_role: null }, people).map((p) => p.id)).toEqual(['gordon', 'camila-mom', 'gordon-mom', 'kim']);
    expect(signupChoices({ ...signup, requested_role: 'tutor' }, people)).toEqual([]);
  });

  test('confirming types the child\u2019s first name for a parent, else their own', () => {
    expect(confirmWordFor(people[1], ['Gordon Wu'])).toEqual({ word: 'Gordon', what: 'the child’s first name' });
    expect(confirmWordFor(people[1], [])).toEqual({ word: 'Grace', what: 'their first name' });
    expect(confirmWordFor(people[3], ['Gordon'])).toEqual({ word: 'Gordon', what: 'their first name' });
    expect(confirmMatches(' gordon ', 'Gordon')).toBe(true);
    expect(confirmMatches('Camila', 'Gordon')).toBe(false);
    expect(confirmMatches('', '')).toBe(false);
  });

  test('each account is described by its family', () => {
    expect(familyText({ role: 'parent', children: ['Gordon'], paying: ['Gordon'] })).toBe('Parent of Gordon; pays for Gordon');
    expect(familyText({ role: 'parent', children: ['Camila', 'Leo', 'Ava'] })).toBe('Parent of Camila, Leo and Ava');
    expect(familyText({ role: 'parent' })).toBe('No children linked yet');
    expect(familyText({ role: 'student', parents: ['Grace Young'] })).toBe('Student; parent Grace Young');
    expect(familyText({ role: 'student', parents: ['Ann', 'Bo'] })).toBe('Student; parents Ann and Bo');
    expect(familyText({ role: 'student' })).toBe('Student; no parent linked yet');
  });
});
