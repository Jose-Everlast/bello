import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../lib/commands.js';

const type = (text) => parseCommand(text).type;

test('JA and variants', () => {
  for (const text of ['JA', 'ja', 'Ja!', ' ja ', 'Ja.', 'ok', 'Okay', 'passt', 'Ja bitte', 'veröffentlichen', 'Veroeffentlichen', 'JA 👍']) {
    assert.deepEqual(parseCommand(text), { type: 'yes', direct: false, text: '' }, text);
  }
});

test('NEIN and variants', () => {
  for (const text of ['NEIN', 'nein', 'Nein!', 'nö', 'nee', 'verwerfen', 'Abbrechen', 'nein danke']) {
    assert.equal(type(text), 'no', text);
  }
});

test('RÜCKGÄNGIG and variants', () => {
  for (const text of ['RÜCKGÄNGIG', 'rückgängig', 'Rueckgaengig', 'ruckgangig', 'Rückgängig machen', 'zurück', 'undo']) {
    assert.equal(type(text), 'undo', text);
  }
});

test('STATUS, HILFE, NOTIZEN', () => {
  assert.equal(type('Status'), 'status');
  assert.equal(type('status?'), 'status');
  assert.equal(type('HILFE'), 'help');
  assert.equal(type('hilfe!'), 'help');
  assert.equal(type('?'), 'help');
  assert.equal(type('Notizen'), 'notes');
});

test('empty input', () => {
  assert.equal(type(''), 'empty');
  assert.equal(type('   '), 'empty');
  assert.equal(type(undefined), 'empty');
  assert.equal(type(null), 'empty');
});

test('everything else is an edit request, kept verbatim', () => {
  assert.deepEqual(parseCommand('Negroni kostet jetzt 12 €'), { type: 'edit', direct: false, text: 'Negroni kostet jetzt 12 €' });
  assert.equal(type('ja, aber den Preis bitte auf 13'), 'edit');
  assert.equal(type('nein, lieber 12 €'), 'edit');
  assert.equal(type('Jahrgangssekt neu auf die Karte'), 'edit');
});

test('"direkt" is a marker only when it is unambiguous', () => {
  const direct = { type: 'edit', direct: true, text: 'Negroni 12 €' };
  assert.deepEqual(parseCommand('direkt: Negroni 12 €'), direct);
  assert.deepEqual(parseCommand('Direkt! Negroni 12 €'), direct);
  assert.deepEqual(parseCommand('DIREKT\nNegroni 12 €'), direct);
  assert.deepEqual(parseCommand('Negroni 12 €\ndirekt'), direct);
  assert.deepEqual(parseCommand('Negroni 12 € - direkt'), direct);
  assert.deepEqual(parseCommand('Negroni 12 € !direkt'), direct);
});

test('"direkt" as an ordinary word at the start or end of a sentence is not a marker (F1, C13)', () => {
  for (const text of [
    'Bei uns kommt der Kaffee direkt.',
    'Neuer Hinweis beim Spritz: Kommt eiskalt und direkt',
    'Direkt am Markt als neuer Text oben',
    'direkt am tisch gemixt bei bellogroni dazuschreiben',
    'bellogroni: kommt eiskalt und direkt',
    'Direkt Negroni 12 €',
    'Negroni 12 € direkt',
    'Negroni 12 €, direkt',
  ]) {
    assert.deepEqual(parseCommand(text), { type: 'edit', direct: false, text }, text);
  }
});

test('casual confirmations, refusals and undo spellings are commands, not model calls (C6)', () => {
  for (const text of ['ja klar', 'jaa', 'ja mach', 'passt so', 'mach online', 'ok danke', '👍', '✅', 'Ja, passt so!']) {
    assert.equal(type(text), 'yes', text);
  }
  for (const text of ['nein doch nicht', 'doch nicht', 'lieber nicht', 'nee danke', '👎']) {
    assert.equal(type(text), 'no', text);
  }
  for (const text of ['rückgänig', 'rückgängig bitte', 'bitte rückgängig machen', 'Rueckgaengig bitte']) {
    assert.equal(type(text), 'undo', text);
  }
  // Anything with a number or another word stays an edit request.
  for (const text of ['ok 13', 'ja aber teurer', 'nein lieber 12', 'mach das raus', 'Rückgabe bitte', 'passt nicht', 'doch']) {
    assert.equal(type(text), 'edit', text);
  }
  assert.equal(type('Notizen leeren'), 'notes_clear');
});

test('"direkt" inside a word or sentence is not a marker', () => {
  assert.equal(parseCommand('Direktsaft neu bei Soft Drinks, 4 €').direct, false);
  assert.equal(parseCommand('Der Saft kommt direkt vom Hof, bitte so schreiben').direct, false);
  assert.equal(parseCommand('Indirekt').direct, false);
});

test('"direkt" alone publishes nothing; only an explicit JA does (C2)', () => {
  assert.deepEqual(parseCommand('direkt'), { type: 'direct_only', direct: false, text: '' });
  assert.deepEqual(parseCommand('Direkt!'), { type: 'direct_only', direct: false, text: '' });
  assert.deepEqual(parseCommand('direkt:'), { type: 'direct_only', direct: false, text: '' });
  assert.deepEqual(parseCommand('ja direkt'), { type: 'yes', direct: true, text: '' });
});

test('"direkt" with another command is passed on as an edit request', () => {
  assert.deepEqual(parseCommand('nein direkt'), { type: 'edit', direct: false, text: 'nein direkt' });
});
