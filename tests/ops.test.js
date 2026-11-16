import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, LIMITS, MAX_OPS } from '../lib/ops.js';
import { locateItem, locateSection, validateContent } from '../lib/content.js';
import { RESPONSE_SCHEMA } from '../lib/model.js';
import { TODAY, fixtureContent, op } from './helpers.js';

const ctx = { today: TODAY, pendingPhoto: null };
const apply = (ops, c = ctx, content = fixtureContent()) => applyOperations(content, ops, c);
const names = (content, sectionId) => locateSection(content, sectionId).section.items.map((i) => i.id);

test('fixture is valid content', () => {
  assert.deepEqual(validateContent(fixtureContent()), []);
});

test('set_text changes an existing key', () => {
  const r = apply([op({ op: 'set_text', id: 'visit.hours1', text: 'Di–Sa 15:00–00:00' })]);
  assert.equal(r.ok, true);
  assert.equal(r.content.texts['visit.hours1'], 'Di–Sa 15:00–00:00');
  assert.deepEqual(r.changes, ['Öffnungszeiten: „Di–Sa 14:30–00:00“ → „Di–Sa 15:00–00:00“']);
});

test('set_text rejects unknown keys, empty values and prototype keys', () => {
  assert.equal(apply([op({ op: 'set_text', id: 'hero.nope', text: 'x' })]).ok, false);
  assert.equal(apply([op({ op: 'set_text', id: 'hero.text', text: '  ' })]).ok, false);
  assert.equal(apply([op({ op: 'set_text', id: '__proto__', text: 'x' })]).ok, false);
  assert.equal(apply([op({ op: 'set_text', id: 'constructor', text: 'x' })]).ok, false);
});

test('set_item changes only the listed fields', () => {
  const r = apply([op({ op: 'set_item', id: 'negroni', fields: ['price'], price: '12 €', name: 'IGNORED', text: 'IGNORED' })]);
  assert.equal(r.ok, true);
  const { item } = locateItem(r.content, 'negroni');
  assert.equal(item.price, '12 €');
  assert.equal(item.name, 'Negroni');
  assert.equal(item.text, 'Gin · Campari · Vermouth');
  assert.deepEqual(r.changes, ['Negroni: 11 € → 12 €']);
});

test('set_item can rename, clear a note and set a text', () => {
  const r = apply([op({ op: 'set_item', id: 'aperitivo-platte', fields: ['name', 'note', 'text'], name: 'Aperitivo-Teller', note: '', text: 'Oliven · Focaccia' })]);
  assert.equal(r.ok, true);
  const { item } = locateItem(r.content, 'aperitivo-platte');
  assert.equal(item.id, 'aperitivo-platte', 'ids never change');
  assert.equal(item.name, 'Aperitivo-Teller');
  assert.equal(item.note, '');
  assert.equal(item.text, 'Oliven · Focaccia');
  assert.equal(r.changes.length, 3);
});

test('set_item rejects unknown id, missing fields, foreign fields, empty name', () => {
  assert.equal(apply([op({ op: 'set_item', id: 'gibt-es-nicht', fields: ['price'], price: '1 €' })]).ok, false);
  assert.equal(apply([op({ op: 'set_item', id: 'negroni', fields: [], price: '1 €' })]).ok, false);
  assert.equal(apply([op({ op: 'set_item', id: 'negroni', fields: ['title'], title: 'x' })]).ok, false);
  assert.equal(apply([op({ op: 'set_item', id: 'negroni', fields: ['name'], name: '' })]).ok, false);
});

