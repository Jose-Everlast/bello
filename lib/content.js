// Content model helpers (see the shared contract: data/content.json).
// Pure functions, no I/O.

export const UPLOAD_DIR = 'assets/uploads/';
export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const IMAGE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;

/** Today's date (YYYY-MM-DD) in Europe/Berlin. */
export function berlinToday(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function berlinWeekday(date = new Date()) {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long' }).format(date);
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "2026-11-16" -> "16.11." */
export function shortDate(isoDate) {
  const [, m, d] = isoDate.split('-');
  return `${d}.${m}.`;
}

export function isSpecialActive(special, today) {
  return special.from <= today && today <= special.until;
}

export function slugify(text, fallback = 'eintrag') {
  const slug = String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function collectIds(content) {
  const ids = { tabs: new Set(), sections: new Set(), items: new Set(), specials: new Set() };
  for (const tab of content.menu) {
    ids.tabs.add(tab.id);
    for (const section of tab.sections) {
      ids.sections.add(section.id);
      for (const item of section.items) ids.items.add(item.id);
    }
  }
  for (const special of content.specials) ids.specials.add(special.id);
  return ids;
}

export function findTab(content, id) {
  return content.menu.find((tab) => tab.id === id) || null;
}

export function locateSection(content, id) {
  for (const tab of content.menu) {
    const index = tab.sections.findIndex((section) => section.id === id);
    if (index !== -1) return { tab, index, section: tab.sections[index] };
  }
  return null;
}

export function locateItem(content, id) {
  for (const tab of content.menu) {
    for (const section of tab.sections) {
      const index = section.items.findIndex((item) => item.id === id);
      if (index !== -1) return { tab, section, index, item: section.items[index] };
    }
  }
  return null;
}

export function findSpecial(content, id) {
  return content.specials.find((special) => special.id === id) || null;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';

/**
 * Structural validation of a whole content object. Returns a list of German
 * problem descriptions (empty = valid). Length limits and character rules are
 * enforced on new values by the operations, not here, so that an existing
 * published file never blocks editing because of a long text.
 */
export function validateContent(content) {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  if (!isObject(content)) return ['Der Inhalt ist kein Objekt.'];
  if (content.version !== 1) bad('Unbekannte Inhaltsversion.');
  if (!isObject(content.texts)) bad('"texts" fehlt.');
  else {
    for (const [key, value] of Object.entries(content.texts)) {
      if (!isString(value)) bad(`Text "${key}" ist kein Text.`);
    }
  }
  const seen = { tab: new Set(), section: new Set(), item: new Set(), special: new Set() };
  const checkId = (kind, label, id) => {
    if (!isString(id) || !ID_RE.test(id)) return bad(`${label}: ungültige Kennung.`);
    if (seen[kind].has(id)) return bad(`${label}: Kennung "${id}" ist doppelt.`);
    seen[kind].add(id);
    return undefined;
  };
  if (!Array.isArray(content.menu)) bad('"menu" fehlt.');
  else {
    for (const tab of content.menu) {
      if (!isObject(tab)) { bad('Ein Reiter ist ungültig.'); continue; }
      checkId('tab', 'Reiter', tab.id);
      if (!isString(tab.label) || !tab.label) bad(`Reiter "${tab.id}": Name fehlt.`);
      if (!Array.isArray(tab.sections)) { bad(`Reiter "${tab.id}": Abschnitte fehlen.`); continue; }
      for (const section of tab.sections) {
        if (!isObject(section)) { bad('Ein Abschnitt ist ungültig.'); continue; }
        checkId('section', 'Abschnitt', section.id);
        if (!isString(section.title) || !section.title) bad(`Abschnitt "${section.id}": Titel fehlt.`);
        if (!isString(section.subtitle)) bad(`Abschnitt "${section.id}": Untertitel ist kein Text.`);
        if (!Array.isArray(section.items)) { bad(`Abschnitt "${section.id}": Einträge fehlen.`); continue; }
        for (const item of section.items) {
          if (!isObject(item)) { bad('Ein Eintrag ist ungültig.'); continue; }
          checkId('item', 'Eintrag', item.id);
          if (!isString(item.name) || !item.name) bad(`Eintrag "${item.id}": Name fehlt.`);
          for (const field of ['price', 'text', 'note']) {
            if (!isString(item[field])) bad(`Eintrag "${item.id}": "${field}" ist kein Text.`);
          }
          if (typeof item.hidden !== 'boolean') bad(`Eintrag "${item.id}": "hidden" fehlt.`);
        }
      }
    }
  }
  if (!Array.isArray(content.specials)) bad('"specials" fehlt.');
  else {
    for (const special of content.specials) {
      if (!isObject(special)) { bad('Ein Special ist ungültig.'); continue; }
      checkId('special', 'Special', special.id);
      if (!isString(special.title) || !special.title) bad(`Special "${special.id}": Titel fehlt.`);
      if (!isString(special.text)) bad(`Special "${special.id}": Text ist kein Text.`);
      if (special.image !== null) {
        const ok = isString(special.image)
          && special.image.startsWith(UPLOAD_DIR)
          && IMAGE_NAME_RE.test(special.image.slice(UPLOAD_DIR.length));
        if (!ok) bad(`Special "${special.id}": ungültiger Bildpfad.`);
      }
      if (!isString(special.imageAlt)) bad(`Special "${special.id}": Bildbeschreibung ist kein Text.`);
      if (!isValidDate(special.from) || !isValidDate(special.until)) bad(`Special "${special.id}": ungültiges Datum.`);
      else if (special.until < special.from) bad(`Special "${special.id}": Ende liegt vor dem Anfang.`);
    }
  }
  return problems;
}
