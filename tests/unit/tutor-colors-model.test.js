import { describe, test, expect, afterEach } from 'vitest';
import {
  TUTOR_COLORS, COLOR_LABELS, NO_TONE, isColorName, colorMap, autoColor, colorFor, toneClassFor,
  setTutorColors, tutorColors, tutorToneClass, tutorColorOf, colorOptions, automaticLabel,
  chosenColors, pickerState, colorSavedText,
} from '../../portal/js/tutor-colors-model.js';

afterEach(() => setTutorColors(new Map()));

describe('the names', () => {
  test('are the fourteen the database accepts', () => {
    expect([...TUTOR_COLORS]).toEqual([
      'red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'slate',
    ]);
    expect(new Set(TUTOR_COLORS).size).toBe(14);
    expect(Object.isFrozen(TUTOR_COLORS)).toBe(true);
  });

  test('each has a label to show', () => {
    expect(COLOR_LABELS.red).toBe('Red');
    expect(COLOR_LABELS.slate).toBe('Slate');
    for (const name of TUTOR_COLORS) expect(COLOR_LABELS[name]).toMatch(/^[A-Z][a-z]+$/);
  });

  test('isColorName accepts only those', () => {
    expect(isColorName('teal')).toBe(true);
    for (const bad of ['Teal', 'TEAL', '', null, undefined, 'chartreuse', '#14B8A6', 'tc-teal', 3]) expect(isColorName(bad)).toBe(false);
  });

  test('the database check and this list agree', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../supabase/migrations/20261019120000_tutor_colors.sql', import.meta.url), 'utf8');
    const inSql = [...sql.slice(sql.indexOf('check (calendar_color in (')).split('))')[0].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(inSql).toEqual([...TUTOR_COLORS]);
  });
});

describe('colorMap', () => {
  test('turns calendar_colors() rows into a map by id', () => {
    const map = colorMap([{ profile_id: 'a', color: 'red' }, { profile_id: 7, color: 'blue' }]);
    expect(map.get('a')).toBe('red');
    expect(map.get('7')).toBe('blue');
    expect(map.size).toBe(2);
  });

  test('drops rows it does not understand and survives a bad answer', () => {
    expect(colorMap([{ profile_id: 'a', color: 'plaid' }, { profile_id: null, color: 'red' }, null, {}]).size).toBe(0);
    expect(colorMap(null).size).toBe(0);
    expect(colorMap(undefined).size).toBe(0);
  });
});

describe('automatic colors', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

  test('are stable for a tutor and always a known name', () => {
    for (const id of ids) {
      expect(autoColor(id)).toBe(autoColor(id));
      expect(isColorName(autoColor(id))).toBe(true);
    }
  });

  test('spread over the palette', () => {
    expect(new Set(ids.map((id) => autoColor(id))).size).toBeGreaterThanOrEqual(8);
  });

  test('never take a color the admin gave to someone else', () => {
    const given = new Map([['a', 'red'], ['b', 'violet'], ['c', 'blue']]);
    for (const id of ids) expect(['red', 'violet', 'blue']).not.toContain(autoColor(id, given));
  });

  test('use the whole palette once every color is taken', () => {
    const all = new Map(TUTOR_COLORS.map((name, i) => [`t${i}`, name]));
    expect(isColorName(autoColor('x', all))).toBe(true);
  });

  test('are the same for everyone who knows the same choices', () => {
    const given = new Map([['a', 'red']]);
    expect(autoColor(ids[3], given)).toBe(autoColor(ids[3], new Map(given)));
  });
});

