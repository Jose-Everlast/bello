// Telegram as a second entry: update parsing, secret header, allowlist with
// the id reply, the client with a fake fetch, and a full flow through the
// shared conversation. No network, no environment variables.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_LINE, createConversation } from '../lib/conversation.js';
import { locateItem } from '../lib/content.js';
import { handlePreview, verifyPreviewToken } from '../lib/preview.js';
import { ENV_NAMES, TELEGRAM_ENV_NAMES, envNames, getRuntime, missingEnv, previewSecret } from '../lib/runtime.js';
import { createMemoryStore } from '../lib/store-memory.js';
import { MAX_TEXT, createTelegram } from '../lib/telegram.js';
import {
  NOT_ALLOWED_WINDOW_MS, createReplyLimiter, extractTelegramMessages, handleTelegramPost, notAllowedReply,
  parseAllowedIds, verifySecretToken,
} from '../lib/telegram-webhook.js';
import { MAX_MEDIA_BYTES } from '../lib/whatsapp.js';
import { OWNER, SITE, START, edit, fixtureContent, op, scriptedModel } from './helpers.js';

const SECRET = 'tg_Test-Secret_123';
const TOKEN = '123456789:AAtest-Token_abc';
const DEV = 555000111; // Telegram user id of the developer
const DATE = Math.floor(START / 1000);

const message = (fields, { id = DEV, messageId = 7, chat } = {}) => ({
  update_id: 900000 + messageId,
  message: {
    message_id: messageId,
    from: { id, is_bot: false, first_name: 'Jose', language_code: 'de' },
    chat: chat || { id, first_name: 'Jose', type: 'private' },
    date: DATE,
    ...fields,
  },
});
const textUpdate = (text, options) => message({ text }, options);
const PHOTO = [
  { file_id: 'AgAC-small', file_unique_id: 'u1', width: 90, height: 67, file_size: 1200 },
  { file_id: 'AgAC-large', file_unique_id: 'u3', width: 1280, height: 960, file_size: 180000 },
  { file_id: 'AgAC-medium', file_unique_id: 'u2', width: 320, height: 240, file_size: 15000 },
];
const raw = (obj) => Buffer.from(JSON.stringify(obj), 'utf8');
const jsonRes = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function post(update, options = {}) {
  // An explicit `undefined` must reach the handler as such (header absent, secret not configured).
  const header = 'header' in options ? options.header : SECRET;
  const secret = 'secret' in options ? options.secret : SECRET;
  const { allowed = new Set([String(DEV)]), limiter = createReplyLimiter(), now = () => START } = options;
  const handled = [];
  const notified = [];
  const result = handleTelegramPost({
    rawBody: Buffer.isBuffer(update) ? update : raw(update),
    secretHeader: header,
    secret,
    allowedIds: allowed,
    handleMessage: async (msg) => { handled.push(msg); },
    notify: async (id, text) => { notified.push({ id, text }); },
    limiter,
    now,
  });
  return { result, handled, notified };
}

// --- update parsing --------------------------------------------------------

test('telegram update: text message becomes the shape of lib/webhook.js', () => {
  assert.deepEqual(extractTelegramMessages(textUpdate('Negroni 12 €')), [{
    id: `tg-${DEV}-7`, from: String(DEV), userId: null, timestamp: DATE, type: 'text',
    text: 'Negroni 12 €', caption: '', mediaId: '', phoneNumberId: '',
  }]);
});

test('telegram update: photo with caption takes the largest size', () => {
  const [msg] = extractTelegramMessages(message({ photo: PHOTO, caption: 'Special: Tiramisu, 6 €' }));
  assert.equal(msg.type, 'image');
  assert.equal(msg.mediaId, 'AgAC-large');
  assert.equal(msg.caption, 'Special: Tiramisu, 6 €');
  assert.equal(msg.text, '');
});

