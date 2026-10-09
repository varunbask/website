import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpSections, helpLede, supportMailto, partsText, SUPPORT_EMAIL, PRIVACY_PATH } from '../../portal/js/help-model.js';
import { MAX_SUBMISSIONS } from '../../portal/js/buckets.js';

const PORTAL = fileURLToPath(new URL('../../portal', import.meta.url));
const ids = (role) => helpSections(role).map((s) => s.id);

// Every block's text as plain strings, and every link
function textsOf(section) {
  const out = [];
  for (const block of section.blocks) {
    if (block.type === 'p') out.push(partsText(block.parts));
    else if (block.type === 'steps' || block.type === 'list') out.push(...block.items.map(partsText));
    else if (block.type === 'actions') out.push(...block.actions.map((a) => a.label));
  }
  return out;
}
const allText = (role) => helpSections(role).flatMap((s) => [s.title, ...textsOf(s)]).join('\n');
function linksOf(role) {
  const out = [];
  for (const section of helpSections(role)) {
    for (const block of section.blocks) {
      if (block.type === 'actions') out.push(...block.actions.map((a) => ({ text: a.label, href: a.href })));
      else for (const item of block.items ?? [block.parts]) out.push(...[].concat(item).filter((p) => typeof p !== 'string'));
    }
  }
  return out;
}

describe('support address', () => {
  test('one constant, and the mailto built from it', () => {
    expect(SUPPORT_EMAIL).toBe('vbmgroupsllc@gmail.com');
    expect(supportMailto()).toBe('mailto:vbmgroupsllc@gmail.com');
    expect(supportMailto('Portal question')).toBe('mailto:vbmgroupsllc@gmail.com?subject=Portal%20question');
  });

  test('the address is written once in the portal scripts that show it (help-model.js)', () => {
    const hits = [];
    for (const file of readdirSync(join(PORTAL, 'js'), { recursive: true })) {
      if (!String(file).endsWith('.js')) continue;
      if (readFileSync(join(PORTAL, 'js', String(file)), 'utf8').includes('vbmgroupsllc@gmail.com')) hits.push(String(file));
    }
    // invites-model.js already carries its own copy for the invite emails
    expect(hits).toContain('help-model.js');
    expect(hits.filter((f) => !['help-model.js', 'invites-model.js'].includes(f))).toEqual([]);
  });
});

describe('sections by role', () => {
  test('students and parents: contact, homework, schedule, install, privacy', () => {
    for (const role of ['student', 'parent']) expect(ids(role)).toEqual(['contact', 'homework', 'schedule', 'profile', 'install', 'privacy']);
  });

  test('tutors: staff tips, no family sections; admins add the admin tips', () => {
    expect(ids('tutor')).toEqual(['contact', 'notes', 'grading', 'drafts', 'google', 'profile', 'keyboard', 'install', 'privacy']);
    expect(ids('admin')).toEqual(['contact', 'notes', 'grading', 'drafts', 'google', 'profile', 'keyboard', 'admin', 'install', 'privacy']);
  });

  test('an unknown role gets the student help, never staff tips', () => {
    expect(ids('nobody')).toEqual(ids('student'));
  });

  test('every role gets a lede and a unique set of section ids and titles', () => {
    for (const role of ['student', 'parent', 'tutor', 'admin']) {
      expect(helpLede(role).length).toBeGreaterThan(10);
      const sections = helpSections(role);
      expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
      expect(new Set(sections.map((s) => s.title)).size).toBe(sections.length);
    }
  });
});

describe('contact', () => {
  test('families get the support sentence with a mail link', () => {
    for (const role of ['student', 'parent']) {
      const contact = helpSections(role)[0];
      expect(textsOf(contact)[0]).toBe('Questions about lessons, scheduling or billing? Email vbmgroupsllc@gmail.com.');
      const link = contact.blocks[0].parts.find((p) => typeof p !== 'string');
      expect(link).toEqual({ text: SUPPORT_EMAIL, href: 'mailto:vbmgroupsllc@gmail.com' });
      expect(contact.blocks.at(-1).actions[0].href.startsWith('mailto:vbmgroupsllc@gmail.com')).toBe(true);
    }
  });

  test('staff get their own sentence with the same address', () => {
    for (const role of ['tutor', 'admin']) {
      const first = textsOf(helpSections(role)[0])[0];
      expect(first).toContain('Email vbmgroupsllc@gmail.com');
      expect(first).not.toContain('billing');
    }
  });
});

