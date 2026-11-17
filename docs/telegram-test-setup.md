# Telegram → Website: Testkanal einrichten

Stand: 17.11.2026. Für den Entwickler. Telegram ist ein **Testkanal**: derselbe Bot, dieselbe Logik und derselbe Zustand wie bei WhatsApp, nur ein anderer Eingang (`api/telegram.js`). Der Inhaber bekommt später WhatsApp, sobald Meta die Entwickler-Registrierung zulässt (`docs/whatsapp-test-setup.md`). Dafür muss am Telegram-Teil nichts zurückgebaut werden; beide Eingänge können nebeneinander laufen.

Die Angaben zur Telegram Bot API sind am 17.11.2026 gegen https://core.telegram.org/bots/api (Bot API 10.4) geprüft. Was nur mit einem echten Bot zu prüfen ist, steht in Abschnitt 9.

## 1. Bot anlegen

1. In Telegram den Chat **@BotFather** öffnen (blauer Haken).
2. `/newbot` senden.
3. Name eingeben, z. B. `Bello Website Test`.
4. Benutzernamen eingeben; er muss auf `bot` enden, z. B. `bello_website_test_bot`.
5. BotFather antwortet mit dem **Token** (Form `123456789:AA…`). Kopieren. Wer das Token hat, steuert den Bot; es gehört nur in Vercel, nicht in eine Datei des Repos.

## 2. Umgebungsvariablen in Vercel

Vercel Dashboard > Projekt **bello** > Settings > Environment Variables. Environment **Production**, Typ „Sensitive“/Secret.

| Name | Wert |
|---|---|
| `TELEGRAM_BOT_TOKEN` | das Token von BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | selbst gewählte Zeichenfolge, 1 bis 256 Zeichen, nur `A–Z`, `a–z`, `0–9`, `_` und `-`. Z. B. Ausgabe von `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `TELEGRAM_ALLOWED_IDS` | deine Telegram-ID (nur Ziffern); mehrere mit Komma getrennt. Kennst du sie noch nicht: weglassen und nach Abschnitt 5 nachtragen. Ohne diese Variable ist niemand freigeschaltet. |
| `ANTHROPIC_API_KEY` | wie in `docs/whatsapp-test-setup.md`, Abschnitt 2 |
| `GITHUB_TOKEN` | wie in `docs/whatsapp-test-setup.md`, Abschnitt 3 (Zugriff auf `bello` und `bello-state`) |

Schon gesetzt und unverändert: `GITHUB_REPO`, `GITHUB_STATE_REPO`, `SITE_URL`.

Die WhatsApp-Variablen (`WHATSAPP_…`, `WA_…`) braucht der Telegram-Weg nicht. Optional wie bisher: `DEVELOPER_NAME`, `PREVIEW_SECRET`.

Vorschau-Links werden mit dem ersten gesetzten Wert aus `PREVIEW_SECRET`, `WHATSAPP_APP_SECRET`, `TELEGRAM_WEBHOOK_SECRET` signiert. Kommt später `WHATSAPP_APP_SECRET` dazu (oder ändert sich der benutzte Wert), werden offene Vorschau-Links ungültig; dann die Änderung noch einmal schicken. Wer das vermeiden will, setzt gleich `PREVIEW_SECRET`.

## 3. Deployen

Den Stand mit `api/telegram.js` nach `master` pushen (oder, wenn er schon deployt ist: Deployments > letztes Production-Deployment > **Redeploy**). Variablen gelten erst für neue Deployments.

Prüfen (Git Bash; in PowerShell `curl.exe`):

- `curl -i https://bello-lyart.vercel.app/api/telegram` → 405.
- `curl -i -X POST https://bello-lyart.vercel.app/api/telegram -d '{}'` → 401 `invalid secret token`.

## 4. Webhook eintragen

