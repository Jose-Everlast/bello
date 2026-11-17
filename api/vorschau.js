// Preview of the unpublished draft: GET /api/vorschau?token=<token>[&image=<name>.webp]

import { createMissCache, handlePreview } from '../lib/preview.js';
import { createStore, log, previewSecret } from '../lib/runtime.js';

// One store and one cache of unknown tokens per function instance, so that
// repeated requests with an old link do not turn into GitHub calls.
let shared = null;
function getShared() {
  if (!shared) {
    shared = { store: createStore(), misses: createMissCache() };
  }
  return shared;
}

const unavailable = () => new Response(JSON.stringify({ error: 'Vorschau gerade nicht erreichbar.' }), {
  status: 503,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  try {
    // Without the secret no token can be checked offline: refuse instead of reading state for anyone.
    const secret = previewSecret();
    if (!secret) {
      log('preview_error', { message: 'PREVIEW_SECRET, WHATSAPP_APP_SECRET bzw. TELEGRAM_WEBHOOK_SECRET fehlt' });
      return unavailable();
    }
    const { store, misses } = getShared();
    const result = await handlePreview({
      store,
      misses,
      secret,
      token: params.get('token'),
      image: params.get('image'),
      now: new Date(),
    });
    return new Response(result.body, { status: result.status, headers: result.headers });
  } catch (err) {
    log('preview_error', { message: String(err?.message || err).slice(0, 300) });
    return unavailable();
  }
}
