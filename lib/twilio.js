// WhatsApp through Twilio (official WhatsApp provider). Used while Meta's own
// developer registration is blocked: Twilio's WhatsApp Sandbox needs no Meta
// account, and a Twilio production sender later keeps this same code.
//
// Client: same interface as lib/whatsapp.js and lib/telegram.js (sendText,
// markRead, downloadMedia), so the conversation does not know the difference.
// Webhook: Twilio posts form fields and signs them with X-Twilio-Signature =
// base64(HMAC-SHA1(auth token, full URL + every field name and value, sorted by name)).

import { createHmac } from 'node:crypto';
import { safeEqual } from './signature.js';
import { MAX_MEDIA_BYTES, MediaError, digitsOnly } from './whatsapp.js';

const API = 'https://api.twilio.com/2010-04-01';
export const MAX_TEXT = 1600; // Twilio's limit per WhatsApp message body
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const SID_RE = /^AC[0-9a-f]{32}$/;

/** "+14155238886" or "whatsapp:+14155238886" -> "whatsapp:+14155238886". */
export function whatsappAddress(value) {
  const d = digitsOnly(value);
  return d ? `whatsapp:+${d}` : '';
}

/** Splits a long text at line breaks (or hard, if a line is too long) into parts of at most `max`. */
export function splitText(text, max = MAX_TEXT) {
  const parts = [];
  let rest = String(text ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length || parts.length === 0) parts.push(rest);
  return parts;
}

export function createTwilioWhatsApp({ accountSid, authToken, from, fetchImpl = globalThis.fetch } = {}) {
  if (!SID_RE.test(accountSid || '')) throw new Error('TWILIO_ACCOUNT_SID fehlt oder hat nicht die Form AC…');
  if (!authToken) throw new Error('TWILIO_AUTH_TOKEN fehlt');
  const fromAddress = whatsappAddress(from);
  if (!fromAddress) throw new Error('TWILIO_WHATSAPP_FROM fehlt (z. B. +14155238886)');
  const auth = { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` };

  async function request(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      throw new Error(`Twilio nicht erreichbar (${err?.name || 'Fehler'})`);
    }
  }

  async function sendOne(to, body) {
    const res = await request(`${API}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: fromAddress, To: whatsappAddress(to), Body: body }).toString(),
    });
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (!res.ok) {
      throw new Error(`Twilio ${res.status} ${data?.code ?? ''} ${String(data?.message ?? '').slice(0, 200)}`.trim());
    }
    return data;
  }

  return {
    async sendText(to, text) {
      let last = null;
      for (const part of splitText(text)) last = await sendOne(to, part);
      return last;
    },

    /** Twilio sets read receipts itself; nothing to do. */
    async markRead() {
      return null;
    },

    /** mediaId is the MediaUrl Twilio sent. Only Twilio's own API host is fetched. */
    async downloadMedia(mediaId) {
      let url;
      try { url = new URL(mediaId); } catch { throw new MediaError('bad_id', 'ungültige Medien-Adresse'); }
      if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com' || !url.pathname.startsWith(`/2010-04-01/Accounts/${accountSid}/`)) {
        throw new MediaError('bad_url', 'unerwartete Medien-Adresse');
      }
      let res;
      try {
        // Twilio answers with a redirect to its file storage; fetch drops the
        // Authorization header when the redirect leaves api.twilio.com.
        res = await request(url.href, { headers: auth, redirect: 'follow' });
      } catch (err) {
        throw new MediaError('download_failed', err.message);
      }
      if (!res.ok) throw new MediaError('download_failed', `Medien-Download fehlgeschlagen (${res.status})`);
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      return { bytes, mimeType: res.headers.get('content-type') || '' };
    },
  };
}

/** The value Twilio puts into X-Twilio-Signature for this URL and these form fields. */
export function twilioSignature(authToken, url, params) {
  const keys = [...new Set([...params.keys()])].sort();
  let data = url;
  for (const key of keys) for (const value of params.getAll(key)) data += key + value;
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/** True when the signature matches one of the URLs the webhook may be reached under. */
export function verifyTwilioSignature({ header, authToken, urls, params }) {
  if (typeof authToken !== 'string' || !authToken || typeof header !== 'string' || !header) return false;
  return urls.filter(Boolean).some((url) => safeEqual(header, twilioSignature(authToken, url, params)));
}

/**
 * One Twilio webhook call -> none or one message of the shape used by
 * lib/webhook.js: { id, from, userId, timestamp, type, text, caption, mediaId, phoneNumberId }.
 */
export function extractTwilioMessage(params) {
  const sid = params.get('MessageSid') || params.get('SmsMessageSid') || '';
  const from = params.get('From') || '';
  if (!/^(SM|MM)[0-9a-f]{32}$/.test(sid) || !from.startsWith('whatsapp:')) return null;
  const numMedia = Number(params.get('NumMedia') || 0);
  const firstType = params.get('MediaContentType0') || '';
  const body = params.get('Body') || '';
  let type = 'unknown';
  if (numMedia > 0 && firstType.startsWith('image/')) type = 'image';
  else if (numMedia > 0) type = firstType.startsWith('audio/') ? 'audio' : firstType.startsWith('video/') ? 'video' : 'document';
  else if (params.get('Latitude')) type = 'location';
  else if (body) type = 'text';
  return {
    id: sid,
    from: digitsOnly(from),
    userId: null,
    timestamp: null,
    type,
    text: type === 'text' ? body : '',
    caption: type === 'image' ? body : '',
    mediaId: type === 'image' ? params.get('MediaUrl0') || '' : '',
    phoneNumberId: '',
  };
}

/**
 * POST handling. Returns { status, body, work }; `work` never rejects.
 * Senders not on the allowlist get no answer at all (same as the Meta path).
 */
export function handleTwilioPost({ rawBody, signatureHeader, authToken, urls, allowedNumbers, handleMessage, log = () => {} }) {
  const params = new URLSearchParams(Buffer.from(rawBody).toString('utf8'));
  if (!verifyTwilioSignature({ header: signatureHeader, authToken, urls, params })) {
    return { status: 401, body: 'invalid signature', work: null };
  }
  const msg = extractTwilioMessage(params);
  if (!msg || !allowedNumbers.has(msg.from)) return { status: 200, body: EMPTY_TWIML, work: null };
  const work = (async () => {
    try {
      await handleMessage(msg);
    } catch (err) {
      log('webhook_work_error', { id: msg.id, message: String(err?.message || err).slice(0, 300) });
    }
  })();
  return { status: 200, body: EMPTY_TWIML, work };
}
