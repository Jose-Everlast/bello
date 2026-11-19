// Colours and the look of the page parts: the named colours the owner can use,
// the page sections with their German names and default colours, which texts
// can be aligned, and the contrast check behind the readability warning.
// Pure data and functions, no I/O.

// Stored colours are always "#rrggbb", lower case.
export const HEX_RE = /^#[0-9a-f]{6}$/;
// The word that takes a colour or a text style back to the stylesheet.
export const RESET = 'standard';

/** Named colours (German). The first six are the Bello palette. */
export const COLORS = [
  ['Bello-Rot', '#e0261c'],
  ['Creme', '#fff6e8'],
  ['Gelb', '#ffd84a'],
  ['Dunkelgrün', '#1a201b'],
  ['Schwarz', '#000000'],
  ['Weiß', '#ffffff'],
  ['Rot', '#d62828'],
  ['Dunkelrot', '#8b1a1a'],
  ['Bordeaux', '#6d1a2a'],
  ['Orange', '#f28c28'],
  ['Rosa', '#f4a6b8'],
  ['Pink', '#e83e8c'],
  ['Lila', '#7b3fa0'],
  ['Blau', '#1f4e9e'],
  ['Hellblau', '#7fb2e5'],
  ['Dunkelblau', '#14213d'],
  ['Türkis', '#1fb5ad'],
  ['Grün', '#2e7d32'],
  ['Hellgrün', '#8bc34a'],
  ['Oliv', '#6b7a2e'],
  ['Braun', '#7b4b2a'],
  ['Beige', '#e8dcc4'],
  ['Gold', '#c9a227'],
  ['Grau', '#808080'],
  ['Hellgrau', '#d9d9d9'],
  ['Dunkelgrau', '#404040'],
];

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** "Bello-Rot", "bello rot", "bellorot" -> "bellorot"; "Weiß"/"weiss" -> "weiss". */
function colorWord(text) {
  return String(text).toLowerCase().normalize('NFC')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[\s_-]+/g, '');
}
const BY_WORD = new Map(COLORS.map(([name, hex]) => [colorWord(name), hex]));
const BY_HEX = new Map(COLORS.map(([name, hex]) => [hex, name]));

