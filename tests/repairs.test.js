// Regression tests for the review findings (ids in the test names).

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_LINE, bullets } from '../lib/conversation.js';
import { locateItem, locateSection } from '../lib/content.js';
import { LIMITS, applyOperations } from '../lib/ops.js';
import { createMissCache, createPreviewToken, handlePreview, verifyPreviewToken } from '../lib/preview.js';
import { createGithubStore } from '../lib/store-github.js';
import { MAX_TEXT } from '../lib/whatsapp.js';
import { MIRROR, OWNER, SITE, TODAY, edit, fixtureContent, makeHarness, op } from './helpers.js';

const priceOp = (price, id = 'negroni') => op({ op: 'set_item', id, fields: ['price'], price });
const negroniPrice = async (h) => locateItem(await h.store.getPublished(), 'negroni').item.price;
const apply = (operations, ctx = {}, content = fixtureContent()) => applyOperations(content, operations, { today: TODAY, pendingPhoto: null, ...ctx });
const unclear = (reply) => ({ ok: true, intent: 'unclear', reply, forward: false, operations: [] });

// ---------- publish exactly once (double-publish-on-state-conflict, C5, F6) ----------

test('direkt + a state conflict after the publish: one model call, one commit, one history entry', async () => {
  const h = makeHarness({ script: [edit(op({ op: 'add_item', parent_id: 'focaccia', name: 'Trüffel', price: '12 €' }))] });
  h.store.conflictOnNextWrites(1, { after: 1 }); // the write right after react() conflicts
  const { reply } = await h.say('direkt: Neu bei Focaccia: Trüffel 12 €');
  assert.match(reply, /^Veröffentlicht:\n• Neu in Focaccia: Trüffel \(12 €\)/);
  assert.equal(h.model.calls.length, 1, 'the model is not asked again on the retry');
  assert.equal(h.store.commits.length, 1, 'published once');
  const ids = locateSection(await h.store.getPublished(), 'focaccia').section.items.map((i) => i.id);
  assert.deepEqual(ids, ['mortadella-provolone', 'trueffel'], 'no second copy of the item');
  assert.equal(h.state().history.length, 1);
  assert.equal(h.state().draft, null);

  assert.match((await h.say('rückgängig')).reply, /^Rückgängig gemacht/);
  assert.deepEqual(await h.store.getPublished(), fixtureContent());
});

test('JA + a state conflict after the publish: history is kept and RÜCKGÄNGIG takes back exactly this publication', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('99 €'))] });
  await h.say('direkt: Negroni 12 €');
  await h.say('Negroni 99 €');
  h.store.conflictOnNextWrites(1, { after: 1 });
  const yes = await h.say('JA');
  assert.match(yes.reply, /^Veröffentlicht:\n• Negroni: 12 € → 99 €/);
  assert.equal(await negroniPrice(h), '99 €');
  assert.equal(h.store.commits.length, 2);
  assert.equal(h.state().history.length, 2);
  assert.equal(h.state().draft, null);

  await h.say('RÜCKGÄNGIG');
  assert.equal(await negroniPrice(h), '12 €', 'one step back, not two');
});

test('publish succeeded but the state could not be stored at all: true reply now, history recorded on the next JA', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  await h.say('Negroni 12 €');
  h.store.conflictOnNextWrites(10, { after: 1 });
  const lost = await h.say('ja');
  assert.match(lost.reply, /^Veröffentlicht:/, 'it is live, so the owner is told so');
  assert.equal(h.store.commits.length, 1);
  h.store.conflictOnNextWrites(0);
  assert.ok(h.state().draft, 'the bookkeeping was lost: the draft is still stored');
  assert.equal(h.state().history.length, 0);

  const again = await h.say('ja');
  assert.match(again.reply, /^Veröffentlicht:/);
  assert.equal(h.store.commits.length, 1, 'not published a second time');
  assert.equal(h.state().draft, null);
  assert.equal(h.state().history.length, 1);
  await h.say('rückgängig');
  assert.equal(await negroniPrice(h), '11 €');
});

