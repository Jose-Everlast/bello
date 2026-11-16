// store-github.js against a small in-memory imitation of the GitHub REST API
// (no network), plus image processing and the WhatsApp client with a fake fetch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { StateRepoPublicError, createGithubStore } from '../lib/store-github.js';
import { StateConflictError } from '../lib/store-memory.js';
import { ImageError, MAX_INPUT_BYTES, processImage } from '../lib/image.js';
import { createWhatsApp } from '../lib/whatsapp.js';
import { fixtureContent } from './helpers.js';

const sha = (value) => createHash('sha1').update(value).digest('hex');
const jsonRes = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Minimal fake of the endpoints store-github.js uses. Branch = { head, files: Map<path, Buffer> }. */
function fakeGithub({ withStateBranch = false, repo = 'o/r', isPrivate = true, defaultBranch = 'master', withContent = true } = {}) {
  const branches = new Map();
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const log = [];
  const snapshot = (files, message) => {
    const id = sha(`${message}:${commits.size}:${Math.random()}`);
    const treeSha = sha(JSON.stringify([...files.entries()].map(([p, b]) => [p, sha(b)]).sort()));
    trees.set(treeSha, new Map(files));
    commits.set(id, { tree: treeSha, message });
    return id;
  };
  const master = new Map(withContent ? [['data/content.json', Buffer.from(JSON.stringify(fixtureContent()))]] : [['README.md', Buffer.from('x')]]);
  branches.set(defaultBranch, { head: snapshot(master, 'init'), files: master });
  if (withStateBranch) branches.set('wa-state', { head: snapshot(new Map(), 'state init'), files: new Map() });
  const hooks = { beforeRefPatch: null, beforePut: null };

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    assert.ok(u.pathname.startsWith(`/repos/${repo}`), `request for ${u.pathname} reached the fake of ${repo}`);
    const path = decodeURIComponent(u.pathname.replace(`/repos/${repo}`, ''));
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ method, path, headers: init.headers, body });
    assert.equal(init.headers.Authorization, 'Bearer t0ken');
    assert.equal(init.headers['User-Agent'], 'bello-whatsapp');
    assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
    const raw = init.headers.Accept === 'application/vnd.github.raw+json';

    let m;
    if (method === 'GET' && path === '') return jsonRes(200, { full_name: repo, private: isPrivate, default_branch: defaultBranch });
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const branch = branches.get(m[1]);
      return branch ? jsonRes(200, { object: { sha: branch.head } }) : jsonRes(404, { message: 'Not Found' });
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (branches.has(name)) return jsonRes(422, { message: 'Reference already exists' });
      const source = [...branches.values()].find((b) => b.head === body.sha);
      branches.set(name, { head: body.sha, files: new Map(source.files) });
      return jsonRes(201, {});
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      if (hooks.beforeRefPatch) { const hook = hooks.beforeRefPatch; hooks.beforeRefPatch = null; hook(); }
      const branch = branches.get(m[1]);
      assert.equal(body.force, false);
      const commit = commits.get(body.sha);
      if (commit.parent !== branch.head) return jsonRes(422, { message: 'Update is not a fast forward' });
      branch.head = body.sha;
      branch.files = new Map(trees.get(commit.tree));
      return jsonRes(200, {});
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(.+)$/.exec(path))) return jsonRes(200, { tree: { sha: commits.get(m[1]).tree } });
    if (method === 'POST' && path === '/git/blobs') {
      const bytes = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8');
      blobs.set(sha(bytes), bytes);
      return jsonRes(201, { sha: sha(bytes) });
    }
    if (method === 'POST' && path === '/git/trees') {
      const files = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) files.set(entry.path, blobs.get(entry.sha));
      const treeSha = sha(JSON.stringify([...files.entries()].map(([p, b]) => [p, sha(b)]).sort()));
      trees.set(treeSha, files);
      return jsonRes(201, { sha: treeSha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const id = sha(`${body.message}:${body.tree}:${body.parents[0]}`);
      commits.set(id, { tree: body.tree, parent: body.parents[0], message: body.message });
      return jsonRes(201, { sha: id });
    }
    if ((m = /^\/contents\/(.+)$/.exec(path))) {
      const ref = method === 'GET' ? u.searchParams.get('ref') : body.branch;
      // A ref can be a branch name or, for reads, a commit sha.
      const branch = branches.get(ref) || (method === 'GET' && commits.has(ref) ? { files: trees.get(commits.get(ref).tree) } : null);
      if (!branch) return jsonRes(404, { message: 'No commit found for the ref' });
      const file = branch.files.get(m[1]);
      if (method === 'GET') {
        if (!file) return jsonRes(404, { message: 'Not Found' });
        if (raw) return new Response(file, { status: 200 });
        return jsonRes(200, { type: 'file', encoding: 'base64', sha: sha(file), content: file.toString('base64').replace(/(.{60})/g, '$1\n') });
      }
      if (method === 'PUT') {
        if (hooks.beforePut) { const hook = hooks.beforePut; hooks.beforePut = null; hook(branch); }
        const current = branch.files.get(m[1]);
        if (current && body.sha !== sha(current)) return jsonRes(409, { message: 'does not match' });
        if (!current && body.sha) return jsonRes(409, { message: 'does not match' });
        const bytes = Buffer.from(body.content, 'base64');
        branch.files.set(m[1], bytes);
        branch.head = snapshot(branch.files, body.message);
        return jsonRes(current ? 200 : 201, { content: { sha: sha(bytes) } });
      }
      if (method === 'DELETE') {
        if (!file) return jsonRes(404, { message: 'Not Found' });
        branch.files.delete(m[1]);
        return jsonRes(200, {});
      }
    }
    throw new Error(`fake GitHub: unexpected ${method} ${path}`);
  }
  return { fetchImpl, branches, commits, trees, log, hooks };
}

