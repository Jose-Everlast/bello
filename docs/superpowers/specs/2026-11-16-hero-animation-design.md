# Hero-Animation: natürlicherer Ablauf

Datum: 2026-11-16 · Größe: kleine Änderung (eine JS-Datei, wenige CSS-Zeilen)

## Absicht
Die Scroll-Idee „ein Negroni entsteht" bleibt. Der Ablauf soll flüssiger und
überzeugender werden und sich wie ein echter Drink anfühlen. Heute erscheinen
Glas, Eis und Orange aus dem Nichts, und der Negroni fährt wie ein Balken hoch.

## Ziele
- Eis fällt, Negroni wird eingegossen, Orange wird eingesetzt.
- Kein sichtbarer Sprung an irgendeiner Scroll-Position, auch nicht am Ende.
- Läuft auf Handy und Desktop ruckelfrei.

## Nicht-Ziele
- Keine neuen Fotos, kein Video, keine Bibliothek.
- Texte, Layout, Scroll-Länge und die vier Stufen bleiben.
- Die geringe Bildauflösung (709 × 411 px) und die Retusche-Kante im
  Hintergrund werden nicht behoben. Dafür bräuchte es das Originalfoto.

## Anti-Ziele
- Sichtbare Ausschnittkanten an bewegten Würfeln oder der Orange.
- Verspielte, comicartige Bewegung. Die Bar-Stimmung bleibt ruhig.

## Wege
- **A – Bewegung mit den vorhandenen Ebenen (gewählt).** Überzeugend ohne
  neues Material. Risiko: Ausschnittkanten in Bewegung.
- **B – Nur Feinschliff.** Sicher, löst aber das „aus dem Nichts" nicht.
- **C – Videosequenz.** Am echtesten, braucht aber neues Material.

## Entwurf
Alles in `assets/js/script-03.js`, gleiche Leinwand, gleiche Ebenen.

| Scroll | Was passiert |
|---|---|
| 0.03–0.15 | Glas blendet ein und setzt sich wenige Pixel ab. |
| 0.16–0.40 | Drei Würfel fallen nacheinander von oberhalb des Glasrands, beschleunigt, leicht gedreht, mit kurzem Nachfedern. Sie blenden nur am Anfang des Falls ein. |
| 0.40–0.83 | Dünner Strahl von oben bis zur Oberfläche. Pegel steigt erst schnell, dann langsamer. Strahl wird am Ende dünner und reißt ab. |
| 0.835–0.965 | Orange senkt sich mit kleiner Drehung ein und setzt sich. |
| 0.965–1 | Weiche Überblendung ins Originalfoto statt hartem Wechsel. |

- **Oberfläche:** Eine gefederte Neigung, angetrieben von der
  Scroll-Geschwindigkeit, lässt den Pegel leicht schwappen und zur Ruhe
  kommen. Die Zeichenschleife läuft weiter, bis die Feder ruht.
- **Rückwärts scrollen:** Alles läuft sauber rückwärts, da jede Position
  nur vom Scroll-Fortschritt abhängt. Nur das Schwappen ist zeitbasiert.
- **Texte:** Stufentitel und Untertitel wechseln mit kurzem Aus- und
  Einblenden statt hart.
- **Reduzierte Bewegung:** wie bisher direkt das fertige Bild.

## Dem Umsetzer überlassen
Genaue Fallhöhen, Drehwinkel, Federwerte und Strahlfarbe. Sie werden im
Browser bei Desktop- und Handybreite eingestellt. Zeigen sich bei einem
Element Ausschnittkanten, wird dessen Bewegung verkürzt, notfalls bis zum
heutigen Einblenden.
