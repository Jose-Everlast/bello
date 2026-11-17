// Telegram Bot API webhook (test channel, same conversation as api/whatsapp.js).
//   POST = incoming update: check the secret header, answer 200 at once, do
//          the work in the background with waitUntil.
//   GET  = 405 (Telegram never sends one).

import { waitUntil } from '@vercel/functions';
import { getRuntime, log } from '../lib/runtime.js';
import { createTelegram } from '../lib/telegram.js';
import { handleTelegramPost, parseAllowedIds } from '../lib/telegram-webhook.js';

const text = (status, body, headers = {}) => new Response(body, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

// Only for the "not allowed" reply: needs the bot token and nothing else.
let plainClient = null;
function getPlainClient() {
  if (!plainClient) plainClient = createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN });
  return plainClient;
}

export function GET() {
  return text(405, 'Method Not Allowed', { Allow: 'POST' });
}

export async function POST(request) {
  let rawBody;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return text(400, 'bad request');
  }

  try {
    // Secret first: without a valid one nothing else is looked at.
    const result = handleTelegramPost({
      rawBody,
      secretHeader: request.headers.get('x-telegram-bot-api-secret-token'),
      secret: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowedIds: parseAllowedIds(process.env.TELEGRAM_ALLOWED_IDS),
      // Built lazily, inside the background work: a missing variable is logged there.
      handleMessage: (msg) => getRuntime(process.env, { channel: 'telegram' }).handleMessage(msg),
      notify: (id, reply) => getPlainClient().sendText(id, reply),
      log,
    });
    if (result.work) waitUntil(result.work);
    return text(result.status, result.body);
  } catch (err) {
    // Misconfiguration or a bug: log it, but never make Telegram retry.
    log('webhook_error', { message: String(err?.message || err).slice(0, 500) });
    return text(200, 'OK');
  }
}
