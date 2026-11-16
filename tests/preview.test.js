import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePreview } from '../lib/preview.js';
import { createMemoryStore } from '../lib/store-memory.js';
import { fixtureContent } from './helpers.js';

const TOKEN = 'a'.repeat(32);
const NOW = new Date('2026-11-16T12:00:00Z');

async function storeWithDraft({ expiresAt = '2026-11-17T12:00:00Z', images = ['foto-1.webp'] } = {}) {
  const content = fixtureContent();
  const draftContent = fixtureContent();
  draftContent.specials.push({ id: 'sp-neu', title: 'Neu', text: '', image: 'assets/uploads/foto-1.webp', imageAlt: 'Bild', from: '2026-11-16', until: '2026-11-20' });
  draftContent.specials.push({ id: 'sp-alt', title: 'Alt', text: '', image: 'assets/uploads/schon-live.webp', imageAlt: 'Bild', from: '2026-11-16', until: '2026-11-20' });
  const store = createMemoryStore({
    content,
    state: { version: 1, draft: { token: TOKEN, content: draftContent, images, changes: ['x'], expiresAt }, history: [], notes: [], seen: [], contacts: {} },
  });
  await store.putDraftImage('foto-1.webp', Buffer.from('IMG'));
  await store.putDraftImage('fremd.webp', Buffer.from('OTHER'));
  return store;
}

test('valid token returns the draft content and an image map for draft images only', async () => {
  const store = await storeWithDraft();
  const res = await handlePreview({ store, token: TOKEN, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.match(res.headers['Content-Type'], /^application\/json/);
  const body = JSON.parse(res.body);
  assert.deepEqual(Object.keys(body).sort(), ['content', 'images']);
  assert.equal(body.content.specials.length, 3);
  assert.deepEqual(body.images, { 'assets/uploads/foto-1.webp': `/api/vorschau?token=${TOKEN}&image=foto-1.webp` });
});

test('invalid, malformed and missing tokens give 404 JSON', async () => {
  const store = await storeWithDraft();
  let reads = 0;
  const counting = { ...store, readState: async () => { reads += 1; return store.readState(); } };
  for (const token of [null, undefined, '', 'b'.repeat(32), TOKEN.slice(1), `${TOKEN}a`, TOKEN.toUpperCase(), '../state.json', ['a'], `${TOKEN}&x=1`]) {
    const res = await handlePreview({ store: counting, token, now: NOW });
    assert.equal(res.status, 404, String(token));
    assert.equal(typeof JSON.parse(res.body).error, 'string');
  }
  assert.equal(reads, 1, 'only the well-formed wrong token reaches the store');
});

test('expired draft gives 404', async () => {
  const store = await storeWithDraft({ expiresAt: '2026-11-16T12:00:00Z' });
  assert.equal((await handlePreview({ store, token: TOKEN, now: NOW })).status, 404);
  const broken = await storeWithDraft({ expiresAt: 'kaputt' });
  assert.equal((await handlePreview({ store: broken, token: TOKEN, now: NOW })).status, 404);
});

test('no draft and no state give 404', async () => {
  const empty = createMemoryStore({ content: fixtureContent() });
  assert.equal((await handlePreview({ store: empty, token: TOKEN, now: NOW })).status, 404);
  const noDraft = createMemoryStore({ content: fixtureContent(), state: { version: 1, draft: null } });
  assert.equal((await handlePreview({ store: noDraft, token: TOKEN, now: NOW })).status, 404);
});

test('image: bytes for a draft image, 404 for anything else', async () => {
  const store = await storeWithDraft();
  const ok = await handlePreview({ store, token: TOKEN, image: 'foto-1.webp', now: NOW });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Content-Type'], 'image/webp');
  assert.equal(ok.body.toString(), 'IMG');
  for (const image of ['fremd.webp', 'nope.webp', '../state.json', 'foto-1.webp/..', '', 'FOTO-1.webp']) {
    assert.equal((await handlePreview({ store, token: TOKEN, image, now: NOW })).status, 404, image);
  }
  assert.equal((await handlePreview({ store, token: 'b'.repeat(32), image: 'foto-1.webp', now: NOW })).status, 404);
});

test('store failure gives 503, not an exception', async () => {
  const store = { readState: async () => { throw new Error('down'); } };
  const res = await handlePreview({ store, token: TOKEN, now: NOW });
  assert.equal(res.status, 503);
  assert.equal(typeof JSON.parse(res.body).error, 'string');
});