const makeStore = (gh) => createGithubStore({ token: 't0ken', repo: 'o/r', fetchImpl: gh.fetchImpl, retryDelayMs: 0 });

test('github store: configuration is checked', () => {
  assert.throws(() => createGithubStore({ token: '', repo: 'o/r' }), /GITHUB_TOKEN/);
  assert.throws(() => createGithubStore({ token: 'x', repo: 'nur-name' }), /GITHUB_REPO/);
});

test('github store: reads the published content from master', async () => {
  const gh = fakeGithub();
  assert.deepEqual(await makeStore(gh).getPublished(), fixtureContent());
});

test('github store: reading never creates the branch; the first write creates wa-state from master, then state round-trips', async () => {
  const gh = fakeGithub();
  const store = makeStore(gh);
  const first = await store.readState();
  assert.deepEqual(first, { state: null, rev: null });
  assert.equal(gh.branches.has('wa-state'), false, 'a read (e.g. from the preview endpoint) must not create anything');
  assert.deepEqual(gh.log.map((c) => `${c.method} ${c.path}`), ['GET /contents/state.json'], 'one request, nothing else');
  const rev = await store.writeState({ version: 1, draft: null, note: 'äöü €' }, first.rev);
  const second = await store.readState();
  assert.deepEqual(second.state, { version: 1, draft: null, note: 'äöü €' });
  assert.equal(second.rev, rev);
  assert.ok(gh.branches.has('wa-state'), 'branch created by the first write');
  assert.equal(gh.branches.get('master').files.has('state.json'), false, 'state never lands on master');
});

test('github store: state is never written to a public repo (state-in-public-repo, F2)', async () => {
  const gh = fakeGithub({ isPrivate: false });
  const store = makeStore(gh);
  await assert.rejects(store.writeState({ version: 1 }, null), StateRepoPublicError);
  await assert.rejects(store.putDraftImage('foto-1.webp', Buffer.from([1])), StateRepoPublicError);
  assert.equal(gh.branches.has('wa-state'), false);
  assert.deepEqual(gh.log.filter((c) => c.method !== 'GET'), [], 'no write request of any kind');
  // Reading the published content of a public site repo is fine.
  assert.deepEqual(await store.getPublished(), fixtureContent());
});