test('telegram update: photo without caption', () => {
  const [msg] = extractTelegramMessages(message({ photo: PHOTO }));
  assert.equal(msg.type, 'image');
  assert.equal(msg.mediaId, 'AgAC-large');
  assert.equal(msg.caption, '');
});

test('telegram update: unsupported kinds keep their name and carry no text or media', () => {
  const cases = {
    voice: { voice: { file_id: 'v', duration: 3 } },
    sticker: { sticker: { file_id: 's', width: 512, height: 512 } },
    video: { video: { file_id: 'v', width: 1, height: 1, duration: 1 }, caption: 'direkt: alles raus' },
    document: { document: { file_id: 'd', file_name: 'foto.jpg', mime_type: 'image/jpeg' }, caption: 'Special' },
    location: { location: { latitude: 51.5, longitude: 9.9 } },
    unknown: { something_new: {} },
  };
  for (const [type, fields] of Object.entries(cases)) {
    const [msg] = extractTelegramMessages(message(fields));
    assert.equal(msg.type, type);
    assert.deepEqual([msg.text, msg.caption, msg.mediaId], ['', '', '']);
  }
});

test('telegram update: groups, channels, edits, bots and broken shapes are ignored', () => {
  const group = { id: -1001234567890, title: 'Bello Team', type: 'supergroup' };
  assert.deepEqual(extractTelegramMessages(textUpdate('ja', { chat: group })), []);
  assert.deepEqual(extractTelegramMessages(textUpdate('ja', { chat: { id: -42, title: 'x', type: 'group' } })), []);
  assert.deepEqual(extractTelegramMessages({ update_id: 1, channel_post: textUpdate('ja').message }), []);
  assert.deepEqual(extractTelegramMessages({ update_id: 1, edited_message: { ...textUpdate('ja').message, edit_date: DATE + 5 } }), []);
  assert.deepEqual(extractTelegramMessages({ update_id: 1, message_reaction: { chat: { id: DEV, type: 'private' } } }), []);
  const bot = textUpdate('ja');
  bot.message.from.is_bot = true;
  assert.deepEqual(extractTelegramMessages(bot), []);
  assert.deepEqual(extractTelegramMessages(textUpdate('ja', { chat: { id: DEV + 1, type: 'private' } })), [], 'chat and sender differ');
  assert.deepEqual(extractTelegramMessages(textUpdate('ja', { messageId: 0 })), [], 'no stable id');
  for (const broken of [null, undefined, 'x', 7, {}, { message: null }, { message: { chat: { type: 'private' } } }, { message: { message_id: 1, chat: { id: DEV, type: 'private' } } }]) {
    assert.deepEqual(extractTelegramMessages(broken), []);
  }
});

test('telegram update: the dedupe id is stable per message and differs between messages and chats', () => {
  const id = (update) => extractTelegramMessages(update)[0].id;
  assert.equal(id(textUpdate('a', { messageId: 12 })), `tg-${DEV}-12`);
  assert.equal(id(textUpdate('a', { messageId: 12 })), id({ ...textUpdate('a', { messageId: 12 }), update_id: 5 }), 'a redelivery has the same id');
  assert.notEqual(id(textUpdate('a', { messageId: 12 })), id(textUpdate('a', { messageId: 13 })));
  assert.notEqual(id(textUpdate('a', { messageId: 12 })), id(textUpdate('a', { messageId: 12, id: DEV + 1 })));
});

test('parseAllowedIds', () => {
  assert.deepEqual([...parseAllowedIds('555000111, 42;7\n-100123,abc,12a, 0')], ['555000111', '42', '7']);
  assert.equal(parseAllowedIds(undefined).size, 0);
  assert.equal(parseAllowedIds('').size, 0);
});

// --- secret header ---------------------------------------------------------

