// WhatsApp via Twilio (Sandbox now, a Twilio WhatsApp sender later).
//   POST = incoming message: check X-Twilio-Signature, answer with empty TwiML
//          at once, do the work in the background with waitUntil.
//   GET  = 405.

import { waitUntil } from '@vercel/functions';
import { getRuntime, log } from '../lib/runtime.js';
import { EMPTY_TWIML, handleTwilioPost } from '../lib/twilio.js';
import { parseAllowedNumbers } from '../lib/webhook.js';

const reply = (status, body, type = 'text/plain') => new Response(body, {
  status,
  headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' },
});

export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}

export async function POST(request) {
  let rawBody;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return reply(400, 'bad request');
  }
  try {
    const site = String(process.env.SITE_URL || '').replace(/\/+$/, '');
    const result = handleTwilioPost({
      rawBody,
      signatureHeader: request.headers.get('x-twilio-signature'),
      authToken: process.env.TWILIO_AUTH_TOKEN,
      // Twilio signs the URL entered in its console; accept the site URL and the URL as received.
      urls: [site && `${site}/api/twilio`, request.url],
      allowedNumbers: parseAllowedNumbers(process.env.WA_ALLOWED_NUMBERS),
      handleMessage: (msg) => getRuntime(process.env, { channel: 'twilio' }).handleMessage(msg),
      log,
    });
    if (result.work) waitUntil(result.work);
    return result.status === 200 ? reply(200, result.body, 'text/xml') : reply(result.status, result.body);
  } catch (err) {
    log('webhook_error', { message: String(err?.message || err).slice(0, 500) });
    return reply(200, EMPTY_TWIML, 'text/xml');
  }
}
