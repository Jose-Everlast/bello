// The closed operation set. Everything the model returns goes through
// applyOperations(): strict normalisation, validation against the current
// content, application to a copy. Either all operations apply or none.

import {
  UPLOAD_DIR, addDays, collectIds, findSpecial, findTab, isValidDate,
  locateItem, locateSection, shortDate, slugify, uniqueId, validateContent,
} from './content.js';

export const OP_NAMES = [
  'set_text', 'set_item', 'add_item', 'remove_item', 'move_item', 'set_item_hidden',
  'add_section', 'set_section', 'remove_section', 'set_tab_label',
  'add_special', 'set_special', 'remove_special',
];
export const FIELD_NAMES = ['name', 'price', 'text', 'note', 'title', 'subtitle', 'image_alt', 'from', 'until'];
export const POSITIONS = ['start', 'end', 'after'];
export const PHOTO_MODES = ['keep', 'attach', 'remove'];

export const MAX_OPS = 30;
export const LIMITS = {
  textValue: 600, name: 80, price: 40, text: 300, note: 200,
  title: 80, subtitle: 120, label: 30,
  specialTitle: 80, specialText: 400, imageAlt: 120,
  items: 400, sectionsPerTab: 20, specials: 20, specialDays: 366,
};

const STRING_KEYS = ['id', 'parent_id', 'after_id', 'name', 'price', 'text', 'note', 'title', 'subtitle', 'image_alt', 'from', 'until'];
const ALL_KEYS = new Set(['op', 'position', 'photo', 'hidden', 'fields', ...STRING_KEYS]);
const TEMP_REF_RE = /^neu-[a-z0-9-]{1,20}$/;
// C0/C1 controls, DEL, zero-width and bidi controls, line/paragraph separators.
// U+200D (zero width joiner) stays allowed: joined emoji need it.
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

/**
 * internal = true: a mistake of the model (unknown id, wrong shape). The owner
 * cannot act on the wording, so the conversation shows a generic sentence.
 * internal = false: something the owner can fix (dates, limits, missing photo).
 */
export class OpError extends Error {
  constructor(message, internal = false) {
    super(message);
    this.internal = internal;
  }
}

const fail = (message) => { throw new OpError(message); };
const failInternal = (message) => { throw new OpError(message, true); };

/** Labels for the page texts, so that no technical key reaches the owner. */
const TEXT_LABELS = [
  ['visit.hours', 'Öffnungszeiten'],
  ['visit.closed', 'Ruhetag'],
  ['visit.address', 'Adresse'],
  ['hero.', 'Text ganz oben'],
  ['menu.intro', 'Text über der Karte'],
];
export function textLabel(key) {
  const hit = TEXT_LABELS.find(([prefix]) => String(key).startsWith(prefix));
  return hit ? hit[1] : 'Seitentext';
}
const shown = (id) => String(id).slice(0, 40) || 'ohne Angabe';

/** Validates one free-text value. Returns the cleaned string. */
export function cleanValue(value, max, label, { required = false } = {}) {
  if (typeof value !== 'string') failInternal(`${label}: kein Text.`);
  const text = value.normalize('NFC').trim();
  if (FORBIDDEN_CHARS.test(text)) fail(`${label}: enthält Zeilenumbrüche oder Steuerzeichen.`);
  if (/[<>]/.test(text)) fail(`${label}: die Zeichen < und > sind nicht erlaubt.`);
  if (required && !text) fail(`${label} darf nicht leer sein.`);
  if (text.length > max) fail(`${label} ist zu lang (höchstens ${max} Zeichen).`);
  return text;
}

