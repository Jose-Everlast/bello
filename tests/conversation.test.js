import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_LINE, DRAFT_TTL_MS, MAX_HISTORY, STALE_MS } from '../lib/conversation.js';
import { locateItem } from '../lib/content.js';
import { handlePreview } from '../lib/preview.js';
import { MIRROR, OWNER, SITE, edit, fixtureContent, makeHarness, op } from './helpers.js';

const priceOp = (price, id = 'negroni') => op({ op: 'set_item', id, fields: ['price'], price });
const negroniPrice = async (h) => locateItem(await h.store.getPublished(), 'negroni').item.price;

test('edit -> preview -> JA publishes one commit', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  const { reply } = await h.say('Negroni kostet jetzt 12 €');
  const token = h.tokenOf(reply);
  assert.ok(token, 'reply contains a preview link');
  assert.equal(reply, `Entwurf:\n• Negroni: 11 € → 12 €\n\nVorschau: ${SITE}/?vorschau=${token}\n\n${CONFIRM_LINE}`);
  assert.equal(await negroniPrice(h), '11 €', 'nothing published yet');
  assert.equal(h.store.commits.length, 0);

  // The model saw the published content and the message, and nothing else of note.
  assert.equal(h.model.calls.length, 1);
  assert.equal(h.model.calls[0].text, 'Negroni kostet jetzt 12 €');
  assert.deepEqual(h.model.calls[0].content, fixtureContent());
  assert.equal(h.model.calls[0].image, null);

  const preview = await handlePreview({ store: h.store, token, now: new Date(h.now()) });
  assert.equal(preview.status, 200);
  assert.equal(locateItem(JSON.parse(preview.body).content, 'negroni').item.price, '12 €');

  const yes = await h.say('JA');
  assert.match(yes.reply, /^Veröffentlicht:\n• Negroni: 11 € → 12 €/);
  assert.ok(yes.reply.includes(`${SITE}/`));
  assert.equal(await negroniPrice(h), '12 €');
  assert.equal(h.store.commits.length, 1);
  assert.deepEqual(h.store.commits[0].paths, ['data/content.json']);
  assert.equal(h.state().draft, null);
  assert.equal(h.state().history.length, 1);
  assert.equal(h.model.calls.length, 1, 'JA does not call the model');

  const after = await handlePreview({ store: h.store, token, now: new Date(h.now()) });
  assert.equal(after.status, 404, 'the token dies with the draft');
});

test('edit -> NEIN discards', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  const { reply } = await h.say('Negroni 12 €');
  const token = h.tokenOf(reply);
  const no = await h.say('Nein');
  assert.match(no.reply, /Verworfen/);
  assert.equal(h.state().draft, null);
  assert.equal(await negroniPrice(h), '11 €');
  assert.equal(h.store.commits.length, 0);
  assert.equal((await handlePreview({ store: h.store, token, now: new Date(h.now()) })).status, 404);
  assert.match((await h.say('ja')).reply, /keinen offenen Entwurf/);
  assert.match((await h.say('nein')).reply, /nichts zu verwerfen/);
});

test('further edits are applied on top of the draft and the reply lists all pending changes', async () => {
  const h = makeHarness({
    script: [
      edit(priceOp('12 €')),
      (input) => {
        assert.equal(input.draftPending, true);
        assert.equal(locateItem(input.content, 'negroni').item.price, '12 €', 'the model sees the draft');
        return edit(op({ op: 'set_item_hidden', id: 'polpette-al-sugo', hidden: true }));
      },
    ],
  });
  const first = await h.say('Negroni 12 €');
  const second = await h.say('Polpette sind aus');
  assert.equal(h.tokenOf(second.reply), h.tokenOf(first.reply), 'same preview link');
  assert.ok(second.reply.startsWith('Entwurf (alle offenen Änderungen):\n• Negroni: 11 € → 12 €\n• Polpette al Sugo: ausgeblendet (bleibt so, bis du schreibst „Polpette al Sugo wieder da“)\n'));
  await h.say('ja');
  const live = await h.store.getPublished();
  assert.equal(locateItem(live, 'negroni').item.price, '12 €');
  assert.equal(locateItem(live, 'polpette-al-sugo').item.hidden, true);
  assert.equal(h.store.commits.length, 1, 'still one commit');
});