describe('families', () => {
  test('homework: the real attempt limit, the tutor review, the results, and where feedback appears', () => {
    for (const role of ['student', 'parent']) {
      const text = textsOf(helpSections(role).find((s) => s.id === 'homework')).join('\n');
      expect(text).toContain(`up to ${MAX_SUBMISSIONS} times`);
      expect(text).toMatch(/tutor reviews (the|your) work and marks it Completed, Missing or Extended, with feedback/);
      expect(text).toContain('Graded');
      expect(text).not.toMatch(/\bAI\b|assistant|draft/);
      // the three results, explained, and no score anywhere
      expect(text).toMatch(/Completed: the work was done/);
      expect(text).toMatch(/Missing: nothing usable was handed in/);
      expect(text).toMatch(/Extended: more time, so the assignment goes back to To do with a new due date/);
      expect(text).not.toMatch(/score/i);
      expect(text).toContain('20 MB');
    }
  });

  test('students submit; parents are told only their child can', () => {
    const student = textsOf(helpSections('student').find((s) => s.id === 'homework')).join('\n');
    const parent = textsOf(helpSections('parent').find((s) => s.id === 'homework')).join('\n');
    expect(student).toContain('Submit work');
    expect(parent).toContain('only they can submit');
  });

  test('schedule: students can get Google Calendar invites, parents are pointed to their child', () => {
    const student = textsOf(helpSections('student').find((s) => s.id === 'schedule')).join('\n');
    const parent = textsOf(helpSections('parent').find((s) => s.id === 'schedule')).join('\n');
    expect(student).toContain('Get Google Calendar invites');
    expect(student).toContain('Stop invites');
    expect(parent).not.toContain('Get Google Calendar invites');
    expect(parent).toMatch(/Your child can turn them on/);
  });

  test('rescheduling: who to tell, and nothing about notice periods or what cancelling costs', () => {
    expect(textsOf(helpSections('student').find((s) => s.id === 'schedule')).join('\n'))
      .toContain('Need to reschedule or cancel a lesson? Tell your tutor or email us.');
    expect(textsOf(helpSections('parent').find((s) => s.id === 'schedule')).join('\n'))
      .toContain('Need to reschedule or cancel a lesson? Tell your child’s tutor or email us.');
    for (const role of ['student', 'parent']) {
      const text = allText(role);
      expect(text).not.toMatch(/24 hours|Late cancellations|\bcharges?\b|\bfees?\b|\bfree\b/i);
    }
  });

  test('families never see staff tips', () => {
    for (const role of ['student', 'parent']) {
      const text = allText(role);
      expect(text).not.toMatch(/Release to family|Review queue|Write session notes|Reconnect/);
    }
  });
});

describe('staff', () => {
  test('session notes, the review queue, Google sync and keyboard tips', () => {
    const text = (id) => textsOf(helpSections('tutor').find((s) => s.id === id)).join('\n');
    expect(text('notes')).toContain('Write session notes');
    expect(text('notes')).toMatch(/family reads your notes/);
    expect(text('grading')).toContain('Release to family');
    expect(text('grading')).toMatch(/see nothing until you release/);
    expect(text('grading')).toMatch(/Choose Completed when the work was done, Missing when nothing usable came in, or Extended/);
    expect(text('grading')).toMatch(/pick the new due date/);
    expect(text('grading')).toContain('use Extend');
    expect(text('grading')).not.toMatch(/score/i);
    expect(text('google')).toContain('VP Education sessions');
    expect(text('google')).toContain('Reconnect Google Calendar');
    expect(text('keyboard')).toContain('Page Up and Page Down');
  });

  test('drafting homework from lesson materials: where to start, what it reads, the wait, and that the answer key is staff only', () => {
    const text = textsOf(helpSections('tutor').find((s) => s.id === 'drafts')).join('\n');
    expect(text).toContain('Make homework from this lesson');
    expect(text).toContain('Draft with AI from lesson materials');
    expect(text).toMatch(/photos of the whiteboard or worksheet, PDFs, Word, PowerPoint or Excel files, or paste your lesson notes/);
    expect(text).toMatch(/deleted right after/);
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).toContain('Recent drafts');
    expect(text).toMatch(/Nothing is saved until you do/);
    expect(text).toMatch(/students and parents never see it/);
    for (const role of ['student', 'parent']) expect(allText(role)).not.toMatch(/lesson photos|lesson materials|answer key|Recent drafts/i);
  });

  test('the worksheet: families print, fill in on paper or mark it up; staff preview it', () => {
    const student = textsOf(helpSections('student').find((s) => s.id === 'homework')).join('\n');
    const parent = textsOf(helpSections('parent').find((s) => s.id === 'homework')).join('\n');
    expect(student).toContain('Print it and fill it in on paper, then take a photo or scan to hand it in. Or choose Mark up');
    expect(parent).toMatch(/Worksheet: open, print or download it so your child can fill it in on paper/);
    for (const text of [student, parent]) expect(text).not.toMatch(/\bAI\b|answer key|[\u2013\u2014]/);
    const drafts = textsOf(helpSections('tutor').find((s) => s.id === 'drafts')).join('\n');
    expect(drafts).toContain('Preview worksheet');
  });

  test('only admins get People and Account', () => {
    expect(allText('admin')).toMatch(/People is where/);
    expect(allText('tutor')).not.toMatch(/People is where/);
  });
});