/** Strict shape check of one raw operation from the model. */
export function normalizeOp(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) failInternal('Eine Änderung hat ein ungültiges Format.');
  for (const key of Object.keys(raw)) {
    if (!ALL_KEYS.has(key)) failInternal(`Eine Änderung enthält ein unbekanntes Feld (${shown(key)}).`);
  }
  const op = {};
  op.op = typeof raw.op === 'string' ? raw.op.trim().toLowerCase() : '';
  if (!OP_NAMES.includes(op.op)) failInternal('Eine Änderung hat eine unbekannte Art.');
  for (const key of STRING_KEYS) {
    const value = raw[key] === undefined || raw[key] === null ? '' : raw[key];
    if (typeof value !== 'string') failInternal(`Eine Änderung hat ein ungültiges Feld (${key}).`);
    op[key] = value;
  }
  op.position = typeof raw.position === 'string' && raw.position ? raw.position.trim().toLowerCase() : 'end';
  if (!POSITIONS.includes(op.position)) failInternal('Eine Änderung hat eine ungültige Position.');
  op.photo = typeof raw.photo === 'string' && raw.photo ? raw.photo.trim().toLowerCase() : 'keep';
  if (!PHOTO_MODES.includes(op.photo)) failInternal('Eine Änderung hat eine ungültige Foto-Angabe.');
  if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') failInternal('Eine Änderung hat ein ungültiges Feld (hidden).');
  op.hidden = raw.hidden === true;
  op.hasHidden = typeof raw.hidden === 'boolean';
  const fields = raw.fields === undefined || raw.fields === null ? [] : raw.fields;
  if (!Array.isArray(fields)) failInternal('Eine Änderung hat ein ungültiges Feld (fields).');
  op.fields = [...new Set(fields.map((f) => {
    const name = typeof f === 'string' ? f.trim().toLowerCase() : '';
    if (!FIELD_NAMES.includes(name)) failInternal('Eine Änderung nennt ein unbekanntes Feld.');
    return name;
  }))];
  return op;
}

const quote = (text) => `„${text}“`;
const itemCount = (content) => content.menu.reduce(
  (n, tab) => n + tab.sections.reduce((m, s) => m + s.items.length, 0), 0);

function resolveRef(run, id) {
  return run.refs.has(id) ? run.refs.get(id) : id;
}

function registerTemp(run, tempRef, realId) {
  if (!tempRef) return;
  if (!TEMP_REF_RE.test(tempRef)) failInternal('Eine neue Zeile hat einen ungültigen Platzhalter.');
  if (run.refs.has(tempRef)) failInternal('Ein Platzhalter wurde doppelt verwendet.');
  // F8: a placeholder must never shadow a real id of the content.
  if (run.realIds.has(tempRef)) failInternal(`Der Platzhalter ${tempRef} ist schon eine echte Kennung.`);
  run.refs.set(tempRef, realId);
}

function needItem(run, id) {
  const found = locateItem(run.content, resolveRef(run, id));
  if (!found) failInternal(`Den Eintrag habe ich nicht gefunden (${shown(id)}).`);
  return found;
}

function needSection(run, id) {
  const found = locateSection(run.content, resolveRef(run, id));
  if (!found) failInternal(`Den Abschnitt habe ich nicht gefunden (${shown(id)}).`);
  return found;
}

function needTab(run, id) {
  const found = findTab(run.content, id);
  if (!found) failInternal(`Den Karten-Bereich habe ich nicht gefunden (${shown(id)}).`);
  return found;
}

function needSpecial(run, id) {
  const found = findSpecial(run.content, resolveRef(run, id));
  if (!found) failInternal(`Das Special habe ich nicht gefunden (${shown(id)}).`);
  return found;
}

function insertAt(list, entry, op, run) {
  if (op.position === 'start') { list.unshift(entry); return; }
  if (op.position === 'after') {
    const afterId = resolveRef(run, op.after_id);
    const index = list.findIndex((e) => e.id === afterId);
    if (index === -1) failInternal(`Die Stelle zum Einfügen habe ich nicht gefunden (${shown(op.after_id)}).`);
    list.splice(index + 1, 0, entry);
    return;
  }
  list.push(entry);
}

function requireFields(op, allowed) {
  if (op.fields.length === 0) failInternal('Bei einer Änderung fehlt die Angabe, was geändert werden soll.');
  for (const field of op.fields) {
    if (!allowed.includes(field)) failInternal(`Das Feld ${field} passt nicht zu dieser Änderung.`);
  }
}

function checkDates(from, until, today, { mustBeCurrent }) {
  if (!isValidDate(from)) fail('Das Startdatum des Specials ist ungültig.');
  if (!until) fail('Bis wann soll das Special gelten? Bitte nenne ein Enddatum.');
  if (!isValidDate(until)) fail('Das Enddatum des Specials ist ungültig.');
  if (until < from) fail('Das Enddatum des Specials liegt vor dem Startdatum.');
  if (today) {
    if (mustBeCurrent && until < today) fail('Das Enddatum des Specials liegt in der Vergangenheit.');
    if (until > addDays(today, LIMITS.specialDays)) fail('Das Enddatum des Specials liegt mehr als ein Jahr in der Zukunft.');
  }
}

/** A new id from a name. Never of the placeholder form "neu-…" (F8). */
function newId(base, taken) {
  return uniqueId(TEMP_REF_RE.test(base) ? `eintrag-${base}` : base, taken);
}

const visibleCount = (section) => section.items.filter((item) => item.hidden !== true).length;