test('github store: GITHUB_STATE_REPO keeps state in a separate private repo while publishing stays on the site repo', async () => {
  const siteGh = fakeGithub({ isPrivate: false });
  const stateGh = fakeGithub({ repo: 's/p', defaultBranch: 'main', withContent: false });
  const fetchImpl = (url, init) => (new URL(url).pathname.startsWith('/repos/s/p') ? stateGh : siteGh).fetchImpl(url, init);
  const store = createGithubStore({ token: 't0ken', repo: 'o/r', stateRepo: 's/p', fetchImpl, retryDelayMs: 0 });

  const rev = await store.writeState({ version: 1, n: 1 }, null);
  await store.putDraftImage('foto-1.webp', Buffer.from([1, 2]));
  assert.deepEqual((await store.readState()), { state: { version: 1, n: 1 }, rev });
  assert.ok(stateGh.branches.get('wa-state').files.has('state.json'), 'state in the private repo, branch made from its default branch');
  assert.ok(stateGh.branches.get('wa-state').files.has('drafts/foto-1.webp'));
  assert.deepEqual(await store.getDraftImage('foto-1.webp'), Buffer.from([1, 2]));
  assert.deepEqual(siteGh.log.filter((c) => c.method !== 'GET'), [], 'nothing private was sent to the public site repo');
  assert.equal(siteGh.branches.has('wa-state'), false);

  const next = fixtureContent();
  next.texts['hero.text'] = 'Neu';
  assert.equal((await store.publish({ content: next, images: [], message: 'Inhalt' })).changed, true);
  assert.deepEqual(JSON.parse(siteGh.branches.get('master').files.get('data/content.json').toString()), next);
  assert.equal(stateGh.log.some((c) => c.path.startsWith('/git/')  && c.method !== 'GET' && c.path !== '/git/refs'), false, 'no publish in the state repo');
  assert.throws(() => createGithubStore({ token: 'x', repo: 'o/r', stateRepo: 'kaputt' }), /GITHUB_STATE_REPO/);
});

test('github store: a stale revision raises StateConflictError', async () => {
  const gh = fakeGithub({ withStateBranch: true });
  const store = makeStore(gh);
  const rev1 = await store.writeState({ n: 1 }, null);
  await store.writeState({ n: 2 }, rev1);
  await assert.rejects(store.writeState({ n: 3 }, rev1), StateConflictError);
  await assert.rejects(store.writeState({ n: 3 }, null), StateConflictError);
  assert.deepEqual((await store.readState()).state, { n: 2 });
});

test('github store: draft images are stored on wa-state, read back and removed', async () => {
  const gh = fakeGithub({ withStateBranch: true });
  const store = makeStore(gh);
  const bytes = Buffer.from([0, 1, 2, 250, 255]);
  await store.putDraftImage('foto-1.webp', bytes);
  assert.ok(gh.branches.get('wa-state').files.has('drafts/foto-1.webp'));
  assert.deepEqual(await store.getDraftImage('foto-1.webp'), bytes);
  assert.equal(await store.getDraftImage('fehlt.webp'), null);
  assert.equal(await store.getDraftImage('../state.json'), null);
  await assert.rejects(store.putDraftImage('../x.webp', bytes));
  await store.removeDraftImages(['foto-1.webp', 'fehlt.webp', '../state.json']);
  assert.equal(gh.branches.get('wa-state').files.has('drafts/foto-1.webp'), false);
});

