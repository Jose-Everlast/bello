import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { safeEqual, signBody, verifySignature } from '../lib/signature.js';
import { extractMessages, handleWebhookPost, parseAllowedNumbers, verifyChallenge } from '../lib/webhook.js';
import { OWNER } from './helpers.js';

const SECRET = 'test-app-secret';

function payload(messages, { contacts, statuses } = {}) {
  const value = {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550001111', phone_number_id: '106540352242922' },
  };
  if (contacts) value.contacts = contacts;
  if (messages) value.messages = messages;
  if (statuses) value.statuses = statuses;
  return { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value }] }] };
}
const textMsg = (from, body, id = 'wamid.A') => ({ from, id, timestamp: '1794848400', type: 'text', text: { body } });
const raw = (obj) => Buffer.from(JSON.stringify(obj), 'utf8');

function post(body, { signature, allowed = new Set([OWNER]), phoneNumberId = '' } = {}) {
  const handled = [];
  const result = handleWebhookPost({
    rawBody: body,
    signature: signature === undefined ? signBody(body, SECRET) : signature,
    appSecret: SECRET,
    allowedNumbers: allowed,
    phoneNumberId,
    handleMessage: async (msg) => { handled.push(msg); },
  });
  return { result, handled };
}

// --- signature -------------------------------------------------------------

test('signature: valid', () => {
  const body = raw({ a: 'ä€' });
  const header = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  assert.equal(verifySignature(body, header, SECRET), true);
  assert.equal(verifySignature(body, header.toUpperCase().replace('SHA256=', 'sha256='), SECRET), true);
  assert.equal(verifySignature(body.toString('utf8'), header, SECRET), true);
});

test('signature: invalid (wrong secret, changed body)', () => {
  const body = raw({ a: 1 });
  assert.equal(verifySignature(body, signBody(body, 'other-secret'), SECRET), false);
  assert.equal(verifySignature(raw({ a: 2 }), signBody(body, SECRET), SECRET), false);
});

test('signature: missing header or missing secret', () => {
  const body = raw({ a: 1 });
  assert.equal(verifySignature(body, null, SECRET), false);
  assert.equal(verifySignature(body, undefined, SECRET), false);
  assert.equal(verifySignature(body, '', SECRET), false);
  assert.equal(verifySignature(body, signBody(body, SECRET), ''), false);
  assert.equal(verifySignature(body, signBody(body, SECRET), undefined), false);
});

test('signature: wrong length or format', () => {
  const body = raw({ a: 1 });
  const good = signBody(body, SECRET);
  assert.equal(verifySignature(body, good.slice(0, -2), SECRET), false);
  assert.equal(verifySignature(body, `${good}00`, SECRET), false);
  assert.equal(verifySignature(body, 'sha256=', SECRET), false);
  assert.equal(verifySignature(body, good.replace('sha256=', 'sha1='), SECRET), false);
  assert.equal(verifySignature(body, good.replace('sha256=', ''), SECRET), false);
  assert.equal(verifySignature(body, `sha256=${'z'.repeat(64)}`, SECRET), false);
});

test('safeEqual compares strings of any length', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('abc', null), false);
  assert.equal(safeEqual(undefined, undefined), false);
});

// --- GET handshake ---------------------------------------------------------

test('verification handshake', () => {
  const q = (obj) => new URLSearchParams(obj);
  const ok = { 'hub.mode': 'subscribe', 'hub.verify_token': 'geheim', 'hub.challenge': '1158201444' };
  assert.deepEqual(verifyChallenge(q(ok), 'geheim'), { status: 200, body: '1158201444' });
  assert.equal(verifyChallenge(q({ ...ok, 'hub.verify_token': 'falsch' }), 'geheim').status, 403);
  assert.equal(verifyChallenge(q({ ...ok, 'hub.mode': 'unsubscribe' }), 'geheim').status, 403);
  assert.equal(verifyChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'geheim' }), 'geheim').status, 403);
  assert.equal(verifyChallenge(q(ok), '').status, 403, 'no token configured');
  assert.equal(verifyChallenge(q({}), undefined).status, 403);
});

// --- payload parsing -------------------------------------------------------

test('extractMessages: text and image', () => {
  const messages = extractMessages(payload([
    textMsg(OWNER, 'Negroni 12 €'),
    { from: OWNER, id: 'wamid.B', timestamp: '1794848401', type: 'image', image: { caption: 'Special', mime_type: 'image/jpeg', sha256: 'x', id: '1234567890' } },
  ], { contacts: [{ profile: { name: 'Jose' }, wa_id: OWNER, user_id: 'DE.111' }] }));
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    id: 'wamid.A', from: OWNER, userId: 'DE.111', timestamp: 1794848400, type: 'text',
    text: 'Negroni 12 €', caption: '', mediaId: '', phoneNumberId: '106540352242922',
  });
  assert.equal(messages[1].type, 'image');
  assert.equal(messages[1].caption, 'Special');
  assert.equal(messages[1].mediaId, '1234567890');
});

