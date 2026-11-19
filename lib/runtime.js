// Wires the real dependencies from environment variables (Vercel functions).
// Nothing here runs at import time, so a missing variable never breaks a cold start.

import Anthropic from '@anthropic-ai/sdk';
import { createConversation } from './conversation.js';
import { processImage } from './image.js';
import { createClaudeModel } from './model.js';
import { createGithubStore } from './store-github.js';
import { createTelegram } from './telegram.js';
import { createTwilioWhatsApp } from './twilio.js';
import { parseAllowedIds } from './telegram-webhook.js';
import { parseAllowedNumbers } from './webhook.js';
import { createWhatsApp } from './whatsapp.js';

const SHARED_ENV_NAMES = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO', 'SITE_URL'];

/** What the WhatsApp path needs. */
export const ENV_NAMES = [
  'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
  'WA_ALLOWED_NUMBERS', ...SHARED_ENV_NAMES,
];

/** What the Telegram path needs. No WhatsApp variable is among them. */
export const TELEGRAM_ENV_NAMES = [
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_ALLOWED_IDS', ...SHARED_ENV_NAMES,
];

/** WhatsApp through Twilio: no Meta variable is among them. */
export const TWILIO_ENV_NAMES = [
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'WA_ALLOWED_NUMBERS', ...SHARED_ENV_NAMES,
];

export const envNames = (channel = 'whatsapp') => (
  channel === 'telegram' ? TELEGRAM_ENV_NAMES : channel === 'twilio' ? TWILIO_ENV_NAMES : ENV_NAMES
);

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

/**
 * Key for the MAC inside preview tokens. First one that is set:
 * PREVIEW_SECRET, the Meta app secret, the Telegram webhook secret.
 * Used both where tokens are signed (getRuntime) and where they are checked
 * (api/vorschau.js), so the two always agree.
 */
export function previewSecret(env = process.env) {
  return env.PREVIEW_SECRET || env.WHATSAPP_APP_SECRET || env.TELEGRAM_WEBHOOK_SECRET || '';
}

const cached = new Map();

/**
 * Returns { handleMessage, allowedNumbers } built from the environment.
 * channel: 'whatsapp' (default) or 'telegram' - decides which client sends the
 * replies and loads the photos, and which variables are required.
 */
export function getRuntime(env = process.env, { channel = 'whatsapp' } = {}) {
  if (!['whatsapp', 'telegram', 'twilio'].includes(channel)) throw new Error(`Unbekannter Kanal: ${channel}`);
  // Only the real environment is cached (one runtime per channel and instance).
  const useCache = env === process.env;
  if (useCache && cached.has(channel)) return cached.get(channel);
  const missing = missingEnv(env, envNames(channel));
  if (missing.length) throw new Error(`Umgebungsvariablen fehlen: ${missing.join(', ')}`);
  if (!/^https:\/\/[^\s/]+/.test(env.SITE_URL)) throw new Error('SITE_URL muss mit https:// beginnen');

  const telegram = channel === 'telegram';
  const allowedNumbers = telegram ? parseAllowedIds(env.TELEGRAM_ALLOWED_IDS) : parseAllowedNumbers(env.WA_ALLOWED_NUMBERS);
  let sender;
  if (telegram) sender = createTelegram({ token: env.TELEGRAM_BOT_TOKEN });
  else if (channel === 'twilio') {
    sender = createTwilioWhatsApp({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_WHATSAPP_FROM });
  } else sender = createWhatsApp({ accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID });
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
  const conversation = createConversation({
    store: createStore(env),
    sender,
    model: createClaudeModel({ client, log }),
    processImage,
    clock: () => new Date(),
    previewSecret: previewSecret(env),
    config: {
      // Twilio is WhatsApp for the conversation: same sender keys (plain numbers), same wording.
      channel: telegram ? 'telegram' : 'whatsapp',
      siteUrl: env.SITE_URL,
      developerName: env.DEVELOPER_NAME || 'die Entwickler',
      allowedNumbers,
      // Copies to a second number exist on WhatsApp only.
      mirrorNumber: telegram ? '' : env.WA_MIRROR_NUMBER || '',
    },
    log,
  });
  const runtime = { handleMessage: conversation.handleMessage, allowedNumbers };
  if (useCache) cached.set(channel, runtime);
  return runtime;
}
