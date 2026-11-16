// Parses the fixed German commands. Everything else is an edit request for
// the model. Pure, no I/O.

const YES = ['ja', 'j', 'jo', 'jep', 'jap', 'ok', 'okay', 'passt', 'ja bitte', 'ja passt',
  'veröffentlichen', 'veroeffentlichen', 'ja veröffentlichen', 'ja veroeffentlichen', 'freigeben', 'yes'];
const NO = ['nein', 'n', 'nö', 'noe', 'nee', 'ne', 'verwerfen', 'abbrechen', 'nein danke',
  'nein verwerfen', 'no'];
const UNDO = ['rückgängig', 'rueckgaengig', 'ruckgangig', 'rückgangig', 'ruckgängig', 'rueckgängig',
  'rückgaengig', 'rückgängig machen', 'rueckgaengig machen', 'zurück', 'zurueck', 'undo',
  'zurücknehmen', 'zuruecknehmen', 'zurück bitte', 'bitte zurücknehmen'];
const STATUS = ['status', 'stand', 'entwurf'];
const HELP = ['hilfe', 'help', 'hilfe bitte', 'was kannst du', 'anleitung'];
const NOTES = ['notizen', 'notes'];
const NOTES_CLEAR = ['notizen leeren', 'notizen löschen', 'notizen loeschen', 'notes clear'];

// Casual confirmations ("ja klar", "passt so", "ok danke", "nein doch nicht").
// Only short messages made of nothing but these words count; anything with a
// number or another word stays an edit request.
const YES_START = /^(?:ja+|jo|jep|jap|jup|ok|okay|oki|passt|klar|genau|super|perfekt|yes|mach|online|los)$/;
const YES_FILL = new Set(['jo', 'jep', 'jap', 'jup', 'ok', 'okay', 'oki', 'passt', 'klar', 'genau', 'super',
  'perfekt', 'yes', 'mach', 'machen', 'online', 'los', 'so', 'das', 'es', 'bitte', 'danke', 'gut', 'gerne',
  'stellen', 'veröffentlichen', 'freigeben', 'damit']);
const NO_START = /^(?:nein|nö|noe|nee|ne|no|verwerfen|abbrechen|lösch|lösche)$/;
const NO_FILL = new Set(['nein', 'nö', 'noe', 'nee', 'ne', 'no', 'danke', 'doch', 'nicht', 'lieber', 'verwerfen',
  'abbrechen', 'bitte', 'weg', 'damit', 'den', 'entwurf', 'lösch', 'lösche', 'löschen', 'das', 'mach']);
const NO_PHRASES = ['doch nicht', 'lieber nicht', 'doch lieber nicht'];
const UNDO_WORD = /^r(?:ü|u|ue)ckg(?:ä|a|ae)n/;
const UNDO_FILL = new Set(['bitte', 'machen', 'mach', 'das', 'wieder', 'mal']);
const THUMBS_UP = /[\u{1F44D}\u{1F44C}✅✔]/u;
const THUMBS_DOWN = /[\u{1F44E}❌]/u;

function normalize(text) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looseCommand(norm) {
  const words = norm.split(' ');
  if (words.length > 4 || /\d/.test(norm)) return null;
  if (words.some((w) => UNDO_WORD.test(w)) && words.every((w) => UNDO_WORD.test(w) || UNDO_FILL.has(w))) return 'undo';
  if (words.length <= 3 && YES_START.test(words[0]) && words.every((w) => YES_FILL.has(w) || /^ja+$/.test(w))) return 'yes';
  if (NO_PHRASES.includes(norm)) return 'no';
  if (NO_START.test(words[0]) && words.every((w) => NO_FILL.has(w))) return 'no';
  return null;
}

function fixedCommand(text) {
  const norm = normalize(text);
  if (!norm) {
    if (THUMBS_UP.test(text)) return 'yes';
    if (THUMBS_DOWN.test(text)) return 'no';
    return /^[\s?¿]+$/.test(text) && text.includes('?') ? 'help' : null;
  }
  if (YES.includes(norm)) return 'yes';
  if (NO.includes(norm)) return 'no';
  if (UNDO.includes(norm)) return 'undo';
  if (STATUS.includes(norm)) return 'status';
  if (HELP.includes(norm)) return 'help';
  if (NOTES.includes(norm)) return 'notes';
  if (NOTES_CLEAR.includes(norm)) return 'notes_clear';
  return looseCommand(norm);
}

// The marker for "publish without preview" must be unambiguous, because
// "direkt" is also an ordinary word ("kommt eiskalt und direkt"):
//   start:  "direkt: ...", "direkt! ..." or "direkt" on its own first line
//   end:    "direkt" on its own last line, "... - direkt" or "... !direkt"
const DIRECT_START = /^direkt[^\S\n]*(?:[:!]\s*|\n\s*)/iu;
const DIRECT_END = /(?:\n\s*|\s+[-–—]\s*|!\s*)direkt[\s.!]*$/iu;

/**
 * Returns { type, direct, text }.
 * type: 'yes' | 'no' | 'undo' | 'status' | 'help' | 'notes' | 'notes_clear' | 'direct_only' | 'edit' | 'empty'
 * direct: true when the message carries the "direkt" marker.
 * text: the edit text (without the marker) for type 'edit'.
 */
export function parseCommand(input) {
  const original = typeof input === 'string' ? input.trim() : '';
  if (!original) return { type: 'empty', direct: false, text: '' };

  const norm = normalize(original);
  // "direkt" alone says nothing about what to publish: explain, never publish.
  if (norm === 'direkt') return { type: 'direct_only', direct: false, text: '' };
  if (norm === 'ja direkt' || norm === 'direkt ja') return { type: 'yes', direct: true, text: '' };

  const fixed = fixedCommand(original);
  if (fixed) return { type: fixed, direct: false, text: '' };

  let rest = original;
  let direct = false;
  if (DIRECT_START.test(rest)) {
    direct = true;
    rest = rest.replace(DIRECT_START, '').trim();
  } else if (DIRECT_END.test(rest)) {
    direct = true;
    rest = rest.replace(DIRECT_END, '').trim();
  }
  if (!direct) return { type: 'edit', direct: false, text: original };

  if (!rest) return { type: 'direct_only', direct: false, text: '' };
  // "direkt" combined with a fixed command makes no sense: treat the whole
  // message as an edit request so the model can ask back.
  if (fixedCommand(rest)) return { type: 'edit', direct: false, text: original };
  return { type: 'edit', direct: true, text: rest };
}