test('a conflict while drafting re-applies the cached model answer instead of asking the model again', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  h.store.conflictOnNextWrites(2, { after: 1 });
  const { reply } = await h.say('Negroni 12 €');
  assert.match(reply, /Negroni: 11 € → 12 €/);
  assert.equal(h.model.calls.length, 1);
});

// ---------- undo (undo-overwrites-master, C8) ----------

test('RÜCKGÄNGIG is refused when master no longer holds what the bot published', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  await h.say('direkt: Negroni 12 €');
  const pushed = await h.store.getPublished();
  pushed.texts['hero.text'] = 'DEV CHANGE';
  h.store.setPublished(pushed);

  const { reply } = await h.say('rückgängig');
  assert.match(reply, /inzwischen an anderer Stelle geändert, RÜCKGÄNGIG geht hier nicht/);
  assert.deepEqual(await h.store.getPublished(), pushed, 'the developer change is untouched');
  assert.equal(h.store.commits.length, 1);
});

test('RÜCKGÄNGIG says what was taken back and a further one does not claim nothing was ever published', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  await h.say('direkt: Negroni 12 €');
  const first = await h.say('rückgängig');
  assert.match(first.reply, /^Rückgängig gemacht\. Zurückgenommen ist die Veröffentlichung vom 16\.11\., 18:00 Uhr:\n• Negroni: 11 € → 12 €\n\nIn etwa einer Minute live/);
  const second = await h.say('rückgängig');
  assert.equal(second.reply, 'Es gibt gerade nichts zum Zurücknehmen.');
});

test('a push that lands between reading and publishing is not overwritten, for JA and for RÜCKGÄNGIG (F5)', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('13 €'))] });
  await h.say('direkt: Negroni 12 €');
  await h.say('Negroni 13 €');
  const pushed = await h.store.getPublished();
  pushed.texts['hero.text'] = 'DEV CHANGE';
  h.store.hooks.beforePublish = () => h.store.setPublished(pushed);
  assert.match((await h.say('ja')).reply, /inzwischen an anderer Stelle geändert/);
  assert.deepEqual(await h.store.getPublished(), pushed);
  assert.equal(h.state().draft, null);

  // Back to exactly what the bot published, then the same race for RÜCKGÄNGIG.
  const botState = fixtureContent();
  locateItem(botState, 'negroni').item.price = '12 €';
  h.store.setPublished(botState);
  h.store.hooks.beforePublish = () => h.store.setPublished(pushed);
  assert.match((await h.say('rückgängig')).reply, /RÜCKGÄNGIG geht hier nicht/);
  assert.deepEqual(await h.store.getPublished(), pushed);
});

// ---------- conversation context (C1) ----------

test('a clarifying question can be answered with a short message', async () => {
  const h = makeHarness({
    script: [
      unclear('Welchen meinst du: Negroni oder Negroni Sbagliato?'),
      (input) => {
        assert.deepEqual(input.previous, { text: 'negroni kostet jetz 12', reply: 'Welchen meinst du: Negroni oder Negroni Sbagliato?' });
        assert.equal(input.text, 'den normalen');
        return edit(priceOp('12 €'));
      },
      (input) => {
        assert.equal(input.previous, null, 'the question is settled once an edit came out of it');
        return edit(priceOp('13 €'));
      },
    ],
  });
  assert.equal(h.model.calls.length, 0);
  assert.equal((await h.say('negroni kostet jetz 12')).reply, 'Welchen meinst du: Negroni oder Negroni Sbagliato?');
  assert.equal(h.model.calls[0].previous, null);
  const second = await h.say('den normalen');
  assert.match(second.reply, /^Entwurf:\n• Negroni: 11 € → 12 €/);
  await h.say('negroni 13');
});

