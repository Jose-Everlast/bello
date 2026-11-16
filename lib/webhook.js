// Meta webhook handling without any platform specifics: verification
// handshake, signature check, payload parsing, sender allowlist.

import { safeEqual, verifySignature } from './signature.js';

const digits = (value) => String(value ?? '').replace(/\D/g, '');

/** "49170…, +49 151 …" -> Set of digit strings. */
export function parseAllowedNumbers(value) {
  return new Set(String(value ?? '').split(/[,;\n]+/).map(digits).filter((n) => n.length >= 6));
}

/**
 * GET handshake. params: URLSearchParams (or anything with .get()).
 * Returns { status, body }.
 */
export function verifyChallenge(params, verifyToken) {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (!verifyToken || mode !== 'subscribe' || typeof challenge !== 'string' || !challenge) {
    return { status: 403, body: 'Forbidden' };
  }
  if (!safeEqual(token, verifyToken)) return { status: 403, body: 'Forbidden' };
  return { status: 200, body: challenge };
}

/**
 * Flattens a webhook payload into messages. Tolerates status updates, batches
 * and unknown shapes. Each message:
 * { id, from, userId, timestamp, type, text, caption, mediaId, phoneNumberId }
 */
export function extractMessages(payload) {
  const out = [];
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = change && change.field === 'messages' ? change.value : null;
      if (!value || !Array.isArray(value.messages)) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const m of value.messages) {
        if (!m || typeof m.id !== 'string' || !m.id) continue;
        const contact = contacts.find((c) => c && (c.wa_id === m.from || c.user_id === m.from_user_id)) || contacts[0] || {};
        const type = typeof m.type === 'string' ? m.type : 'unknown';
        out.push({
          id: m.id,
          from: digits(m.from || (contacts.length === 1 ? contact.wa_id : '')),
          userId: typeof m.from_user_id === 'string' ? m.from_user_id
            : (contacts.length === 1 && typeof contact.user_id === 'string' ? contact.user_id : null),
          timestamp: /^\d+$/.test(String(m.timestamp ?? '')) ? Number(m.timestamp) : null,
          type,
          text: type === 'text' && typeof m.text?.body === 'string' ? m.text.body : '',
          caption: type === 'image' && typeof m.image?.caption === 'string' ? m.image.caption : '',
          mediaId: type === 'image' && typeof m.image?.id === 'string' ? m.image.id : '',
          phoneNumberId: typeof value.metadata?.phone_number_id === 'string' ? value.metadata.phone_number_id : '',
        });
      }
    }
  }
  return out;
}

/**
 * POST handling. Returns { status, body, work } where `work` is a promise
 * (never rejects) to hand to waitUntil, or null when there is nothing to do.
 *
 * @param {object} args
 * @param {Buffer} args.rawBody          untouched request bytes
 * @param {string|null} args.signature   X-Hub-Signature-256
 * @param {string} args.appSecret
 * @param {Set<string>} args.allowedNumbers
 * @param {string} [args.phoneNumberId]  if set, messages for other business numbers are ignored
 * @param {(msg) => Promise<any>} args.handleMessage
 * @param {(event, data) => void} [args.log]
 */
export function handleWebhookPost({ rawBody, signature, appSecret, allowedNumbers, phoneNumberId = '', handleMessage, log = () => {} }) {
  if (!verifySignature(rawBody, signature, appSecret)) {
    return { status: 401, body: 'invalid signature', work: null };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return { status: 200, body: 'OK', work: null };
  }
  const messages = extractMessages(payload).filter((msg) => {
    if (phoneNumberId && msg.phoneNumberId && msg.phoneNumberId !== phoneNumberId) return false;
    // Known sender: must be on the allowlist. Sender number omitted by Meta
    // (business-scoped user id only): the conversation resolves it from state.
    if (msg.from) return allowedNumbers.has(msg.from);
    return Boolean(msg.userId);
  });
  if (messages.length === 0) return { status: 200, body: 'OK', work: null };

  const work = (async () => {
    for (const msg of messages) {
      try {
        await handleMessage(msg);
      } catch (err) {
        log('webhook_work_error', { id: msg.id, message: String(err?.message || err).slice(0, 300) });
      }
    }
  })();
  return { status: 200, body: 'OK', work };
}