test('github store: publish is exactly one commit on master with content and images', async () => {
  const gh = fakeGithub();
  const store = makeStore(gh);
  const headBefore = gh.branches.get('master').head;
  const next = fixtureContent();
  next.texts['hero.text'] = 'Neu';
  const image = Buffer.from([9, 8, 7]);
  const result = await store.publish({ content: next, images: [{ path: 'assets/uploads/foto-1.webp', bytes: image }], message: 'Inhalt per WhatsApp' });
  assert.equal(result.changed, true);
  const master = gh.branches.get('master');
  assert.equal(gh.commits.get(master.head).parent, headBefore, 'one commit on top of the old head');
  assert.equal(gh.commits.get(master.head).message, 'Inhalt per WhatsApp');
  assert.deepEqual(await store.getPublished(), next);
  assert.deepEqual(master.files.get('assets/uploads/foto-1.webp'), image);
  assert.equal(gh.log.filter((c) => c.method === 'PATCH').length, 1);
  assert.equal(gh.log.some((c) => c.method === 'PUT'), false, 'no per-file commits on master');

  const again = await store.publish({ content: next, images: [], message: 'nochmal' });
  assert.deepEqual(again, { commit: null, changed: false, moved: false }, 'identical content creates no commit');
});

test('github store: publish rebuilds on the new head when master moved in between', async () => {
  const gh = fakeGithub();
  const store = makeStore(gh);
  // The developer pushes while we are publishing: the first PATCH is not a fast-forward.
  gh.hooks.beforeRefPatch = () => {
    const master = gh.branches.get('master');
    const pushed = sha('developer push');
    gh.commits.set(pushed, { tree: gh.commits.get(master.head).tree, parent: master.head, message: 'developer push' });
    master.head = pushed;
  };
  const next = fixtureContent();
  next.texts['hero.text'] = 'Neu';
  const result = await store.publish({ content: next, images: [], message: 'Inhalt' });
  assert.equal(result.changed, true);
  assert.equal(gh.log.filter((c) => c.method === 'PATCH').length, 2, 'second attempt after the non-fast-forward');
  const master = gh.branches.get('master');
  assert.equal(gh.commits.get(master.head).parent, sha('developer push'), 'built on the new head, never forced');
  assert.deepEqual(await store.getPublished(), next);
});

test('github store: publish refuses when data/content.json at the head is not what the caller expects (F5)', async () => {
  const gh = fakeGithub();
  const store = makeStore(gh);
  const expected = fixtureContent();
  const next = fixtureContent();
  next.texts['hero.text'] = 'Vom Bot';

  // Case 1: master already differs before the first attempt.
  const other = fixtureContent();
  other.texts['hero.text'] = 'Vom Entwickler';
  const pushContent = (content) => {
    const master = gh.branches.get('master');
    const files = new Map(master.files);
    files.set('data/content.json', Buffer.from(JSON.stringify(content)));
    const treeSha = sha(`tree:${JSON.stringify(content)}`);
    gh.trees.set(treeSha, files);
    const pushed = sha(`push:${JSON.stringify(content)}`);
    gh.commits.set(pushed, { tree: treeSha, parent: master.head, message: 'developer push' });
    master.head = pushed;
    master.files = files;
  };
  pushContent(other);
  assert.deepEqual(await store.publish({ content: next, images: [], message: 'Inhalt', expected }), { commit: null, changed: false, moved: true });
  assert.deepEqual(await store.getPublished(), other, 'the developer push is untouched');
  assert.equal(gh.log.some((c) => c.method === 'PATCH'), false);

  // Case 2: content.json changes between our read and the ref update (non-fast-forward window).
  const third = fixtureContent();
  third.texts['hero.text'] = 'Zweiter Push';
  gh.hooks.beforeRefPatch = () => pushContent(third);
  assert.deepEqual(await store.publish({ content: next, images: [], message: 'Inhalt', expected: other }), { commit: null, changed: false, moved: true });
  assert.deepEqual(await store.getPublished(), third, 'the push that landed in the retry window is not overwritten');

  // Case 3: master moved, but content.json is still what we expect: rebuild and publish.
  gh.hooks.beforeRefPatch = () => {
    const master = gh.branches.get('master');
    const pushed = sha('unrelated push');
    gh.commits.set(pushed, { tree: gh.commits.get(master.head).tree, parent: master.head, message: 'unrelated push' });
    master.head = pushed;
  };
  assert.equal((await store.publish({ content: next, images: [], message: 'Inhalt', expected: third })).changed, true);
  assert.deepEqual(await store.getPublished(), next);
});