function takePhoto(run) {
  if (!run.pendingPhoto) fail('Dafür brauche ich zuerst ein Foto. Schick es mir bitte und schreib dann, wofür es ist.');
  if (run.usedPhoto) fail('Ein Foto kann nur für ein Special verwendet werden.');
  run.usedPhoto = true;
  return UPLOAD_DIR + run.pendingPhoto;
}

const HANDLERS = {
  set_text(run, op) {
    const { texts } = run.content;
    if (!Object.prototype.hasOwnProperty.call(texts, op.id)) failInternal(`Diesen Seitentext gibt es nicht (${shown(op.id)}).`);
    const value = cleanValue(op.text, LIMITS.textValue, 'Der Text', { required: true });
    const before = texts[op.id];
    if (before === value) return;
    texts[op.id] = value;
    run.textKeys.push(op.id);
    run.changes.push(`${textLabel(op.id)}: ${quote(before)} → ${quote(value)}`);
  },

  set_item(run, op) {
    requireFields(op, ['name', 'price', 'text', 'note']);
    const { item } = needItem(run, op.id);
    const label = item.name;
    for (const field of op.fields) {
      if (field === 'name') {
        const value = cleanValue(op.name, LIMITS.name, 'Der Name', { required: true });
        if (value !== item.name) { run.changes.push(`${item.name} heißt jetzt ${value}`); item.name = value; }
      } else if (field === 'price') {
        const value = cleanValue(op.price, LIMITS.price, 'Der Preis');
        if (value !== item.price) {
          if (!item.price) run.changes.push(`${label}: Preis jetzt ${value}`);
          else if (!value) run.changes.push(`${label}: Preis entfernt (war ${item.price})`);
          else run.changes.push(`${label}: ${item.price} → ${value}`);
          item.price = value;
        }
      } else if (field === 'text') {
        const value = cleanValue(op.text, LIMITS.text, 'Die Beschreibung');
        if (value !== item.text) {
          run.changes.push(value ? `${label}: Beschreibung jetzt ${quote(value)}` : `${label}: Beschreibung entfernt`);
          item.text = value;
        }
      } else {
        const value = cleanValue(op.note, LIMITS.note, 'Der Hinweis');
        if (value !== item.note) {
          run.changes.push(value ? `${label}: Hinweis jetzt ${quote(value)}` : `${label}: Hinweis entfernt`);
          item.note = value;
        }
      }
    }
  },

  add_item(run, op) {
    const { section } = needSection(run, op.parent_id);
    if (itemCount(run.content) >= LIMITS.items) fail('Die Karte hat zu viele Einträge.');
    const name = cleanValue(op.name, LIMITS.name, 'Der Name', { required: true });
    const item = {
      id: newId(slugify(name), collectIds(run.content).items),
      name,
      price: cleanValue(op.price, LIMITS.price, 'Der Preis'),
      text: cleanValue(op.text, LIMITS.text, 'Die Beschreibung'),
      note: cleanValue(op.note, LIMITS.note, 'Der Hinweis'),
      hidden: op.hidden,
    };
    insertAt(section.items, item, op, run);
    registerTemp(run, op.id, item.id);
    const details = [item.text, item.note].filter(Boolean).map(quote).join(', ');
    run.changes.push(`Neu in ${section.title}: ${name}${item.price ? ` (${item.price})` : ''}${details ? ` – ${details}` : ''}${item.hidden ? ', noch ausgeblendet' : ''}`);
  },

  remove_item(run, op) {
    const { section, index, item } = needItem(run, op.id);
    section.items.splice(index, 1);
    run.changes.push(`Entfernt: ${item.name} (aus ${section.title})`);
  },

  move_item(run, op) {
    const source = needItem(run, op.id);
    const target = op.parent_id ? needSection(run, op.parent_id).section : source.section;
    if (op.position === 'after' && resolveRef(run, op.after_id) === source.item.id) {
      failInternal('Ein Eintrag kann nicht hinter sich selbst verschoben werden.');
    }
    source.section.items.splice(source.index, 1);
    insertAt(target.items, source.item, op, run);
    // Nothing moved (already at that place): no change to report.
    if (target === source.section && target.items.indexOf(source.item) === source.index) return;
    let where = 'ans Ende';
    if (op.position === 'start') where = 'an den Anfang';
    if (op.position === 'after') where = `hinter ${locateItem(run.content, resolveRef(run, op.after_id)).item.name}`;
    run.changes.push(target === source.section
      ? `${source.item.name} verschoben: ${where}`
      : `${source.item.name} verschoben nach ${target.title} (${where})`);
  },

  set_item_hidden(run, op) {
    if (!op.hasHidden) failInternal('Bei einer Änderung fehlt die Angabe, ob ein- oder ausgeblendet werden soll.');
    const { item } = needItem(run, op.id);
    if (item.hidden === op.hidden) return;
    item.hidden = op.hidden;
    run.changes.push(op.hidden
      ? `${item.name}: ausgeblendet (bleibt so, bis du schreibst „${item.name} wieder da“)`
      : `${item.name}: wieder sichtbar`);
  },

  add_section(run, op) {
    const tab = needTab(run, op.parent_id);
    if (tab.sections.length >= LIMITS.sectionsPerTab) fail('Dieser Bereich der Karte hat zu viele Abschnitte.');
    const title = cleanValue(op.title, LIMITS.title, 'Der Titel', { required: true });
    const section = {
      id: newId(slugify(title, 'abschnitt'), collectIds(run.content).sections),
      title,
      subtitle: cleanValue(op.subtitle, LIMITS.subtitle, 'Der Untertitel'),
      items: [],
    };
    insertAt(tab.sections, section, op, run);
    registerTemp(run, op.id, section.id);
    run.changes.push(`Neuer Abschnitt in ${tab.label}: ${title}`);
  },

  set_section(run, op) {
    requireFields(op, ['title', 'subtitle']);
    const { section } = needSection(run, op.id);
    const label = section.title;
    for (const field of op.fields) {
      if (field === 'title') {
        const value = cleanValue(op.title, LIMITS.title, 'Der Titel', { required: true });
        if (value !== section.title) { run.changes.push(`Abschnitt ${section.title} heißt jetzt ${value}`); section.title = value; }
      } else {
        const value = cleanValue(op.subtitle, LIMITS.subtitle, 'Der Untertitel');
        if (value !== section.subtitle) {
          run.changes.push(value ? `Abschnitt ${label}: Untertitel jetzt ${quote(value)}` : `Abschnitt ${label}: Untertitel entfernt`);
          section.subtitle = value;
        }
      }
    }
  },

  remove_section(run, op) {
    const { tab, index, section } = needSection(run, op.id);
    tab.sections.splice(index, 1);
    const n = section.items.length;
    run.changes.push(`Abschnitt entfernt: ${section.title}${n ? ` (mit ${n} ${n === 1 ? 'Eintrag' : 'Einträgen'})` : ''}`);
  },

  set_tab_label(run, op) {
    const tab = needTab(run, op.id);
    const value = cleanValue(op.title, LIMITS.label, 'Der Name des Karten-Bereichs', { required: true });
    if (value === tab.label) return;
    run.changes.push(`Karten-Bereich ${tab.label} heißt jetzt ${value}`);
    tab.label = value;
  },

  add_special(run, op) {
    if (run.content.specials.length >= LIMITS.specials && run.today) {
      // Expired specials are invisible on the site; they must not block new ones.
      run.content.specials = run.content.specials.filter((s) => !(isValidDate(s.until) && s.until < run.today));
    }
    if (run.content.specials.length >= LIMITS.specials) fail('Es gibt schon zu viele Specials. Bitte erst eines entfernen.');
    if (op.photo === 'remove') failInternal('Eine Änderung hat eine ungültige Foto-Angabe.');
    const title = cleanValue(op.title, LIMITS.specialTitle, 'Der Titel des Specials', { required: true });
    const text = cleanValue(op.text, LIMITS.specialText, 'Der Text des Specials');
    const from = op.from.trim() || run.today || '';
    const until = op.until.trim();
    checkDates(from, until, run.today, { mustBeCurrent: true });
    const image = op.photo === 'attach' ? takePhoto(run) : null;
    const imageAlt = image ? (cleanValue(op.image_alt, LIMITS.imageAlt, 'Die Bildbeschreibung') || title) : '';
    const special = {
      id: uniqueId(`sp-${slugify(title, 'special')}`, collectIds(run.content).specials),
      title, text, image, imageAlt, from, until,
    };
    run.content.specials.push(special);
    registerTemp(run, op.id, special.id);
    run.changes.push(`Neues Special: ${title}${text ? ` – ${text}` : ''} (${shortDate(from)} bis ${shortDate(until)})${image ? ', mit Foto' : ''}`);
  },

  set_special(run, op) {
    const special = needSpecial(run, op.id);
    if (op.fields.length === 0 && op.photo === 'keep') failInternal('Bei einer Änderung fehlt die Angabe, was geändert werden soll.');
    if (op.fields.length) requireFields(op, ['title', 'text', 'image_alt', 'from', 'until']);
    const label = special.title;
    for (const field of op.fields) {
      if (field === 'title') {
        const value = cleanValue(op.title, LIMITS.specialTitle, 'Der Titel des Specials', { required: true });
        if (value !== special.title) { run.changes.push(`Special ${special.title} heißt jetzt ${value}`); special.title = value; }
      } else if (field === 'text') {
        const value = cleanValue(op.text, LIMITS.specialText, 'Der Text des Specials');
        if (value !== special.text) {
          run.changes.push(value ? `Special ${label}: Text jetzt ${quote(value)}` : `Special ${label}: Text entfernt`);
          special.text = value;
        }
      } else if (field === 'image_alt') {
        if (op.photo === 'keep') {
          if (!special.image) fail('Dieses Special hat kein Foto, das beschrieben werden könnte.');
          const value = cleanValue(op.image_alt, LIMITS.imageAlt, 'Die Bildbeschreibung', { required: true });
          if (value !== special.imageAlt) { run.changes.push(`Special ${label}: Bildbeschreibung geändert`); special.imageAlt = value; }
        }
      } else {
        const value = op[field].trim();
        if (value !== special[field]) {
          special[field] = value;
          run.changes.push(`Special ${label}: ${field === 'from' ? 'gilt ab' : 'gilt bis'} ${isValidDate(value) ? shortDate(value) : value.slice(0, 20)}`);
        }
      }
    }
    checkDates(special.from, special.until, run.today, { mustBeCurrent: op.fields.includes('until') });
    if (op.photo === 'attach') {
      special.image = takePhoto(run);
      special.imageAlt = cleanValue(op.image_alt, LIMITS.imageAlt, 'Die Bildbeschreibung') || special.title;
      run.changes.push(`Special ${label}: neues Foto`);
    } else if (op.photo === 'remove') {
      if (special.image) run.changes.push(`Special ${label}: Foto entfernt`);
      special.image = null;
      special.imageAlt = '';
    }
  },

  remove_special(run, op) {
    const special = needSpecial(run, op.id);
    run.content.specials = run.content.specials.filter((s) => s !== special);
    run.changes.push(`Special entfernt: ${special.title}`);
  },
};