test('"ja" / "nein" answer the open question when there is nothing to confirm; the question expires', async () => {
  const h = makeHarness({
    script: [
      unclear('Meinst du den Negroni?'),
      (input) => { assert.equal(input.text, 'ja'); assert.equal(input.previous.reply, 'Meinst du den Negroni?'); return edit(priceOp('12 €')); },
      unclear('Meinst du den Negroni?'),
    ],
  });
  await h.say('negroni 12');
  assert.match((await h.say('ja')).reply, /^Entwurf:\n• Negroni: 11 € → 12 €/);
  await h.say('nein');
  await h.say('negroni 14');
  h.advance(31 * 60 * 1000);
  assert.match((await h.say('ja')).reply, /keinen offenen Entwurf/, 'after 30 minutes "ja" is no longer an answer');
  assert.equal(h.model.calls.length, 3);
});

test('a missing end date is asked for and the answer completes the special', async () => {
  const h = makeHarness({
    script: [
      edit(op({ op: 'add_special', title: 'Tiramisu', text: '6 €', until: '' })),
      (input) => {
        assert.match(input.previous.reply, /^Bis wann soll das Special gelten\?/);
        return edit(op({ op: 'add_special', title: 'Tiramisu', text: '6 €', until: '2026-11-22' }));
      },
    ],
  });
  assert.match((await h.say('Special Tiramisu 6 €')).reply, /Bis wann soll das Special gelten\?/);
  assert.match((await h.say('bis sonntag')).reply, /Neues Special: Tiramisu – 6 € \(16\.11\. bis 22\.11\.\)/);
});

// ---------- direkt with an open draft (C2) ----------

test('"direkt: …" while a draft is open publishes nothing and adds to the draft', async () => {
  const h = makeHarness({
    script: [
      edit(op({ op: 'set_tab_label', id: 'snacks', title: 'Mangiare' })),
      edit(priceOp('12 €')),
    ],
  });
  await h.say('bitte Mangiare statt Snacks schreiben');
  const { reply } = await h.say('direkt: Negroni 12 €');
  assert.match(reply, /^Es ist noch ein Entwurf offen, deshalb habe ich nichts direkt veröffentlicht\./);
  assert.match(reply, /• Karten-Bereich Snacks heißt jetzt Mangiare\n• Negroni: 11 € → 12 €/);
  assert.ok(reply.includes(CONFIRM_LINE));
  assert.equal(h.store.commits.length, 0);
  assert.deepEqual(await h.store.getPublished(), fixtureContent());

  const bare = await h.say('direkt');
  assert.match(bare.reply, /Schreib hinter „direkt:“/);
  assert.match(bare.reply, /Dein Entwurf ist noch offen/);
  assert.equal(h.store.commits.length, 0, 'a bare "direkt" never publishes the draft');
  await h.say('ja');
  assert.equal(h.store.commits.length, 1);
});

// ---------- hours in several places (C3) ----------

test('changing opening hours: plain label, hint about video and Google text, note for the developer after publishing', async () => {
  const h = makeHarness({ script: [edit(op({ op: 'set_text', id: 'visit.hours1', text: 'Di–Sa 15:00–00:00' }))] });
  const draft = await h.say('wir machen jetzt erst um 15 uhr auf');
  assert.match(draft.reply, /• Öffnungszeiten: „Di–Sa 14:30–00:00“ → „Di–Sa 15:00–00:00“/);
  assert.equal(draft.reply.includes('visit.hours1'), false, 'no technical key (C10)');
  assert.match(draft.reply, /Im Info-Video und in der Google-Beschreibung stehen dann noch die alten Angaben/);
  assert.equal(h.state().notes.length, 0, 'nothing noted for a mere draft');
  const yes = await h.say('ja');
  assert.match(yes.reply, /Das habe ich für Jose notiert\./);
  assert.equal(h.state().notes.length, 1);
  assert.match(h.state().notes[0].text, /Info-Video/);
});