describe('everyone', () => {
  test('privacy links to /privacy.html', () => {
    expect(PRIVACY_PATH).toBe('/privacy.html');
    for (const role of ['student', 'parent', 'tutor', 'admin']) {
      expect(linksOf(role).some((l) => l.href === '/privacy.html')).toBe(true);
    }
  });

  test('every link goes somewhere real: a portal route, the privacy page or the support mailto', () => {
    const routes = new Set(['assignments', 'calendar', 'review', 'students', 'profile']);
    for (const role of ['student', 'parent', 'tutor', 'admin']) {
      for (const { href } of linksOf(role)) {
        if (href.startsWith('#/')) expect(routes.has(href.slice(2).split(/[/?]/)[0]), `${role} ${href}`).toBe(true);
        else expect(href === PRIVACY_PATH || href.startsWith('mailto:vbmgroupsllc@gmail.com'), `${role} ${href}`).toBe(true);
      }
    }
  });

  test('plain English: no em or en dashes, no messaging the portal does not have', () => {
    for (const role of ['student', 'parent', 'tutor', 'admin']) {
      const text = `${helpLede(role)}\n${allText(role)}`;
      expect(text).not.toMatch(/[\u2013\u2014]/);
      expect(text).not.toMatch(/message (your|the) tutor/i);
    }
  });
});

describe('dead ends are gone', () => {
  const read = (name) => readFileSync(join(PORTAL, 'js', name), 'utf8');

  test('the attempt-limit and failed-upload lines point to the support address, not to a message the portal cannot send', () => {
    for (const name of ['item-drawer.js', 'submit-work.js']) {
      const source = read(name);
      expect(source, name).not.toMatch(/Message your tutor/i);
      expect(source, name).toContain("from './help-model.js'");
      expect(source, name).toContain('SUPPORT_EMAIL');
    }
    expect(read('submit-work.js')).not.toContain('email it to your tutor');
    expect(read('item-drawer.js')).not.toMatch(/used all 5 attempts/);
  });
});

describe('your profile', () => {
  const section = (role) => helpSections(role).find((s) => s.id === 'profile');
  const text = (role) => textsOf(section(role)).join('\n');

  test('students, parents and tutors each get a short Your profile section that links to the page', () => {
    for (const role of ['student', 'parent', 'tutor', 'admin']) {
      expect(section(role).title).toBe('Your profile');
      const links = section(role).blocks.flatMap((b) => b.items).flat().filter((p) => typeof p === 'object');
      expect(links).toContainEqual({ text: 'Profile', href: '#/profile' });
    }
  });

  test('it says who sees the profile and that photos lose their location data', () => {
    expect(text('student')).toMatch(/your parents, your tutors and the admin/);
    expect(text('parent')).toMatch(/their tutors and the admin/);
    expect(text('tutor')).toMatch(/Families of the students you teach/);
    for (const role of ['student', 'parent', 'tutor']) expect(text(role)).toMatch(/location data is removed/);
  });

  test('no AI wording and no dashes', () => {
    for (const role of ['student', 'parent', 'tutor']) {
      expect(text(role)).not.toMatch(/\bAI\b|grader|automatic/i);
      expect(text(role)).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