/**
 * Applies operations to a copy of `content`.
 * ctx: { today: 'YYYY-MM-DD', pendingPhoto: '<name>.webp' | null }
 * Returns { ok: true, content, changes: string[], notices: string[], textKeys: string[], usedPhoto }
 * or { ok: false, error, internal }. notices are hints for the owner that are not changes.
 * The input content is never modified.
 */
export function applyOperations(content, operations, ctx = {}) {
  try {
    if (!Array.isArray(operations) || operations.length === 0) failInternal('Ich habe keine Änderung erkannt.');
    if (operations.length > MAX_OPS) fail(`Das sind zu viele Änderungen auf einmal (höchstens ${MAX_OPS}).`);
    const run = {
      content: structuredClone(content),
      changes: [],
      textKeys: [],
      refs: new Map(),
      realIds: new Set(),
      today: ctx.today || null,
      pendingPhoto: ctx.pendingPhoto || null,
      usedPhoto: false,
    };
    const ids = collectIds(run.content);
    run.realIds = new Set([...ids.items, ...ids.sections, ...ids.specials]);
    const emptyBefore = new Set(run.content.menu.flatMap((tab) => tab.sections).filter((s) => visibleCount(s) === 0).map((s) => s.id));
    for (const raw of operations) {
      const op = normalizeOp(raw);
      HANDLERS[op.op](run, op);
    }
    const problems = validateContent(run.content);
    if (problems.length) failInternal(problems[0]);
    if (run.changes.length === 0) fail('Das steht schon genau so auf der Seite.');
    // F3: the site drops sections without a visible entry and refuses a menu with nothing to show.
    const sections = run.content.menu.flatMap((tab) => tab.sections);
    if (!sections.some((s) => visibleCount(s) > 0)) fail('Damit wäre die Karte leer. Mindestens ein Eintrag muss sichtbar bleiben.');
    const notices = sections
      .filter((s) => visibleCount(s) === 0 && !emptyBefore.has(s.id))
      .map((s) => `Hinweis: Der Abschnitt ${s.title} hat jetzt keinen sichtbaren Eintrag und wird auf der Seite nicht gezeigt.`);
    return { ok: true, content: run.content, changes: run.changes, notices, textKeys: run.textKeys, usedPhoto: run.usedPhoto };
  } catch (err) {
    if (err instanceof OpError) return { ok: false, error: err.message, internal: err.internal };
    throw err;
  }
}
