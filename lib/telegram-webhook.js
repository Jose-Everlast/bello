// Telegram webhook handling without any platform specifics: secret header,
// Update parsing into the message shape of lib/webhook.js, sender allowlist.

import { safeEqual } from './signature.js';

export const NOT_ALLOWED_WINDOW_MS = 60 * 1000;
const MAX_LIMITER_ENTRIES = 500;

/** Message kinds that are neither text nor photo, in the order they are looked for. */
const OTHER_TYPES = [
  'voice', 'audio', 'video', 'video_note', 'animation', 'document', 'sticker', 'contact', 'location', 'venue', 'poll', 'dice',
];

const isId = (value) => Number.isSafeInteger(value) && value > 0;

/** "123456789, 987654321" -> Set of digit strings. */
export function parseAllowedIds(value) {
  return new Set(String(value ?? '').split(/[,;\s]+/).filter((id) => /^[1-9]\d{0,15}$/.test(id)));
}

export function notAllowedReply(id) {
  return `Diese Unterhaltung ist nicht freigeschaltet. Deine Telegram-ID: ${id}`;
}

/** True when the request carries the secret given to setWebhook. Without a configured secret nothing passes. */
export function verifySecretToken(header, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  return safeEqual(header, secret);
}

/**
 * At most one "not allowed" reply per sender per window, per function instance.
 * allow(id, nowMs) -> boolean
 */
export function createReplyLimiter({ windowMs = NOT_ALLOWED_WINDOW_MS, maxEntries = MAX_LIMITER_ENTRIES } = {}) {
  const last = new Map();
  return {
    allow(id, now = Date.now()) {
      const at = last.get(id);
      if (at !== undefined && now - at < windowMs) return false;
      if (last.size >= maxEntries) {
        for (const [key, value] of last) if (now - value >= windowMs) last.delete(key);
        // Still full of fresh entries: stay silent instead of growing without bound.
        if (last.size >= maxEntries) return false;
      }
      last.set(id, now);
      return true;
    },
  };
}

/**
 * Turns one Telegram Update into messages (none or one) of the shape
 * { id, from, userId, timestamp, type, text, caption, mediaId, phoneNumberId }.
 * Only new messages in private chats; edits, groups, channels, bots and
 * everything else are ignored.
 */
export function extractTelegramMessages(update) {
  const m = update && typeof update === 'object' ? update.message : null;
  if (!m || typeof m !== 'object') return [];
  if (!m.chat || m.chat.type !== 'private' || !isId(m.chat.id)) return [];
  if (!m.from || m.from.is_bot === true || m.from.id !== m.chat.id) return [];
  // message_id is unique inside the chat (0 = ephemeral, no stable id to dedupe on).
  if (!isId(m.message_id)) return [];

  const photos = Array.isArray(m.photo) ? m.photo.filter((p) => p && typeof p.file_id === 'string' && p.file_id) : [];
  let type = 'unknown';
  if (photos.length) type = 'image';
  else if (typeof m.text === 'string') type = 'text';
  else type = OTHER_TYPES.find((key) => m[key] !== undefined && m[key] !== null) || 'unknown';

  const area = (p) => (Number(p.width) || 0) * (Number(p.height) || 0);
  const largest = photos.reduce((best, p) => (!best || area(p) >= area(best) ? p : best), null);

  return [{
    id: `tg-${m.chat.id}-${m.message_id}`,
    from: String(m.from.id),
    userId: null,
    timestamp: Number.isSafeInteger(m.date) && m.date >= 0 ? m.date : null,
    type,
    text: type === 'text' ? m.text : '',
    caption: type === 'image' && typeof m.caption === 'string' ? m.caption : '',
    mediaId: type === 'image' ? largest.file_id : '',
    phoneNumberId: '',
  }];
}

/**
 * POST handling. Returns { status, body, work } where `work` is a promise
 * (never rejects) to hand to waitUntil, or null when there is nothing to do.
 *
 * @param {object} args
 * @param {Buffer} args.rawBody
 * @param {string|null} args.secretHeader   X-Telegram-Bot-Api-Secret-Token
 * @param {string} args.secret              TELEGRAM_WEBHOOK_SECRET
 * @param {Set<string>} args.allowedIds
 * @param {(msg) => Promise<any>} args.handleMessage   for senders on the list
 * @param {(id, text) => Promise<any>} args.notify     plain send, for senders not on the list
 * @param {{ allow(id, nowMs): boolean }} [args.limiter]
 * @param {() => number} [args.now]
 * @param {(event, data) => void} [args.log]
 */
export function handleTelegramPost({
  rawBody, secretHeader, secret, allowedIds, handleMessage, notify,
  limiter = defaultLimiter, now = Date.now, log = () => {},
}) {
  if (!verifySecretToken(secretHeader, secret)) {
    return { status: 401, body: 'invalid secret token', work: null };
  }
  let update;
  try {
    update = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return { status: 200, body: 'OK', work: null };
  }
  const jobs = [];
  for (const msg of extractTelegramMessages(update)) {
    if (allowedIds.has(msg.from)) {
      jobs.push({ msg, run: () => handleMessage(msg) });
    } else if (limiter.allow(msg.from, now())) {
      // Tells the sender their id and does nothing else: no state, no model, no GitHub.
      jobs.push({ msg, run: () => notify(msg.from, notAllowedReply(msg.from)) });
    }
  }
  if (jobs.length === 0) return { status: 200, body: 'OK', work: null };

  const work = (async () => {
    for (const job of jobs) {
      try {
        await job.run();
      } catch (err) {
        log('webhook_work_error', { id: job.msg.id, message: String(err?.message || err).slice(0, 300) });
      }
    }
  })();
  return { status: 200, body: 'OK', work };
}

const defaultLimiter = createReplyLimiter();