// ---------- confirmations and reminders (C6, C15) ----------

test('casual confirmation publishes the draft without a model call; reactions are ignored silently', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  await h.say('Negroni 12 €');
  const reaction = await h.say('', OWNER, { type: 'reaction' });
  assert.deepEqual(reaction.result, { handled: false, reason: 'reaction' });
  assert.equal(reaction.reply, null);
  const { reply } = await h.say('ja klar 👍');
  assert.match(reply, /^Veröffentlicht:/);
  assert.equal(h.model.calls.length, 1);
});

test('every reply that is not about the draft reminds the owner that it is still open', async () => {
  const h = makeHarness({
    script: [
      edit(priceOp('12 €')),
      { ok: true, intent: 'question', reply: 'Der Negroni kostet 11 €.', forward: false, operations: [] },
      { ok: true, intent: 'out_of_scope', reply: '', forward: false, operations: [] },
      edit(op({ op: 'remove_item', id: 'gibt-es-nicht' })),
    ],
  });
  await h.say('Negroni 12 €');
  const tail = `\nDein Entwurf ist noch offen. ${CONFIRM_LINE}`;
  assert.equal((await h.say('was kostet der negroni?')).reply, `Der Negroni kostet 11 €.${tail}`);
  assert.ok((await h.say('mach die seite blau')).reply.endsWith(tail));
  assert.ok((await h.say('den dings raus')).reply.endsWith(tail));
  const photo = await h.photo('');
  assert.ok(photo.reply.startsWith('Foto ist angekommen.'));
  assert.ok(photo.reply.endsWith(tail));
  assert.equal((await h.say('nein')).reply, 'Verworfen (auch das Foto). Die Seite bleibt, wie sie ist.');
  await h.photo('');
  assert.equal((await h.say('nein')).reply, 'Das Foto habe ich verworfen. Die Seite bleibt, wie sie ist.');
});

// ---------- hidden items (C7) ----------

test('hiding says that it stays hidden, and STATUS lists hidden items', async () => {
  const h = makeHarness({ script: [edit(op({ op: 'set_item_hidden', id: 'polpette-al-sugo', hidden: true }))] });
  const { reply } = await h.say('direkt: die polpette sind heute aus');
  assert.match(reply, /• Polpette al Sugo: ausgeblendet \(bleibt so, bis du schreibst „Polpette al Sugo wieder da“\)/);
  const status = await h.say('status');
  assert.match(status.reply, /Gerade ausgeblendet: Polpette al Sugo, Negroni Sbagliato\./);
  assert.match(status.reply, /Zurückholen mit z\. B\. „Polpette al Sugo wieder da“/);
});

// ---------- notes (C9) ----------

test('"gebe ich weiter" is only said when the developer really gets a copy; NOTIZEN LEEREN clears the list', async () => {
  const outOfScope = { ok: true, intent: 'out_of_scope', reply: '', forward: false, operations: [] };
  const h = makeHarness({ script: [outOfScope, outOfScope], mirrorNumber: MIRROR });
  const closed = await h.say('mach die seite blau');
  assert.match(closed.reply, /^Das kann ich nicht selbst ändern\. Ich habe es für Jose notiert/);
  assert.equal(h.sent.filter((m) => m.to === MIRROR).length, 0);

  await h.say('status', MIRROR); // opens the developer's 24 h window
  const open = await h.say('und bitte ein Reservierungsformular');
  assert.equal(open.reply, 'Das gebe ich an Jose weiter.');
  const copy = h.sent.filter((m) => m.to === MIRROR).at(-1);
  assert.match(copy.text, /Reservierungsformular/, 'the wish really went to the developer');

  assert.match((await h.say('notizen leeren')).reply, /kann nur Jose leeren/);
  assert.equal(h.state().notes.length, 2);
  assert.match((await h.say('notizen', MIRROR)).reply, /NOTIZEN LEEREN/);
  assert.equal((await h.say('Notizen leeren', MIRROR)).reply, 'Notizen geleert (2).');
  assert.equal(h.state().notes.length, 0);
});

