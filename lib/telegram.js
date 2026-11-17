// Telegram Bot API client (via fetch). Same interface as lib/whatsapp.js, so
// the conversation can use either one as its `sender`.
//
// The bot token is part of every request URL. It therefore never goes into an
// error message or a log line: errors carry the HTTP status and Telegram's own
// description only, with the token blanked out should it ever appear there.

import { MAX_MEDIA_BYTES, MediaError, digitsOnly } from './whatsapp.js';

const API = 'https://api.telegram.org';
export const MAX_TEXT = 4096; // sendMessage: "1-4096 characters after entities parsing"
export const TOKEN_RE = /^\d+:[\w-]+$/;

export function createTelegram({ token, fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN fehlt');
  if (!TOKEN_RE.test(token)) throw new Error('TELEGRAM_BOT_TOKEN hat nicht die Form <Zahl>:<Zeichenfolge>');
  const redact = (value) => String(value ?? '').split(token).join('***');

  /** fetch that never lets the URL (and with it the token) escape in an error. */
  async function request(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      throw new Error(`Telegram nicht erreichbar (${redact(err?.name || 'Fehler')})`);
    }
  }

  async function call(method, body) {
    const res = await request(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (!res.ok || !data || data.ok !== true) {
      throw new Error(`Telegram ${res.status} ${redact(data?.description).slice(0, 200)}`.trim());
    }
    return data.result;
  }

  return {
    async sendText(to, text) {
      const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
      return call('sendMessage', {
        // In a private chat the chat id is the user id.
        chat_id: Number(digitsOnly(to)),
        text: body,
        link_preview_options: { is_disabled: true },
      });
    },

    /** Telegram has no read receipts for bots. Kept so both clients look the same. */
    async markRead() {
      return null;
    },

    /** getFile, then the file itself. Returns { bytes: Buffer, mimeType }. */
    async downloadMedia(mediaId) {
      if (!/^[\w.-]+$/.test(mediaId || '')) throw new MediaError('bad_id', 'ungültige Medien-ID');
      let file;
      try {
        file = await call('getFile', { file_id: mediaId });
      } catch (err) {
        throw new MediaError('meta_failed', `Medien-Abfrage fehlgeschlagen (${err.message})`);
      }
      if (Number(file?.file_size) > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      const path = typeof file?.file_path === 'string' ? file.file_path : '';
      if (!/^[\w.-]+(\/[\w.-]+)*$/.test(path) || path.includes('..')) throw new MediaError('bad_url', 'unerwarteter Dateipfad');
      let fileRes;
      try {
        fileRes = await request(`${API}/file/bot${token}/${path}`, {});
      } catch (err) {
        throw new MediaError('download_failed', err.message);
      }
      if (!fileRes.ok) throw new MediaError('download_failed', `Medien-Download fehlgeschlagen (${fileRes.status})`);
      const declared = Number(fileRes.headers.get('content-length') || 0);
      if (declared > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      const bytes = Buffer.from(await fileRes.arrayBuffer());
      if (bytes.length > MAX_MEDIA_BYTES) throw new MediaError('too_large', 'Datei zu groß');
      return { bytes, mimeType: fileRes.headers.get('content-type') || '' };
    },
  };
}