test('secret header: valid, invalid, missing, not configured', () => {
  assert.equal(verifySecretToken(SECRET, SECRET), true);
  assert.equal(verifySecretToken(`${SECRET}x`, SECRET), false);
  assert.equal(verifySecretToken(SECRET.toLowerCase(), SECRET), false);
  assert.equal(verifySecretToken('', SECRET), false);
  assert.equal(verifySecretToken(null, SECRET), false);
  assert.equal(verifySecretToken(undefined, SECRET), false);
  assert.equal(verifySecretToken(SECRET, ''), false);
  assert.equal(verifySecretToken(SECRET, undefined), false);
  assert.equal(verifySecretToken('', ''), false);
  assert.equal(verifySecretToken(undefined, undefined), false);
});

test('POST with the right secret from an allowed id is handed to the conversation', async () => {
  const { result, handled, notified } = post(textUpdate('Negroni 12 €'));
  assert.equal(result.status, 200);
  await result.work;
  assert.equal(handled.length, 1);
  assert.equal(handled[0].text, 'Negroni 12 €');
  assert.equal(notified.length, 0);
});

test('POST with a wrong or missing secret, or without a configured one, is rejected and nothing is processed', async () => {
  const attempts = [
    { header: 'wrong' }, { header: '' }, { header: null }, { header: undefined },
    { secret: '' }, { secret: undefined }, { header: '', secret: '' }, { header: null, secret: undefined },
  ];
  for (const options of attempts) {
    const { result, handled, notified } = post(textUpdate('direkt: Negroni 1 €'), options);
    assert.equal(result.status, 401);
    assert.equal(result.work, null);
    assert.equal(handled.length + notified.length, 0);
  }
});

test('POST: non-JSON, ignored updates and a failing handler never cause a retry', async () => {
  assert.deepEqual(post(Buffer.from('not json')).result, { status: 200, body: 'OK', work: null });
  assert.deepEqual(post({ update_id: 1, edited_message: textUpdate('ja').message }).result, { status: 200, body: 'OK', work: null });
  assert.deepEqual(post(textUpdate('ja', { chat: { id: -5, type: 'group' } })).result, { status: 200, body: 'OK', work: null });
  const logged = [];
  const result = handleTelegramPost({
    rawBody: raw(textUpdate('a')), secretHeader: SECRET, secret: SECRET, allowedIds: new Set([String(DEV)]),
    handleMessage: async () => { throw new Error('boom'); }, notify: async () => {},
    log: (event, data) => logged.push({ event, ...data }),
  });
  assert.equal(result.status, 200);
  await assert.doesNotReject(result.work);
  assert.deepEqual(logged, [{ event: 'webhook_work_error', id: `tg-${DEV}-7`, message: 'boom' }]);
});

// --- allowlist -------------------------------------------------------------

test('allowlist: an unknown sender only learns their id; nothing reaches the conversation', async () => {
  const stranger = 777000222;
  for (const update of [textUpdate('direkt: alles löschen', { id: stranger }), message({ photo: PHOTO, caption: 'x' }, { id: stranger }), message({ voice: { file_id: 'v' } }, { id: stranger })]) {
    const { result, handled, notified } = post(update);
    assert.equal(result.status, 200);
    await result.work;
    assert.equal(handled.length, 0);
    assert.deepEqual(notified, [{ id: String(stranger), text: `Diese Unterhaltung ist nicht freigeschaltet. Deine Telegram-ID: ${stranger}` }]);
  }
  assert.equal(notAllowedReply(42), 'Diese Unterhaltung ist nicht freigeschaltet. Deine Telegram-ID: 42');

  const empty = post(textUpdate('hallo'), { allowed: new Set() });
  await empty.result.work;
  assert.equal(empty.handled.length, 0, 'empty allowlist allows nobody');
  assert.equal(empty.notified.length, 1, 'but the developer still learns his id');
});