/** A colour name or hex code (#rgb, #rrggbb) -> "#rrggbb", otherwise null. */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join('')}`;
  const word = colorWord(text);
  return word && BY_WORD.has(word) ? BY_WORD.get(word) : null;
}

/** "Bello-Rot" for a named colour, the code otherwise. */
export const colorName = (hex) => BY_HEX.get(hex) || hex;
/** "Bello-Rot (#e0261c)" for a named colour, the code otherwise; null = "Standard". */
export const colorLabel = (hex) => (hex === null || hex === undefined ? 'Standard' : BY_HEX.has(hex) ? `${BY_HEX.get(hex)} (${hex})` : hex);

/* ---------- sections ---------- */

export const SECTION_PROPERTIES = { background: 'Hintergrund', text: 'Textfarbe', accent: 'Akzentfarbe' };
const ALL = Object.keys(SECTION_PROPERTIES);

/**
 * The page sections. key = data-section="<key>" in public/index.html (the menu
 * cards live inside the menu section, see public/assets/js/content.js).
 * defaults: the colours the stylesheet uses, for the contrast check.
 * covers: what "Hintergrund" changes, told to the model and the owner.
 */
export const SECTIONS = {
  header: {
    label: 'Kopfzeile', properties: ALL,
    defaults: { background: '#141611', text: '#e9dfd4', accent: '#e55c42' },
    covers: 'die Leiste oben mit Logo und Menü, auch das aufgeklappte Menü auf dem Handy',
  },
  hero: {
    label: 'Ganz oben', properties: ['text', 'accent'],
    defaults: { background: '#e0261c', text: '#fff7ed', accent: '#ffd84a' },
    covers: 'nichts: der Hintergrund ganz oben ist die Negroni-Animation und bleibt, wie er ist',
  },
  marquee: {
    label: 'Laufband', properties: ALL,
    defaults: { background: '#e0261c', text: '#fff6e8', accent: '#f9bb7e' },
    covers: 'das ganze Band (die Sterne zwischen den Sprüchen haben die Akzentfarbe)',
  },
  specials: {
    label: 'Specials', properties: ALL,
    defaults: { background: '#fff6e8', text: '#171813', accent: '#e0261c' },
    covers: 'die Fläche um die Special-Karten und die hellen Streifen oben; die Karten selbst bleiben weiß',
  },
  concept: {
    label: 'Einblicke', properties: ALL,
    defaults: { background: '#f3ece0', text: '#1a1a16', accent: '#bc4936' },
    covers: 'die Fläche um die Videos und die Zeilen darunter; die Videos bleiben, wie sie sind',
  },
  menu: {
    label: 'Karte', properties: ALL,
    defaults: { background: '#1a201b', text: '#f3eadb', accent: '#e7a183' },
    covers: 'die Fläche um die Kartenseiten mit Überschrift, Text und Reitern; die Kartenseiten selbst sind ein eigener Bereich',
  },
  'menu-cards': {
    label: 'Kartenseiten', properties: ALL,
    defaults: { background: '#f5eee1', text: '#1d211a', accent: '#ad4a38' },
    covers: 'die hellen Seiten mit den Einträgen der Karte (jede zweite etwas dunkler); Akzent = Preise und der Streifen links',
  },
  visit: {
    label: 'Besuch', properties: ALL,
    defaults: { background: '#121a16', text: '#f4eee3', accent: '#d37550' },
    covers: 'den ganzen Bereich; der große Knopf und der Stempel haben die Akzentfarbe',
  },
  walk: {
    label: 'Der Weg', properties: ALL,
    defaults: { background: '#162019', text: '#fff5e8', accent: '#efa478' },
    covers: 'die Fläche um Text, Schritte und Stadtplan; der Stadtplan behält seinen dunklen Grund, damit die Straßen lesbar bleiben',
  },
  footer: {
    label: 'Fußzeile', properties: ALL,
    defaults: { background: '#141611', text: '#f3e8dc', accent: '#cf5038' },
    covers: 'die ganze Fußzeile',
  },
};

export const isSectionKey = (key) => typeof key === 'string' && own(SECTIONS, key);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The section colours of a content object. A file without "sectionStyles" has none. */
export function sectionStylesOf(content) {
  return isObject(content?.sectionStyles) ? content.sectionStyles : {};
}

/** Stored colour of a section property, or null (= stylesheet). */
export function sectionColor(content, key, property) {
  const styles = sectionStylesOf(content);
  const entry = own(styles, key) && isObject(styles[key]) ? styles[key] : {};
  return own(entry, property) && HEX_RE.test(entry[property]) ? entry[property] : null;
}

/** The colour the page really shows: stored or default. */
export const effectiveSectionColor = (content, key, property) => sectionColor(content, key, property) || SECTIONS[key].defaults[property];

/* ---------- text styles ---------- */

export const TEXT_PROPERTIES = { color: 'Farbe', bold: 'fett', italic: 'kursiv', align: 'Ausrichtung' };
export const ALIGN = { left: 'linksbündig', center: 'mittig', right: 'rechtsbündig' };
const ALIGN_WORDS = {
  left: 'left', links: 'left', linksbuendig: 'left',
  center: 'center', centre: 'center', mitte: 'center', mittig: 'center', zentriert: 'center',
  right: 'right', rechts: 'right', rechtsbuendig: 'right',
};
/** "rechts", "mittig", "center" -> "right" / "center"; otherwise null. */
export const parseAlign = (value) => {
  const word = typeof value === 'string' ? colorWord(value) : '';
  return own(ALIGN_WORDS, word) ? ALIGN_WORDS[word] : null;
};

/**
 * Texts that stand as a block of their own (paragraph, title, line of a
 * list), so that an alignment changes something. Parts of a heading or of a
 * line (first word, second line, links in the menu bar) are not in here.
 */
export const ALIGN_KEYS = new Set([
  'hero.text', 'hero.stage.title', 'hero.stage.text',
  'concept.text', 'concept.card1.title', 'concept.card1.text', 'concept.card2.title', 'concept.card2.text',
  'concept.card3.title', 'concept.card3.text',
  'menu.eyebrow', 'menu.section.title', 'menu.section.subtitle', 'menu.item.text', 'menu.item.note',
  'special.title', 'special.text',
  'visit.text', 'visit.where.label', 'visit.where.note', 'visit.when.label', 'visit.closed',
  'walk.step.title', 'walk.step.text',
]);

// Texts that sit on something else than their section background: on a
// button in the accent colour, on a video, or (specials) on the white card.
const NO_CONTRAST_CHECK = new Set(['hero.cta.menu', 'visit.cta.label', 'visit.cta.note', 'concept.card1.side', 'concept.card2.side', 'concept.card3.side']);
const ON_WHITE_CARD = new Set(['special.title', 'special.text']);
const SECTION_OF_PREFIX = {
  header: 'header', nav: 'header', hero: 'hero', marquee: 'marquee', specials: 'specials', special: 'specials',
  concept: 'concept', menu: 'menu', visit: 'visit', walk: 'walk', footer: 'footer',
};

/** The section a text (style key) stands in, or null when it has no plain section background behind it. */
export function sectionOfText(key) {
  if (NO_CONTRAST_CHECK.has(key)) return null;
  if (/^menu\.(folio|foot|section\.|item\.)/.test(key)) return 'menu-cards';
  const prefix = String(key).split('.')[0];
  return own(SECTION_OF_PREFIX, prefix) ? SECTION_OF_PREFIX[prefix] : null;
}

/** The background colour behind a text, or null when there is none to check against. */
export function backgroundOfText(content, key) {
  if (ON_WHITE_CARD.has(key)) return '#ffffff';
  const section = sectionOfText(key);
  return section ? effectiveSectionColor(content, section, 'background') : null;
}

/* ---------- contrast (WCAG 2) ---------- */

export const MIN_CONTRAST_TEXT = 4.5;
// The accent colour is used for large words of the headings and for buttons.
export const MIN_CONTRAST_ACCENT = 3;

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two "#rrggbb" colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** "1,1" (rounded down, so that 4.49 never shows as 4,5). */
export const ratioText = (ratio) => (Math.floor(ratio * 10) / 10).toFixed(1).replace('.', ',');
