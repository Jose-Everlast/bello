// Conversation logic. Pure orchestration: every side effect goes through the
// injected dependencies.
//
// deps = {
//   store,          // see lib/store-memory.js for the interface
//   sender,         // { sendText(to, text), downloadMedia(mediaId) -> { bytes, mimeType } }
//   model,          // async (input) => { ok, intent, reply, forward, operations } | { ok:false, reason }
//   processImage,   // async (Buffer) => { bytes, mimeType }   (lib/image.js)
//   clock,          // () => Date
//   config: { siteUrl, developerName, allowedNumbers: Set<string>, mirrorNumber,
//             channel },  // 'whatsapp' (default) or 'telegram'
//   previewSecret,  // optional: preview tokens then carry a MAC (lib/preview.js)
//   randomHex,      // optional (bytes) => hex string, for tests
//   log,            // optional (event, data) => void
// }
//
// msg = { id, from, userId, timestamp, type, text, mediaId, caption }
//       (see lib/webhook.js and lib/telegram-webhook.js)
//
// Both channels share one state. Senders are kept apart in it by their key:
// a WhatsApp sender is its phone number in digits, a Telegram sender is
// "tg:<user id>". The key is what is stored (contacts, notes, open question);
// the bare digits are what the allowlist holds and what the sender client gets.

import { createHash, randomBytes } from 'node:crypto';
import { parseCommand } from './commands.js';
import { UPLOAD_DIR, berlinToday, berlinWeekday, validateContent } from './content.js';
import { cleanReply } from './model.js';
import { applyOperations } from './ops.js';
import { createPreviewToken } from './preview.js';
import { StateConflictError } from './store-memory.js';

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const PHOTO_TTL_MS = 24 * 60 * 60 * 1000;
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const STALE_MS = 10 * 60 * 1000;
export const QUESTION_TTL_MS = 30 * 60 * 1000;
export const MAX_HISTORY = 10;
export const MAX_NOTES = 50;
export const MAX_SEEN = 300;
export const MAX_MESSAGE_CHARS = 2000;
export const CHANGE_LIST_BUDGET = 2400;
const WRITE_ATTEMPTS = 4;

export const CONFIRM_LINE = 'Antworte JA zum Veröffentlichen oder NEIN zum Verwerfen.';
const MOVED_REPLY = 'Die Seite wurde inzwischen an anderer Stelle geändert, deshalb habe ich den Entwurf verworfen. Bitte schick mir die Änderung nochmal.';
const NOT_UNDERSTOOD = 'Das habe ich nicht richtig verstanden. Bitte schreib es nochmal etwas anders, am besten mit dem Namen wie auf der Karte. Es wurde nichts geändert.';

const digits = (value) => String(value ?? '').replace(/\D/g, '');
const TELEGRAM_PREFIX = 'tg:';
/** Sender key -> the address the channel's client understands. */
const bare = (key) => (key.startsWith(TELEGRAM_PREFIX) ? key.slice(TELEGRAM_PREFIX.length) : key);
/** Sender key -> how it is shown in notes and copies. */
const senderLabel = (key) => (String(key).startsWith(TELEGRAM_PREFIX) ? `Telegram ${bare(String(key))}` : `+${key}`);
const hashContent =(content) => createHash('sha256').update(JSON.stringify(content)).digest('hex');

/**
 * Bullet list that never grows past `budget` characters (the first line is
 * always kept), so that what follows it - preview link, JA/NEIN line - always
 * fits into one message (WhatsApp and Telegram both allow 4096 characters).
 */
