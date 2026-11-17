// Shared test helpers. No network, no environment variables.

import { readFileSync } from 'node:fs';
import { createConversation } from '../lib/conversation.js';
import { createMemoryStore } from '../lib/store-memory.js';

export const SITE = 'https://bello.example';
export const OWNER = '4915112345678';
export const MIRROR = '4917000000001';
export const START = Date.parse('2026-11-16T17:00:00Z'); // Monday 18:00 in Berlin
export const TODAY = '2026-11-16';

export function fixtureContent() {
  return JSON.parse(readFileSync(new URL('./fixtures/content.json', import.meta.url), 'utf8'));
}

/** A complete raw operation as the model would return it. */
export function op(partial) {
  return {
    op: '', id: '', parent_id: '', after_id: '', position: 'end', fields: [], name: '', price: '', text: '',
    note: '', title: '', subtitle: '', hidden: false, photo: 'keep', image_alt: '', from: '', until: '',
    key: '', factor: 1, scale: 1,
    ...partial,
  };
}

export const edit = (...operations) => ({ ok: true, intent: 'edit', reply: '', forward: false, operations });

/** Scripted fake model: answers from a queue and records what it was given. */
export function scriptedModel(script = []) {
  const queue = [...script];
  const calls = [];
  const model = async (input) => {
    calls.push(input);
    if (queue.length === 0) throw new Error('scripted model: no answer left');
    const next = queue.shift();
    return typeof next === 'function' ? next(input) : next;
  };
  model.calls = calls;
  model.push = (...answers) => queue.push(...answers);
  return model;
}

export function makeHarness({ script = [], content = fixtureContent(), mirrorNumber = '', allowed = [OWNER], previewSecret = '' } = {}) {
  const store = createMemoryStore({ content });
  const sent = [];
  const media = new Map();
  let now = START;
  let counter = 0;
  const model = scriptedModel(script);
  const sender = {
    async sendText(to, text) { sent.push({ to, text }); },
    async downloadMedia(id) {
      if (!media.has(id)) { const err = new Error('not found'); err.code = 'download_failed'; throw err; }
      return { bytes: media.get(id), mimeType: 'image/jpeg' };
    },
  };
  const processImage = async (bytes) => {
    if (bytes.toString().startsWith('BROKEN')) { const err = new Error('bad'); err.code = 'not_an_image'; throw err; }
    return { bytes: Buffer.from(`webp:${bytes.toString()}`), mimeType: 'image/webp' };
  };
  const conversation = createConversation({
    store, sender, model, processImage,
    clock: () => new Date(now),
    previewSecret,
    randomHex: (bytes) => { counter += 1; return counter.toString(16).padStart(bytes * 2, '0'); },
    config: { siteUrl: `${SITE}/`, developerName: 'Jose', allowedNumbers: new Set([...allowed, ...(mirrorNumber ? [mirrorNumber] : [])]), mirrorNumber },
  });
  let n = 0;
  const base = (from) => { n += 1; return { id: `wamid.${n}`, from, userId: null, timestamp: Math.floor(now / 1000) }; };
  return {
    store, sent, model, media, conversation,
    advance(ms) { now += ms; },
    now: () => now,
    /** Sends a text message and returns the reply text to the sender (or null). */
    async say(text, from = OWNER, extra = {}) {
      const before = sent.length;
      const result = await conversation.handleMessage({ ...base(from), type: 'text', text, caption: '', mediaId: '', ...extra });
      const reply = sent.slice(before).find((m) => m.to === from);
      return { result, reply: reply ? reply.text : null };
    },
    async photo(caption = '', from = OWNER, bytes = 'jpegdata') {
      const before = sent.length;
      const mediaId = `media${n + 1}`;
      media.set(mediaId, Buffer.from(bytes));
      const result = await conversation.handleMessage({ ...base(from), type: 'image', text: '', caption, mediaId });
      const reply = sent.slice(before).find((m) => m.to === from);
      return { result, reply: reply ? reply.text : null };
    },
    state: () => store.peekState(),
    tokenOf(reply) {
      const match = /\?vorschau=([0-9a-f]{32})/.exec(reply || '');
      return match ? match[1] : null;
    },
  };
}
