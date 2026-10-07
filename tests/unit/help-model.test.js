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
    for (const role of ['student', 'parent']) expect(ids(role)).toEqual(['contact', 'homework', 'schedule', 'install', 'privacy']);
  });

  test('tutors: staff tips, no family sections; admins add the admin tips', () => {
    expect(ids('tutor')).toEqual(['contact', 'notes', 'grading', 'google', 'keyboard', 'install', 'privacy']);
    expect(ids('admin')).toEqual(['contact', 'notes', 'grading', 'google', 'keyboard', 'admin', 'install', 'privacy']);
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
  test('homework: the real attempt limit, the AI draft, tutor check, and where feedback appears', () => {
    for (const role of ['student', 'parent']) {
      const text = textsOf(helpSections(role).find((s) => s.id === 'homework')).join('\n');
      expect(text).toContain(`up to ${MAX_SUBMISSIONS} times`);
      expect(text).toMatch(/AI assistant drafts a grade/);
      expect(text).toMatch(/tutor checks every grade/);
      expect(text).toContain('Graded');
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

  test('rescheduling: no notice period and no charge for cancelling', () => {
    for (const role of ['student', 'parent']) {
      const text = textsOf(helpSections(role).find((s) => s.id === 'schedule')).join('\n');
      expect(text).toContain('There is no charge for cancelling.');
      expect(text).not.toMatch(/24 hours|Late cancellations/);
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
    expect(text('google')).toContain('VP Education sessions');
    expect(text('google')).toContain('Reconnect Google Calendar');
    expect(text('keyboard')).toContain('Page Up and Page Down');
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
    const routes = new Set(['assignments', 'calendar', 'review', 'students']);
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