test('allowlist: the id reply is sent at most once per id per minute', async () => {
  const limiter = createReplyLimiter();
  let now = START;
  const send = (id, messageId) => post(textUpdate('hallo', { id, messageId }), { limiter, now: () => now });

  const first = send(777000222, 1);
  await first.result.work;
  assert.equal(first.notified.length, 1);

  now += NOT_ALLOWED_WINDOW_MS - 1;
  const second = send(777000222, 2);
  assert.deepEqual(second.result, { status: 200, body: 'OK', work: null }, 'silent inside the window');
  assert.equal(second.notified.length, 0);

  const other = send(888000333, 3);
  await other.result.work;
  assert.equal(other.notified.length, 1, 'another id has its own limit');

  now += 1;
  const third = send(777000222, 4);
  await third.result.work;
  assert.equal(third.notified.length, 1, 'again after a minute');

  const allowed = post(textUpdate('status'), { limiter, now: () => now });
  await allowed.result.work;
  assert.equal(allowed.handled.length, 1, 'allowed senders are never limited');
});

test('reply limiter does not grow without bound', () => {
  const limiter = createReplyLimiter({ windowMs: 1000, maxEntries: 3 });
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => limiter.allow(id, 0)), [true, true, true, false]);
  assert.equal(limiter.allow('d', 1000), true, 'expired entries make room');
  assert.equal(limiter.allow('a', 1000), true);
});

// --- client ----------------------------------------------------------------

test('telegram client: sendMessage body, endpoint, length cap, no link preview', async () => {
  const calls = [];
  const tg = createTelegram({
    token: TOKEN,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return jsonRes(200, { ok: true, result: { message_id: 1 } }); },
  });
  assert.deepEqual(await tg.sendText(String(DEV), 'Hallo'), { message_id: 1 });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { chat_id: DEV, text: 'Hallo', link_preview_options: { is_disabled: true } });
  await tg.sendText(String(DEV), 'x'.repeat(5000));
  assert.equal(JSON.parse(calls[1].init.body).text.length, MAX_TEXT);
  assert.equal(MAX_TEXT, 4096);
  assert.equal(await tg.markRead('tg-1-1'), null);
  assert.equal(calls.length, 2, 'markRead does not call Telegram');
  assert.throws(() => createTelegram({ token: '' }), /TELEGRAM_BOT_TOKEN fehlt/);
  assert.throws(() => createTelegram({ token: 'kein token' }), (err) => !err.message.includes('kein token'));
});

test('telegram client: errors carry status and description, never the token', async () => {
  const failing = createTelegram({ token: TOKEN, fetchImpl: async () => jsonRes(403, { ok: false, error_code: 403, description: `Forbidden: bot was blocked by the user ${TOKEN}` }) });
  await assert.rejects(failing.sendText('1', 'x'), (err) => /Telegram 403 Forbidden: bot was blocked/.test(err.message) && !err.message.includes(TOKEN));

  const offline = createTelegram({ token: TOKEN, fetchImpl: async (url) => { throw new TypeError(`fetch failed: ${url}`); } });
  await assert.rejects(offline.sendText('1', 'x'), (err) => /nicht erreichbar/.test(err.message) && !err.message.includes(TOKEN) && err.cause === undefined);
  await assert.rejects(offline.downloadMedia('AgAC-large'), (err) => err.code === 'meta_failed' && !err.message.includes(TOKEN));

  const notJson = createTelegram({ token: TOKEN, fetchImpl: async () => new Response('<html>502</html>', { status: 502 }) });
  await assert.rejects(notJson.sendText('1', 'x'), /^Error: Telegram 502$/);
});

