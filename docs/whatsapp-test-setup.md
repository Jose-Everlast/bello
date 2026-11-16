# WhatsApp → Website: Testbetrieb mit der eigenen Nummer einrichten

Stand: 16.11.2026. Für den Entwickler. Ziel: Du schreibst von deinem eigenen Handy an eine Meta-Testnummer, der Bot ändert `public/data/content.json` im Repo `Jose-Everlast/bello`, Vercel baut die Seite neu.

Was mit „UNGEPRÜFT“ markiert ist, steht so nicht wörtlich in der offiziellen Doku oder konnte ohne echte Konten nicht ausprobiert werden. Die Liste steht gesammelt in Abschnitt 10.

## 0. Was es ist

| Teil | Datei | Aufgabe |
|---|---|---|
| Webhook | `api/whatsapp.js` | GET = Verifizierung durch Meta. POST = Signatur prüfen, sofort 200 antworten, Arbeit im Hintergrund (`waitUntil`). |
| Vorschau | `api/vorschau.js` | Liefert den unveröffentlichten Entwurf für `/?vorschau=<token>`. |
| Logik | `lib/*.js` | Befehle, Änderungs-Operationen, Modellaufruf, GitHub-Speicher, WhatsApp-Client, Bildverarbeitung. |
| Zustand | Branch `wa-state` in einem **privaten** Repo | `state.json` (Entwurf, letzte 10 veröffentlichte Stände, Notizen mit Nachrichtentexten, Telefonnummern, gesehene Nachrichten-IDs) und `drafts/*.webp` (unveröffentlichte Fotos). Wird bei der ersten Nachricht automatisch angelegt. Pflicht vorher: Abschnitt 0.1. |
| Veröffentlichen | Branch `master` | Genau ein Commit pro Veröffentlichung: `public/data/content.json` und neue Bilder unter `public/assets/uploads/`. Vercel baut daraufhin neu. |

Befehle im Chat: `JA`, `NEIN`, `RÜCKGÄNGIG`, `STATUS` (offener Entwurf, ausgeblendete Einträge), `HILFE`, `NOTIZEN` (zeigt die für dich notierten Wünsche), `NOTIZEN LEEREN`, und „direkt:“ am Anfang einer Nachricht (ohne Vorschau veröffentlichen, z. B. `direkt: Polpette sind aus`). „direkt“ zählt nur mit Doppelpunkt oder Ausrufezeichen dahinter oder allein in der ersten oder letzten Zeile; als normales Wort im Satz („kommt eiskalt und direkt“) löst es nichts aus. Ist ein Entwurf offen, veröffentlicht „direkt:“ nichts, sondern nimmt die Änderung in den Entwurf auf. Lockere Bestätigungen („ja klar“, „passt so“, 👍, „nein doch nicht“, „rückgängig bitte“) werden wie die Befehle behandelt.

## 0.1 Pflicht vor dem ersten Start: privates Repo für den Zustand

`state.json` enthält die Telefonnummern aus `WA_ALLOWED_NUMBERS`, die WhatsApp-Nutzerkennung, weitergereichte Nachrichtentexte (Notizen), den vollständigen Entwurf samt Vorschau-Token und die letzten 10 veröffentlichten Stände; unter `drafts/` liegen unveröffentlichte Fotos. Jeder Schreibvorgang ist ein eigener Commit, die Daten bleiben also in der Git-Historie, auch wenn sie aus der Datei verschwinden.

`Jose-Everlast/bello` war bei der Prüfung am 16.11.2026 ohne Anmeldung lesbar, also öffentlich. In ein öffentliches Repo darf der Zustand nicht. Der Code prüft das selbst: Vor dem ersten Schreiben fragt er `GET /repos/<Repo>` ab und schreibt nur, wenn GitHub `"private": true` meldet. Sonst wird nichts geschrieben, der Bot antwortet „Da ist technisch etwas schiefgegangen“, und im Log steht `handle_error` mit `"name":"StateRepoPublicError"`.

**Stand 16.11.2026:** Das private Repo `Jose-Everlast/bello-state` ist angelegt (mit README, Standard-Branch `main`). Es fehlt nur noch der Eintrag in Vercel:

1. In Vercel `GITHUB_STATE_REPO` auf `Jose-Everlast/bello-state` setzen (Abschnitt 5). Veröffentlicht wird weiter nach `GITHUB_REPO`; die Website bleibt, wo sie ist.
2. Das GitHub-Token braucht Zugriff auf beide Repos, `bello` und `bello-state` (Abschnitt 3).

Das Website-Repo privat zu stellen ist keine Alternative, solange das Vercel-Projekt im Hobby-Tarif läuft: Am 16.11.2026 ausprobiert, Vercel blockiert dann jeden Build mit „Git author … must have access to the project on Vercel to create deployments“. Das träfe auch die Commits des Bots.