test('"direkt" applies and publishes without preview', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  const { reply } = await h.say('direkt: Negroni 12 €');
  assert.equal(h.model.calls[0].text, 'Negroni 12 €');
  assert.match(reply, /^Veröffentlicht:\n• Negroni: 11 € → 12 €/);
  assert.equal(h.tokenOf(reply), null);
  assert.equal(await negroniPrice(h), '12 €');
  assert.equal(h.state().draft, null);
  assert.equal(h.store.commits.length, 1);
});

test('"direkt" with an invalid operation publishes nothing', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'), op({ op: 'remove_item', id: 'gibt-es-nicht' }))] });
  const { reply } = await h.say('direkt: Negroni 12 € und den Dings raus');
  assert.match(reply, /nicht richtig verstanden/);
  assert.equal(reply.includes('gibt-es-nicht'), false, 'no technical detail for the owner (C16)');
  assert.match(reply, /Es wurde nichts geändert/);
  assert.equal(await negroniPrice(h), '11 €');
  assert.equal(h.state().draft, null);
  assert.equal(h.store.commits.length, 0);
});

test('invalid operations in a normal edit leave an existing draft untouched', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('<b>13 €</b>'))] });
  await h.say('Negroni 12 €');
  const before = JSON.stringify(h.state().draft);
  const { reply } = await h.say('Negroni fett 13 €');
  assert.match(reply, /nicht erlaubt/);
  assert.equal(JSON.stringify(h.state().draft), before);
});

test('RÜCKGÄNGIG restores the previously published content, step by step', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('13 €'))] });
  assert.match((await h.say('rückgängig')).reply, /nichts zum Zurücknehmen/);
  await h.say('direkt: Negroni 12 €');
  await h.say('direkt: Negroni 13 €');
  assert.equal(await negroniPrice(h), '13 €');

  const undo1 = await h.say('RÜCKGÄNGIG');
  assert.match(undo1.reply, /^Rückgängig gemacht/);
  assert.equal(await negroniPrice(h), '12 €');
  await h.say('Rückgängig');
  assert.equal(await negroniPrice(h), '11 €');
  assert.deepEqual(await h.store.getPublished(), fixtureContent());
  assert.match((await h.say('rückgängig')).reply, /nichts zum Zurücknehmen/);
  assert.equal(h.store.commits.length, 4);
});

test('RÜCKGÄNGIG is refused while a draft is pending', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('13 €'))] });
  await h.say('direkt: Negroni 12 €');
  await h.say('Negroni 13 €');
  const { reply } = await h.say('rückgängig');
  assert.match(reply, /noch ein Entwurf offen/);
  assert.equal(await negroniPrice(h), '12 €');
  assert.ok(h.state().draft);
});

test('only the last 10 published versions are kept', async () => {
  const script = Array.from({ length: MAX_HISTORY + 3 }, (_, i) => edit(priceOp(`${20 + i} €`)));
  const h = makeHarness({ script });
  for (let i = 0; i < script.length; i += 1) await h.say(`direkt: Negroni ${20 + i} €`);
  assert.equal(h.state().history.length, MAX_HISTORY);
});