export function bullets(lines, budget = CHANGE_LIST_BUDGET) {
  const out = [];
  let used = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = `• ${lines[i]}`;
    if (out.length && used + line.length + 1 > budget) {
      const rest = lines.length - i;
      out.push(`… und ${rest} weitere ${rest === 1 ? 'Änderung' : 'Änderungen'}`);
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

function berlinDateTime(iso) {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export function emptyState() {
  return { version: 1, draft: null, pendingPhoto: null, pendingQuestion: null, history: [], notes: [], seen: [], contacts: {} };
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const base = emptyState();
  const object = (value) => (value && typeof value === 'object' ? value : null);
  return {
    version: 1,
    draft: object(state.draft),
    pendingPhoto: object(state.pendingPhoto),
    pendingQuestion: object(state.pendingQuestion),
    history: Array.isArray(state.history) ? state.history : base.history,
    notes: Array.isArray(state.notes) ? state.notes : base.notes,
    seen: Array.isArray(state.seen) ? state.seen : base.seen,
    contacts: object(state.contacts) || base.contacts,
  };
}

export function helpText(developerName) {
  return [
    'So geht es:',
    '• Schreib mir einfach, was sich ändern soll, z. B. „Bellogroni kostet jetzt 12 €“, „Polpette sind aus“, „Polpette sind wieder da“ oder „Neu bei Focaccia: Trüffel, 12 €“.',
    '• Für ein Special schick ein Foto und schreib dazu, was es ist und bis wann es gilt.',
    '• Ich schicke dir einen Vorschau-Link. JA veröffentlicht, NEIN verwirft.',
    '• Mit „direkt:“ am Anfang (z. B. „direkt: Polpette sind aus“) geht es ohne Vorschau sofort online.',
    '• RÜCKGÄNGIG stellt den Stand vor der letzten Veröffentlichung wieder her.',
    '• STATUS zeigt, ob ein Entwurf offen ist und was gerade ausgeblendet ist.',
    `Wünsche zu Aussehen oder neuen Funktionen kann ich nicht selbst umsetzen; die notiere ich für ${developerName}.`,
  ].join('\n');
}

function modelFailureReply(reason, developerName) {
  if (reason === 'timeout' || reason === 'unavailable') {
    return 'Ich komme gerade nicht weiter, der Textdienst antwortet nicht. Bitte versuch es in ein paar Minuten nochmal. Es wurde nichts geändert.';
  }
  if (reason === 'config') {
    return `Es gibt ein technisches Problem, das ich nicht selbst lösen kann. Bitte sag ${developerName} Bescheid. Es wurde nichts geändert.`;
  }
  return 'Das konnte ich nicht verarbeiten. Bitte schreib es nochmal etwas anders. Es wurde nichts geändert.';
}

export function createConversation(deps) {
  const {
    store, sender, model, processImage,
    clock = () => new Date(),
    randomHex = (bytes) => randomBytes(bytes).toString('hex'),
    log = () => {},
  } = deps;
  const telegram = deps.config?.channel === 'telegram';
  const senderPrefix = telegram ? TELEGRAM_PREFIX : '';
  const channelName = telegram ? 'Telegram' : 'WhatsApp';
  const config = {
    siteUrl: String(deps.config?.siteUrl || '').replace(/\/+$/, ''),
    developerName: deps.config?.developerName || 'die Entwickler',
    allowedNumbers: deps.config?.allowedNumbers instanceof Set
      ? deps.config.allowedNumbers
      : new Set([...(deps.config?.allowedNumbers || [])].map(digits).filter(Boolean)),
    // The copy to a second number is a WhatsApp feature (it depends on Meta's 24 h window).
    mirrorNumber: telegram ? '' : digits(deps.config?.mirrorNumber),
  };
  const previewSecret = deps.previewSecret || '';

  const previewUrl = (token) => `${config.siteUrl}/?vorschau=${token}`;
  const reminder = (state) => (state.draft ? `\nDein Entwurf ist noch offen. ${CONFIRM_LINE}` : '');

  function addNote(state, number, text, now) {
    state.notes.push({ at: now.toISOString(), from: number, text: String(text).slice(0, 1000) });
    if (state.notes.length > MAX_NOTES) state.notes = state.notes.slice(-MAX_NOTES);
  }

  /** True while a copy of this exchange really reaches the developer (see mirror()). */
  function mirrorOpen(state, number, now) {
    const target = config.mirrorNumber;
    if (!target || target === number) return false;
    const lastAt = Date.parse(state.contacts[target]?.lastAt || '');
    return Number.isFinite(lastAt) && now.getTime() - lastAt < WINDOW_MS;
  }

  /** What the owner is told about a wish the bot cannot carry out. Only promises what happens. */
  function forwardLine(state, number, now, what = 'Das') {
    if (mirrorOpen(state, number, now)) return `${what} gebe ich an ${config.developerName} weiter.`;
    if (config.mirrorNumber && config.mirrorNumber === number) {
      return `${what} kann ich nicht selbst ändern. Ich habe es notiert (NOTIZEN zeigt die Liste).`;
    }
    return `${what} kann ich nicht selbst ändern. Ich habe es für ${config.developerName} notiert. Bitte gib kurz Bescheid, dass dort etwas steht.`;
  }

  /** Drops an expired draft / photo / question. Returns what expired. */
  function expire(state, now, out) {
    const expired = { draft: false, photo: false };
    if (state.draft && Date.parse(state.draft.expiresAt) <= now.getTime()) {
      out.cleanup.push(...(state.draft.images || []));
      state.draft = null;
      expired.draft = true;
    }
    if (state.pendingPhoto && Date.parse(state.pendingPhoto.at) + PHOTO_TTL_MS <= now.getTime()) {
      out.cleanup.push(state.pendingPhoto.name);
      state.pendingPhoto = null;
      expired.photo = true;
    }
    if (state.pendingQuestion && !(Date.parse(state.pendingQuestion.at) + QUESTION_TTL_MS > now.getTime())) {
      state.pendingQuestion = null;
    }
    return expired;
  }

  /** The unanswered question to this sender, if any. */
  function openQuestion(state, number) {
    const q = state.pendingQuestion;
    return q && q.from === number && typeof q.text === 'string' && typeof q.reply === 'string' ? q : null;
  }

  function draftReply(draft, { lead = '', extra = [] } = {}) {
    const many = draft.changes.length > 1;
    return [
      ...(lead ? [lead] : []),
      many ? 'Entwurf (alle offenen Änderungen):' : 'Entwurf:',
      bullets(draft.changes),
      '',
      `Vorschau: ${previewUrl(draft.token)}`,
      '',
      CONFIRM_LINE,
      ...(extra.length ? ['', ...extra] : []),
    ].join('\n');
  }

  const visitHint = (published) => (published
    ? `Im Info-Video und in der Google-Beschreibung stehen noch die alten Angaben. Das habe ich für ${config.developerName} notiert.`
    : `Hinweis: Im Info-Video und in der Google-Beschreibung stehen dann noch die alten Angaben. Das notiere ich beim Veröffentlichen für ${config.developerName}.`);

  /**
   * Publishes state.draft as one commit. Returns { ok, reply }.
   * After a successful publish, out.done holds the reply and a function that
   * re-applies the bookkeeping (history, draft removal) to a freshly read
   * state. The retry loop in handleMessage uses it instead of running the
   * whole reaction - and with it the publish - a second time.
   */
  async function publishDraft(state, number, now, out) {
    const draft = state.draft;
    const drop = () => {
      out.cleanup.push(...(draft.images || []));
      state.draft = null;
    };
    const draftHash = hashContent(draft.content);
    if (draftHash === draft.baseHash) {
      drop();
      return { ok: false, reply: 'Das steht schon so auf der Seite, es wurde nichts veröffentlicht.' };
    }
    const published = await store.getPublished();
    const publishedHash = hashContent(published);
    const alreadyLive = publishedHash === draftHash;
    if (!alreadyLive && publishedHash !== draft.baseHash) {
      drop();
      return { ok: false, reply: MOVED_REPLY };
    }
    const problems = validateContent(draft.content);
    if (problems.length) {
      drop();
      log('draft_invalid', { problem: problems[0] });
      return { ok: false, reply: 'Der Entwurf war fehlerhaft und wurde verworfen. Bitte schick mir die Änderung nochmal.' };
    }

    /** Bookkeeping after the publish. `previous` = what was live before it. */
    const finish = (previous) => (target) => {
      const last = target.history[target.history.length - 1];
      if (previous && !(last && last.hash === draftHash)) {
        target.history.push({ at: now.toISOString(), content: previous, hash: draftHash, changes: draft.changes });
        if (target.history.length > MAX_HISTORY) target.history = target.history.slice(-MAX_HISTORY);
      }
      if (draft.visitChanged) {
        addNote(target, number, `[System] Öffnungszeiten oder Adresse wurden per ${channelName} geändert. Bitte Info-Video, Meta-Beschreibung in index.html und Google-Eintrag angleichen.`, now);
      }
      out.cleanup.push(...(draft.images || []));
      if (target.draft && target.draft.token === draft.token) target.draft = null;
      target.pendingQuestion = null;
    };
    const reply = [
      'Veröffentlicht:',
      bullets(draft.changes),
      '',
      `In etwa einer Minute live: ${config.siteUrl}/`,
      'Mit RÜCKGÄNGIG nimmst du das wieder zurück.',
      ...(draft.visitChanged ? ['', visitHint(true)] : []),
    ].join('\n');

    if (alreadyLive) {
      // An earlier attempt published this draft but its state write was lost.
      // Record it now, so that RÜCKGÄNGIG takes back this publication.
      finish(draft.baseContent || null)(state);
      return { ok: true, reply };
    }

    const referenced = new Set(draft.content.specials.map((s) => s.image).filter(Boolean));
    const images = [];
    for (const name of draft.images || []) {
      const path = UPLOAD_DIR + name;
      if (!referenced.has(path)) continue;
      const bytes = await store.getDraftImage(name);
      if (!bytes) {
        return { ok: false, reply: 'Das Foto zum Entwurf ist nicht mehr da. Antworte NEIN und schick Foto und Text bitte nochmal.' };
      }
      images.push({ path, bytes });
    }
    const n = draft.changes.length;
    const result = await store.publish({
      content: draft.content,
      images,
      message: `Inhalt per ${channelName}: ${n} ${n === 1 ? 'Änderung' : 'Änderungen'}\n\n${draft.changes.map((c) => `- ${c}`).join('\n')}`.slice(0, 5000),
      expected: published,
    });
    if (result.moved) {
      drop();
      return { ok: false, reply: MOVED_REPLY };
    }
    if (!result.changed) {
      drop();
      return { ok: false, reply: 'Das steht schon so auf der Seite, es wurde nichts veröffentlicht.' };
    }
    const apply = finish(published);
    out.done = { reply, apply };
    apply(state);
    return { ok: true, reply };
  }

  async function onUndo(state, now, out) {
    if (state.draft) {
      return `Es ist noch ein Entwurf offen. ${CONFIRM_LINE} Danach geht RÜCKGÄNGIG.`;
    }
    const entry = state.history[state.history.length - 1];
    if (!entry) return 'Es gibt gerade nichts zum Zurücknehmen.';
    if (validateContent(entry.content).length) {
      state.history.pop();
      return 'Der gespeicherte frühere Stand ist fehlerhaft, ich habe nichts geändert.';
    }
    const refused = 'Die Seite wurde inzwischen an anderer Stelle geändert, RÜCKGÄNGIG geht hier nicht. Schreib mir, was zurück soll.';
    // Only take back what the bot itself published: master must still hold exactly that.
    const published = await store.getPublished();
    if (entry.hash && hashContent(published) !== entry.hash) return refused;
    const result = await store.publish({
      content: entry.content, images: [], message: `Inhalt per ${channelName}: Rückgängig`, expected: published,
    });
    if (result.moved) return refused;
    const apply = (target) => {
      const index = target.history.findLastIndex((h) => h.at === entry.at && h.hash === entry.hash);
      if (index !== -1) target.history.splice(index, 1);
    };
    apply(state);
    const changes = Array.isArray(entry.changes) ? entry.changes.filter((c) => typeof c === 'string') : [];
    const lines = changes.length
      ? [`Rückgängig gemacht. Zurückgenommen ist die Veröffentlichung vom ${berlinDateTime(entry.at)} Uhr:`, bullets(changes), '']
      : [`Rückgängig gemacht. Die Seite zeigt wieder den Stand von vor der Veröffentlichung am ${berlinDateTime(entry.at)} Uhr.`];
    lines.push(`In etwa einer Minute live: ${config.siteUrl}/`);
    if (state.history.length) lines.push('Nochmal RÜCKGÄNGIG geht einen weiteren Schritt zurück.');
    const reply = lines.join('\n');
    if (result.changed) out.done = { reply, apply };
    return reply;
  }

  async function statusReply(state) {
    const lines = [];
    if (state.draft) {
      lines.push('Offener Entwurf:', bullets(state.draft.changes), '',
        `Vorschau: ${previewUrl(state.draft.token)}`,
        `Gültig bis ${berlinDateTime(state.draft.expiresAt)} Uhr.`, '', CONFIRM_LINE);
    } else {
      lines.push('Kein offener Entwurf. Die Seite zeigt den veröffentlichten Stand.');
    }
    if (state.pendingPhoto) lines.push('', 'Ein Foto wartet noch darauf, dass du mir schreibst, wofür es ist.');
    let content = state.draft ? state.draft.content : null;
    if (!content) {
      try { content = await store.getPublished(); } catch (err) { log('status_error', { message: String(err?.message || err).slice(0, 300) }); }
    }
    const hidden = (content?.menu || []).flatMap((tab) => tab.sections.flatMap((s) => s.items)).filter((item) => item.hidden === true).map((item) => item.name);
    if (hidden.length) {
      lines.push('', `Gerade ausgeblendet${state.draft ? ' (im Entwurf)' : ''}: ${hidden.join(', ').slice(0, 800)}.`,
        `Zurückholen mit z. B. „${hidden[0]} wieder da“.`);
    }
    return lines.join('\n');
  }

  function notesReply(state) {
    if (!state.notes.length) return 'Keine Notizen für die Entwicklung.';
    return ['Notizen für die Entwicklung:',
      ...state.notes.slice(-15).map((n) => `• ${berlinDateTime(n.at)} (${senderLabel(n.from)}): ${n.text}`)].join('\n').slice(0, 3800)
      + '\n\nMit NOTIZEN LEEREN löschst du die Liste.';
  }

  async function onEdit(state, number, text, direct, now, out, { imageBytes = null, photoIsNew = false } = {}) {
    if (text.length > MAX_MESSAGE_CHARS) {
      return `Die Nachricht ist zu lang. Bitte teil sie in kleinere Nachrichten auf.${reminder(state)}`;
    }
    const hadDraft = Boolean(state.draft);
    const published = hadDraft ? null : await store.getPublished();
    const base = hadDraft ? state.draft.content : published;

    let image = null;
    if (state.pendingPhoto) {
      const bytes = imageBytes || await store.getDraftImage(state.pendingPhoto.name);
      if (bytes) image = { base64: Buffer.from(bytes).toString('base64'), mediaType: 'image/webp' };
      else state.pendingPhoto = null;
    }

    const today = berlinToday(now);
    const question = openQuestion(state, number);
    // One model call per message, also when the state write is retried.
    if (out.modelResult === undefined) {
      try {
        out.modelResult = await model({
          text, content: base, image, today, weekday: berlinWeekday(now),
          hasPhoto: Boolean(state.pendingPhoto), draftPending: hadDraft,
          previous: question ? { text: question.text, reply: question.reply } : null,
        });
      } catch (err) {
        log('model_throw', { message: String(err?.message || err).slice(0, 300) });
        out.modelResult = { ok: false, reason: 'unavailable' };
      }
    }
    const result = out.modelResult;
    if (!result || result.ok !== true) {
      const reason = result?.reason || 'invalid_json';
      if (reason === 'config') addNote(state, number, '[System] Modellaufruf fehlgeschlagen (Konfiguration prüfen: ANTHROPIC_API_KEY, Modell, Schema).', now);
      return `${modelFailureReply(reason, config.developerName)}${reminder(state)}`;
    }

    // The whole request so far, so that a second short answer still has its context.
    const requestSoFar = (question ? `${question.text}\n${text}` : text).slice(-1000);
    const ask = (reply) => { state.pendingQuestion = { from: number, text: requestSoFar, reply, at: now.toISOString() }; };
    state.pendingQuestion = null;

    const photoHint = photoIsNew ? '\nDas Foto habe ich gespeichert, aber noch nicht verwendet.' : '';

    if (result.intent === 'out_of_scope') {
      addNote(state, number, text, now);
      return `${forwardLine(state, number, now)}${photoHint}${reminder(state)}`;
    }
    if (result.intent === 'question' || result.intent === 'unclear') {
      const fallback = result.intent === 'question'
        ? 'Das kann ich leider nicht beantworten.'
        : 'Das habe ich nicht verstanden. Was genau soll sich ändern?';
      const reply = cleanReply(result.reply) || fallback;
      if (result.intent === 'unclear') ask(reply);
      return `${reply}${photoHint}${reminder(state)}`;
    }

    // intent "edit": only the closed operation set, validated and applied by code.
    const applied = applyOperations(base, result.operations, {
      today,
      pendingPhoto: state.pendingPhoto ? state.pendingPhoto.name : null,
    });
    if (!applied.ok) {
      if (applied.internal) {
        log('op_error', { message: String(applied.error).slice(0, 300) });
        return `${NOT_UNDERSTOOD}${photoHint}${reminder(state)}`;
      }
      if (/\?/.test(applied.error)) ask(applied.error);
      return `Das konnte ich so nicht übernehmen: ${applied.error}\nEs wurde nichts geändert.${photoHint}${reminder(state)}`;
    }

    const draft = state.draft || {
      token: createPreviewToken(previewSecret, randomHex),
      createdAt: now.toISOString(),
      baseHash: hashContent(published),
      baseContent: published,
      changes: [],
      images: [],
    };
    draft.content = applied.content;
    draft.changes = [...draft.changes, ...applied.changes];
    draft.expiresAt = new Date(now.getTime() + DRAFT_TTL_MS).toISOString();
    if (applied.textKeys.some((key) => key.startsWith('visit.'))) draft.visitChanged = true;
    const usedPhoto = applied.usedPhoto && state.pendingPhoto ? state.pendingPhoto.name : null;
    if (usedPhoto) {
      draft.images = [...draft.images, usedPhoto];
      state.pendingPhoto = null;
    }
    state.draft = draft;

    // The changes cancel each other out (e.g. special added and removed again): nothing to confirm.
    if (hashContent(draft.content) === draft.baseHash) {
      out.cleanup.push(...draft.images);
      state.draft = null;
      return hadDraft
        ? 'Damit ist der Entwurf wieder leer. Die Seite bleibt, wie sie ist.'
        : 'Das steht schon genau so auf der Seite. Es wurde nichts geändert.';
    }

    const extra = [...applied.notices];
    if (result.forward) {
      addNote(state, number, text, now);
      extra.push(forwardLine(state, number, now, 'Den Rest'));
    }
    if (photoIsNew && !applied.usedPhoto) extra.push('Das Foto habe ich gespeichert, aber noch nicht verwendet.');

    if (direct && !hadDraft) {
      const outcome = await publishDraft(state, number, now, out);
      const reply = [outcome.reply, ...extra].join('\n');
      if (out.done) {
        const inner = out.done.apply;
        out.done = {
          reply,
          apply(target) {
            inner(target);
            if (result.forward) addNote(target, number, text, now);
            if (usedPhoto && target.pendingPhoto?.name === usedPhoto) target.pendingPhoto = null;
          },
        };
      }
      return reply;
    }
    if (draft.visitChanged) extra.push(visitHint(false));
    return draftReply(draft, {
      // "direkt" never publishes changes the owner has not confirmed.
      lead: direct ? 'Es ist noch ein Entwurf offen, deshalb habe ich nichts direkt veröffentlicht. Die neue Änderung habe ich dazugenommen.\n' : '',
      extra,
    });
  }

  /** Handles one message against a private copy of the state. Returns the reply text. */
  async function react(state, number, msg, prepared, now, out) {
    const expired = expire(state, now, out);

    if (msg.timestamp && now.getTime() - Number(msg.timestamp) * 1000 > STALE_MS) {
      if (prepared?.name) out.cleanup.push(prepared.name);
      return 'Diese Nachricht kam verspätet bei mir an, deshalb habe ich sie nicht ausgeführt. Bitte schick sie nochmal.';
    }

    if (msg.type === 'image') {
      if (prepared.error) return `${prepared.error}${reminder(state)}`;
      if (state.pendingPhoto) out.cleanup.push(state.pendingPhoto.name);
      state.pendingPhoto = { name: prepared.name, at: now.toISOString() };
      const cmd = parseCommand(msg.caption || '');
      if (cmd.type !== 'edit') {
        return `Foto ist angekommen. Wofür ist es? Schreib mir z. B. „Special: Trüffel-Focaccia, 12 €, bis Sonntag“.${reminder(state)}`;
      }
      return onEdit(state, number, cmd.text, cmd.direct, now, out, { imageBytes: prepared.bytes, photoIsNew: true });
    }

    if (msg.type !== 'text') {
      return `Ich verstehe nur Textnachrichten und Fotos. Schreib mir bitte, was sich ändern soll.${reminder(state)}`;
    }

    const cmd = parseCommand(msg.text);
    // A bare "ja" / "nein" with nothing to confirm is the answer to my last question.
    const answersQuestion = openQuestion(state, number) && !state.draft
      && ((cmd.type === 'yes' && !cmd.direct) || (cmd.type === 'no' && !state.pendingPhoto));
    if (answersQuestion) return onEdit(state, number, msg.text.trim(), false, now, out);

    switch (cmd.type) {
      case 'empty':
      case 'help':
        return `${helpText(config.developerName)}${reminder(state)}`;
      case 'status':
        return statusReply(state);
      case 'notes':
        return notesReply(state);
      case 'notes_clear': {
        if (config.mirrorNumber && config.mirrorNumber !== number) return `Die Notizen kann nur ${config.developerName} leeren.`;
        const n = state.notes.length;
        state.notes = [];
        return n ? `Notizen geleert (${n}).` : 'Es gab keine Notizen.';
      }
      case 'direct_only':
        return `Schreib hinter „direkt:“, was sich ändern soll, z. B. „direkt: Polpette sind aus“. Dann geht es ohne Vorschau online.${reminder(state)}`;
      case 'yes':
        if (!state.draft) {
          return expired.draft
            ? 'Der Entwurf ist nach 24 Stunden abgelaufen. Bitte schick mir die Änderung nochmal.'
            : 'Es gibt keinen offenen Entwurf. Schreib mir, was sich ändern soll.';
        }
        state.pendingQuestion = null;
        return (await publishDraft(state, number, now, out)).reply;
      case 'no': {
        state.pendingQuestion = null;
        if (!state.draft && !state.pendingPhoto) return 'Es gibt keinen offenen Entwurf, es ist nichts zu verwerfen.';
        const hadDraft = Boolean(state.draft);
        const hadPhoto = Boolean(state.pendingPhoto);
        if (hadDraft) out.cleanup.push(...(state.draft.images || []));
        if (hadPhoto) out.cleanup.push(state.pendingPhoto.name);
        state.draft = null;
        state.pendingPhoto = null;
        if (!hadDraft) return 'Das Foto habe ich verworfen. Die Seite bleibt, wie sie ist.';
        return hadPhoto ? 'Verworfen (auch das Foto). Die Seite bleibt, wie sie ist.' : 'Verworfen. Die Seite bleibt, wie sie ist.';
      }
      case 'undo':
        state.pendingQuestion = null;
        return onUndo(state, now, out);
      default:
        return onEdit(state, number, cmd.text, cmd.direct, now, out);
    }
  }

  /** Downloads and converts an incoming photo once, before the state loop. */
  async function prepareImage(msg) {
    try {
      const media = await sender.downloadMedia(msg.mediaId);
      const image = await processImage(media.bytes);
      const name = `foto-${berlinToday(clock()).replace(/-/g, '')}-${randomHex(5)}.webp`;
      await store.putDraftImage(name, image.bytes);
      return { name, bytes: image.bytes };
    } catch (err) {
      const code = err?.code || '';
      log('image_error', { code, message: String(err?.message || err).slice(0, 300) });
      if (code === 'too_large') return { error: 'Das Foto ist zu groß (höchstens 5 MB). Bitte schick es kleiner nochmal.' };
      if (code === 'not_an_image') return { error: 'Das konnte ich nicht als Foto lesen. Bitte schick ein normales Foto (JPG oder PNG).' };
      return { error: 'Das Foto konnte ich gerade nicht laden. Bitte schick es nochmal.' };
    }
  }

  function resolveNumber(state, msg) {
    const from = digits(msg.from);
    if (from) return senderPrefix + from;
    // Sender number omitted (WhatsApp only): look the business-scoped user id up.
    if (!msg.userId || telegram) return '';
    for (const [number, contact] of Object.entries(state.contacts)) {
      if (contact && contact.userId === msg.userId && !number.startsWith(TELEGRAM_PREFIX)) return number;
    }
    return '';
  }

  async function safeSend(to, text) {
    try {
      await sender.sendText(bare(to), text);
      return true;
    } catch (err) {
      log('send_error', { message: String(err?.message || err).slice(0, 300) });
      return false;
    }
  }

  /**
   * Entry point for one incoming message (WhatsApp or Telegram). Never throws.
   * Returns { handled, reason?, reply? }.
   */
  async function handleMessage(msg) {
    let number = '';
    try {
      if (!msg || typeof msg.id !== 'string' || !msg.id) return { handled: false, reason: 'no_id' };
      // A reaction (e.g. a thumbs-up on the draft message) is not a command: say nothing.
      if (msg.type === 'reaction') return { handled: false, reason: 'reaction' };

      // 1. Allowlist + dedupe: claim the message id in the state first.
      let state;
      let rev;
      for (let attempt = 0; ; attempt += 1) {
        const read = await store.readState();
        state = normalizeState(read.state);
        number = resolveNumber(state, msg);
        if (!number || !config.allowedNumbers.has(bare(number))) return { handled: false, reason: 'not_allowed' };
        if (state.seen.includes(msg.id)) return { handled: false, reason: 'duplicate' };
        state.seen = [...state.seen, msg.id].slice(-MAX_SEEN);
        state.contacts[number] = {
          userId: msg.userId || state.contacts[number]?.userId || null,
          lastAt: clock().toISOString(),
        };
        try {
          rev = await store.writeState(state, read.rev);
          break;
        } catch (err) {
          if (!(err instanceof StateConflictError) || attempt >= WRITE_ATTEMPTS - 1) throw err;
        }
      }

      // 2. Work that must happen only once.
      const prepared = msg.type === 'image' ? await prepareImage(msg) : null;

      // 3. React on a copy of the state; on a write conflict re-read and redo.
      //    Side effects that must not repeat (model call, publish) are kept in
      //    `out` across attempts: once something is published (out.done), a
      //    retry only re-applies the bookkeeping to the freshly read state.
      let reply;
      const out = { cleanup: [], done: null, modelResult: undefined };
      for (let attempt = 0; ; attempt += 1) {
        const working = structuredClone(state);
        if (out.done) {
          out.done.apply(working);
          reply = out.done.reply;
        } else {
          out.cleanup = [];
          reply = await react(working, number, msg, prepared, clock(), out);
        }
        try {
          await store.writeState(working, rev);
          state = working;
          break;
        } catch (err) {
          const last = !(err instanceof StateConflictError) || attempt >= WRITE_ATTEMPTS - 1;
          if (last && out.done) {
            // Published, but the bookkeeping could not be stored: the owner must still get the true answer.
            log('state_write_lost', { id: msg.id, message: String(err?.message || err).slice(0, 300) });
            break;
          }
          if (last) throw err;
          const read = await store.readState();
          state = normalizeState(read.state);
          rev = read.rev;
        }
      }

      // 4. Clean up draft images that are no longer referenced, then answer.
      const keep = new Set([...(state.draft?.images || []), state.pendingPhoto?.name].filter(Boolean));
      const remove = [...new Set(out.cleanup)].filter((name) => !keep.has(name));
      if (remove.length) {
        try { await store.removeDraftImages(remove); } catch (err) { log('cleanup_error', { message: String(err?.message || err) }); }
      }
      await safeSend(number, reply);
      await mirror(state, number, msg, reply);
      return { handled: true, reply };
    } catch (err) {
      log('handle_error', { id: msg?.id, name: err?.name, message: String(err?.message || err).slice(0, 500) });
      if (number) {
        await safeSend(number, 'Da ist technisch etwas schiefgegangen. Bitte versuch es gleich nochmal. Wenn es wieder passiert, sag bitte Bescheid.');
      }
      return { handled: false, reason: 'error' };
    }
  }

  /** Best-effort copy to the mirror number, only while its 24 h window is open. */
  async function mirror(state, number, msg, reply) {
    const target = config.mirrorNumber;
    if (!mirrorOpen(state, number, clock())) return;
    const request = msg.type === 'image'
      ? `[Foto]${msg.caption ? ` ${msg.caption}` : ''}`
      : msg.type === 'text' ? msg.text : `[${msg.type}]`;
    await safeSend(target, `Kopie · ${senderLabel(number)} schrieb:\n${String(request).slice(0, 1500)}\n\nAntwort:\n${reply}`.slice(0, 4000));
  }

  return { handleMessage };
}
