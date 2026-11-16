#!/usr/bin/env node
// Local WhatsApp simulator: feeds messages through the same conversation logic
// as the webhook, with the in-memory store. Nothing is written to GitHub,
// WhatsApp or the files of this project.
//
//   node tools/wa-sim.mjs                         interactive
//   node tools/wa-sim.mjs "Negroni 12 €" "JA"     scripted: one message per argument
//
// Inside the prompt:
//   /foto <datei> [Bildunterschrift]   send a photo (JPG/PNG/WebP file)
//   /foto                              send a generated test photo without caption
//   /vorschau                          show what the preview endpoint would return
//   /live                              show the published content (menu as text)
//   /state                             show the stored state (draft, notes, history size)
//   /ende                              quit
// Every command also works with "!" instead of "/" (useful as an argument in Git Bash).
//
// With ANTHROPIC_API_KEY set the real model (claude-haiku-5-5) is called;
// without it a small keyword-based stand-in answers. The stand-in is NOT a
// model: it only understands the few patterns listed in STAND_IN_HELP below
// and asks back for everything else. Free wording ("negroni kostet jetz 12",
// "öffnungszeiten sonntag bis 23 uhr") can only be tried with the real model.

import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createConversation } from '../lib/conversation.js';
import { addDays, isValidDate } from '../lib/content.js';
import { processImage } from '../lib/image.js';
import { createClaudeModel } from '../lib/model.js';
import { handlePreview } from '../lib/preview.js';
import { createMemoryStore } from '../lib/store-memory.js';

const ROOT = new URL('../', import.meta.url);
const NUMBER = '491700000000';
const SITE_URL = (process.env.SITE_URL || 'http://127.0.0.1:8765').replace(/\/+$/, '');

async function loadContent() {
  for (const path of ['data/content.json', 'tests/fixtures/content.json']) {
    try {
      return { content: JSON.parse(await readFile(new URL(path, ROOT), 'utf8')), path };
    } catch { /* try the next one */ }
  }
  throw new Error('Weder data/content.json noch tests/fixtures/content.json gefunden.');
}

// --- keyword stand-in for the model (only used without ANTHROPIC_API_KEY) ---

const blankOp = (partial) => ({
  op: '', id: '', parent_id: '', after_id: '', position: 'end', fields: [], name: '', price: '', text: '',
  note: '', title: '', subtitle: '', hidden: false, photo: 'keep', image_alt: '', from: '', until: '',
  ...partial,
});
const answer = (intent, reply = '', operations = []) => ({ ok: true, intent, reply, forward: false, operations });

export const STAND_IN_HELP = [
  '"<Name wie auf der Karte> <Preis> €"            Preis ändern',
  '"<Name> ist aus" / "<Name> wieder da"            aus- und einblenden',
  '"<Name> entfernen"                               Eintrag löschen',
  '"was kostet <Name>"                              Frage',
  '"Special: <Titel>, <Text>, bis JJJJ-MM-TT"       neues Special (Doppelpunkt nötig; ohne "bis" 7 Tage)',
  '"Special <Titel> raus" / "Special raus"          Special entfernen',
  'Wörter wie Farbe, Design, Schrift, Layout        gilt als Wunsch an die Entwicklung',
];