test('out of scope: forwarded as a note, nothing changes', async () => {
  const h = makeHarness({ script: [{ ok: true, intent: 'out_of_scope', reply: 'Klar, mache ich!', forward: false, operations: [priceOp('1 €')] }] });
  const { reply } = await h.say('Mach den Hintergrund bitte blau und bau ein Reservierungsformular ein');
  assert.equal(reply, 'Das kann ich nicht selbst ändern. Ich habe es für Jose notiert. Bitte gib kurz Bescheid, dass dort etwas steht.');
  assert.equal(h.state().draft, null, 'operations of an out-of-scope answer are ignored');
  assert.equal(h.store.commits.length, 0);
  assert.equal(h.state().notes.length, 1);
  assert.equal(h.state().notes[0].text, 'Mach den Hintergrund bitte blau und bau ein Reservierungsformular ein');
  assert.equal(h.state().notes[0].from, OWNER);
  assert.match((await h.say('notizen')).reply, /Hintergrund bitte blau/);
});

test('mixed request: the edit is drafted and the rest is forwarded', async () => {
  const h = makeHarness({ script: [{ ...edit(priceOp('12 €')), forward: true }] });
  const { reply } = await h.say('Negroni 12 € und die Schrift bitte größer');
  assert.match(reply, /• Negroni: 11 € → 12 €/);
  assert.match(reply, /Den Rest kann ich nicht selbst ändern\. Ich habe es für Jose notiert/);
  assert.equal(h.state().notes.length, 1);
});

test('unclear and question: the model reply is passed on, cleaned, and nothing changes', async () => {
  const h = makeHarness({
    script: [
      { ok: true, intent: 'unclear', reply: 'Meinst du den Negroni oder den Negroni Sbagliato?', forward: false, operations: [priceOp('1 €')] },
      { ok: true, intent: 'question', reply: 'Der Negroni kostet 11 €.', forward: false, operations: [] },
      { ok: true, intent: 'unclear', reply: '', forward: false, operations: [] },
    ],
  });
  assert.equal((await h.say('Negroni teurer')).reply, 'Meinst du den Negroni oder den Negroni Sbagliato?');
  assert.equal((await h.say('Was kostet der Negroni?')).reply, 'Der Negroni kostet 11 €.');
  assert.match((await h.say('hmm')).reply, /nicht verstanden/);
  assert.equal(h.state().draft, null);
  assert.equal(h.store.commits.length, 0);
});

test('model failures are explained and change nothing', async () => {
  const h = makeHarness({
    script: [
      { ok: false, reason: 'timeout' },
      { ok: false, reason: 'refusal' },
      { ok: false, reason: 'config' },
      () => { throw new Error('boom'); },
      { ok: true, intent: 'edit', reply: '', forward: false, operations: [] },
    ],
  });
  assert.match((await h.say('a')).reply, /antwortet nicht/);
  assert.match((await h.say('b')).reply, /nicht verarbeiten/);
  assert.match((await h.say('c')).reply, /technisches Problem.*Jose/);
  assert.match((await h.say('d')).reply, /antwortet nicht/);
  assert.match((await h.say('e')).reply, /nicht richtig verstanden/);
  assert.equal(h.state().draft, null);
  assert.equal(h.state().notes.length, 1, 'a configuration problem leaves a note for the developer');
});

test('STATUS and HILFE', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  assert.match((await h.say('status')).reply, /Kein offener Entwurf/);
  assert.match((await h.say('Hilfe')).reply, /JA veröffentlicht, NEIN verwirft/);
  const { reply } = await h.say('Negroni 12 €');
  const status = await h.say('STATUS');
  assert.match(status.reply, /^Offener Entwurf:\n• Negroni: 11 € → 12 €/);
  assert.ok(status.reply.includes(`?vorschau=${h.tokenOf(reply)}`));
  assert.equal(h.model.calls.length, 1, 'commands never reach the model');
});