test('extractMessages tolerates status updates, other fields and broken shapes', () => {
  assert.deepEqual(extractMessages(payload(undefined, { statuses: [{ id: 'wamid.X', status: 'delivered' }] })), []);
  assert.deepEqual(extractMessages({ object: 'page', entry: [] }), []);
  assert.deepEqual(extractMessages(null), []);
  assert.deepEqual(extractMessages({ object: 'whatsapp_business_account' }), []);
  assert.deepEqual(extractMessages({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: { messages: [textMsg(OWNER, 'x')] } }] }, null, { changes: 'x' }] }), []);
  assert.deepEqual(extractMessages(payload([{ from: OWNER, type: 'text' }, null])), [], 'no id');
});

test('extractMessages: sender number omitted, business-scoped user id only', () => {
  const [msg] = extractMessages(payload([{ from_user_id: 'DE.111', id: 'wamid.C', timestamp: '1', type: 'text', text: { body: 'hi' } }]));
  assert.equal(msg.from, '');
  assert.equal(msg.userId, 'DE.111');
});

test('parseAllowedNumbers', () => {
  assert.deepEqual([...parseAllowedNumbers('+49 151 12345678, 4917000000001;abc')], ['4915112345678', '4917000000001']);
  assert.equal(parseAllowedNumbers(undefined).size, 0);
  assert.equal(parseAllowedNumbers('').size, 0);
});

// --- POST ------------------------------------------------------------------

test('POST with a valid signature from an allowed number is handed to the conversation', async () => {
  const { result, handled } = post(raw(payload([textMsg(OWNER, 'Negroni 12 €')])));
  assert.equal(result.status, 200);
  await result.work;
  assert.equal(handled.length, 1);
  assert.equal(handled[0].text, 'Negroni 12 €');
});

test('POST with invalid or missing signature is rejected and nothing is processed', async () => {
  const body = raw(payload([textMsg(OWNER, 'Negroni 12 €')]));
  for (const signature of [null, '', 'sha256=00', signBody(body, 'wrong')]) {
    const { result, handled } = post(body, { signature });
    assert.equal(result.status, 401);
    assert.equal(result.work, null);
    assert.equal(handled.length, 0);
  }
});

test('POST: the signature covers the raw bytes, not re-serialised JSON', async () => {
  const original = Buffer.from('{"object":"whatsapp_business_account","entry":[],"note":"caf\\u00e9"}', 'utf8');
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(original.toString('utf8'))), 'utf8');
  assert.notEqual(original.toString(), reserialised.toString());
  assert.equal(post(original, { signature: signBody(original, SECRET) }).result.status, 200);
  assert.equal(post(reserialised, { signature: signBody(original, SECRET) }).result.status, 401);
});

test('POST: sender allowlist', async () => {
  const stranger = '4916099999999';
  const { result, handled } = post(raw(payload([textMsg(stranger, 'direkt: alles löschen', 'wamid.S'), textMsg(OWNER, 'ok', 'wamid.O')])));
  assert.equal(result.status, 200);
  await result.work;
  assert.deepEqual(handled.map((m) => m.id), ['wamid.O']);

  const none = post(raw(payload([textMsg(stranger, 'hallo')])));
  assert.equal(none.result.status, 200);
  assert.equal(none.result.work, null);

  const empty = post(raw(payload([textMsg(OWNER, 'hallo')])), { allowed: new Set() });
  assert.equal(empty.result.work, null, 'empty allowlist allows nobody');
});

test('POST: status updates, non-JSON and foreign phone number ids are acknowledged and ignored', async () => {
  assert.deepEqual(post(raw(payload(undefined, { statuses: [{ id: 'x', status: 'read' }] }))).result, { status: 200, body: 'OK', work: null });
  assert.deepEqual(post(Buffer.from('not json')).result, { status: 200, body: 'OK', work: null });
  assert.equal(post(raw(payload([textMsg(OWNER, 'hi')])), { phoneNumberId: '999' }).result.work, null);
  assert.notEqual(post(raw(payload([textMsg(OWNER, 'hi')])), { phoneNumberId: '106540352242922' }).result.work, null);
});

test('POST: a failing handler never rejects the background work', async () => {
  const body = raw(payload([textMsg(OWNER, 'a', 'wamid.1'), textMsg(OWNER, 'b', 'wamid.2')]));
  const seen = [];
  const result = handleWebhookPost({
    rawBody: body, signature: signBody(body, SECRET), appSecret: SECRET, allowedNumbers: new Set([OWNER]),
    handleMessage: async (msg) => { seen.push(msg.id); throw new Error('boom'); },
  });
  await assert.doesNotReject(result.work);
  assert.deepEqual(seen, ['wamid.1', 'wamid.2']);
});