// ---------- no-op drafts (C11) ----------

test('changes that cancel each other out leave no draft, and JA cannot claim a publication', async () => {
  const h = makeHarness({
    script: [
      edit(op({ op: 'add_special', title: 'Trüffel-Focaccia', text: '12 €', until: '2026-11-17', photo: 'attach', image_alt: 'Focaccia' })),
      edit(op({ op: 'remove_special', id: 'sp-trueffel-focaccia' })),
    ],
  });
  await h.photo('heute und morgen: trüffel focaccia 12€');
  assert.ok(h.state().draft);
  const { reply } = await h.say('special wieder raus');
  assert.equal(reply, 'Damit ist der Entwurf wieder leer. Die Seite bleibt, wie sie ist.');
  assert.equal(h.state().draft, null);
  assert.equal(h.store.drafts.size, 0, 'the draft photo is cleaned up');
  assert.match((await h.say('ja')).reply, /keinen offenen Entwurf/);
  assert.equal(h.store.commits.length, 0);
});

// ---------- long drafts (F10) ----------

test('a very long change list is shortened so that link and JA/NEIN line always fit', async () => {
  const long = (i) => `${'Sehr langer Text '.repeat(33)}${i}`.slice(0, 590);
  const script = Array.from({ length: 8 }, (_, i) => edit(op({ op: 'set_text', id: 'hero.text', text: long(i) })));
  const h = makeHarness({ script });
  let reply;
  for (let i = 0; i < script.length; i += 1) ({ reply } = await h.say(`neuer text ${i}`));
  assert.ok(reply.length <= MAX_TEXT, `reply has ${reply.length} characters`);
  assert.ok(reply.includes(`Vorschau: ${SITE}/?vorschau=`));
  assert.ok(reply.endsWith(CONFIRM_LINE));
  assert.match(reply, /… und \d+ weitere Änderungen/);
  assert.equal(bullets(['a', 'b']), '• a\n• b');
  assert.equal(bullets(['a'.repeat(50), 'b'.repeat(50), 'c'], 60), `• ${'a'.repeat(50)}\n… und 2 weitere Änderungen`);
});

// ---------- operations ----------

test('F3: a menu with nothing to show is refused; an empty section is pointed out', () => {
  const all = ['aperitivo-platte', 'polpette-al-sugo', 'torta-della-nonna', 'mortadella-provolone', 'negroni'];
  const hideAll = apply(all.map((id) => op({ op: 'set_item_hidden', id, hidden: true })));
  assert.equal(hideAll.ok, false);
  assert.match(hideAll.error, /Damit wäre die Karte leer/);
  assert.equal(hideAll.internal, false);
  const removeAll = apply(['mangiare', 'focaccia', 'negronis'].map((id) => op({ op: 'remove_section', id })));
  assert.equal(removeAll.ok, false);

  const added = apply([op({ op: 'add_section', parent_id: 'snacks', title: 'Dolci' })]);
  assert.equal(added.ok, true);
  assert.deepEqual(added.notices, ['Hinweis: Der Abschnitt Dolci hat jetzt keinen sichtbaren Eintrag und wird auf der Seite nicht gezeigt.']);
  const moved = apply([op({ op: 'move_item', id: 'mortadella-provolone', parent_id: 'mangiare' })]);
  assert.match(moved.notices[0], /Der Abschnitt Focaccia hat jetzt keinen sichtbaren Eintrag/);
  const filled = apply([
    op({ op: 'add_section', id: 'neu-1', parent_id: 'snacks', title: 'Dolci' }),
    op({ op: 'add_item', parent_id: 'neu-1', name: 'Tiramisu', price: '6 €' }),
  ]);
  assert.deepEqual(filled.notices, []);
});

