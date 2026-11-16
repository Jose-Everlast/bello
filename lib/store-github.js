// GitHub-backed store (REST API via fetch, no Octokit).
//   site repo,  branch master:    public/data/content.json and public/assets/uploads/* = the published site
//   state repo, branch wa-state:  state.json (draft, history, notes, dedupe) and drafts/*.webp
// The state repo holds phone numbers, message texts and unpublished photos. It
// MUST be private: every write checks that first and refuses otherwise. It is
// the site repo by default, or a separate private repo (GITHUB_STATE_REPO).
// Interface: see store-memory.js.

import { StateConflictError } from './store-memory.js';
import { IMAGE_NAME_RE, SITE_REPO_DIR } from './content.js';

const API = 'https://api.github.com';
const CONTENT_PATH = `${SITE_REPO_DIR}data/content.json`; // repo path; the page loads it as /data/content.json
const STATE_PATH = 'state.json';
const DRAFT_DIR = 'drafts';
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export class GithubError extends Error {
  constructor(status, message) {
    super(`GitHub ${status}: ${message}`);
    this.name = 'GithubError';
    this.status = status;
  }
}

/** The repo that would hold the private state is publicly readable. Nothing was written. */
export class StateRepoPublicError extends Error {
  constructor(repo) {
    super(`Das Repo ${repo} ist öffentlich. Der Zustand (Telefonnummern, Nachrichten, Entwürfe) wird nur in ein privates Repo geschrieben: Repo privat stellen oder GITHUB_STATE_REPO auf ein privates Repo setzen.`);
    this.name = 'StateRepoPublicError';
  }
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const canonical = (content) => JSON.stringify(content);

export function createGithubStore({
  token,
  repo, // "owner/name": the site
  stateRepo = '', // "owner/name": where the private state lives (default: the site repo)
  fetchImpl = globalThis.fetch,
  publishBranch = 'master',
  stateBranch = 'wa-state',
  committer = { name: 'Bello WhatsApp', email: 'bello-whatsapp@users.noreply.github.com' },
  retryDelayMs = 300,
} = {}) {
  if (!token) throw new Error('GITHUB_TOKEN fehlt');
  if (!REPO_RE.test(repo || '')) throw new Error('GITHUB_REPO muss die Form "owner/name" haben');
  const stateRepoName = stateRepo || repo;
  if (!REPO_RE.test(stateRepoName)) throw new Error('GITHUB_STATE_REPO muss die Form "owner/name" haben');
  const site = `${API}/repos/${repo}`;
  const state = `${API}/repos/${stateRepoName}`;
  const sameRepo = stateRepoName.toLowerCase() === repo.toLowerCase();

  async function gh(base, method, path, { body, raw = false, okStatuses = [] } = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bello-whatsapp',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      let message = '';
      try { message = (await res.json()).message || ''; } catch { /* no JSON body */ }
      throw new GithubError(res.status, `${method} ${path.split('?')[0] || '/'} ${message}`.trim());
    }
    return res;
  }

  async function headSha(base, branch) {
    const res = await gh(base, 'GET', `/git/ref/heads/${encodePath(branch)}`, { okStatuses: [404] });
    if (res.status === 404) return null;
    return (await res.json()).object.sha;
  }

  // Checked once per store instance, before the first write. A repo that is
  // not confirmed private is never written to.
  let stateRepoInfo = null;
  async function ensureStateRepoPrivate() {
    if (stateRepoInfo) return stateRepoInfo;
    const info = await (await gh(state, 'GET', '')).json();
    if (info.private !== true) throw new StateRepoPublicError(stateRepoName);
    stateRepoInfo = { defaultBranch: typeof info.default_branch === 'string' && info.default_branch ? info.default_branch : 'main' };
    return stateRepoInfo;
  }

  let stateBranchChecked = false;
  async function ensureStateBranch() {
    const info = await ensureStateRepoPrivate();
    if (stateBranchChecked) return;
    if (!(await headSha(state, stateBranch))) {
      const sourceBranch = sameRepo ? publishBranch : info.defaultBranch;
      const source = await headSha(state, sourceBranch);
      if (!source) throw new GithubError(404, `Branch ${sourceBranch} in ${stateRepoName} nicht gefunden (ein leeres Repo braucht zuerst einen Commit, z. B. eine README)`);
      // 422 = created concurrently by another invocation: fine.
      await gh(state, 'POST', '/git/refs', { body: { ref: `refs/heads/${stateBranch}`, sha: source }, okStatuses: [422] });
    }
    stateBranchChecked = true;
  }

  async function putFile(path, bytes, { sha, message }) {
    const res = await gh(state, 'PUT', `/contents/${encodePath(path)}`, {
      body: {
        message,
        content: Buffer.from(bytes).toString('base64'),
        branch: stateBranch,
        committer,
        ...(sha ? { sha } : {}),
      },
      okStatuses: [409, 422],
    });
    if (res.status === 409 || res.status === 422) return null;
    return (await res.json()).content.sha;
  }

  /** public/data/content.json at a branch or commit, parsed; null when it is missing or unreadable. */
  async function contentAt(ref) {
    const res = await gh(site, 'GET', `/contents/${CONTENT_PATH}?ref=${encodeURIComponent(ref)}`, { raw: true, okStatuses: [404] });
    if (res.status === 404) return null;
    try { return JSON.parse(await res.text()); } catch { return null; }
  }