test('image: converts to WebP, max 1600 px, applies EXIF rotation, strips metadata', async () => {
  const sharp = (await import('sharp')).default;
  const input = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 224, g: 38, b: 28 } } })
    .withMetadata({ orientation: 6 }) // rotated 90°: displayed as 1200 x 2400
    .withExif({ IFD0: { Copyright: 'geheim', Artist: 'Jose' } })
    .jpeg()
    .toBuffer();
  const out = await processImage(input);
  assert.equal(out.mimeType, 'image/webp');
  assert.equal(out.width, 800);
  assert.equal(out.height, 1600);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  assert.equal(out.bytes.includes(Buffer.from('geheim')), false);
});

test('image: small images are not enlarged', async () => {
  const sharp = (await import('sharp')).default;
  const input = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff6e8' } }).png().toBuffer();
  const out = await processImage(input);
  assert.deepEqual([out.width, out.height], [300, 200]);
});

test('image: rejects oversized input, empty input and non-images', async () => {
  await assert.rejects(processImage(Buffer.alloc(MAX_INPUT_BYTES + 1)), (err) => err instanceof ImageError && err.code === 'too_large');
  await assert.rejects(processImage(Buffer.alloc(0)), (err) => err.code === 'not_an_image');
  await assert.rejects(processImage(Buffer.from('das ist kein Bild')), (err) => err.code === 'not_an_image');
  await assert.rejects(processImage('string'), (err) => err.code === 'not_an_image');
});

test('whatsapp client: text message body and endpoint', async () => {
  const calls = [];
  const wa = createWhatsApp({
    accessToken: 'tok', phoneNumberId: '123',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return jsonRes(200, { messages: [{ id: 'wamid.out' }] }); },
  });
  await wa.sendText('+49 151 12345678', 'Hallo');
  assert.equal(calls[0].url, 'https://graph.facebook.com/v27.0/123/messages');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '4915112345678', type: 'text',
    text: { preview_url: false, body: 'Hallo' },
  });
  await wa.sendText('1', 'x'.repeat(5000));
  assert.equal(JSON.parse(calls[1].init.body).text.body.length, 4096);
  assert.throws(() => createWhatsApp({ accessToken: '', phoneNumberId: '123' }));
  assert.throws(() => createWhatsApp({ accessToken: 'tok', phoneNumberId: 'abc' }));
});

test('whatsapp client: send errors are thrown with the status', async () => {
  const wa = createWhatsApp({ accessToken: 'tok', phoneNumberId: '123', fetchImpl: async () => jsonRes(400, { error: { code: 131030 } }) });
  await assert.rejects(wa.sendText('1', 'x'), /WhatsApp 400.*131030/);
});

test('whatsapp client: two-step media download, token only to Meta hosts, size limit', async () => {
  const seen = [];
  const make = (meta, file = new Response(Buffer.from('JPEG'), { status: 200 })) => createWhatsApp({
    accessToken: 'tok', phoneNumberId: '123',
    fetchImpl: async (url, init) => {
      seen.push({ url, auth: init.headers.Authorization });
      return url.startsWith('https://graph.facebook.com/') ? jsonRes(200, meta) : file;
    },
  });
  const ok = await make({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', file_size: 4 }).downloadMedia('987');
  assert.equal(ok.bytes.toString(), 'JPEG');
  assert.equal(ok.mimeType, 'image/jpeg');
  assert.deepEqual(seen.map((s) => s.auth), ['Bearer tok', 'Bearer tok']);
  assert.equal(seen[0].url, 'https://graph.facebook.com/v27.0/987?phone_number_id=123');

  await assert.rejects(make({ url: 'https://evil.example/x', mime_type: 'image/jpeg', file_size: 4 }).downloadMedia('987'), (e) => e.code === 'bad_url');
  await assert.rejects(make({ url: 'https://lookaside.fbsbx.com/x', file_size: 6 * 1024 * 1024 }).downloadMedia('987'), (e) => e.code === 'too_large');
  await assert.rejects(make({ url: 'https://lookaside.fbsbx.com/x', file_size: 4 }).downloadMedia('../me'), (e) => e.code === 'bad_id');
});