test('F4: joined emoji (zero width joiner) are accepted, other invisible characters are not', () => {
  const note = 'Vom Chef \u{1F468}‍\u{1F373} empfohlen';
  const r = apply([op({ op: 'set_item', id: 'negroni', fields: ['note'], note })]);
  assert.equal(r.ok, true);
  assert.equal(locateItem(r.content, 'negroni').item.note, note);
  assert.equal(apply([op({ op: 'set_item', id: 'negroni', fields: ['note'], note: 'a​b' })]).ok, false);
  assert.equal(apply([op({ op: 'set_item', id: 'negroni', fields: ['note'], note: 'a‮b' })]).ok, false);
});

test('F7: moving an item to where it already is is no change', () => {
  const r = apply([op({ op: 'move_item', id: 'torta-della-nonna', position: 'end' })]);
  assert.deepEqual(r, { ok: false, error: 'Das steht schon genau so auf der Seite.', internal: false });
  assert.equal(apply([op({ op: 'move_item', id: 'aperitivo-platte', position: 'start' })]).ok, false);
  assert.equal(apply([op({ op: 'move_item', id: 'polpette-al-sugo', position: 'after', after_id: 'aperitivo-platte' })]).ok, false);
  assert.equal(apply([op({ op: 'move_item', id: 'aperitivo-platte', position: 'end' })]).ok, true);
});

test('F8: a generated id never looks like a placeholder, and a placeholder cannot shadow a real id', () => {
  const r = apply([
    op({ op: 'add_item', parent_id: 'mangiare', name: 'Neu 1' }),
    op({ op: 'add_item', id: 'neu-1', parent_id: 'mangiare', name: 'Zwei' }),
    op({ op: 'set_item', id: 'neu-1', fields: ['price'], price: '3 €' }),
  ]);
  assert.equal(r.ok, true);
  assert.equal(locateItem(r.content, 'eintrag-neu-1').item.name, 'Neu 1');
  assert.equal(locateItem(r.content, 'eintrag-neu-1').item.price, '');
  assert.equal(locateItem(r.content, 'zwei').item.price, '3 €');

  const legacy = fixtureContent();
  locateItem(legacy, 'negroni').item.id = 'neu-1';
  const clash = apply([op({ op: 'add_item', id: 'neu-1', parent_id: 'mangiare', name: 'Zwei' })], {}, legacy);
  assert.equal(clash.ok, false);
  assert.equal(clash.internal, true);
});

test('C4: expired specials do not count toward the limit and are dropped when it is reached', () => {
  const content = fixtureContent();
  content.specials = Array.from({ length: LIMITS.specials }, (_, i) => ({
    id: `sp-alt-${i + 1}`, title: `Alt ${i + 1}`, text: '', image: null, imageAlt: '', from: '2026-10-01', until: '2026-10-31',
  }));
  const r = apply([op({ op: 'add_special', title: 'Neu', until: '2026-11-20' })], {}, content);
  assert.equal(r.ok, true);
  assert.deepEqual(r.content.specials.map((s) => s.id), ['sp-neu']);
  assert.deepEqual(r.changes, ['Neues Special: Neu (16.11. bis 20.11.)'], 'the owner hears nothing about the cleanup');

  const full = fixtureContent();
  full.specials = Array.from({ length: LIMITS.specials }, (_, i) => ({
    id: `sp-jetzt-${i + 1}`, title: `Jetzt ${i + 1}`, text: '', image: null, imageAlt: '', from: '2026-11-01', until: '2026-11-30',
  }));
  assert.match(apply([op({ op: 'add_special', title: 'Neu', until: '2026-11-20' })], {}, full).error, /zu viele Specials/);
});

test('C12: the draft line of a new entry repeats what the owner typed', () => {
  const r = apply([op({ op: 'add_item', parent_id: 'focaccia', name: 'Trüffel', price: '12 €', text: 'Trüffelcreme · Burrata', note: 'Nur am Wochenende' })]);
  assert.deepEqual(r.changes, ['Neu in Focaccia: Trüffel (12 €) – „Trüffelcreme · Burrata“, „Nur am Wochenende“']);
});