test('telegram client: getFile then download, size limit, path check', async () => {
  const seen = [];
  const make = (file, body = new Response(Buffer.from('JPEG'), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })) => createTelegram({
    token: TOKEN,
    fetchImpl: async (url, init) => {
      seen.push({ url, body: init?.body });
      return url.endsWith('/getFile') ? jsonRes(200, { ok: true, result: file }) : body;
    },
  });
  const ok = await make({ file_id: 'AgAC-large', file_unique_id: 'u3', file_size: 4, file_path: 'photos/file_12.jpg' }).downloadMedia('AgAC-large');
  assert.equal(ok.bytes.toString(), 'JPEG');
  assert.equal(ok.mimeType, 'image/jpeg');
  assert.equal(seen[0].url, `https://api.telegram.org/bot${TOKEN}/getFile`);
  assert.deepEqual(JSON.parse(seen[0].body), { file_id: 'AgAC-large' });
  assert.equal(seen[1].url, `https://api.telegram.org/file/bot${TOKEN}/photos/file_12.jpg`);

  await assert.rejects(make({ file_size: MAX_MEDIA_BYTES + 1, file_path: 'photos/a.jpg' }).downloadMedia('x'), (e) => e.code === 'too_large');
  await assert.rejects(make({ file_size: 4, file_path: 'photos/a.jpg' }, new Response(Buffer.alloc(MAX_MEDIA_BYTES + 1), { status: 200 })).downloadMedia('x'), (e) => e.code === 'too_large');
  await assert.rejects(make({ file_size: 4, file_path: '../../bot1:x/getMe' }).downloadMedia('x'), (e) => e.code === 'bad_url');
  await assert.rejects(make({ file_size: 4, file_path: 'https://evil.example/a.jpg' }).downloadMedia('x'), (e) => e.code === 'bad_url');
  await assert.rejects(make({ file_size: 4 }).downloadMedia('x'), (e) => e.code === 'bad_url');
  await assert.rejects(make({ file_size: 4, file_path: 'photos/a.jpg' }).downloadMedia('../me'), (e) => e.code === 'bad_id');
  await assert.rejects(make({ file_size: 4, file_path: 'photos/a.jpg' }, new Response('gone', { status: 404 })).downloadMedia('x'),
    (e) => e.code === 'download_failed' && !e.message.includes(TOKEN));
});

// --- full flow through the shared conversation -------------------------------

function makeTelegramHarness({ script = [], secret = SECRET, allowed = [String(DEV)], store = createMemoryStore({ content: fixtureContent() }) } = {}) {
  const sent = [];
  const files = new Map([['AgAC-large', Buffer.from('jpegdata')]]);
  let now = START;
  let counter = 0;
  let messageId = 0;
  const model = scriptedModel(script);
  const sender = createTelegram({
    token: TOKEN,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/sendMessage')) {
        const body = JSON.parse(init.body);
        sent.push({ to: body.chat_id, text: body.text });
        return jsonRes(200, { ok: true, result: { message_id: 1000 + sent.length } });
      }
      if (url.endsWith('/getFile')) {
        const id = JSON.parse(init.body).file_id;
        return files.has(id)
          ? jsonRes(200, { ok: true, result: { file_id: id, file_size: files.get(id).length, file_path: `photos/${id}.jpg` } })
          : jsonRes(400, { ok: false, error_code: 400, description: 'Bad Request: invalid file_id' });
      }
      const name = /\/photos\/(.+)\.jpg$/.exec(url)?.[1];
      return new Response(files.get(name), { status: 200 });
    },
  });
  const conversation = createConversation({
    store, sender, model,
    processImage: async (bytes) => ({ bytes: Buffer.from(`webp:${bytes.toString()}`), mimeType: 'image/webp' }),
    clock: () => new Date(now),
    previewSecret: previewSecret({ TELEGRAM_WEBHOOK_SECRET: secret }),
    randomHex: (bytes) => { counter += 1; return counter.toString(16).padStart(bytes * 2, '0'); },
    config: { channel: 'telegram', siteUrl: `${SITE}/`, developerName: 'Jose', allowedNumbers: new Set(allowed), mirrorNumber: OWNER },
  });
  const limiter = createReplyLimiter();
  /** Sends one update through the webhook and returns the texts sent back for it. */
  async function deliver(fields, { id = DEV, redeliver = false } = {}) {
    if (!redeliver) messageId += 1;
    const before = sent.length;
    const update = message(fields, { id, messageId });
    update.message.date = Math.floor(now / 1000);
    const result = handleTelegramPost({
      rawBody: raw(update), secretHeader: SECRET, secret: SECRET, allowedIds: new Set(allowed),
      handleMessage: (msg) => conversation.handleMessage(msg),
      notify: (to, text) => sender.sendText(to, text),
      limiter, now: () => now,
    });
    assert.equal(result.status, 200);
    await result.work;
    return sent.slice(before);
  }
  return {
    store, sent, model, deliver,
    say: async (text, options) => (await deliver({ text }, options))[0]?.text ?? null,
    now: () => now,
    state: () => store.peekState(),
    tokenOf: (reply) => /\?vorschau=([0-9a-f]{32})/.exec(reply || '')?.[1] ?? null,
  };
}