test('photo without caption: asks what it is for; the next text creates the special with the image', async () => {
  const h = makeHarness({
    script: [(input) => {
      assert.equal(input.hasPhoto, true);
      assert.equal(input.image.mediaType, 'image/webp');
      assert.equal(Buffer.from(input.image.base64, 'base64').toString(), 'webp:jpegdata');
      return edit(op({ op: 'add_special', title: 'Trüffel-Focaccia', text: '12 €', until: '2026-11-22', photo: 'attach', image_alt: 'Focaccia mit Trüffel auf einem Brett' }));
    }],
  });
  const first = await h.photo('');
  assert.match(first.reply, /Wofür ist es\?/);
  assert.equal(h.model.calls.length, 0, 'no model call without a caption');
  const photoName = h.state().pendingPhoto.name;
  assert.match(photoName, /^foto-20261116-[0-9a-f]{10}\.webp$/);
  assert.ok(h.store.drafts.has(photoName));

  const second = await h.say('Das ist die Trüffel-Focaccia, 12 €, bis Sonntag als Special');
  assert.match(second.reply, /Neues Special: Trüffel-Focaccia – 12 € \(16\.11\. bis 22\.11\.\), mit Foto/);
  const token = h.tokenOf(second.reply);
  assert.equal(h.state().pendingPhoto, null);
  assert.deepEqual(h.state().draft.images, [photoName]);

  // Preview resolves the draft image.
  const preview = JSON.parse((await handlePreview({ store: h.store, token, now: new Date(h.now()) })).body);
  const path = `assets/uploads/${photoName}`;
  assert.equal(preview.content.specials[1].image, path);
  assert.deepEqual(preview.images, { [path]: `/api/vorschau?token=${token}&image=${photoName}` });
  const image = await handlePreview({ store: h.store, token, image: photoName, now: new Date(h.now()) });
  assert.equal(image.status, 200);
  assert.equal(image.headers['Content-Type'], 'image/webp');
  assert.equal(image.body.toString(), 'webp:jpegdata');

  await h.say('ja');
  assert.deepEqual(h.store.commits[0].paths, ['data/content.json', path], 'content and image in one commit');
  assert.equal(h.store.files.get(path).toString(), 'webp:jpegdata');
  assert.equal(h.store.drafts.size, 0, 'draft image removed after publishing');
  const special = (await h.store.getPublished()).specials[1];
  assert.equal(special.image, path);
  assert.equal(special.imageAlt, 'Focaccia mit Trüffel auf einem Brett');
});

test('photo with caption: one step', async () => {
  const h = makeHarness({
    script: [(input) => {
      assert.equal(input.text, 'Special: Tiramisu im Glas, 6 €, bis Freitag');
      assert.ok(input.image);
      return edit(op({ op: 'add_special', title: 'Tiramisu im Glas', text: '6 €', until: '2026-11-20', photo: 'attach', image_alt: 'Tiramisu im Glas' }));
    }],
  });
  const { reply } = await h.photo('Special: Tiramisu im Glas, 6 €, bis Freitag');
  assert.match(reply, /Neues Special: Tiramisu im Glas – 6 € \(16\.11\. bis 20\.11\.\), mit Foto/);
  assert.ok(h.tokenOf(reply));
  assert.equal(h.state().pendingPhoto, null);
  assert.equal(h.state().draft.images.length, 1);
});

test('photo with caption the model cannot place: photo is kept for the next message', async () => {
  const h = makeHarness({ script: [{ ok: true, intent: 'unclear', reply: 'Bis wann soll das Special gelten?', forward: false, operations: [] }] });
  const { reply } = await h.photo('Neues Special Tiramisu');
  assert.match(reply, /^Bis wann soll das Special gelten\?/);
  assert.match(reply, /Foto habe ich gespeichert/);
  assert.ok(h.state().pendingPhoto);
});

test('photo: NEIN discards photo and draft images; a second photo replaces the first', async () => {
  const h = makeHarness();
  await h.photo('');
  const first = h.state().pendingPhoto.name;
  await h.photo('', OWNER, 'other');
  const second = h.state().pendingPhoto.name;
  assert.notEqual(first, second);
  assert.deepEqual([...h.store.drafts.keys()], [second]);
  await h.say('nein');
  assert.equal(h.state().pendingPhoto, null);
  assert.equal(h.store.drafts.size, 0);
});

