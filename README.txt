BELLO – aperitivo bar, Kurze Str. 6A, 37073 Göttingen
Website (eine Seite, reines HTML/CSS/JS, kein Build-Schritt)

Live: https://bello-lyart.vercel.app/ (Vercel, aus dem GitHub-Repo, Branch master)
Lokal ansehen: im Projektordner "python -m http.server 8765" starten und http://127.0.0.1:8765/ öffnen.

Dateien:
- index.html
- assets/css/styles.css
- assets/js/script-01.js  Mobiles Menü
- assets/js/script-03.js  Hero (Negroni-Animation beim Scrollen)
- assets/js/script-04.js  Weg vom Kornmarkt (Karte)
- assets/js/script-08.js  Video-Karussell
- assets/js/script-09.js  Karte (Tabs)
- assets/images/*         Hero-Ebenen, Poster, favicon.svg
- assets/video/bello-info.mp4  Info-Clip (erzeugt mit tools/make_info_video.py)

Extern geladen (brauchen Internet):
- Schriften von Google Fonts
- die zwei Instagram-Reels samt Vorschaubildern über einen val.run-Proxy
- Links zu Instagram und Google Maps

"Platz anfragen" führt zum Instagram-Profil @bello.aperitivobar; ein Buchungsformular gibt es nicht.
Impressum und Datenschutzerklärung fehlen noch.