Diese eine Adresse im Browser öffnen, `<TOKEN>` und `<SECRET>` durch die Werte aus Abschnitt 2 ersetzen:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://bello-lyart.vercel.app/api/telegram&secret_token=<SECRET>&allowed_updates=["message"]
```

Erwartete Antwort:

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

Entscheidend sind `"ok":true` und `"result":true`. Bei `"ok":false` steht der Grund in `description` (z. B. `Unauthorized` = Token falsch; ein Secret mit anderen Zeichen als oben wird abgelehnt).

Telegram schickt das Secret danach bei jeder Zustellung im Header `X-Telegram-Bot-Api-Secret-Token` mit; ohne den passenden Wert antwortet `api/telegram` mit 401 und verarbeitet nichts. Der Webhook muss auf die Produktions-Domain zeigen (Vorschau-Deployments sind durch die Vercel-Anmeldung geschützt). Die Adresse enthält das Token und bleibt im Browser-Verlauf; danach dort löschen.

## 5. Eigene ID freischalten

1. In Telegram den Bot über seinen Benutzernamen suchen, **Start** drücken (sendet `/start`) oder irgendetwas schreiben.
2. Der Bot antwortet: `Diese Unterhaltung ist nicht freigeschaltet. Deine Telegram-ID: 123456789`. Diese Antwort kommt höchstens einmal pro Minute; dabei wird nichts gespeichert und weder das Modell noch GitHub aufgerufen.
3. Die Zahl in Vercel als `TELEGRAM_ALLOWED_IDS` eintragen. **Redeploy.**

## 6. Testen

Im Chat mit dem Bot:

1. `Hilfe` → Kurzanleitung (prüft Webhook, Secret, Freischaltung, GitHub-Zugriff, Zustands-Repo und Senden).
2. `Bellogroni kostet jetzt 13 €` → „Entwurf: …“, Vorschau-Link, „Antworte JA …“. Link öffnen: Balken „Vorschau · noch nicht veröffentlicht“, neuer Preis sichtbar.
3. `JA` → „Veröffentlicht“. Auf GitHub ein Commit „Inhalt per Telegram: 1 Änderung“ auf `master`, in Vercel ein neues Deployment, nach etwa einer Minute live. `RÜCKGÄNGIG` nimmt es zurück.
4. Ein Foto **als Foto** (nicht „als Datei“) mit Bildunterschrift `Special: Trüffel-Focaccia, 12 €, bis Sonntag` → Entwurf mit Foto. `NEIN` verwirft.

Alle Befehle (`NEIN`, `STATUS`, `NOTIZEN`, `direkt: …`) und Grenzen stehen in `docs/whatsapp-test-setup.md`, Abschnitte 0, 7 und 8; sie gelten hier genauso.

## 7. Fehlersuche

- `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` im Browser: `url` muss `https://bello-lyart.vercel.app/api/telegram` sein. `pending_update_count` zählt noch nicht zugestellte Nachrichten. `last_error_message` nennt den letzten Zustellfehler, `last_error_date` wann (Unix-Zeit). Steht dort ein 401-Fehler: `secret_token` aus Abschnitt 4 und `TELEGRAM_WEBHOOK_SECRET` stimmen nicht überein, oder nach dem Setzen der Variable wurde nicht neu deployt.
- Vercel > Projekt > Logs (Hobby: 1 Stunde zurück). Eine JSON-Zeile pro Ereignis, ohne Nachrichtentexte und ohne Token: `webhook_work_error` mit „Umgebungsvariablen fehlen: …“ = Variable fehlt oder kein Redeploy; `handle_error` = Fehler beim Bearbeiten (z. B. `StateRepoPublicError`, `GitHub 401/403/404`); `send_error` mit `Telegram 4xx …` = Antwort konnte nicht gesendet werden; `image_error` = Foto. Die übrigen Namen: `docs/whatsapp-test-setup.md`, Abschnitt 7.
- Gar keine Antwort, auch nicht die mit der ID: Webhook nicht gesetzt (`url` leer) oder `TELEGRAM_BOT_TOKEN` in Vercel falsch (Log: `webhook_work_error`).
- Immer nur die Antwort mit der ID: `TELEGRAM_ALLOWED_IDS` enthält die Zahl nicht exakt, oder kein Redeploy.
- Webhook wieder entfernen: `https://api.telegram.org/bot<TOKEN>/deleteWebhook`.

## 8. Unterschiede zu WhatsApp

- Anmeldung des Webhooks: geheimer Header statt Signatur über den Inhalt. Es gibt keinen GET-Handshake.
- Freischaltung über die Telegram-ID statt über die Telefonnummer. Nicht freigeschaltete Absender bekommen ihre ID genannt (bei WhatsApp: keine Antwort).
- Nur Einzelchats. Nachrichten aus Gruppen und Kanälen, bearbeitete Nachrichten und andere Bots werden ignoriert. Eine nachträglich bearbeitete Nachricht wird also nicht noch einmal ausgeführt.
- Kein 24-Stunden-Fenster: der Bot darf jederzeit antworten, sobald du ihn einmal gestartet hast.
- Keine Kopie an eine zweite Person (`WA_MIRROR_NUMBER` wirkt nur bei WhatsApp). Wünsche stehen unter `NOTIZEN`.
- Im Zustand (`state.json`) steht ein Telegram-Absender als `tg:<ID>`, ein WhatsApp-Absender als Telefonnummer. Entwurf, Verlauf und Notizen sind gemeinsam: Ein über Telegram angelegter Entwurf kann über WhatsApp mit `JA` freigegeben werden und umgekehrt.
- Commits heißen „Inhalt per Telegram: …“ statt „Inhalt per WhatsApp: …“.
- Fotos: Telegram verkleinert Fotos selbst; genommen wird die größte gelieferte Fassung, Obergrenze wie bisher 5 MB (Telegram ließe 20 MB zu). Als Datei gesendete Bilder, Sprachnachrichten, Videos und Sticker beantwortet der Bot mit „Ich verstehe nur Textnachrichten und Fotos“.
- Kosten: Telegram berechnet nichts. Anthropic, GitHub und Vercel wie bisher.

## 9. Nicht mit einem echten Bot geprüft

- Der ganze Weg Telegram → Vercel → GitHub → Antwort. Getestet ist die Logik mit nachgebauten Telegram-Antworten (`tests/telegram.test.js`), ohne Netz.
- Der genaue Text in `description` nach `setWebhook` („Webhook was set“); dokumentiert ist nur, dass bei Erfolg `true` zurückkommt.
- Dass der Browser `allowed_updates=["message"]` unverändert genug übergibt. Wenn nicht: Telegram stellt dann auch andere Ereignisse zu; der Code ignoriert alles außer `message`.
- Wie lange Telegram auf die Antwort des Webhooks wartet und wie oft es bei Fehlern wiederholt. Der Webhook antwortet sofort mit 200 und arbeitet danach bis zu 60 s weiter; doppelt zugestellte Nachrichten werden über `tg-<Chat>-<Nachrichtennummer>` erkannt.
- Die Größe der Fotos, die Telegram tatsächlich liefert, und ihr `Content-Type` beim Herunterladen.