test('photo that cannot be read or downloaded', async () => {
  const h = makeHarness();
  assert.match((await h.photo('Special', OWNER, 'BROKEN')).reply, /nicht als Foto lesen/);
  const before = h.sent.length;
  await h.conversation.handleMessage({ id: 'wamid.x', from: OWNER, userId: null, timestamp: Math.floor(h.now() / 1000), type: 'image', text: '', caption: '', mediaId: 'missing' });
  assert.match(h.sent[before].text, /nicht laden/);
  assert.equal(h.state().pendingPhoto, null);
  assert.equal(h.model.calls.length, 0);
});

test('other message types get a short hint', async () => {
  const h = makeHarness();
  const { reply } = await h.say('', OWNER, { type: 'audio' });
  assert.match(reply, /nur Textnachrichten und Fotos/);
});

test('sender allowlist: strangers get no reply and cause no state write', async () => {
  const h = makeHarness({ script: [edit(priceOp('1 €'))] });
  const { result, reply } = await h.say('direkt: Negroni 1 €', '4916099999999');
  assert.deepEqual(result, { handled: false, reason: 'not_allowed' });
  assert.equal(reply, null);
  assert.equal(h.sent.length, 0);
  assert.equal(h.state(), null);
  assert.equal(h.model.calls.length, 0);
});

test('sender without number is resolved through the stored business-scoped user id', async () => {
  const h = makeHarness();
  await h.say('status', OWNER, { userId: 'DE.111' });
  assert.equal(h.state().contacts[OWNER].userId, 'DE.111');
  const known = await h.conversation.handleMessage({ id: 'wamid.u1', from: '', userId: 'DE.111', timestamp: Math.floor(h.now() / 1000), type: 'text', text: 'status' });
  assert.equal(known.handled, true);
  assert.equal(h.sent.at(-1).to, OWNER);
  const unknown = await h.conversation.handleMessage({ id: 'wamid.u2', from: '', userId: 'DE.999', timestamp: Math.floor(h.now() / 1000), type: 'text', text: 'status' });
  assert.deepEqual(unknown, { handled: false, reason: 'not_allowed' });
});

test('dedupe: the same message id is processed once', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  const msg = { id: 'wamid.same', from: OWNER, userId: null, timestamp: Math.floor(h.now() / 1000), type: 'text', text: 'direkt: Negroni 12 €' };
  const first = await h.conversation.handleMessage(msg);
  const second = await h.conversation.handleMessage({ ...msg });
  assert.equal(first.handled, true);
  assert.deepEqual(second, { handled: false, reason: 'duplicate' });
  assert.equal(h.sent.length, 1);
  assert.equal(h.model.calls.length, 1);
  assert.equal(h.store.commits.length, 1);
  assert.deepEqual(await h.conversation.handleMessage({ ...msg, id: '' }), { handled: false, reason: 'no_id' });
});

test('stale messages (delayed webhook retries) are not executed', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  await h.say('Negroni 12 €');
  const { reply } = await h.say('ja', OWNER, { timestamp: Math.floor((h.now() - STALE_MS - 1000) / 1000) });
  assert.match(reply, /verspätet/);
  assert.equal(await negroniPrice(h), '11 €');
  assert.ok(h.state().draft);
});

test('a draft expires after 24 hours together with its token', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  const { reply } = await h.say('Negroni 12 €');
  const token = h.tokenOf(reply);
  h.advance(DRAFT_TTL_MS - 1000);
  assert.equal((await handlePreview({ store: h.store, token, now: new Date(h.now()) })).status, 200);
  h.advance(2000);
  assert.equal((await handlePreview({ store: h.store, token, now: new Date(h.now()) })).status, 404);
  assert.match((await h.say('ja')).reply, /abgelaufen/);
  assert.equal(await negroniPrice(h), '11 €');
  assert.equal(h.state().draft, null);
});