describe('colorFor and the class', () => {
  test('the admin choice wins, then the automatic color, then nothing', () => {
    const given = new Map([['t1', 'lime']]);
    expect(colorFor('t1', given)).toBe('lime');
    expect(colorFor('t2', given)).toBe(autoColor('t2', given));
    expect(colorFor(null, given)).toBeNull();
    expect(colorFor(undefined, given)).toBeNull();
    expect(colorFor('', given)).toBeNull();
    expect(toneClassFor('lime')).toBe('tc-lime');
    expect(toneClassFor(null)).toBe(NO_TONE);
    expect(NO_TONE).toBe('tc-none');
  });

  test('the page state feeds tutorToneClass', () => {
    expect(tutorColors().size).toBe(0);
    setTutorColors([{ profile_id: 't1', color: 'pink' }]);
    expect(tutorToneClass('t1')).toBe('tc-pink');
    expect(tutorColorOf('t1')).toEqual({ name: 'pink', automatic: false });
    const other = tutorColorOf('t2');
    expect(other.automatic).toBe(true);
    expect(other.name).not.toBe('pink');
    setTutorColors(new Map([['t1', 'green']]));
    expect(tutorToneClass('t1')).toBe('tc-green');
  });

  test('colors loaded later replace the old ones', () => {
    setTutorColors([{ profile_id: 't1', color: 'pink' }]);
    setTutorColors([]);
    expect(tutorColors().size).toBe(0);
    expect(tutorColorOf('t1').automatic).toBe(true);
  });
});

describe("the admin's picker", () => {
  test('lists Automatic first and then every color', () => {
    const options = colorOptions();
    expect(options[0]).toEqual({ value: '', label: 'Automatic' });
    expect(options.slice(1).map((o) => o.value)).toEqual([...TUTOR_COLORS]);
    expect(options.slice(1).map((o) => o.label)).toEqual(TUTOR_COLORS.map((n) => COLOR_LABELS[n]));
  });

  test('names the color Automatic stands for', () => {
    expect(automaticLabel('teal')).toBe('Automatic (Teal)');
    expect(automaticLabel(null)).toBe('Automatic');
    expect(colorOptions('rose')[0].label).toBe('Automatic (Rose)');
  });

  test('chosenColors reads staff rows only', () => {
    const people = [
      { id: 'a', role: 'admin', calendar_color: 'red' },
      { id: 'b', role: 'tutor', calendar_color: 'violet' },
      { id: 'c', role: 'tutor', calendar_color: null },
      { id: 'd', role: 'student', calendar_color: 'blue' },
      { id: 'e', role: 'tutor' },
    ];
    expect([...chosenColors(people)]).toEqual([['a', 'red'], ['b', 'violet']]);
    expect(chosenColors(null).size).toBe(0);
  });

  test('pickerState says what the swatch wears', () => {
    const people = [{ id: 'a', role: 'admin', calendar_color: 'red' }, { id: 'b', role: 'tutor', calendar_color: null }];
    const colors = chosenColors(people);
    expect(pickerState(people[0], colors)).toMatchObject({ chosen: 'red', shown: 'red' });
    const auto = pickerState(people[1], colors);
    expect(auto.chosen).toBeNull();
    expect(auto.shown).toBe(auto.automatic);
    expect(auto.automatic).not.toBe('red');
  });

  test('Automatic is what the person would get without their own choice', () => {
    const people = [{ id: 'a', role: 'tutor', calendar_color: 'violet' }, { id: 'b', role: 'tutor', calendar_color: 'blue' }];
    const colors = chosenColors(people);
    const state = pickerState(people[0], colors);
    const without = new Map(colors);
    without.delete('a');
    expect(state.automatic).toBe(autoColor('a', without));
    expect(state.automatic).not.toBe('blue');
    // and that is exactly the color the portal draws once they choose Automatic
    setTutorColors(without);
    expect(tutorColorOf('a')).toEqual({ name: state.automatic, automatic: true });
  });

  test('the toast after a save', () => {
    expect(colorSavedText('Daniel Ortiz', 'violet')).toBe('Daniel Ortiz’s lessons are now violet on the calendar.');
    expect(colorSavedText('Daniel Ortiz', null)).toBe('Daniel Ortiz’s lessons now get an automatic color.');
    for (const text of [colorSavedText('A', 'red'), colorSavedText('A', null)]) expect(text).not.toMatch(/[–—]/);
  });
});