Der Vorschau-Link gehört nicht in fremde Hände: Wer den Link hat, sieht den Entwurf, bis er veröffentlicht, verworfen oder abgelaufen ist.

## 1. Vorher lokal prüfen (ohne Konten, ohne Kosten)

0. Node 24 muss installiert sein (`node -v` zeigt `v24.…`; `package.json` verlangt `24.x`, und `npm test` verlässt sich darauf, dass Node das Muster `tests/*.test.js` selbst auflöst). Alle Befehle im Terminal im Ordner `c:\_repos\bello` ausführen.
1. `npm install`
2. `npm test` – alle Tests müssen grün sein. Kein Test braucht Netz oder Umgebungsvariablen.
3. `node tools/wa-sim.mjs` – Simulator im Terminal. Mit gesetztem `ANTHROPIC_API_KEY` antwortet das echte Modell (dann kostet jeder Änderungswunsch einen Aufruf, rund 0,1 US-Cent). Ohne Schlüssel antwortet ein Stichwort-Ersatz, der kein Sprachmodell ist und nur diese Muster versteht: `<Name wie auf der Karte> <Preis> €`, `<Name> ist aus`, `<Name> wieder da`, `<Name> entfernen`, `was kostet <Name>`, `Special: <Titel>, <Text>, bis JJJJ-MM-TT` (Doppelpunkt nötig), `Special <Titel> raus`, und Wörter wie Farbe/Design/Schrift als Wunsch an die Entwicklung. Auf alles andere („negroni kostet jetz 12“, „Mangiare statt Snacks schreiben“, „öffnungszeiten sonntag bis 23 uhr“) fragt er nur zurück; solche freien Formulierungen lassen sich nur mit dem echten Modell ausprobieren. Befehle wie `JA`, `direkt:`, `STATUS`, `RÜCKGÄNGIG` laufen in beiden Fällen durch denselben Code wie im Betrieb. Es wird nichts gespeichert oder veröffentlicht. Befehle im Simulator: `/foto <datei> [Text]`, `/foto`, `/vorschau`, `/live`, `/state`, `/ende` (in Git Bash als Argument `!foto` statt `/foto` schreiben).

## 2. Anthropic-Schlüssel

1. https://platform.claude.com öffnen, anmelden, Guthaben aufladen (Mindestbetrag laut Konsole; 5 US-Dollar reichen für mehrere tausend Nachrichten).
2. Settings > API Keys > Create Key. Name: `bello-whatsapp`. Den Schlüssel einmal kopieren.
3. Er kommt später in Vercel als `ANTHROPIC_API_KEY`. Nicht zusätzlich `ANTHROPIC_AUTH_TOKEN` setzen.

Verwendet wird das Modell `claude-haiku-5-5` mit strukturierter Ausgabe (`output_config.format`), `effort: "low"`, Zeitlimit 20 s, ein Wiederholungsversuch.

## 3. GitHub-Token

Das Token muss vom Konto **Jose-Everlast** (Eigentümer des Repos) erstellt werden, nicht von einem Mitarbeiter-Konto.

1. GitHub > Profilbild > Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate new token.
2. Token name: `bello-whatsapp`.
3. Expiration: frei wählbar, 1 bis 366 Tage oder „No expiration“. Für den Test 90 Tage; Ablaufdatum in den Kalender eintragen. Läuft es ab, antwortet der Bot nur noch „Da ist technisch etwas schiefgegangen“.
4. Resource owner: Jose-Everlast.
5. Repository access: **Only select repositories** > `Jose-Everlast/bello` und, falls nach Abschnitt 0.1 Möglichkeit 1 eingerichtet, zusätzlich das private Zustands-Repo (z. B. `Jose-Everlast/bello-state`).
6. Permissions > Repository permissions > **Contents: Read and write**. Sonst nichts. Die Sichtbarkeitsprüfung aus Abschnitt 0.1 (`GET /repos/<Repo>`) braucht „Metadata: Read-only“. („Metadata: Read-only“ wird von GitHub selbst dazugesetzt – UNGEPRÜFT, dass das automatisch geschieht; falls nicht, von Hand auf Read-only stellen.) „Workflows“ wird nicht gebraucht.
7. Generate token, einmal kopieren. Kommt in Vercel als `GITHUB_TOKEN`.

Die Commits auf `master` werden ohne eigenen Autor angelegt und laufen damit unter dem Konto, dem das Token gehört. Das ist Absicht: Vercel baut bei privaten Repos im Hobby-Tarif nur Commits von Autoren, die zum Vercel-Konto gehören (UNGEPRÜFT für dieses Projekt; nach der ersten Veröffentlichung im Vercel-Dashboard nachsehen, ob der Build gestartet ist).