const priceOp = (price, id = 'negroni') => op({ op: 'set_item', id, fields: ['price'], price });
const negroniPrice = async (h) => locateItem(await h.store.getPublished(), 'negroni').item.price;

test('telegram flow: edit -> preview -> JA publishes one commit, replies go to the chat', async () => {
  const h = makeTelegramHarness({ script: [edit(priceOp('12 €'))] });
  const reply = await h.say('Negroni kostet jetzt 12 €');
  const token = h.tokenOf(reply);
  assert.equal(reply, `Entwurf:\n• Negroni: 11 € → 12 €\n\nVorschau: ${SITE}/?vorschau=${token}\n\n${CONFIRM_LINE}`);
  assert.equal(h.sent[0].to, DEV, 'chat_id is the bare user id, not the state key');
  assert.equal(await negroniPrice(h), '11 €');
  assert.equal(h.model.calls[0].text, 'Negroni kostet jetzt 12 €');

  // The link is signed with the Telegram webhook secret and checks out with the same fallback.
  const secret = previewSecret({ TELEGRAM_WEBHOOK_SECRET: SECRET });
  assert.equal(verifyPreviewToken(token, secret), true);
  assert.equal(verifyPreviewToken(token, 'another-secret'), false);
  const preview = await handlePreview({ store: h.store, token, secret, now: new Date(h.now()) });
  assert.equal(preview.status, 200);
  assert.equal(locateItem(JSON.parse(preview.body).content, 'negroni').item.price, '12 €');

  const yes = await h.say('JA');
  assert.match(yes, /^Veröffentlicht:\n• Negroni: 11 € → 12 €/);
  assert.equal(await negroniPrice(h), '12 €');
  assert.equal(h.store.commits.length, 1);
  assert.match(h.store.commits[0].message, /^Inhalt per Telegram: 1 Änderung/);
  assert.equal(h.state().draft, null);
  assert.equal(h.model.calls.length, 1, 'JA does not call the model');

  assert.match(await h.say('Rückgängig'), /^Rückgängig gemacht/);
  assert.equal(await negroniPrice(h), '11 €');
});

test('telegram flow: the sender is stored as tg:<id>, a redelivered update is processed once', async () => {
  const h = makeTelegramHarness({ script: [{ ok: true, intent: 'out_of_scope', reply: '', forward: false, operations: [] }] });
  assert.match(await h.say('Hilfe'), /^So geht es:/);
  assert.deepEqual(Object.keys(h.state().contacts), [`tg:${DEV}`]);
  assert.deepEqual(h.state().seen, [`tg-${DEV}-1`]);
  assert.deepEqual(await h.deliver({ text: 'Hilfe' }, { redeliver: true }), [], 'same message_id: no second reply');

  // No mirror on Telegram, even with a mirror number configured: the wish is noted, nothing is sent elsewhere.
  assert.equal(await h.say('Mach den Hintergrund blau'), 'Das kann ich nicht selbst ändern. Ich habe es für Jose notiert. Bitte gib kurz Bescheid, dass dort etwas steht.');
  assert.equal(h.state().notes[0].from, `tg:${DEV}`);
  assert.match(await h.say('Notizen'), new RegExp(`\\(Telegram ${DEV}\\): Mach den Hintergrund blau`));
  assert.ok(h.sent.every((m) => m.to === DEV));
});

