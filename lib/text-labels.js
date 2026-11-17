// German names for everything the owner can address by message: every page
// text (key in content.json "texts", data-text="<key>" in public/index.html)
// and every style group (data-driven parts that share one size). The backend
// builds its change lines from these names and the model gets them next to
// each key, so that "die große Überschrift oben" can be mapped to a key.
// Pure data, no I/O.

export const TEXT_LABELS = {
  'header.tagline1': 'Kopfzeile: kleine Zeile neben dem Logo, erste Zeile',
  'header.tagline2': 'Kopfzeile: kleine Zeile neben dem Logo, zweite Zeile',
  'nav.concept': 'Menüleiste: Link Einblicke',
  'nav.menu': 'Menüleiste: Link Karte',
  'nav.visit': 'Menüleiste: Link Besuch',
  'nav.walk': 'Menüleiste: Link Der Weg',
  'nav.reserve': 'Menüleiste: Knopf Platz anfragen',

  'hero.kicker': 'Ganz oben: kleine Zeile über der großen Überschrift',
  'hero.headline1': 'Ganz oben: große Überschrift, erste Zeile',
  'hero.headline2': 'Ganz oben: große Überschrift, zweite Zeile',
  'hero.text': 'Ganz oben: Text unter der großen Überschrift',
  'hero.cta.menu': 'Ganz oben: Knopf zur Karte',
  'hero.cta.reserve': 'Ganz oben: Knopf Platz anfragen',
  'hero.stage1.title': 'Negroni-Animation: Schritt 1, Titel',
  'hero.stage1.text': 'Negroni-Animation: Schritt 1, Satz',
  'hero.stage2.title': 'Negroni-Animation: Schritt 2, Titel',
  'hero.stage2.text': 'Negroni-Animation: Schritt 2, Satz',
  'hero.stage3.title': 'Negroni-Animation: Schritt 3, Titel',
  'hero.stage3.text': 'Negroni-Animation: Schritt 3, Satz',
  'hero.stage4.title': 'Negroni-Animation: Schritt 4, Titel',
  'hero.stage4.text': 'Negroni-Animation: Schritt 4, Satz',
  'hero.toast1': 'Negroni-Animation: Trinkspruch am Ende, erstes Wort',
  'hero.toast2': 'Negroni-Animation: Trinkspruch am Ende, zweites Wort',
  'hero.progress.label': 'Negroni-Animation: Zeile über dem Fortschrittsbalken',
  'hero.progress.step1': 'Negroni-Animation: Fortschrittsbalken, Wort 1',
  'hero.progress.step2': 'Negroni-Animation: Fortschrittsbalken, Wort 2',
  'hero.progress.step3': 'Negroni-Animation: Fortschrittsbalken, Wort 3',
  'hero.progress.step4': 'Negroni-Animation: Fortschrittsbalken, Wort 4',
  'hero.scrollcue': 'Negroni-Animation: Scroll-Hinweis am rechten Rand',

  'marquee.phrase1': 'Laufband: erster Spruch',
  'marquee.phrase2': 'Laufband: zweiter Spruch',
  'marquee.phrase3': 'Laufband: dritter Spruch',

  'specials.eyebrow1': 'Specials: kleine Zeile über der Überschrift, erster Teil',
  'specials.eyebrow2': 'Specials: kleine Zeile über der Überschrift, zweiter Teil',
  'specials.heading1': 'Überschrift Specials, erstes Wort',
  'specials.heading2': 'Überschrift Specials, zweites Wort',

  'concept.eyebrow1': 'Einblicke: kleine Zeile über der Überschrift, erster Teil',
  'concept.eyebrow2': 'Einblicke: kleine Zeile über der Überschrift, zweiter Teil',
  'concept.heading1': 'Überschrift Einblicke, erste Zeile',
  'concept.heading2': 'Überschrift Einblicke, zweite Zeile',
  'concept.text': 'Einblicke: Text neben der Überschrift',
  'concept.card1.side': 'Video 1: senkrechte Zeile im Bild',
  'concept.card1.eyebrow': 'Video 1: kleine Zeile über dem Titel',
  'concept.card1.title': 'Video 1: Titel',
  'concept.card2.side': 'Video 2: senkrechte Zeile im Bild',
  'concept.card2.eyebrow': 'Video 2: kleine Zeile über dem Titel',
  'concept.card2.title': 'Video 2: Titel',
  'concept.card2.text': 'Video 2: Text unter dem Titel',
  'concept.card3.side': 'Video 3: senkrechte Zeile im Bild',
  'concept.card3.eyebrow': 'Video 3: kleine Zeile über dem Titel',
  'concept.card3.title': 'Video 3: Titel',
  'concept.card3.text': 'Video 3: Text unter dem Titel',
  'concept.swipe': 'Einblicke: Wisch-Hinweis unter den Videos',
  'concept.instagram': 'Einblicke: Link zu Instagram unter den Videos',

  'menu.eyebrow': 'Karte: kleine Zeile über der Überschrift',
  'menu.heading1': 'Überschrift Karte, erstes Wort',
  'menu.heading2': 'Überschrift Karte, zweites Wort',
  'menu.intro.bold': 'Text über der Karte, fetter Satz',
  'menu.intro.text': 'Text über der Karte, zweiter Teil',
  'menu.source': 'Karte: Link zur Karte auf Instagram',
  'menu.folio': 'Karte: kleine Zeile oben links auf jeder Kartenseite',
  'menu.foot': 'Karte: Preishinweis unten auf jeder Kartenseite',

  'visit.folio1': 'Besuch: kleine Zeile ganz oben, links',
  'visit.folio2': 'Besuch: kleine Zeile ganz oben, rechts',
  'visit.eyebrow': 'Besuch: kleine Zeile über der Überschrift',
  'visit.heading1': 'Überschrift Besuch, erste Zeile',
  'visit.heading2': 'Überschrift Besuch, zweite Zeile',
  'visit.text': 'Besuch: Text unter der Überschrift',
  'visit.where.label': 'Besuch: Wort über der Adresse',
  'visit.address': 'Adresse',
  'visit.where.note': 'Besuch: kleine Zeile unter der Adresse',
  'visit.when.label': 'Besuch: Wort über den Öffnungszeiten',
  'visit.hours1': 'Öffnungszeiten',
  'visit.hours2': 'Öffnungszeiten, zweite Zeile',
  'visit.closed': 'Ruhetag',
  'visit.cta.label': 'Besuch: großer Knopf Platz anfragen',
  'visit.cta.note': 'Besuch: kleine Zeile im Knopf Platz anfragen',
  'visit.route.from': 'Besuch: Wegzeile ganz unten, Start',
  'visit.route.to': 'Besuch: Wegzeile ganz unten, Ziel',

  'walk.eyebrow': 'Der Weg: kleine Zeile über der Überschrift',
  'walk.heading1': 'Überschrift Der Weg, erste Zeile',
  'walk.heading2': 'Überschrift Der Weg, zweite Zeile',
  'walk.text': 'Der Weg: Text unter der Überschrift',
  'walk.scrollhint': 'Der Weg: Scroll-Hinweis hinter dem Text',
  'walk.step1.title': 'Der Weg: Schritt 1, Titel',
  'walk.step1.text': 'Der Weg: Schritt 1, Satz',
  'walk.step2.title': 'Der Weg: Schritt 2, Titel',
  'walk.step2.text': 'Der Weg: Schritt 2, Satz',
  'walk.step3.title': 'Der Weg: Schritt 3, Titel',
  'walk.step3.text': 'Der Weg: Schritt 3, Satz',
  'walk.step4.title': 'Der Weg: Schritt 4, Titel',
  'walk.step4.text': 'Der Weg: Schritt 4, Satz',
  'walk.distance': 'Der Weg: Entfernung',
  'walk.duration': 'Der Weg: Gehzeit',
  'walk.maps': 'Der Weg: Knopf In Maps öffnen',
  'walk.map.caption': 'Der Weg: kleine Zeile über der Karte',

  'footer.title': 'Fußzeile: Name der Bar',
  'footer.instagram': 'Fußzeile: Instagram-Zeile',
  'footer.back': 'Fußzeile: Link nach oben',
};