## 4. Meta: App, Testnummer, eigene Nummer als Empfänger

Ein Facebook-Konto ist nötig. Eine Unternehmensverifizierung ist für die Testnummer nicht nötig.

1. https://developers.facebook.com > My Apps > **Create App**; App-Name (z. B. „Bello Website“) und E-Mail eingeben.
2. Use case: **Connect with customers through WhatsApp**.
3. Ein Business-Portfolio auswählen oder neu anlegen, App-Erstellung abschließen.
4. In der App: **Start using the API** > **API Setup**. Meta legt eine Testnummer und ein Test-Konto („Messaging account“) an. Notieren: **Phone number ID** der Testnummer (eine lange Zahl) – das wird `WHATSAPP_PHONE_NUMBER_ID`.
5. In API Setup unter „To“ deine eigene Handynummer hinzufügen und mit dem Code bestätigen, den du per WhatsApp bekommst. Nur eingetragene Nummern können von der Testnummer Nachrichten erhalten (bis zu 5 – UNGEPRÜFT im aktuellen Doku-Text; sonst Fehler 131030).
6. **Generate access token** (temporäres Token, gilt nur einige Stunden) und über die Schaltfläche die Vorlage `hello_world` an deine Nummer senden. In WhatsApp auf diese Nachricht **antworten** – erst deine Nachricht öffnet das 24-Stunden-Fenster, in dem der Bot frei antworten darf.
7. App settings > Basic > **App Secret** anzeigen und kopieren – das wird `WHATSAPP_APP_SECRET`.
8. Dauerhaftes Token (das temporäre aus Schritt 6 läuft nach wenigen Stunden ab): https://business.facebook.com > Einstellungen (Business settings) > Users > **System Users** > Add (Rolle Admin) > **Assign assets**: die App mit „Manage app“ und das WhatsApp-Konto mit Vollzugriff > **Generate token**: App auswählen, Ablauf wählen („Never“, falls angeboten – UNGEPRÜFT), Berechtigungen `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`. Token einmal kopieren – das wird `WHATSAPP_ACCESS_TOKEN`. Für einen ersten Versuch geht auch das temporäre Token aus Schritt 6; dann hört der Bot nach wenigen Stunden auf zu antworten.
9. Ein Verify-Token selbst ausdenken: eine lange zufällige Zeichenfolge, z. B. Ausgabe von `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. Das wird `WHATSAPP_VERIFY_TOKEN`.

Den Webhook (Abschnitt 6, Schritte 4 und 5) erst eintragen, wenn die Seite mit den Variablen deployt ist.

## 5. Umgebungsvariablen in Vercel

Vercel Dashboard > Projekt **bello** > **Settings** > **Environment Variables**. Jede Variable mit „Add“ anlegen, Environment **Production** (Preview und Development nicht ankreuzen), bei den Schlüsseln und Tokens den Typ „Sensitive“/Secret wählen.

| Name | Wert | Woher |
|---|---|---|
| `WHATSAPP_VERIFY_TOKEN` | selbst gewählte Zufallsfolge | Abschnitt 4, Schritt 9 |
| `WHATSAPP_APP_SECRET` | App Secret | Abschnitt 4, Schritt 7 |
| `WHATSAPP_ACCESS_TOKEN` | System-User-Token | Abschnitt 4, Schritt 8 |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID der Testnummer (nur Ziffern) | Abschnitt 4, Schritt 4 |
| `WA_ALLOWED_NUMBERS` | deine Nummer mit Ländervorwahl, ohne `+` und ohne führende 0, z. B. `4915112345678`; mehrere mit Komma getrennt | – |
| `ANTHROPIC_API_KEY` | API-Schlüssel | Abschnitt 2 |
| `GITHUB_TOKEN` | Fine-grained Token | Abschnitt 3 |
| `GITHUB_REPO` | `Jose-Everlast/bello` (die Website; hierhin wird veröffentlicht) | – |
| `GITHUB_STATE_REPO` (Pflicht, solange `GITHUB_REPO` öffentlich ist) | privates Repo für den Zustand, z. B. `Jose-Everlast/bello-state`. Ohne Angabe wird `GITHUB_REPO` benutzt, aber nur, wenn es privat ist. | Abschnitt 0.1 |
| `SITE_URL` | `https://bello-lyart.vercel.app` | – |
| `PREVIEW_SECRET` (optional) | lange Zufallsfolge. Mit ihr werden Vorschau-Links signiert, damit `/api/vorschau` ausgedachte Token ablehnt, ohne GitHub zu fragen. Ohne Angabe wird dafür `WHATSAPP_APP_SECRET` benutzt. Ändert sich der Wert, werden offene Vorschau-Links ungültig. | wie Abschnitt 4, Schritt 9 |
| `DEVELOPER_NAME` (optional) | dein Vorname; erscheint in „Ich habe es für … notiert.“ Ohne Angabe: „die Entwickler“. | – |
| `WA_MIRROR_NUMBER` (optional) | zweite Nummer, die eine Kopie jeder Anfrage und Antwort bekommt. Im Test mit nur einer Nummer leer lassen. Siehe Abschnitt 8. | – |