test('C16: mistakes of the model are marked internal, things the owner can fix are not', () => {
  for (const operations of [
    [op({ op: 'remove_item', id: 'negroni-classico' })],
    [{ op: 'run_shell' }],
    [op({ op: 'set_item', id: 'negroni' })],
    [],
  ]) {
    assert.equal(apply(operations).internal, true, JSON.stringify(operations));
  }
  for (const operations of [
    [op({ op: 'add_special', title: 'X', until: '' })],
    [op({ op: 'add_special', title: 'X', until: '2026-11-20', photo: 'attach' })],
    [op({ op: 'set_item', id: 'negroni', fields: ['price'], price: '11 €' })],
    [op({ op: 'set_item', id: 'negroni', fields: ['name'], name: 'x'.repeat(LIMITS.name + 1) })],
  ]) {
    assert.equal(apply(operations).internal, false, JSON.stringify(operations));
  }
});

// ---------- preview (preview-unauthenticated-github-calls) ----------

const SECRET = 'geheim-nur-im-test';

test('preview tokens carry a MAC; a wrong token is rejected without any I/O', async () => {
  const token = createPreviewToken(SECRET);
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(verifyPreviewToken(token, SECRET), true);
  assert.equal(verifyPreviewToken(token, 'anderes-geheimnis'), false);
  assert.equal(verifyPreviewToken(`${token.slice(0, 31)}${token[31] === '0' ? '1' : '0'}`, SECRET), false);
  assert.equal(verifyPreviewToken('0'.repeat(32), SECRET), false);
  assert.notEqual(createPreviewToken(SECRET), token);

  // Against the real GitHub store with a fetch that fails the test when it is called.
  let requests = 0;
  const store = createGithubStore({ token: 't', repo: 'o/r', fetchImpl: async () => { requests += 1; throw new Error('no network expected'); } });
  for (const bad of ['0'.repeat(32), 'f'.repeat(32), 'a1'.repeat(16), null, 'x']) {
    const res = await handlePreview({ store, token: bad, secret: SECRET });
    assert.equal(res.status, 404, String(bad));
  }
  assert.equal(requests, 0, 'anonymous requests with made-up tokens cause no GitHub call');
});

test('the conversation issues tokens the endpoint accepts, and an old link is looked up only once', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('13 €'))], previewSecret: SECRET });
  const first = h.tokenOf((await h.say('Negroni 12 €')).reply);
  assert.equal(verifyPreviewToken(first, SECRET), true);
  let reads = 0;
  const counting = { ...h.store, readState: async () => { reads += 1; return h.store.readState(); } };
  const misses = createMissCache();
  const get = (token) => handlePreview({ store: counting, token, secret: SECRET, misses, now: new Date(h.now()) });

  assert.equal((await get(first)).status, 200);
  assert.equal((await get(first)).status, 200);
  assert.equal(reads, 2, 'a live draft is always read fresh');

  await h.say('nein');
  const second = h.tokenOf((await h.say('Negroni 13 €')).reply);
  assert.notEqual(second, first);
  reads = 0;
  for (let i = 0; i < 5; i += 1) assert.equal((await get(first)).status, 404);
  assert.equal(reads, 1, 'the dead link costs one read, then it is remembered');
  assert.equal((await get(second)).status, 200, 'the new draft is not affected');
});

test('miss cache forgets after its time and stays bounded', () => {
  let now = 0;
  const cache = createMissCache({ ttlMs: 1000, max: 2, now: () => now });
  cache.add('a');
  assert.equal(cache.has('a'), true);
  now = 1001;
  assert.equal(cache.has('a'), false);
  cache.add('b'); cache.add('c'); cache.add('d');
  assert.equal(cache.has('b'), false, 'oldest entry dropped');
  assert.equal(cache.has('d'), true);
});
