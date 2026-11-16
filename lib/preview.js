// Preview endpoint logic (contract rule 3). No platform specifics.

import { createHmac, randomBytes } from 'node:crypto';
import { IMAGE_NAME_RE, UPLOAD_DIR } from './content.js';
import { safeEqual } from './signature.js';

export const TOKEN_RE = /^[0-9a-f]{32}$/;
const ID_HEX = 20; // 80 random bits
const MAC_HEX = 12; // 48 bits of HMAC-SHA256(secret, id)
export const MISS_CACHE_MS = 60_000;

const mac = (id, secret) => createHmac('sha256', String(secret)).update(`bello-vorschau-v1:${id}`).digest('hex').slice(0, MAC_HEX);

/**
 * A preview token: random id plus a MAC over it, 32 hex characters in all.
 * With the secret a wrong token is recognised without reading any state, so
 * anonymous requests cannot cause GitHub calls. Without a secret (tests,
 * simulator) the token is 32 random hex characters.
 */
export function createPreviewToken(secret, randomHex = (bytes) => randomBytes(bytes).toString('hex')) {
  if (!secret) return randomHex(16);
  const id = randomHex(ID_HEX / 2);
  return id + mac(id, secret);
}

/** Offline check: well-formed and, when a secret is given, carrying the right MAC. */
export function verifyPreviewToken(token, secret) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
  if (!secret) return true;
  return safeEqual(token.slice(ID_HEX), mac(token.slice(0, ID_HEX), secret));
}

/**
 * Remembers tokens that did not match a draft, so that repeating an old or
 * leaked link does not read the state again and again. Tokens are unique per
 * draft, so a token that missed once never becomes valid later. Hits are not
 * cached: the owner always sees the current draft.
 */
export function createMissCache({ ttlMs = MISS_CACHE_MS, max = 500, now = () => Date.now() } = {}) {
  const misses = new Map();
  return {
    has(token) {
      const until = misses.get(token);
      if (until === undefined) return false;
      if (until > now()) return true;
      misses.delete(token);
      return false;
    },
    add(token) {
      if (misses.size >= max) misses.delete(misses.keys().next().value);
      misses.set(token, now() + ttlMs);
    },
  };
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (status, data) => ({
  status,
  headers: { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(data),
});
const notFound = () => json(404, { error: 'Vorschau nicht gefunden oder abgelaufen.' });

/**
 * @param {{ store, token: string|null, image?: string|null, now?: Date, secret?: string,
 *           misses?: { has(token): boolean, add(token): void } }} args
 *   secret: when set, tokens without a valid MAC are rejected before any I/O.
 *   misses: optional createMissCache() shared between requests.
 * @returns {Promise<{ status: number, headers: object, body: string|Buffer }>}
 */
export async function handlePreview({ store, token, image = null, now = new Date(), secret = '', misses = null }) {
  if (!verifyPreviewToken(token, secret)) return notFound();
  if (misses && misses.has(token)) return notFound();

  let state;
  try {
    ({ state } = await store.readState());
  } catch {
    return json(503, { error: 'Vorschau gerade nicht erreichbar.' });
  }
  const draft = state && state.draft;
  // Constant-time comparison; an expired draft is as good as none.
  const matches = safeEqual(token, draft && typeof draft.token === 'string' ? draft.token : '');
  if (!draft || !matches) {
    if (misses) misses.add(token);
    return notFound();
  }
  if (!(Date.parse(draft.expiresAt) > now.getTime())) return notFound();

  const draftImages = Array.isArray(draft.images) ? draft.images : [];

  if (image !== null && image !== undefined) {
    if (typeof image !== 'string' || !IMAGE_NAME_RE.test(image) || !draftImages.includes(image)) return notFound();
    let bytes;
    try {
      bytes = await store.getDraftImage(image);
    } catch {
      return json(503, { error: 'Vorschau gerade nicht erreichbar.' });
    }
    if (!bytes) return notFound();
    return { status: 200, headers: { ...NO_STORE, 'Content-Type': 'image/webp' }, body: bytes };
  }

  const images = {};
  for (const special of draft.content.specials || []) {
    if (typeof special.image !== 'string' || !special.image.startsWith(UPLOAD_DIR)) continue;
    const name = special.image.slice(UPLOAD_DIR.length);
    if (draftImages.includes(name)) {
      images[special.image] = `/api/vorschau?token=${token}&image=${encodeURIComponent(name)}`;
    }
  }
  return json(200, { content: draft.content, images });
}
