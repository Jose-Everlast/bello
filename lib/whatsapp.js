// WhatsApp Cloud API client (Graph API via fetch).

const GRAPH = 'https://graph.facebook.com';
export const MAX_TEXT = 4096;
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // WhatsApp image limit

export class MediaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

export const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

export function createWhatsApp({ accessToken, phoneNumberId, fetchImpl = globalThis.fetch, apiVersion = 'v27.0' } = {}) {
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN fehlt');
  if (!/^\d+$/.test(phoneNumberId || '')) throw new Error('WHATSAPP_PHONE_NUMBER_ID fehlt oder ist keine Zahl');
  const auth = { Authorization: `Bearer ${accessToken}` };
  const messagesUrl = `${GRAPH}/${apiVersion}/${phoneNumberId}/messages`;

  async function post(body) {
    const res = await fetchImpl(messagesUrl, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify((await res.json()).error ?? {}); } catch { /* ignore */ }
      throw new Error(`WhatsApp ${res.status} ${detail}`.trim());
    }
    return res.json();
  }

  return {
    async sendText(to, text) {
      const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
      return post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: digitsOnly(to),
        type: 'text',
        text: { preview_url: false, body },
      });
    },

    async markRead(messageId) {
      return post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
    },

    /** Two-step media download. Returns { bytes: Buffer, mimeType }. */
    async downloadMedia(mediaId) {
      if (!/^[\w.-]+$/.test(mediaId || '')) throw new MediaError('bad_id', 'ungültige Medien-ID');
      const metaRes = await fetchImpl(`${GRAPH}/${apiVersion}/${mediaId}?phone_number_id=${phoneNumberId}`, { headers: auth });
      if (!metaRes.ok) throw new MediaError('meta_failed', `Medien-Abfrage fehlgeschlagen (${metaRes.status})`);
      const meta = await metaRes.json();
      if (Number(meta.file_size) > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      let host = '';
      try { host = new URL(meta.url).hostname; } catch { /* handled below */ }
      // The access token must only ever be sent to Meta hosts.
      if (!/(^|\.)(fbcdn\.net|facebook\.com|fbsbx\.com|whatsapp\.net)$/.test(host)) {
        throw new MediaError('bad_url', 'unerwartete Medien-URL');
      }
      const fileRes = await fetchImpl(meta.url, { headers: auth });
      if (!fileRes.ok) throw new MediaError('download_failed', `Medien-Download fehlgeschlagen (${fileRes.status})`);
      const declared = Number(fileRes.headers.get('content-length') || 0);
      if (declared > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      const bytes = Buffer.from(await fileRes.arrayBuffer());
      if (bytes.length > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      return { bytes, mimeType: meta.mime_type || fileRes.headers.get('content-type') || '' };
    },
  };
}