test('telegram flow: photo with caption, photo without caption, unsupported type', async () => {
  const h = makeTelegramHarness({
    script: [(input) => {
      assert.equal(input.text, 'Special: Tiramisu im Glas, 6 €, bis Freitag');
      assert.equal(Buffer.from(input.image.base64, 'base64').toString(), 'webp:jpegdata');
      return edit(op({ op: 'add_special', title: 'Tiramisu im Glas', text: '6 €', until: '2026-11-20', photo: 'attach', image_alt: 'Tiramisu im Glas' }));
    }],
  });
  const [withCaption] = await h.deliver({ photo: PHOTO, caption: 'Special: Tiramisu im Glas, 6 €, bis Freitag' });
  assert.match(withCaption.text, /Neues Special: Tiramisu im Glas – 6 € \(16\.11\. bis 20\.11\.\), mit Foto/);
  assert.equal(h.state().draft.images.length, 1);
  assert.match(await h.say('nein'), /Verworfen/);

  const [withoutCaption] = await h.deliver({ photo: PHOTO });
  assert.match(withoutCaption.text, /Foto ist angekommen\. Wofür ist es\?/);
  assert.ok(h.state().pendingPhoto);

  const [voice] = await h.deliver({ voice: { file_id: 'v1', duration: 4 } });
  assert.match(voice.text, /nur Textnachrichten und Fotos/);
  const [file] = await h.deliver({ document: { file_id: 'd1', file_name: 'foto.jpg' }, caption: 'direkt: Negroni 1 €' });
  assert.match(file.text, /nur Textnachrichten und Fotos/);
  assert.equal(h.model.calls.length, 1, 'a caption on an unsupported message is not executed');

  const [broken] = await h.deliver({ photo: [{ file_id: 'AgAC-unknown', width: 10, height: 10 }] });
  assert.match(broken.text, /Foto konnte ich gerade nicht laden/);
});

test('telegram flow: a sender who is not on the list touches neither state nor model nor store', async () => {
  const h = makeTelegramHarness({ script: [edit(priceOp('1 €'))] });
  const stranger = 777000222;
  assert.equal(await h.say('direkt: Negroni 1 €', { id: stranger }), `Diese Unterhaltung ist nicht freigeschaltet. Deine Telegram-ID: ${stranger}`);
  assert.deepEqual(await h.deliver({ text: 'ja' }, { id: stranger }), [], 'rate-limited');
  assert.equal(h.state(), null);
  assert.equal(h.model.calls.length, 0);
  assert.equal(h.store.commits.length, 0);
});

test('shared state: a Telegram id and an equal WhatsApp number stay two different senders', async () => {
  // Worst case: the WhatsApp allowlist holds a number whose digits equal a Telegram user id.
  const same = '555000111';
  const store = createMemoryStore({ content: fixtureContent() });
  const h = makeTelegramHarness({ store, allowed: [same], script: [{ ok: true, intent: 'unclear', reply: 'Welchen Negroni meinst du?', forward: false, operations: [] }] });
  assert.equal(await h.say('Negroni teurer'), 'Welchen Negroni meinst du?');
  assert.equal(h.state().pendingQuestion.from, `tg:${same}`);

  const waSent = [];
  const whatsapp = createConversation({
    store,
    sender: { async sendText(to, text) { waSent.push({ to, text }); }, async downloadMedia() { throw new Error('unused'); } },
    model: scriptedModel([]),
    processImage: async (bytes) => ({ bytes, mimeType: 'image/webp' }),
    clock: () => new Date(h.now()),
    config: { siteUrl: SITE, developerName: 'Jose', allowedNumbers: new Set([same]), mirrorNumber: same },
  });
  // A bare "ja" from the WhatsApp number is not taken as the answer to the Telegram sender's question.
  const result = await whatsapp.handleMessage({ id: 'wamid.1', from: same, userId: 'DE.1', timestamp: Math.floor(h.now() / 1000), type: 'text', text: 'ja' });
  assert.equal(result.handled, true);
  assert.match(waSent[0].text, /keinen offenen Entwurf/);
  assert.equal(waSent[0].to, same);
  assert.deepEqual(Object.keys(h.state().contacts).sort(), [same, `tg:${same}`]);
  assert.equal(h.sent.length, 1, 'nothing was sent to the Telegram chat by the WhatsApp side');

  // A WhatsApp message without a number is never resolved to a Telegram contact.
  h.state().contacts[`tg:${same}`].userId = 'DE.9';
  const lost = await whatsapp.handleMessage({ id: 'wamid.2', from: '', userId: 'DE.9', timestamp: Math.floor(h.now() / 1000), type: 'text', text: 'status' });
  assert.deepEqual(lost, { handled: false, reason: 'not_allowed' });
});