// Parts of the page that are built from data or switched by a script. Each
// group has one size for all its elements; it has no text of its own.
export const STYLE_GROUPS = {
  'menu.tab': 'Karte: Reiter (Snacks, Cocktails, Getränke)',
  'menu.section.title': 'Karte: Titel der Abschnitte',
  'menu.section.subtitle': 'Karte: Untertitel der Abschnitte',
  'menu.item.name': 'Karte: Namen der Einträge',
  'menu.item.price': 'Karte: Preise',
  'menu.item.text': 'Karte: Beschreibungen der Einträge',
  'menu.item.note': 'Karte: Hinweise der Einträge',
  'special.title': 'Specials: Titel',
  'special.text': 'Specials: Text',
  'concept.card1.text': 'Video 1: Zeile mit Adresse und Öffnungszeiten',
  'hero.stage.title': 'Negroni-Animation: Titel der Schritte',
  'hero.stage.text': 'Negroni-Animation: Sätze der Schritte',
  'walk.step.title': 'Der Weg: Titel der Schritte',
  'walk.step.text': 'Der Weg: Sätze der Schritte',
};

// Texts that a page script shows one after the other in the same place
// (public/assets/js/script-03.js and script-04.js). They have no data-text
// element of their own, and their size is the size of their group.
const SWITCHED = /^(hero\.stage|walk\.step)\d\.(title|text)$/;
export const SCRIPT_TEXT_KEYS = Object.keys(TEXT_LABELS).filter((key) => SWITCHED.test(key));

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** The key under which a size is stored: a group key, or the text key itself. */
export function styleKeyOf(key) {
  const hit = SWITCHED.exec(String(key));
  return hit ? `${hit[1]}.${hit[2]}` : String(key);
}

export const isStyleGroup = (key) => typeof key === 'string' && own(STYLE_GROUPS, key);

/** Human name of a text key or style group. Never returns a technical key. */
export function labelFor(key) {
  if (typeof key === 'string') {
    if (own(TEXT_LABELS, key)) return TEXT_LABELS[key];
    if (own(STYLE_GROUPS, key)) return STYLE_GROUPS[key];
  }
  return 'Seitentext';
}
