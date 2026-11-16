// Meta (WhatsApp Cloud API) webhook.
//   GET  = verification handshake
//   POST = incoming messages: check the signature over the raw body, answer
//          200 at once, do the work in the background with waitUntil.

import { waitUntil } from '@vercel/functions';
import { getRuntime, log } from '../lib/runtime.js';
import { handleWebhookPost, parseAllowedNumbers, verifyChallenge } from '../lib/webhook.js';

const text = (status, body) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
});

export function GET(request) {
  const result = verifyChallenge(new URL(request.url).searchParams, process.env.WHATSAPP_VERIFY_TOKEN);
  return text(result.status, result.body);
}

export async function POST(request) {
  let rawBody;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return text(400, 'bad request');
  }

  try {
    // Signature first: without a valid one nothing else is looked at.
    const result = handleWebhookPost({
      rawBody,
      signature: request.headers.get('x-hub-signature-256'),
      appSecret: process.env.WHATSAPP_APP_SECRET,
      allowedNumbers: parseAllowedNumbers(process.env.WA_ALLOWED_NUMBERS),
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      // Built lazily, inside the background work: a missing variable is logged there.
      handleMessage: (msg) => getRuntime().handleMessage(msg),
      log,
    });
    if (result.work) waitUntil(result.work);
    return text(result.status, result.body);
  } catch (err) {
    // Misconfiguration or a bug: log it, but never make Meta retry for days.
    log('webhook_error', { message: String(err?.message || err).slice(0, 500) });
    return text(200, 'OK');
  }
}