// --- runtime -----------------------------------------------------------------

test('preview secret: PREVIEW_SECRET, then WHATSAPP_APP_SECRET, then TELEGRAM_WEBHOOK_SECRET', () => {
  const all = { PREVIEW_SECRET: 'p', WHATSAPP_APP_SECRET: 'w', TELEGRAM_WEBHOOK_SECRET: 't' };
  assert.equal(previewSecret(all), 'p');
  assert.equal(previewSecret({ ...all, PREVIEW_SECRET: '' }), 'w');
  assert.equal(previewSecret({ WHATSAPP_APP_SECRET: 'w', TELEGRAM_WEBHOOK_SECRET: 't' }), 'w');
  assert.equal(previewSecret({ TELEGRAM_WEBHOOK_SECRET: 't' }), 't');
  assert.equal(previewSecret({ PREVIEW_SECRET: 'p', TELEGRAM_WEBHOOK_SECRET: 't' }), 'p');
  assert.equal(previewSecret({}), '');
});

test('runtime: each channel requires its own variables and none of the other', () => {
  assert.equal(envNames(), ENV_NAMES);
  assert.equal(envNames('telegram'), TELEGRAM_ENV_NAMES);
  assert.equal(TELEGRAM_ENV_NAMES.some((name) => /^(WHATSAPP|WA)_/.test(name)), false);
  assert.equal(ENV_NAMES.some((name) => name.startsWith('TELEGRAM_')), false);

  const shared = { ANTHROPIC_API_KEY: 'k', GITHUB_TOKEN: 'g', GITHUB_REPO: 'owner/site', GITHUB_STATE_REPO: 'owner/state', SITE_URL: SITE };
  const telegramEnv = { ...shared, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_ALLOWED_IDS: String(DEV) };
  const whatsappEnv = {
    ...shared, WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's', WHATSAPP_ACCESS_TOKEN: 'a', WHATSAPP_PHONE_NUMBER_ID: '123', WA_ALLOWED_NUMBERS: OWNER,
  };
  assert.deepEqual(missingEnv(telegramEnv, envNames('telegram')), []);
  assert.deepEqual(missingEnv(whatsappEnv, envNames('whatsapp')), []);

  const telegram = getRuntime(telegramEnv, { channel: 'telegram' });
  assert.equal(typeof telegram.handleMessage, 'function');
  assert.deepEqual([...telegram.allowedNumbers], [String(DEV)]);
  const whatsapp = getRuntime(whatsappEnv);
  assert.deepEqual([...whatsapp.allowedNumbers], [OWNER]);

  assert.throws(() => getRuntime(whatsappEnv, { channel: 'telegram' }), /Umgebungsvariablen fehlen: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_IDS$/);
  assert.throws(() => getRuntime(telegramEnv), /Umgebungsvariablen fehlen: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WA_ALLOWED_NUMBERS$/);
  assert.throws(() => getRuntime(telegramEnv, { channel: 'signal' }), /Unbekannter Kanal/);
});
