import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTwilioWhatsApp, extractTwilioMessage, handleTwilioPost, splitText, twilioSignature, whatsappAddress, EMPTY_TWIML,
} from '../lib/twilio.js';
import { envNames, missingEnv } from '../lib/runtime.js';

const SID = `AC${'a'.repeat(32)}`;
const TOKEN = 'secret-token';
const URL_ = 'https://bello.example/api/twilio';
const MSG_SID = `SM${'b'.repeat(32)}`;

const form = (fields) => new URLSearchParams(fields);

test('signature matches Twilio\'s documented example', () => {
  // Example from Twilio's "Webhooks security" documentation.
  const params = form({ To: '+18005551212', CallSid: 'CA1234567890ABCDE', Caller: '+14158675310', Digits: '1234', From: '+14158675310' });
  assert.equal(twilioSignature('12345', 'https://example.com/myapp.php?foo=1&bar=2', params), 'L/OH5YylLD5NRKLltdqwSvS0BnU=');
});

test('whatsappAddress and splitText', () => {
  assert.equal(whatsappAddress('+49 170 1234567'), 'whatsapp:+491701234567');
  assert.equal(whatsappAddress('whatsapp:+14155238886'), 'whatsapp:+14155238886');
  assert.deepEqual(splitText('kurz'), ['kurz']);
  const long = `${'a'.repeat(1000)}\n${'b'.repeat(1000)}`;
  assert.deepEqual(splitText(long), ['a'.repeat(1000), 'b'.repeat(1000)]);
  assert.ok(splitText('x'.repeat(4000)).every((p) => p.length <= 1600));
});

test('extracts text and image messages', () => {
  const text = extractTwilioMessage(form({ MessageSid: MSG_SID, From: 'whatsapp:+491701234567', Body: 'Spritz 7,50', NumMedia: '0' }));
  assert.equal(text.type, 'text');
  assert.equal(text.from, '491701234567');
  assert.equal(text.text, 'Spritz 7,50');
  const img = extractTwilioMessage(form({
    MessageSid: `MM${'c'.repeat(32)}`, From: 'whatsapp:+491701234567', Body: 'Neues Special', NumMedia: '1',
    MediaContentType0: 'image/jpeg', MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/x/Media/y`,
  }));
  assert.equal(img.type, 'image');
  assert.equal(img.caption, 'Neues Special');
  assert.match(img.mediaId, /^https:\/\/api\.twilio\.com\//);
  assert.equal(extractTwilioMessage(form({ MessageSid: MSG_SID, From: '+491701234567', Body: 'SMS' })), null);
});

function post(fields, { token = TOKEN, url = URL_, allowed = ['491701234567'] } = {}) {
  const params = form(fields);
  const handled = [];
  const result = handleTwilioPost({
    rawBody: Buffer.from(params.toString()),
    signatureHeader: twilioSignature(token, url, params),
    authToken: TOKEN,
    urls: [URL_],
    allowedNumbers: new Set(allowed),
    handleMessage: async (msg) => { handled.push(msg); },
  });
  return { result, handled };
}

test('webhook: valid signature + allowed sender -> handled, empty TwiML', async () => {
  const { result, handled } = post({ MessageSid: MSG_SID, From: 'whatsapp:+491701234567', Body: 'Hallo', NumMedia: '0' });
  assert.equal(result.status, 200);
  assert.equal(result.body, EMPTY_TWIML);
  await result.work;
  assert.equal(handled.length, 1);
});

test('webhook: wrong signature -> 401, nothing handled', () => {
  const { result } = post({ MessageSid: MSG_SID, From: 'whatsapp:+491701234567', Body: 'Hallo' }, { token: 'falsch' });
  assert.equal(result.status, 401);
  assert.equal(result.work, null);
});

test('webhook: sender not on the list -> silent', () => {
  const { result } = post({ MessageSid: MSG_SID, From: 'whatsapp:+4915100000', Body: 'Hallo' });
  assert.equal(result.status, 200);
  assert.equal(result.work, null);
});

test('client sends form-encoded messages with basic auth, split when long', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ sid: 'SMx' }), { status: 201 });
  };
  const client = createTwilioWhatsApp({ accountSid: SID, authToken: TOKEN, from: '+14155238886', fetchImpl });
  await client.sendText('491701234567', `${'a'.repeat(1500)}\n${'b'.repeat(500)}`);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('From'), 'whatsapp:+14155238886');
  assert.equal(body.get('To'), 'whatsapp:+491701234567');
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`);
});

test('client refuses media from other hosts', async () => {
  const client = createTwilioWhatsApp({ accountSid: SID, authToken: TOKEN, from: '+14155238886', fetchImpl: async () => { throw new Error('no'); } });
  await assert.rejects(client.downloadMedia('https://evil.example/x'), /unerwartete/);
  await assert.rejects(client.downloadMedia(`https://api.twilio.com/2010-04-01/Accounts/AC${'f'.repeat(32)}/x`), /unerwartete/);
});

test('twilio channel needs no Meta variables', () => {
  const names = envNames('twilio');
  assert.ok(!names.some((n) => n.startsWith('WHATSAPP_')));
  assert.deepEqual(missingEnv({}, names).includes('TWILIO_AUTH_TOKEN'), true);
});
