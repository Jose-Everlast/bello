// In-memory store with the same interface as store-github.js.
// Used by the tests and by tools/wa-sim.mjs.
//
// Store interface:
//   getPublished()                      -> content object (public/data/content.json on master)
//   readState()                         -> { state, rev }   (state may be null on first use)
//   writeState(state, rev)              -> new rev; throws StateConflictError if rev is stale
//   putDraftImage(name, bytes)          -> void
//   getDraftImage(name)                 -> Buffer | null
//   removeDraftImages(names)            -> void (best effort)
//   publish({ content, images, message, expected }) -> { commit, changed, moved }
//       images: [{ path: 'assets/uploads/<name>.webp', bytes: Buffer }]  (URL path)
//       exactly one commit on master containing public/data/content.json and the
//       images at SITE_REPO_DIR + path (repo paths)
//       expected (optional): the content the caller believes is published; if master
//       holds something else nothing is written and moved is true

import { SITE_REPO_DIR } from './content.js';

export class StateConflictError extends Error {
  constructor(message = 'state changed concurrently') {
    super(message);
    this.name = 'StateConflictError';
  }
}

export function createMemoryStore({ content, state = null } = {}) {
  let published = structuredClone(content);
  let stateJson = state ? JSON.stringify(state) : null;
  let rev = 0;
  const drafts = new Map();
  const files = new Map(); // published image files, by repo path
  const commits = [];
  let failNextWrites = 0;
  let skipWrites = 0;
  const hooks = { beforePublish: null };

  return {
    async getPublished() {
      return structuredClone(published);
    },
    async readState() {
      return { state: stateJson ? JSON.parse(stateJson) : null, rev: String(rev) };
    },
    async writeState(next, expectedRev) {
      if (skipWrites > 0) {
        skipWrites -= 1;
      } else if (failNextWrites > 0) {
        failNextWrites -= 1;
        rev += 1; // someone else wrote in between
        throw new StateConflictError();
      }
      if (String(expectedRev) !== String(rev)) throw new StateConflictError();
      stateJson = JSON.stringify(next);
      rev += 1;
      return String(rev);
    },
    async putDraftImage(name, bytes) {
      drafts.set(name, Buffer.from(bytes));
    },
    async getDraftImage(name) {
      return drafts.has(name) ? Buffer.from(drafts.get(name)) : null;
    },
    async removeDraftImages(names) {
      for (const name of names) drafts.delete(name);
    },
    async publish({ content: next, images = [], message, expected }) {
      if (hooks.beforePublish) { const hook = hooks.beforePublish; hooks.beforePublish = null; hook(); }
      if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(published)) {
        return { commit: null, changed: false, moved: true };
      }
      const same = JSON.stringify(next) === JSON.stringify(published)
        && images.every((img) => files.has(SITE_REPO_DIR + img.path) && files.get(SITE_REPO_DIR + img.path).equals(img.bytes));
      if (same) return { commit: null, changed: false, moved: false };
      published = structuredClone(next);
      for (const img of images) files.set(SITE_REPO_DIR + img.path, Buffer.from(img.bytes));
      const commit = { id: `mem-${commits.length + 1}`, message, paths: [`${SITE_REPO_DIR}data/content.json`, ...images.map((i) => SITE_REPO_DIR + i.path)] };
      commits.push(commit);
      return { commit: commit.id, changed: true, moved: false };
    },

    // Test helpers (not part of the interface).
    commits,
    files,
    drafts,
    peekState() { return stateJson ? JSON.parse(stateJson) : null; },
    /** The next n writes fail with a conflict; `after` writes before that succeed normally. */
    conflictOnNextWrites(n = 1, { after = 0 } = {}) { failNextWrites = n; skipWrites = after; },
    /** Simulates a push by someone else: replaces the published content without a bot commit. */
    setPublished(next) { published = structuredClone(next); },
    hooks,
  };
}
