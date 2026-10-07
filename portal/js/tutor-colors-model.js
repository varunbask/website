// Pure logic for tutor colors: every lesson is drawn in the color of the tutor
// who teaches it. The admin picks a named color per tutor (profiles.calendar_color,
// read through the calendar_colors() function); a tutor with none gets an
// automatic one from a hash of their id. No DOM. The shades behind each name
// (soft fill, text on it, solid edge) are the .tc-NAME classes in app.css.

// The names the database accepts (profiles_calendar_color_check), in the order
// the admin's picker lists them
export const TUTOR_COLORS = Object.freeze([
  'red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan',
  'blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'slate',
]);

export const COLOR_LABELS = Object.freeze(Object.fromEntries(
  TUTOR_COLORS.map((name) => [name, name[0].toUpperCase() + name.slice(1)]),
));

// The class for a lesson or chip whose tutor is not known
export const NO_TONE = 'tc-none';

export const isColorName = (value) => TUTOR_COLORS.includes(value);

// Rows of calendar_colors() -> Map<tutor id, color name>. Rows that are not a
// known name are dropped, so a color added later never breaks an old page.
export function colorMap(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (row && row.profile_id != null && isColorName(row.color)) map.set(String(row.profile_id), row.color);
  }
  return map;
}

function hashOf(key) {
  let hash = 5381;
  for (const ch of String(key)) hash = ((hash * 33) ^ ch.codePointAt(0)) >>> 0;
  return hash;
}

// The automatic color of a tutor: a hash of the id over the colors nobody has
// been given, so an automatic tutor never looks like one the admin colored (and
// the same tutor gets the same color for everyone, because the assigned set is
// the same for everyone). With every color taken, the whole list is used.
export function autoColor(tutorId, colors = new Map()) {
  const taken = new Set(colors.values());
  const pool = TUTOR_COLORS.filter((name) => !taken.has(name));
  const from = pool.length ? pool : TUTOR_COLORS;
  return from[hashOf(tutorId) % from.length];
}

// The color name for a tutor: the admin's choice, else the automatic one;
// null when there is no tutor to color
export function colorFor(tutorId, colors = new Map()) {
  if (tutorId === null || tutorId === undefined || String(tutorId) === '') return null;
  return colors.get(String(tutorId)) ?? autoColor(String(tutorId), colors);
}

export const toneClassFor = (name) => (name ? `tc-${name}` : NO_TONE);

// ---------------------------------------------------------------------------
// The colors this page knows (the store loads them once and calls setTutorColors)

let current = new Map();

export function setTutorColors(rowsOrMap) {
  current = rowsOrMap instanceof Map ? new Map(rowsOrMap) : colorMap(rowsOrMap);
}

export const tutorColors = () => current;

// 'tc-red' for a tutor the admin colored red, an automatic tc-NAME otherwise,
// 'tc-none' for no tutor
export function tutorToneClass(tutorId) {
  return toneClassFor(colorFor(tutorId, current));
}

// The color name the admin sees for a tutor: { name, automatic }
export function tutorColorOf(tutorId) {
  const chosen = current.get(String(tutorId));
  return chosen ? { name: chosen, automatic: false } : { name: colorFor(tutorId, current), automatic: true };
}

// The text of the picker's first option: "Automatic (Teal)" names the color
// the tutor gets while none is chosen
export const automaticLabel = (autoName) => (autoName ? `Automatic (${COLOR_LABELS[autoName]})` : 'Automatic');

// The options of the admin's picker: Automatic first, then every color
export function colorOptions(autoName = null) {
  return [{ value: '', label: automaticLabel(autoName) }, ...TUTOR_COLORS.map((name) => ({ value: name, label: COLOR_LABELS[name] }))];
}

// What the admin's Everyone list knows: a Map of tutor ids to chosen colors,
// from profile rows ({ id, role, calendar_color }). Only staff carry one.
export function chosenColors(people) {
  return colorMap((people ?? [])
    .filter((p) => p && (p.role === 'tutor' || p.role === 'admin'))
    .map((p) => ({ profile_id: p.id, color: p.calendar_color })));
}

// The picker's state for one staff row: { chosen, shown, automatic }, where shown
// is the color the row's swatch wears (the chosen one, else the automatic one)
export function pickerState(person, colors) {
  const chosen = isColorName(person?.calendar_color) ? person.calendar_color : null;
  // What Automatic would give this person: the colors the others were given are
  // taken, their own choice is not (it goes away when they pick Automatic)
  const others = new Map(colors);
  others.delete(String(person?.id));
  const automatic = autoColor(String(person?.id), others);
  return { chosen, shown: chosen ?? automatic, automatic };
}

// Words for the toast after a save
export function colorSavedText(name, color) {
  return color
    ? `${name}’s lessons are now ${COLOR_LABELS[color].toLowerCase()} on the calendar.`
    : `${name}’s lessons now get an automatic color.`;
}
