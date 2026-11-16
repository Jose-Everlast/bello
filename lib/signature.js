// Meta webhook signature: X-Hub-Signature-256: "sha256=" + hex(HMAC-SHA256(app secret, raw body)).

import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER_RE = /^sha256=([0-9a-f]{64})$/i;

/**
 * @param {Buffer|Uint8Array|string} rawBody the untouched request body
 * @param {string|null|undefined} header value of X-Hub-Signature-256
 * @param {string|null|undefined} appSecret
 */
export function verifySignature(rawBody, header, appSecret) {
  if (typeof appSecret !== 'string' || appSecret.length === 0) return false;
  if (typeof header !== 'string') return false;
  const match = HEADER_RE.exec(header.trim());
  if (!match) return false;
  const given = Buffer.from(match[1].toLowerCase(), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function signBody(rawBody, appSecret) {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** Constant-time comparison of two strings (any length). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHmac('sha256', 'bello-compare').update(a).digest();
  const hb = createHmac('sha256', 'bello-compare').update(b).digest();
  return timingSafeEqual(ha, hb);
}
