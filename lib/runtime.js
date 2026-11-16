// Wires the real dependencies from environment variables (Vercel functions).
// Nothing here runs at import time, so a missing variable never breaks a cold start.

import Anthropic from '@anthropic-ai/sdk';
import { createConversation } from './conversation.js';
import { processImage } from './image.js';
import { createClaudeModel } from './model.js';
import { createGithubStore } from './store-github.js';
import { parseAllowedNumbers } from './webhook.js';
import { createWhatsApp } from './whatsapp.js';

export const ENV_NAMES = [
  'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
  'WA_ALLOWED_NUMBERS', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO', 'SITE_URL',
];

export function log(event, data = {}) {
  // One JSON line per event; never log message texts or secrets here.
  console.log(JSON.stringify({ event, ...data }));
}

export function missingEnv(env = process.env, names = ENV_NAMES) {
  return names.filter((name) => !env[name]);
}

/**
 * The private state (phone numbers, message texts, drafts) goes to
 * GITHUB_STATE_REPO when set, otherwise to GITHUB_REPO. Either way the store
 * refuses to write state into a repo that is not private.
 */
export function createStore(env = process.env) {
  return createGithubStore({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, stateRepo: env.GITHUB_STATE_REPO || '' });
}

/** Key for the MAC inside preview tokens: PREVIEW_SECRET, or else the Meta app secret. */
export function previewSecret(env = process.env) {
  return env.PREVIEW_SECRET || env.WHATSAPP_APP_SECRET || '';
}

let cached = null;

/** Returns { handleMessage, allowedNumbers } built from the environment. */
export function getRuntime(env = process.env) {
  if (cached) return cached;
  const missing = missingEnv(env);
  if (missing.length) throw new Error(`Umgebungsvariablen fehlen: ${missing.join(', ')}`);
  if (!/^https:\/\/[^\s/]+/.test(env.SITE_URL)) throw new Error('SITE_URL muss mit https:// beginnen');

  const allowedNumbers = parseAllowedNumbers(env.WA_ALLOWED_NUMBERS);
  const sender = createWhatsApp({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  });
  // The SDK reads ANTHROPIC_API_KEY from the environment.
  const client = new Anthropic({ maxRetries: 1, timeout: 20_000 });
  const conversation = createConversation({
    store: createStore(env),
    sender,
    model: createClaudeModel({ client, log }),
    processImage,
    clock: () => new Date(),
    previewSecret: previewSecret(env),
    config: {
      siteUrl: env.SITE_URL,
      developerName: env.DEVELOPER_NAME || 'die Entwickler',
      allowedNumbers,
      mirrorNumber: env.WA_MIRROR_NUMBER || '',
    },
    log,
  });
  cached = { handleMessage: conversation.handleMessage, allowedNumbers };
  return cached;
}
