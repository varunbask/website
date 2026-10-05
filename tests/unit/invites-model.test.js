import { describe, test, expect } from 'vitest';
import {
  newInviteToken, inviteLink, inviteMessage, namesText, readToken, joinCopy, joinProblem, joinError, inviteState,
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
