BELLO – aperitivo bar, Kurze Str. 6A, 37073 Göttingen
Website (eine Seite, reines HTML/CSS/JS, kein Build-Schritt)

Live: https://bello-lyart.vercel.app/ (Vercel, aus dem GitHub-Repo, Branch master)
Lokal ansehen: im Projektordner "python -m http.server 8765 --directory public" starten und http://127.0.0.1:8765/ öffnen.

Dateien (die Website liegt in public/; nur dieser Ordner wird von Vercel ausgeliefert):
- public/index.html
- public/assets/css/styles.css
- public/assets/js/script-01.js  Mobiles Menü
- public/assets/js/script-03.js  Hero (Negroni-Animation beim Scrollen)
- public/assets/js/script-04.js  Weg vom Kornmarkt (Karte)
- public/assets/js/script-08.js  Video-Karussell
- public/assets/js/script-09.js  Karte (Tabs)
- public/assets/images/*         Hero-Ebenen, Poster, favicon.svg
- public/assets/video/bello-info.mp4  Info-Clip (erzeugt mit tools/make_info_video.py)

Extern geladen (brauchen Internet):
- Schriften von Google Fonts
- die zwei Instagram-Reels samt Vorschaubildern über einen val.run-Proxy
- Links zu Instagram und Google Maps

"Platz anfragen" führt zum Instagram-Profil @bello.aperitivobar; ein Buchungsformular gibt es nicht.
Impressum und Datenschutzerklärung fehlen noch.
