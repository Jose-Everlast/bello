# Hero-Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Scroll-Negroni im Hero bewegt sich physikalisch plausibel statt nur einzublenden.

**Architecture:** Alles bleibt in der einen Canvas-Schleife von `assets/js/script-03.js`. Jede Position hängt nur vom Scroll-Fortschritt `p` ab. Zwei zeitbasierte Zustände kommen dazu (Strahlstärke, Oberflächenneigung), beide aus der Scroll-Geschwindigkeit gespeist.

**Tech Stack:** Vanilla JS, Canvas 2D, CSS. Kein Build, keine Bibliothek, kein Test-Runner.

**Spec:** `docs/superpowers/specs/2026-11-16-hero-animation-design.md`

## Global Constraints
- Keine neuen Bilder, keine Bibliothek, Texte/Layout/Scroll-Länge unverändert.
- Stufengrenzen bleiben: `.16`, `.40`, `.82`.
- `prefers-reduced-motion`: direkt das fertige Bild.
- Quellkoordinaten 709 × 411; Pegel unten y=347, Hub 140.

## Review Focus
- Rückwärts scrollen: kein Strahl, keine hängenden Zustände.
- Scroll-Stopp mitten im Eingießen: Strahl versiegt, Oberfläche beruhigt sich, Schleife endet.
- Handy-Hochformat: Glas und Strahl im Bild, keine Ruckler.
- Ausschnittkanten an Würfeln/Orange in Bewegung.
- Schneller Sprung (Anker-Link, Seitenende): kein Flackern der Stufentexte.

---

### Task 1: Bewegung in `assets/js/script-03.js`

Gemessene Ebenen (Mittelpunkt): cube1 (316,191) auf dem Rand, cube2 (372,257), cube3 (323,292) im Glas, orange (380,172).

- [ ] `sprite(name,alpha,dy,rot,cx,cy)`: Ebene verschoben und um ihren Mittelpunkt gedreht zeichnen.
- [ ] `drop(t)`: Resthöhe 1→0 mit Beschleunigung, Landung bei t=.72, ein gedämpfter Rückprall (7 %).
- [ ] Glas `.03–.15`: einblenden, 7 px absetzen.
- [ ] Würfel von unten nach oben: cube3 `.16–.265`, cube2 `.225–.335`, cube1 `.305–.405`; Fallhöhen 70/78/96 px. Zeichenreihenfolge bleibt cube1, cube2, cube3.
- [ ] Pegel `.405–.83`: `fill = 1-(1-t)^1.7`. Oberfläche um `tilt` geneigt, nahe leer/voll gedämpft.
- [ ] Strahl bei x=388 von oben bis zur Oberfläche, Stärke `stream` 0–1, nur bei Vorwärts-Scroll im Bereich `.405–.825`.
- [ ] Orange `.835–.965`: 34 px senken, 0.22 rad drehen.
- [ ] Original `.962–1` überblenden.
- [ ] `tick`: Glättung 90 ms; `stream` und Feder (`k=90`, `c=7`, Ziel `±4 px`) fortschreiben; Schleife läuft, bis beide ruhen.

### Task 2: Stufentexte
- [ ] `.photo-stage-label.swap span{opacity:0;transform:translateY(6px)}` plus 170 ms Transition ans Ende von `assets/css/styles.css`.
- [ ] `updateUi`: beim Stufenwechsel Klasse setzen, nach 170 ms Text tauschen; erster Aufruf und reduzierte Bewegung ohne Verzögerung.

### Task 3: Prüfen im Browser
- [ ] Lokal ausliefern, bei 1440 px und 390 px Breite an p = .1, .22, .3, .38, .5, .7, .9, 1 ansehen.
- [ ] Konsole fehlerfrei. Kanten prüfen, Fallhöhen bei Bedarf kürzen.