test('add_item creates a server-generated unique id at the requested position', () => {
  const r = apply([
    op({ op: 'add_item', parent_id: 'negronis', name: 'Negroni', price: '13 €', position: 'start' }),
    op({ op: 'add_item', parent_id: 'mangiare', name: 'Oliven', price: '4 €', position: 'after', after_id: 'aperitivo-platte', id: 'neu-1' }),
    op({ op: 'add_item', parent_id: 'mangiare', name: 'Grissini', position: 'after', after_id: 'neu-1' }),
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(names(r.content, 'negronis'), ['negroni-2', 'negroni', 'negroni-sbagliato']);
  assert.deepEqual(names(r.content, 'mangiare'), ['aperitivo-platte', 'oliven', 'grissini', 'polpette-al-sugo', 'torta-della-nonna']);
  assert.deepEqual(locateItem(r.content, 'oliven').item, { id: 'oliven', name: 'Oliven', price: '4 €', text: '', note: '', hidden: false });
  assert.deepEqual(validateContent(r.content), []);
});

test('add_item: the model cannot choose the id', () => {
  const r = apply([op({ op: 'add_item', parent_id: 'negronis', name: 'Americano', id: 'negroni' })]);
  assert.equal(r.ok, false, 'a non-placeholder id on add is rejected');
});

test('add_item rejects unknown section, missing name, unknown after_id', () => {
  assert.equal(apply([op({ op: 'add_item', parent_id: 'nope', name: 'X' })]).ok, false);
  assert.equal(apply([op({ op: 'add_item', parent_id: 'negronis', name: ' ' })]).ok, false);
  assert.equal(apply([op({ op: 'add_item', parent_id: 'negronis', name: 'X', position: 'after', after_id: 'polpette-al-sugo' })]).ok, false);
});

test('remove_item removes exactly that item', () => {
  const r = apply([op({ op: 'remove_item', id: 'polpette-al-sugo' })]);
  assert.equal(r.ok, true);
  assert.deepEqual(names(r.content, 'mangiare'), ['aperitivo-platte', 'torta-della-nonna']);
  assert.deepEqual(r.changes, ['Entfernt: Polpette al Sugo (aus Mangiare)']);
  assert.equal(apply([op({ op: 'remove_item', id: 'nope' })]).ok, false);
});

test('move_item within a section and across sections', () => {
  const r = apply([
    op({ op: 'move_item', id: 'torta-della-nonna', position: 'start' }),
    op({ op: 'move_item', id: 'polpette-al-sugo', parent_id: 'focaccia', position: 'after', after_id: 'mortadella-provolone' }),
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(names(r.content, 'mangiare'), ['torta-della-nonna', 'aperitivo-platte']);
  assert.deepEqual(names(r.content, 'focaccia'), ['mortadella-provolone', 'polpette-al-sugo']);
  assert.equal(apply([op({ op: 'move_item', id: 'negroni', position: 'after', after_id: 'negroni' })]).ok, false);
  assert.equal(apply([op({ op: 'move_item', id: 'negroni', parent_id: 'nope' })]).ok, false);
});

test('set_item_hidden hides and shows', () => {
  const r = apply([
    op({ op: 'set_item_hidden', id: 'negroni', hidden: true }),
    op({ op: 'set_item_hidden', id: 'negroni-sbagliato', hidden: false }),
  ]);
  assert.equal(r.ok, true);
  assert.equal(locateItem(r.content, 'negroni').item.hidden, true);
  assert.equal(locateItem(r.content, 'negroni-sbagliato').item.hidden, false);
  assert.deepEqual(r.changes, ['Negroni: ausgeblendet (bleibt so, bis du schreibst „Negroni wieder da“)', 'Negroni Sbagliato: wieder sichtbar']);
  const raw = op({ op: 'set_item_hidden', id: 'negroni' });
  delete raw.hidden;
  assert.equal(apply([raw]).ok, false, 'hidden must be given');
});

test('add_section, then items into it via placeholder', () => {
  const r = apply([
    op({ op: 'add_section', parent_id: 'cocktails', title: 'Spritz', subtitle: 'Leicht & frisch', id: 'neu-1', position: 'start' }),
    op({ op: 'add_item', parent_id: 'neu-1', name: 'Aperol Spritz', price: '8 €' }),
  ]);
  assert.equal(r.ok, true);
  const tab = r.content.menu.find((t) => t.id === 'cocktails');
  assert.deepEqual(tab.sections.map((s) => s.id), ['spritz', 'negronis']);
  assert.deepEqual(names(r.content, 'spritz'), ['aperol-spritz']);
  assert.equal(apply([op({ op: 'add_section', parent_id: 'nope', title: 'X' })]).ok, false);
  assert.equal(apply([op({ op: 'add_section', parent_id: 'cocktails', title: '' })]).ok, false);
});

test('set_section and remove_section', () => {
  const r = apply([
    op({ op: 'set_section', id: 'focaccia', fields: ['title', 'subtitle'], title: 'Focacce', subtitle: '' }),
    op({ op: 'remove_section', id: 'negronis' }),
  ]);
  assert.equal(r.ok, true);
  const { section } = locateSection(r.content, 'focaccia');
  assert.equal(section.title, 'Focacce');
  assert.equal(section.subtitle, '');
  assert.equal(locateSection(r.content, 'negronis'), null);
  assert.match(r.changes[2], /Abschnitt entfernt: Negronis \(mit 2 Einträgen\)/);
  assert.equal(apply([op({ op: 'set_section', id: 'focaccia', fields: ['price'], price: 'x' })]).ok, false);
  assert.equal(apply([op({ op: 'remove_section', id: 'nope' })]).ok, false);
});

test('set_tab_label renames a tab and nothing else', () => {
  const r = apply([op({ op: 'set_tab_label', id: 'snacks', title: 'Essen' })]);
  assert.equal(r.ok, true);
  assert.equal(r.content.menu[0].label, 'Essen');
  assert.equal(r.content.menu[0].id, 'snacks');
  assert.equal(apply([op({ op: 'set_tab_label', id: 'nope', title: 'X' })]).ok, false);
  assert.equal(apply([op({ op: 'set_tab_label', id: 'snacks', title: 'x'.repeat(LIMITS.label + 1) })]).ok, false);
});

test('add_special without photo, default start date is today', () => {
  const r = apply([op({ op: 'add_special', title: 'Trüffel-Focaccia', text: 'Nur dieses Wochenende.', until: '2026-11-22' })]);
  assert.equal(r.ok, true);
  const special = r.content.specials[1];
  assert.deepEqual(special, {
    id: 'sp-trueffel-focaccia', title: 'Trüffel-Focaccia', text: 'Nur dieses Wochenende.',
    image: null, imageAlt: '', from: TODAY, until: '2026-11-22',
  });
  assert.deepEqual(r.changes, ['Neues Special: Trüffel-Focaccia – Nur dieses Wochenende. (16.11. bis 22.11.)']);
});

test('add_special with photo uses the pending photo; image path comes from the server', () => {
  const r = apply(
    [op({ op: 'add_special', title: 'Tiramisu', until: '2026-11-20', photo: 'attach', image_alt: 'Ein Glas Tiramisu auf einem Holztisch' })],
    { today: TODAY, pendingPhoto: 'foto-1.webp' },
  );
  assert.equal(r.ok, true);
  assert.equal(r.usedPhoto, true);
  assert.equal(r.content.specials[1].image, 'assets/uploads/foto-1.webp');
  assert.equal(r.content.specials[1].imageAlt, 'Ein Glas Tiramisu auf einem Holztisch');
});

test('add_special: invalid cases', () => {
  const bad = (partial, c = ctx) => assert.equal(apply([op({ op: 'add_special', title: 'X', until: '2026-11-20', ...partial })], c).ok, false);
  bad({ until: '' });
  bad({ until: '2026-02-30' });
  bad({ until: '20.11.2026' });
  bad({ from: '2026-11-21' }); // until before from
  bad({ until: '2026-11-15' }); // already over
  bad({ until: '2028-01-01' }); // more than a year ahead
  bad({ title: '' });
  bad({ photo: 'attach' }); // no photo pending
  bad({ photo: 'remove' });
  bad({ image_alt: 'x'.repeat(121), photo: 'attach' }, { today: TODAY, pendingPhoto: 'foto-1.webp' });
});

test('set_special changes fields, attaches and removes a photo', () => {
  const r = apply(
    [op({ op: 'set_special', id: 'sp-aperitivo-stunde', fields: ['title', 'until'], title: 'Aperitivo-Zeit', until: '2026-12-24', photo: 'attach', image_alt: 'Zwei Gläser Spritz' })],
    { today: TODAY, pendingPhoto: 'foto-2.webp' },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.specials[0], {
    id: 'sp-aperitivo-stunde', title: 'Aperitivo-Zeit', text: 'Jeden Abend bis 19 Uhr.',
    image: 'assets/uploads/foto-2.webp', imageAlt: 'Zwei Gläser Spritz', from: '2026-11-01', until: '2026-12-24',
  });
  const removed = applyOperations(r.content, [op({ op: 'set_special', id: 'sp-aperitivo-stunde', photo: 'remove' })], ctx);
  assert.equal(removed.ok, true);
  assert.equal(removed.content.specials[0].image, null);
  assert.equal(removed.content.specials[0].imageAlt, '');
});

test('set_special: invalid cases', () => {
  const bad = (partial) => assert.equal(apply([op({ op: 'set_special', id: 'sp-aperitivo-stunde', ...partial })]).ok, false);
  bad({}); // nothing to change
  bad({ id: 'sp-nope', fields: ['title'], title: 'X' });
  bad({ fields: ['until'], until: '2026-10-01' }); // before from
  bad({ fields: ['from'], from: 'morgen' });
  bad({ fields: ['price'], price: '1 €' });
  bad({ fields: ['image_alt'], image_alt: 'Bild' }); // special has no photo
});

test('remove_special', () => {
  const r = apply([op({ op: 'remove_special', id: 'sp-aperitivo-stunde' })]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.specials, []);
  assert.equal(apply([op({ op: 'remove_special', id: 'sp-nope' })]).ok, false);
});

test('values: angle brackets, control characters, line breaks and over-long values are rejected', () => {
  const price = (value) => apply([op({ op: 'set_item', id: 'negroni', fields: ['price'], price: value })]).ok;
  assert.equal(price('<b>12 €</b>'), false);
  assert.equal(price('12 > 11'), false);
  assert.equal(price('12\n€'), false);
  assert.equal(price('12\u0000€'), false);
  assert.equal(price(`12${String.fromCharCode(0x202e)}€`), false, 'bidi override');
  assert.equal(price(`12${String.fromCharCode(0x200b)}€`), false, 'zero width space');
  assert.equal(price('x'.repeat(LIMITS.price + 1)), false);
  assert.equal(price('x'.repeat(LIMITS.price)), true);
  assert.equal(price('ab 12 € (0,2 l)'), true, 'price is free text');
  assert.equal(price(12), false, 'not a string');
});

test('shape: unknown op, unknown key, wrong types, non-object, empty list, too many', () => {
  assert.equal(apply([op({ op: 'delete_everything' })]).ok, false);
  assert.equal(apply([{ ...op({ op: 'remove_item', id: 'negroni' }), html: '<script>' }]).ok, false);
  assert.equal(apply([op({ op: 'remove_item', id: ['negroni'] })]).ok, false);
  assert.equal(apply([op({ op: 'set_item', id: 'negroni', fields: 'price', price: '1 €' })]).ok, false);
  assert.equal(apply([op({ op: 'move_item', id: 'negroni', position: 'top' })]).ok, false);
  assert.equal(apply(['remove_item negroni']).ok, false);
  assert.equal(apply([null]).ok, false);
  assert.equal(apply([]).ok, false);
  assert.equal(apply('remove_item').ok, false);
  const many = Array.from({ length: MAX_OPS + 1 }, (_, i) => op({ op: 'add_item', parent_id: 'negronis', name: `Drink ${i}` }));
  assert.equal(apply(many).ok, false);
});

test('enum values are compared case-insensitively', () => {
  const r = apply([op({ op: 'SET_ITEM', id: 'negroni', fields: ['Price'], price: '12 €', position: 'END', photo: 'KEEP' })]);
  assert.equal(r.ok, true);
});

test('atomicity: one invalid operation means nothing is applied and the input is untouched', () => {
  const content = fixtureContent();
  const before = JSON.stringify(content);
  const r = applyOperations(content, [
    op({ op: 'set_item', id: 'negroni', fields: ['price'], price: '12 €' }),
    op({ op: 'remove_item', id: 'aperitivo-platte' }),
    op({ op: 'remove_item', id: 'gibt-es-nicht' }),
  ], ctx);
  assert.equal(r.ok, false);
  assert.equal(r.content, undefined);
  assert.match(r.error, /nicht gefunden/);
  assert.equal(JSON.stringify(content), before);
});

test('a successful run never modifies its input either', () => {
  const content = fixtureContent();
  const before = JSON.stringify(content);
  const r = applyOperations(content, [op({ op: 'remove_section', id: 'mangiare' })], ctx);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(content), before);
});

test('no-op edits are reported as such', () => {
  const r = apply([op({ op: 'set_item', id: 'negroni', fields: ['price'], price: '11 €' })]);
  assert.equal(r.ok, false);
  assert.match(r.error, /schon genau so/);
});

test('one photo cannot be attached to two specials', () => {
  const r = apply([
    op({ op: 'add_special', title: 'A', until: '2026-11-20', photo: 'attach' }),
    op({ op: 'add_special', title: 'B', until: '2026-11-20', photo: 'attach' }),
  ], { today: TODAY, pendingPhoto: 'foto-1.webp' });
  assert.equal(r.ok, false);
});

test('response schema stays inside the structured-output restrictions', () => {
  const forbidden = ['minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'oneOf', 'pattern', 'maxItems'];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const key of forbidden) assert.equal(key in node, false, `schema uses ${key}`);
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), 'every property is required');
    }
    Object.values(node).forEach(walk);
  };
  walk(RESPONSE_SCHEMA);
  // Every schema property of an operation is one the validator knows, and vice versa.
  const opProps = Object.keys(RESPONSE_SCHEMA.properties.operations.items.properties);
  assert.equal(apply([Object.fromEntries(opProps.map((k) => [k, op({ op: 'remove_item', id: 'negroni' })[k]]))]).ok, true);
});