function fakeModel({ text: current, content, today, hasPhoto, previous }) {
  // An answer to the stand-in's own question is read together with the first message.
  const text = previous ? `${previous.text} ${current}` : current;
  const lower = text.toLowerCase();
  if (/(farbe|blau|rot|grün|gelb|größer|kleiner|design|layout|schrift|logo|hintergrund|button|formular|funktion|animation|video|code|html|css)/.test(lower)) {
    return answer('out_of_scope');
  }

  // "Special … raus": remove it. Only with a colon ("Special: …") a new one is created.
  if (/\bspecial\b/.test(lower) && /(raus|weg|löschen|entfernen|streichen)/.test(lower) && !/special\s*:/.test(lower)) {
    const named = content.specials.filter((s) => lower.includes(s.title.toLowerCase()));
    const hits = named.length ? named : content.specials;
    if (hits.length === 0) return answer('unclear', 'Es gibt gerade kein Special.');
    if (hits.length > 1) return answer('unclear', `Welches Special meinst du: ${hits.slice(0, 6).map((s) => s.title).join(', ')}?`);
    return answer('edit', '', [blankOp({ op: 'remove_special', id: hits[0].id })]);
  }
  const special = /special\s*:\s*([^,]+)(?:,\s*(.*))?$/i.exec(text);
  if (special) {
    const bis = /bis\s+(\d{4}-\d{2}-\d{2})/i.exec(text);
    const until = bis && isValidDate(bis[1]) ? bis[1] : addDays(today, 6);
    const rest = (special[2] || '').replace(/,?\s*bis\s+\d{4}-\d{2}-\d{2}/i, '').trim();
    return answer('edit', '', [blankOp({
      op: 'add_special', title: special[1].trim(), text: rest, until,
      photo: hasPhoto ? 'attach' : 'keep', image_alt: hasPhoto ? `Foto: ${special[1].trim()}` : '',
    })]);
  }

  const items = content.menu.flatMap((tab) => tab.sections.flatMap((section) => section.items));
  let matches = items
    .filter((item) => lower.includes(item.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)
    .slice(0, 1);
  if (matches.length === 0) {
    // No full name in the message: try the first word of each name.
    matches = items.filter((item) => lower.split(/[^a-zäöüß]+/).includes(item.name.toLowerCase().split(/[^a-zäöüß]+/)[0]));
  }
  if (matches.length === 0) {
    return answer('unclear', 'Welchen Eintrag meinst du? (Simulator ohne Modell: Er versteht nur feste Muster mit dem Namen wie auf der Karte, siehe Startmeldung.)');
  }
  if (matches.length > 1) {
    return answer('unclear', `Welchen meinst du: ${matches.slice(0, 6).map((m) => m.name).join(', ')}?`);
  }
  const item = matches[0];
  const price = /(\d+)(?:[.,](\d{1,2}))?\s*(?:€|euro)/i.exec(text);
  if (price) {
    const cents = price[2] ? `,${price[2].padEnd(2, '0')}` : '';
    return answer('edit', '', [blankOp({ op: 'set_item', id: item.id, fields: ['price'], price: `${price[1]}${cents} €` })]);
  }
  if (/(wieder da|wieder zeigen|einblenden)/.test(lower)) {
    return answer('edit', '', [blankOp({ op: 'set_item_hidden', id: item.id, hidden: false })]);
  }
  if (/(ist aus|sind aus|ausblenden|gibt es nicht|gibt es gerade nicht)/.test(lower)) {
    return answer('edit', '', [blankOp({ op: 'set_item_hidden', id: item.id, hidden: true })]);
  }
  if (/(entfernen|löschen|streichen|raus)/.test(lower)) {
    return answer('edit', '', [blankOp({ op: 'remove_item', id: item.id })]);
  }
  if (/(was kostet|wie teuer|preis)/.test(lower)) {
    return answer('question', `${item.name} kostet gerade ${item.price || 'nichts (kein Preis eingetragen)'}.`);
  }
  return answer('unclear', `Was soll sich bei ${item.name} ändern?`);
}

// --- wiring ---------------------------------------------------------------------

async function createRealModel() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ maxRetries: 1, timeout: 20_000 });
  return createClaudeModel({ client, log: (event, data) => console.error(`  [${event}] ${JSON.stringify(data)}`) });
}

function describeMenu(content) {
  const lines = [];
  for (const tab of content.menu) {
    lines.push(`# ${tab.label}`);
    for (const section of tab.sections) {
      lines.push(`  ${section.title}${section.subtitle ? ` – ${section.subtitle}` : ''}`);
      for (const item of section.items) {
        lines.push(`    ${item.hidden ? '(ausgeblendet) ' : ''}${item.name}${item.price ? `  ${item.price}` : ''}`);
      }
    }
  }
  lines.push('# Specials');
  for (const s of content.specials) lines.push(`    ${s.title} (${s.from} bis ${s.until})${s.image ? ` [${s.image}]` : ''}`);
  if (content.specials.length === 0) lines.push('    (keine)');
  return lines.join('\n');
}