  return {
    async getPublished() {
      const res = await gh(site, 'GET', `/contents/${CONTENT_PATH}?ref=${encodeURIComponent(publishBranch)}`, { raw: true });
      return JSON.parse(await res.text());
    },

    /** Read only: never creates the branch (the preview endpoint uses this path). */
    async readState() {
      const res = await gh(state, 'GET', `/contents/${STATE_PATH}?ref=${encodeURIComponent(stateBranch)}`, { okStatuses: [404] });
      if (res.status === 404) return { state: null, rev: null };
      const file = await res.json();
      let text;
      if (file.content && file.encoding === 'base64') {
        text = Buffer.from(file.content, 'base64').toString('utf8');
      } else {
        // Files over 1 MB come back without inline content: fetch the blob.
        const blob = await gh(state, 'GET', `/git/blobs/${file.sha}`, { raw: true });
        text = await blob.text();
      }
      return { state: JSON.parse(text), rev: file.sha };
    },

    async writeState(next, rev) {
      await ensureStateBranch();
      const sha = await putFile(STATE_PATH, Buffer.from(`${JSON.stringify(next, null, 1)}\n`, 'utf8'), {
        sha: rev || undefined,
        message: 'state',
      });
      if (!sha) throw new StateConflictError();
      return sha;
    },

    async putDraftImage(name, bytes) {
      if (!IMAGE_NAME_RE.test(name)) throw new Error('ungültiger Bildname');
      await ensureStateBranch();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const sha = await putFile(`${DRAFT_DIR}/${name}`, bytes, { message: `draft image ${name}` });
        if (sha) return;
        await sleep(retryDelayMs * (attempt + 1));
      }
      throw new GithubError(409, 'Entwurfsbild konnte nicht gespeichert werden');
    },

    async getDraftImage(name) {
      if (!IMAGE_NAME_RE.test(name)) return null;
      const res = await gh(state, 'GET', `/contents/${DRAFT_DIR}/${name}?ref=${encodeURIComponent(stateBranch)}`, { raw: true, okStatuses: [404] });
      if (res.status === 404) return null;
      return Buffer.from(await res.arrayBuffer());
    },

    async removeDraftImages(names) {
      for (const name of names) {
        if (!IMAGE_NAME_RE.test(name)) continue;
        try {
          const res = await gh(state, 'GET', `/contents/${DRAFT_DIR}/${name}?ref=${encodeURIComponent(stateBranch)}`, { okStatuses: [404] });
          if (res.status === 404) continue;
          const { sha } = await res.json();
          await gh(state, 'DELETE', `/contents/${DRAFT_DIR}/${name}`, {
            body: { message: `remove draft image ${name}`, sha, branch: stateBranch, committer },
            okStatuses: [404, 409, 422],
          });
        } catch { /* best effort: a leftover draft image is harmless */ }
      }
    },

    /**
     * One commit on the publish branch: public/data/content.json plus new images.
     * images[].path is the URL path (assets/uploads/<name>.webp); the file is
     * written to SITE_REPO_DIR + path.
     * expected: the content the caller believes is published. It is compared
     * with public/data/content.json at the very head the commit is built on, on every
     * attempt, so a push that lands in between is never overwritten:
     * the result is then { commit: null, changed: false, moved: true }.
     */
    async publish({ content, images = [], message, expected }) {
      const entries = [];
      const contentBlob = await (await gh(site, 'POST', '/git/blobs', {
        body: { content: `${JSON.stringify(content, null, 2)}\n`, encoding: 'utf-8' },
      })).json();
      entries.push({ path: CONTENT_PATH, mode: '100644', type: 'blob', sha: contentBlob.sha });
      for (const image of images) {
        const blob = await (await gh(site, 'POST', '/git/blobs', {
          body: { content: Buffer.from(image.bytes).toString('base64'), encoding: 'base64' },
        })).json();
        entries.push({ path: SITE_REPO_DIR + image.path, mode: '100644', type: 'blob', sha: blob.sha });
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const head = await headSha(site, publishBranch);
        if (!head) throw new GithubError(404, `Branch ${publishBranch} nicht gefunden`);
        if (expected !== undefined) {
          const current = await contentAt(head);
          if (current === null || canonical(current) !== canonical(expected)) return { commit: null, changed: false, moved: true };
        }
        const headCommit = await (await gh(site, 'GET', `/git/commits/${head}`)).json();
        const tree = await (await gh(site, 'POST', '/git/trees', {
          body: { base_tree: headCommit.tree.sha, tree: entries },
        })).json();
        if (tree.sha === headCommit.tree.sha) return { commit: null, changed: false, moved: false };
        const commit = await (await gh(site, 'POST', '/git/commits', {
          // No author/committer: GitHub uses the token owner, so Vercel accepts the commit author.
          body: { message, tree: tree.sha, parents: [head] },
        })).json();
        const moved = await gh(site, 'PATCH', `/git/refs/heads/${encodePath(publishBranch)}`, {
          body: { sha: commit.sha, force: false },
          okStatuses: [409, 422],
        });
        if (moved.ok) return { commit: commit.sha, changed: true, moved: false };
        // Head moved in between (developer pushed): look again at the new head.
        await sleep(retryDelayMs * (attempt + 1));
      }
      throw new GithubError(409, 'Veröffentlichen fehlgeschlagen: der Branch hat sich mehrfach geändert');
    },
  };
}