Änderungen an Variablen gelten erst für neue Deployments: danach unter Deployments beim letzten Production-Deployment „Redeploy“ wählen (oder neu pushen).

Lokal werden die Variablen nicht gebraucht. Keine echten Werte in Dateien des Repos schreiben.

## 6. Deployen und Webhook eintragen

1. **Alle** Änderungen committen und nach `master` pushen; `git status` muss danach leer sein, bis auf `.wf-resume.js` (gehört nicht ins Repo). Das sind: `api/`, `lib/`, `public/` (darin `index.html`, `assets/`, `data/`), `package.json`, `package-lock.json`, `vercel.json`, `.vercelignore`, `.gitignore`, `README.txt`, außerdem `tests/`, `tools/`, `docs/`. Fehlt unter `public/assets/` etwas (z. B. `js/script-09.js`, `images/favicon.svg` oder `css/styles.css`), verweist die deployte `index.html` auf Dateien, die es nicht gibt. Im Repo-Wurzelordner dürfen `index.html`, `assets/` und `data/` nicht mehr liegen. `node_modules` steht in `.gitignore`.
2. Im Vercel-Dashboard prüfen, dass der Build durchläuft und unter „Functions“ `api/whatsapp` und `api/vorschau` auftauchen.
3. Mit curl prüfen (jeweils die erwartete Antwort dahinter). In **Git Bash** ausführen; in PowerShell `curl.exe` statt `curl` schreiben (dort ist `curl` ein anderes Programm):
   - `curl -i https://bello-lyart.vercel.app/` → 200, die Seite.
   - `curl -i https://bello-lyart.vercel.app/data/content.json` → 200, `cache-control: public, max-age=0, must-revalidate`.
   - `curl -i https://bello-lyart.vercel.app/lib/ops.js` → 404 (liegt außerhalb von `public/` und wird nicht ausgeliefert).
   - `curl -i https://bello-lyart.vercel.app/package.json` → 404 (ebenso).
   - `curl -i "https://bello-lyart.vercel.app/api/vorschau?token=00000000000000000000000000000000"` → 404 mit JSON `{"error":…}`. Ein ausgedachtes Token wird ohne GitHub-Aufruf abgelehnt; dabei wird nichts angelegt (der Branch `wa-state` entsteht erst bei der ersten WhatsApp-Nachricht). 503 statt 404 heißt: weder `PREVIEW_SECRET` noch `WHATSAPP_APP_SECRET` ist gesetzt (Log: `preview_error`). Ob `GITHUB_TOKEN` stimmt, zeigt erst Abschnitt 7, Schritt 1.
   - `curl -i "https://bello-lyart.vercel.app/api/whatsapp?hub.mode=subscribe&hub.verify_token=DEIN_VERIFY_TOKEN&hub.challenge=12345"` → 200 mit Inhalt `12345`. Mit falschem Token → 403.
   - `curl -i -X POST https://bello-lyart.vercel.app/api/whatsapp -d '{}'` → 401 (keine Signatur).
   Ausgeliefert wird nur der Ordner `public/` (`"outputDirectory": "public"` in `vercel.json`) plus die Funktionen unter `/api`. Kommt bei `/` 404, steht im Vercel-Dashboard unter Settings > Build and Deployment ein abweichendes Root Directory oder ein Build Command; beides muss leer sein. Kommt bei `/lib/ops.js` oder `/package.json` 200, wurde nicht dieser Stand deployt. Geheimnisse stehen in `lib/` keine.
4. Meta-App > WhatsApp > **Configuration** (oder Use cases > Customize > Configuration):
   - Callback URL: `https://bello-lyart.vercel.app/api/whatsapp`
   - Verify token: der Wert von `WHATSAPP_VERIFY_TOKEN`
   - **Verify and save**.
5. Darunter bei Webhook fields das Feld **messages** abonnieren (Subscribe). Keine weiteren Felder.
6. Der Webhook muss auf die Produktions-Domain zeigen. Vorschau-Deployments von Vercel sind durch die Anmeldung geschützt und für Meta nicht erreichbar.

## 7. Testen

Von deinem Handy an die Testnummer schreiben:

1. `Hilfe` → Kurzanleitung kommt zurück (prüft Webhook, Signatur, Absenderliste, GitHub-Zugriff, die Sichtbarkeit des Zustands-Repos und Senden; der Branch `wa-state` entsteht dabei im privaten Repo). Kommt stattdessen „Da ist technisch etwas schiefgegangen“: im Log nach `handle_error` suchen. `StateRepoPublicError` = Abschnitt 0.1 fehlt; `GitHub 401/403/404` = Token falsch oder ohne Zugriff auf eines der Repos.
2. `Was kostet der Bellogroni?` → Antwort aus dem Seiteninhalt (prüft den Modellaufruf).
3. `Bellogroni kostet jetzt 13 €` → Liste der Änderung, Vorschau-Link, „Antworte JA …“. Link öffnen: fester Balken „Vorschau · noch nicht veröffentlicht“, neuer Preis sichtbar.
4. `NEIN` → verworfen. Der Link zeigt danach die veröffentlichte Seite mit dem dunklen Balken „Diese Vorschau gibt es nicht mehr (veröffentlicht, verworfen oder abgelaufen) · du siehst die Live-Seite · neue Änderungen brauchen etwa eine Minute“. (Bei einem technischen Fehler steht dort stattdessen „Vorschau nicht verfügbar · du siehst die veröffentlichte Seite“.)
5. Schritt 3 wiederholen, dann `JA` → „Veröffentlicht“. Auf GitHub: ein neuer Commit „Inhalt per WhatsApp: 1 Änderung“ auf `master`. In Vercel: neues Deployment. Nach etwa einer Minute ist der Preis live.
6. `RÜCKGÄNGIG` → alter Preis wieder live (ein weiterer Commit); die Antwort nennt, was zurückgenommen wurde. Ein zweites `RÜCKGÄNGIG` → „Es gibt gerade nichts zum Zurücknehmen.“
6a. Rückfrage testen: `Panissa ist aus` → der Bot fragt, welche gemeint ist. Kurz antworten (`die Genovese`) → Entwurf „Panissa Genovese: ausgeblendet (bleibt so, bis du schreibst …)“. `NEIN`.
7. `direkt: Polpette al Sugo sind aus` → ohne Vorschau veröffentlicht. Danach `direkt: Polpette al Sugo sind wieder da`.
8. Foto ohne Text senden → Rückfrage. Dann `Special: Trüffel-Focaccia, 12 €, bis Sonntag` → Entwurf mit Foto, in der Vorschau sichtbar. `JA` → ein Commit mit `public/data/content.json` und `public/assets/uploads/foto-….webp`.
9. `Mach den Hintergrund blau` → „Das kann ich nicht selbst ändern. Ich habe es für … notiert. Bitte gib kurz Bescheid, dass dort etwas steht.“ `NOTIZEN` zeigt den Wunsch, `NOTIZEN LEEREN` löscht die Liste. **Du bekommst dazu von selbst keine Nachricht.** Wünsche siehst du nur, wenn du `NOTIZEN` schickst, oder als Kopie, wenn `WA_MIRROR_NUMBER` gesetzt ist und du selbst in den letzten 24 Stunden an den Bot geschrieben hast; nur dann antwortet der Bot dem Inhaber mit „Das gebe ich an … weiter.“ Also regelmäßig `NOTIZEN` schicken.
10. Von einer fremden Nummer schreiben → keine Antwort, kein Eintrag.

Fehlersuche: Vercel > Projekt > Logs (im Hobby-Tarif nur 1 Stunde zurück). Der Code schreibt eine JSON-Zeile pro Ereignis, ohne Nachrichtentexte und ohne Geheimnisse: `webhook_error` (Fehler vor der Verarbeitung), `webhook_work_error` (Fehler in der Hintergrundarbeit), `handle_error` (Fehler beim Bearbeiten einer Nachricht, z. B. GitHub oder `StateRepoPublicError`), `model_error` und `model_throw` (Modellaufruf), `op_error` (das Modell hat eine unbrauchbare Änderung geliefert; der Inhaber bekommt „Das habe ich nicht richtig verstanden“), `send_error` (Antwort konnte nicht gesendet werden), `image_error` (Foto), `cleanup_error` (Entwurfsbild nicht gelöscht, harmlos), `preview_error` (Vorschau), `state_write_lost` (veröffentlicht, aber der Zustand ließ sich danach nicht speichern; das nächste `JA` holt den Eintrag für `RÜCKGÄNGIG` nach), `draft_invalid`, `status_error`. Fehlt eine Variable, steht in `webhook_work_error` „Umgebungsvariablen fehlen: …“ und es kommt keine Antwort. Kommt in den Vercel-Logs gar kein POST an: in der Meta-App prüfen, dass das Feld **messages** abonniert ist und die App dem WhatsApp-Konto zugeordnet ist (Hinweis aus Erfahrung, UNGEPRÜFT). Kommt gar keine Antwort: zuerst prüfen, ob die Variablen gesetzt und danach neu deployt wurde, ob das Access-Token noch gilt und ob deine Nummer in `WA_ALLOWED_NUMBERS` exakt so steht, wie Meta sie sendet (Ziffern mit Ländervorwahl).