async function main() {
  const { content, path } = await loadContent();
  const store = createMemoryStore({ content });
  const useReal = Boolean(process.env.ANTHROPIC_API_KEY);
  const model = useReal ? await createRealModel() : async (input) => fakeModel(input);
  const media = new Map();
  let counter = 0;

  const conversation = createConversation({
    store,
    model,
    processImage,
    sender: {
      async sendText(to, text) { console.log(`\nBELLO-Bot:\n${text.split('\n').map((l) => `  ${l}`).join('\n')}\n`); },
      async downloadMedia(id) { return { bytes: media.get(id), mimeType: 'image/jpeg' }; },
    },
    clock: () => new Date(),
    config: {
      siteUrl: SITE_URL,
      developerName: process.env.DEVELOPER_NAME || 'die Entwickler',
      allowedNumbers: new Set([NUMBER]),
      mirrorNumber: '',
    },
    log: (event, data) => console.error(`  [${event}] ${JSON.stringify(data)}`),
  });

  console.log('BELLO WhatsApp-Simulator');
  console.log(`Inhalt: ${path} (nur im Arbeitsspeicher, es wird nichts gespeichert oder veröffentlicht)`);
  console.log(useReal
    ? 'Modell: ECHT (claude-haiku-5-5 über ANTHROPIC_API_KEY, jeder Änderungswunsch kostet einen Aufruf)'
    : `Modell: einfacher Stichwort-Ersatz (ANTHROPIC_API_KEY ist nicht gesetzt). Kein Sprachmodell: freie Formulierungen versteht er nicht. Er kennt nur:\n${STAND_IN_HELP.map((l) => `  ${l}`).join('\n')}`);
  console.log(`Vorschau-Links zeigen auf ${SITE_URL}; lokal gibt es /api/vorschau nicht, dafür den Befehl /vorschau.\n`);

  const nextMessage = () => {
    counter += 1;
    return { id: `sim.${Date.now()}.${counter}`, from: NUMBER, userId: null, timestamp: Math.floor(Date.now() / 1000) };
  };

  async function feed(line) {
    let text = line.trim();
    if (!text) return true;
    // "!foto" works like "/foto" (Git Bash rewrites arguments that start with a slash).
    if (text.startsWith('!')) text = `/${text.slice(1)}`;
    console.log(`Du: ${text}`);
    if (text === '/ende' || text === '/quit' || text === '/exit') return false;
    if (text === '/live') { console.log(describeMenu(await store.getPublished())); return true; }
    if (text === '/state') {
      const state = store.peekState() || {};
      console.log(JSON.stringify({
        draft: state.draft ? { token: state.draft.token, changes: state.draft.changes, images: state.draft.images, expiresAt: state.draft.expiresAt } : null,
        pendingPhoto: state.pendingPhoto || null,
        history: (state.history || []).length,
        notes: state.notes || [],
        commits: store.commits,
      }, null, 2));
      return true;
    }
    if (text === '/vorschau') {
      const token = store.peekState()?.draft?.token;
      if (!token) { console.log('Kein offener Entwurf.'); return true; }
      const res = await handlePreview({ store, token });
      const body = JSON.parse(res.body);
      console.log(`GET /api/vorschau?token=${token} -> ${res.status}`);
      if (body.content) console.log(describeMenu(body.content));
      console.log(`Bilder: ${JSON.stringify(body.images || {})}`);
      return true;
    }
    if (text.startsWith('/foto')) {
      const [, file, ...caption] = text.split(/\s+/);
      let bytes;
      if (file) {
        try { bytes = await readFile(file); } catch { console.log(`Datei nicht lesbar: ${file}`); return true; }
      } else {
        const sharp = (await import('sharp')).default;
        bytes = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#e0261c' } }).jpeg().toBuffer();
      }
      const message = { ...nextMessage(), type: 'image', text: '', caption: caption.join(' '), mediaId: `sim-media-${counter}` };
      media.set(message.mediaId, bytes);
      await conversation.handleMessage(message);
      return true;
    }
    await conversation.handleMessage({ ...nextMessage(), type: 'text', text, caption: '', mediaId: '' });
    return true;
  }

  const scripted = process.argv.slice(2);
  if (scripted.length) {
    for (const line of scripted) {
      if (!(await feed(line))) break;
    }
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  rl.setPrompt('> ');
  rl.prompt();
  // Lines are handled strictly one after another, also when they are piped in.
  let queue = Promise.resolve(true);
  rl.on('line', (line) => {
    queue = queue.then(async (go) => {
      if (!go) return false;
      const more = await feed(line);
      if (more) rl.prompt(); else rl.close();
      return more;
    });
  });
  await new Promise((resolve) => rl.on('close', resolve));
  await queue;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