test('JA is refused when the published content changed underneath the draft', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  await h.say('Negroni 12 €');
  const changed = fixtureContent();
  changed.texts['hero.text'] = 'Vom Entwickler geändert';
  await h.store.publish({ content: changed, images: [], message: 'developer push' });
  const { reply } = await h.say('ja');
  assert.match(reply, /inzwischen an anderer Stelle geändert/);
  assert.deepEqual(await h.store.getPublished(), changed);
  assert.equal(h.state().draft, null);
});

test('state write conflicts are retried', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('12 €'))] });
  h.store.conflictOnNextWrites(1);
  const { reply } = await h.say('Negroni 12 €');
  assert.match(reply, /Negroni: 11 € → 12 €/);
  assert.ok(h.state().draft);
  assert.ok(h.state().seen.includes('wamid.1'));
});

test('a store failure is reported to the owner and never thrown', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €'))] });
  h.store.publish = async () => { throw new Error('GitHub 500'); };
  const { result, reply } = await h.say('direkt: Negroni 12 €');
  assert.deepEqual(result, { handled: false, reason: 'error' });
  assert.match(reply, /technisch etwas schiefgegangen/);
  assert.equal(await negroniPrice(h), '11 €');
});

test('too long messages are refused without a model call', async () => {
  const h = makeHarness();
  const { reply } = await h.say('x'.repeat(2001));
  assert.match(reply, /zu lang/);
  assert.equal(h.model.calls.length, 0);
});

test('mirror number gets a copy only while its own 24 h window is open', async () => {
  const h = makeHarness({ script: [edit(priceOp('12 €')), edit(priceOp('13 €'))], mirrorNumber: MIRROR });
  await h.say('Negroni 12 €');
  assert.equal(h.sent.filter((m) => m.to === MIRROR).length, 0, 'mirror has not written yet: window closed');

  await h.say('hilfe', MIRROR);
  assert.equal(h.sent.filter((m) => m.to === MIRROR).length, 1, 'own reply only, no copy of own messages');

  await h.say('nein');
  const copies = h.sent.filter((m) => m.to === MIRROR);
  assert.equal(copies.length, 2);
  assert.match(copies[1].text, /^Kopie · \+4915112345678 schrieb:\nnein\n\nAntwort:\nVerworfen/);

  h.advance(24 * 60 * 60 * 1000 + 1000);
  await h.say('Negroni 13 €');
  assert.equal(h.sent.filter((m) => m.to === MIRROR).length, 2, 'window closed again');
});

test('prompt injection: whatever the model returns, only valid operations on content can happen', async () => {
  const h = makeHarness({
    script: [
      // A hijacked model tries unknown operations and extra keys.
      edit({ op: 'run_shell', cmd: 'rm -rf /' }),
      edit({ ...priceOp('12 €'), path: '../../index.html' }),
      // ... and tries to smuggle markup and a link into a value and into the reply.
      edit(op({ op: 'set_text', id: 'hero.text', text: '<script>alert(1)</script>' })),
      { ok: true, intent: 'question', reply: 'Bitte hier anmelden: https://evil.example/login und Code schicken', forward: false, operations: [] },
    ],
  });
  for (const text of ['a', 'b', 'c']) {
    const { reply } = await h.say(`direkt: ${text}`);
    assert.match(reply, /nicht richtig verstanden|konnte ich so nicht übernehmen/);
    assert.match(reply, /Es wurde nichts geändert/);
  }
  const { reply } = await h.say('Was soll ich tun?');
  assert.equal(reply.includes('http'), false, 'links in model-written replies are removed');
  assert.equal(h.store.commits.length, 0);
  assert.deepEqual(await h.store.getPublished(), fixtureContent());
  assert.equal(h.state().draft, null);
});