## 8. Kosten und bekannte Grenzen

**Kosten**
- Meta: Antworten innerhalb des 24-Stunden-Fensters sind „Service“-Nachrichten. Seit 01.10.2026 sind pro Geschäftsnummer 1.000 zugestellte Service-Nachrichten pro Monat frei, danach kostenpflichtig (Deutschland angeblich 0,0456 € pro Nachricht – UNGEPRÜFT gegen Metas eigene Preisliste, https://developers.facebook.com/docs/whatsapp/pricing#rate-cards). Der Bot schickt pro eingehender Nachricht eine Antwort, mit `WA_MIRROR_NUMBER` zwei. Dass die Testnummer nichts kostet, ist UNGEPRÜFT (offiziell nur: gelockerte Limits, keine Zahlungsmethode nötig).
- Anthropic: ein Aufruf pro Änderungswunsch, bei etwa 7.000 Eingabe- und 600 Ausgabe-Token rund 0,001 US-Dollar. `JA`, `NEIN`, `STATUS`, `HILFE`, `RÜCKGÄNGIG`, `NOTIZEN` und Fotos ohne Text kosten nichts. Mit Foto etwas mehr (Bild-Token, Höhe UNGEPRÜFT).
- GitHub: kostenlos. Pro Nachricht entstehen zwei kleine Commits auf `wa-state` (im privaten Zustands-Repo), pro Veröffentlichung einer auf `master`.
- Vercel: Hobby ist kostenlos, laut Nutzungsbedingungen aber nur für private, nicht kommerzielle Nutzung. Die Website einer Bar ist kommerziell; korrekt wäre Pro (20 US-Dollar pro Monat und Entwickler-Platz). Gesperrte Projekte liefern HTTP 451.

**Grenzen**
- 24-Stunden-Fenster: Der Bot kann nur antworten, wenn die Person in den letzten 24 Stunden geschrieben hat. Er schreibt nie von sich aus, also ist das im Normalfall erfüllt. Eine Kopie an `WA_MIRROR_NUMBER` geht nur raus, wenn diese Nummer selbst in den letzten 24 Stunden an den Bot geschrieben hat (der Code prüft das und lässt die Kopie sonst weg). Zuverlässig „immer“ ginge nur mit einer kostenpflichtigen, genehmigten Vorlage; das ist nicht eingebaut. Die Spiegelnummer muss zusätzlich in `WA_ALLOWED_NUMBERS` stehen und bei der Testnummer als Empfänger eingetragen sein.
- Token-Laufzeiten: temporäres Meta-Token wenige Stunden; System-User-Token je nach gewählter Laufzeit; GitHub-Token je nach gewählter Laufzeit. Läuft eines ab, bleibt die Website unverändert online, nur der Bot fällt aus.
- Entwurf und Vorschau-Link gelten 24 Stunden nach der letzten Änderung am Entwurf. Ein unbenutztes Foto wird 24 Stunden aufgehoben.
- Nachrichten, die Meta mehr als 10 Minuten verspätet zustellt, werden nicht ausgeführt (Schutz vor einem alten `JA`); der Bot bittet um Wiederholung.
- Antwortfrist des Webhooks: eine offizielle Zahl in Sekunden gibt es nicht (UNGEPRÜFT, Dritte nennen etwa 5 s). Der Webhook antwortet sofort mit 200 und arbeitet danach im Hintergrund weiter (höchstens 60 s, in `vercel.json` gesetzt).
- Signatur: geprüft wird HMAC-SHA256 über die unveränderten Roh-Bytes der Anfrage. Dass Meta genau so rechnet, steht nicht wörtlich in der Doku (UNGEPRÜFT); schlägt die Prüfung bei echten Nachrichten fehl (401 in den Logs), ist `WHATSAPP_APP_SECRET` falsch.
- Fotos: höchstens 5 MB (WhatsApp-Grenze), werden gedreht, auf 1600 px verkleinert, von Metadaten befreit und als WebP gespeichert. `sharp` auf Vercel ist UNGEPRÜFT: `package-lock.json` enthält die Linux-Binärpakete, Node ist auf 24.x festgelegt. Lädt `sharp` dort nicht, funktionieren Textänderungen weiter und Fotos werden mit „konnte ich gerade nicht laden“ abgelehnt.
- Jede Veröffentlichung löst ein Vercel-Deployment aus (Hobby: höchstens 100 pro Tag). Nach `JA` dauert es etwa eine Minute bis live.
- Hat sich `public/data/content.json` auf `master` geändert, während ein Entwurf offen war (z. B. durch einen Push von dir), verwirft `JA` den Entwurf und bittet um Wiederholung, statt deine Änderung zu überschreiben. Das wird beim Veröffentlichen direkt am aktuellen Stand von `master` noch einmal geprüft, auch wenn dein Push genau in diesem Moment ankommt.
- `RÜCKGÄNGIG` kennt die letzten 10 über WhatsApp veröffentlichten Stände und stellt nur `public/data/content.json` zurück; hochgeladene Bilder bleiben im Repo liegen. Es nimmt nur zurück, was der Bot selbst zuletzt veröffentlicht hat: Steht auf `master` inzwischen etwas anderes (z. B. ein Push von dir), lehnt der Bot ab („RÜCKGÄNGIG geht hier nicht“), statt deinen Stand zu überschreiben.
- Die Bereiche der Karte (Snacks, Cocktails, Getränke) können umbenannt, aber nicht angelegt oder gelöscht werden. Eine Änderung, nach der kein Eintrag mehr sichtbar wäre, wird abgelehnt; ein Abschnitt ohne sichtbaren Eintrag wird auf der Seite nicht gezeigt, der Bot weist darauf hin.
- „Ist aus“ blendet einen Eintrag dauerhaft aus. Ein „heute“ wird nicht ausgewertet; der Eintrag kommt erst mit „… wieder da“ zurück. `STATUS` listet, was ausgeblendet ist.
- Öffnungszeiten und Adresse stehen an drei Stellen der Seite aus `public/data/content.json` (Block WANN?/WO?, „Bello in 15 Sekunden“, Fußzeile). **Nicht** mitgeändert werden: die Meta-Beschreibung und `og:description` in `public/index.html` (Zeilen 9 und 11), das Info-Video und der Google-Eintrag. Ändert der Inhaber Zeiten oder Adresse, sagt ihm der Bot das und legt nach dem Veröffentlichen eine Notiz für dich an.
- Fester Stand in `public/index.html`: Karte und Texte stehen zusätzlich fest im HTML (für Besucher ohne JavaScript, Suchmaschinen und als Rückfall). `content.js` ersetzt sie nach dem Laden durch `/data/content.json` (im Repo: `public/data/content.json`). Nach der ersten Veröffentlichung per WhatsApp weicht der feste Stand ab: Besucher sehen für einen Moment die alte Karte, Besucher ohne JavaScript und Suchmaschinen dauerhaft. Das wird hingenommen; wer es vermeiden will, gleicht `public/index.html` gelegentlich von Hand an `public/data/content.json` an. Ein automatisches Mitschreiben ist nicht eingebaut.
- Rückfragen: Fragt der Bot nach („Welchen meinst du …?“), gilt die nächste Nachricht derselben Person 30 Minuten lang als Antwort darauf und geht zusammen mit der ersten Nachricht an das Modell. Mehr Gesprächsverlauf kennt das Modell nicht.
- Vorschau-Links sind signiert (siehe `PREVIEW_SECRET`). `/api/vorschau` lehnt ausgedachte Token ohne GitHub-Aufruf ab und merkt sich abgelaufene Links eine Minute lang. Wer einen gültigen Link kennt, kann ihn beliebig oft abrufen; jeder Abruf liest den Zustand bei GitHub.
- Gleichzeitige Nachrichten von zwei Personen werden über die Versionsprüfung von `state.json` nacheinander verarbeitet; im seltenen Konfliktfall wird die Nachricht bis zu viermal neu versucht.

**WhatsApp-Gruppe mit euch beiden?** Über die offizielle API praktisch nicht möglich: Gruppen gibt es nur für „Official Business Accounts“ (verifiziertes Unternehmen, mindestens 30 Tage auf der Plattform, genehmigter Anzeigename); Testnummern sind ausgeschlossen, und selbst dann müsste das Unternehmen die Gruppe per API anlegen und ihr tretet per Einladungslink bei. Inoffizielle Bibliotheken (Baileys, whatsapp-web.js) verstoßen gegen die WhatsApp-Nutzungsbedingungen, können zur dauerhaften Sperre der Nummer führen und brauchen einen dauerhaft laufenden Prozess, was auf Vercel nicht geht. **Ersatz:** zwei Einzelchats mit derselben Bot-Nummer. Beide Nummern in `WA_ALLOWED_NUMBERS`, deine Nummer zusätzlich als `WA_MIRROR_NUMBER`: dann siehst du jede Anfrage des Inhabers samt Antwort als Kopie, solange du selbst in den letzten 24 Stunden etwas an den Bot geschrieben hast (ein `STATUS` am Tag genügt). Entwurf, `JA` und `NEIN` sind gemeinsam: Jeder der beiden kann den offenen Entwurf des anderen freigeben oder verwerfen.

## 9. Später: auf die Nummer des Inhabers umstellen

Mit der Testnummer (weiterhin Test):
1. Meta-App > API Setup > unter „To“ die Handynummer des Inhabers hinzufügen; er bekommt einen Code per WhatsApp und nennt ihn dir.
2. In Vercel `WA_ALLOWED_NUMBERS` auf `<Inhaber>,<du>` setzen, `WA_MIRROR_NUMBER` auf deine Nummer, `DEVELOPER_NAME` auf deinen Vornamen. Redeploy.
3. Der Inhaber speichert die Testnummer als Kontakt („Bello Website“) und schreibt `Hilfe`.

Für den echten Betrieb (eigene Bot-Nummer statt Testnummer):
1. Eine Telefonnummer besorgen, die **nicht** in der WhatsApp- oder WhatsApp-Business-App benutzt wird (die private Nummer des Inhabers und die Nummer der Bar in der App scheiden damit aus; eine zusätzliche SIM oder Festnetznummer geht).
2. Meta-App > API Setup > Nummer hinzufügen, per SMS oder Anruf bestätigen, Anzeigenamen festlegen.
3. Im Business-Portfolio eine Zahlungsmethode hinterlegen (nötig, sobald die 1.000 freien Service-Nachrichten im Monat überschritten werden oder Vorlagen verschickt werden).
4. In Vercel `WHATSAPP_PHONE_NUMBER_ID` auf die ID der neuen Nummer ändern; das System-User-Token braucht Zugriff auf dieses WhatsApp-Konto. Redeploy.
5. Webhook-Eintrag und App Secret bleiben gleich.
6. Vercel-Tarif klären (siehe Kosten).

## 10. Alles, was UNGEPRÜFT ist

- Dass ein Fine-grained Token mit „Contents“ auch `GET /repos/<Repo>` (Sichtbarkeitsprüfung, Abschnitt 0.1) lesen darf, also „Metadata: Read-only“ automatisch dabei ist. Wenn nicht: `handle_error` mit `GitHub 403` oder `404` bei der ersten Nachricht.
- Dass ein eigenes privates Zustands-Repo (`GITHUB_STATE_REPO`) mit demselben Token funktioniert; getestet nur gegen das nachgebaute GitHub.
- Dass Vercel mit `"framework": null` und `"outputDirectory": "public"` nur `public/` ausliefert und die Funktionen aus `api/` (im Repo-Wurzelordner, mit `lib/`) trotzdem baut. Die Doku nennt `public` als Ausgabeordner und `api/` im Wurzelordner als Ort der Funktionen, beschreibt die Kombination aber nicht in einem Satz. Prüfung: curl in Abschnitt 6.
- Dass `.vercelignore` auch bei Deployments aus GitHub beachtet wird (dokumentiert ist es nur allgemein). Sicherheitsrelevant ist das nicht mehr: `docs/`, `tools/`, `tests/` liegen außerhalb von `public/`.
- Dass `git.deploymentEnabled` den Branch `wa-state` tatsächlich vom Bauen ausnimmt (dokumentiert; prüfen: nach der ersten Nachricht darf in Vercel kein Preview-Deployment für `wa-state` erscheinen).
- `sharp` 0.35.5 auf Vercel mit Node 24.x.
- Dass Vercel Commits baut, die über die GitHub-API mit deinem Token erzeugt wurden.
- GitHub: genaue Statuscodes bei veraltetem `sha` (erwartet 409), bei nicht vorspulbarem Ref (erwartet 422) und bei schon vorhandenem Branch (erwartet 422). Der Code behandelt 409 und 422 jeweils als „neu lesen und wiederholen“.
- Meta: Signatur über Roh-Bytes; Antwortfrist; Obergrenze von 5 Empfängern bei der Testnummer; Kostenfreiheit der Testnummer; „Never“ als Laufzeit des System-User-Tokens; Preise für Deutschland.
- Anthropic: tatsächliche Antwortzeit und die einmalige Verzögerung beim ersten Aufruf mit neuem Schema; Bild-Token für WebP-Fotos; ob `image/webp` mit 1600 px ohne Weiteres angenommen wird. Der Aufruf selbst (Modellname, `output_config`, Schema) wurde nie gegen die echte API ausgeführt.
- Das Zusammenspiel im Ganzen: Es gab keinen einzigen echten Durchlauf mit Meta, GitHub, Anthropic oder Vercel. Getestet ist die Logik mit Speicher im Arbeitsspeicher, nachgebautem GitHub und geskriptetem Modell.
