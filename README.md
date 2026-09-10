# CEVI March — Website



---

## Aufbau

```
index.html            Startseite (Foto-Collage + die drei Stufen)
impressum.html        Pflichtangaben nach Art. 3 UWG
datenschutz.html      Datenschutzerklärung nach DSG
stufen.html           Alpha, Zazu und Fröschli nacheinander (#alpha, #zazu, …)
kontakt.html          Kontakte, Treffpunkt und Schnuppern (#schnuppern)
jungschar.html        Organisation, Agenda, Lager, Verein, …
404.html              Fehlerseite (GitHub Pages)

assets/css/style.css  komplettes Design (Schrift, Farben, Rundungen)
assets/js/site.js     Menü, Scroll-Effekte, Einblendungen
assets/img/agenda/    Bild des aktuellen Datenplans     ← hier ablegen
assets/media/         Bilder
assets/docs/          PDFs (Datenpläne, Flyer, Statuten)

content/site.json     Texte, Kontakte, Datenplan        ← hier pflegen
tools/build.py        erzeugt aus content/ die HTML-Dateien
tools/bilder.py       verkleinert zu grosse Fotos
tools/ungenutzt.py    listet Dateien, die keine Seite mehr braucht
```

Gestaltung: Tagebuch, auf allen Seiten. Kariertes Papier als Grund, Fotos mit
Klebeband aufgeklebt und leicht schief, handschriftliche Bildtexte und
Randnotizen (Caveat), der Datenplan auf einem eingeklebten linierten Blatt,
Kontaktkarten wie angeheftete Zettel,
JetBrains Mono für Titel und Beschriftungen, DM Sans für Fliesstext. Beides sind Google Fonts und
werden im `<head>` geladen – Schriftwechsel geht über `tools/build.py`
(Link im `head()`) und die Variablen `--font-mono` / `--font-body` /
`--font-hand` zuoberst in `style.css`.

Die Collage auf der Startseite nimmt automatisch **alle Bilder aus
`assets/img/`** – neue Fotos einfach dort ablegen und `build.py` laufen lassen.
Das Bild aus `HERO.image` kommt zuerst, der Rest alphabetisch, höchstens zwölf.
Logo, `hero-1`, `hero-2`, `cevi-c` und `noise.svg` bleiben aussen vor.

Alle Links und Bildpfade sind relativ und liegen flach im Projektordner. Dadurch
funktioniert die Seite an jedem Ort gleich: lokal per Doppelklick, auf GitHub
Pages in einem Unterordner oder auf einer eigenen Domain.

---

## Ansehen

**Doppelklick auf `index.html`.** Das reicht – auch ohne Internet, ausser dass
dann die Schriften von Google Fonts fehlen und die Systemschrift einspringt.

Wer lieber einen lokalen Server will (nötig nur für den Supabase-Modus):
Doppelklick auf `start.bat`, oder von Hand

```bash
python -m http.server 5173
```

---

## Inhalte ändern

1. Passende Datei in `content/` bearbeiten.
2. Neu bauen:

   ```bash
   python tools/build.py
   ```

3. Änderungen committen und pushen.

Das Skript schreibt alle Seiten neu und prüft zum Schluss, ob jeder Link und
jedes Bild auf eine vorhandene Datei zeigt.

Wo was steht:

* **`content/site.json`** – Navigation, Startseite, Stufen, alle Textseiten,
  Kontaktpersonen, Datenplan
* **Bildtexte und Randnotizen** – in `content/site.json` bei der jeweiligen
  Seite die Felder `bildtext` (Handschrift unter dem Foto) und `notiz`
  (Randbemerkung neben dem Text)
* **Erstes Bild der Startseiten-Collage** – `HERO.image` in `content/site.json`
* **Karte auf der Kontaktseite** – `KONTAKT.ort.maps` (Link) und
  `KONTAKT.ort.embed` (eingebettete Google-Karte) in `content/site.json`
* **Agenda** – der Datenplan heisst immer gleich:
  `assets/img/agenda/datenplan.pdf` (oder `.jpg`, `.png`, `.webp`). Zum
  Aktualisieren einfach diese Datei ersetzen. Aus einem PDF macht `build.py`
  automatisch ein Bild, damit der Plan auch auf dem Handy lesbar ist – dafür
  braucht es `pymupdf` (in der GitHub-Action bereits eingebaut). Das PDF
  bleibt zusätzlich als Download verlinkt. Weitere Bilder im Ordner erscheinen
  darunter als frühere Pläne; ist der Ordner leer, zeigt die Seite die
  Terminliste aus `content/site.json`.
* **Neue Bilder** nach `assets/img/` legen, neue PDFs nach `assets/docs/`

Fotos direkt aus der Kamera sind oft 5–15 MB gross und bremsen die Seite.
Danach einmal

```bash
python tools/bilder.py --wirklich
```

rechnet alle Bilder in `assets/img/` auf maximal 2000 Pixel herunter (ohne
`--wirklich` zeigt es nur, was passieren würde).

Wer nur einen Tippfehler ändern will, kann auch direkt die `.html` anfassen –
beim nächsten `build.py` wird das aber überschrieben. Besser in `content/`
korrigieren.

---

## Automatisch bauen auf GitHub

Im Repository liegt ein Ablauf unter `.github/workflows/seiten-bauen.yml`.
Er startet bei jeder Änderung an `content/`, `assets/img/`, `assets/docs/`
oder `tools/build.py`, baut die Seiten neu und schreibt sie zurück.

Das heisst: `assets/img/agenda/datenplan.pdf` direkt auf github.com ersetzen
genügt – ein bis zwei Minuten später steht der neue Plan auf der Website.
Ohne Python auf dem eigenen Rechner, ohne `build.py`.

Damit das klappt, muss unter **Settings → Actions → General → Workflow
permissions** die Einstellung *Read and write permissions* aktiv sein.

---

## Auf GitHub veröffentlichen

```bash
git remote add origin https://github.com/<benutzer>/<repo>.git
git branch -M main
git push -u origin main
```

Danach im Repository unter **Settings → Pages** als Quelle
*Deploy from a branch* → `main` / `/ (root)` wählen. Nach ein bis zwei Minuten
ist die Seite unter `https://<benutzer>.github.io/<repo>/` erreichbar.

Eigene Domain: unter *Settings → Pages → Custom domain* `cevimarch.ch` eintragen
und beim Domain-Anbieter einen CNAME auf `<benutzer>.github.io` setzen.

Das Repository ist rund 140 MB gross. Ein grosser Teil davon wird seit dem
Entfernen der Beiträge nicht mehr gebraucht – vor allem fünf Videos aus den
alten „CEVI @ Home“-Beiträgen (~90 MB) und 36 alte Flyer-PDFs. Für GitHub Pages
ist das unproblematisch (Limit 1 GB), macht das Klonen aber langsam. Ungenutzte
Dateien finden:

```bash
python tools/ungenutzt.py
```

---

## Rechtliches

Zwei Seiten sind aus Schweizer Recht nötig und im Fuss jeder Seite verlinkt:

* **Impressum** – Art. 3 Abs. 1 lit. s UWG verlangt vollständige Angaben zu
  Identität und Kontaktadresse. Für einen Verein: Name gemäss Statuten, Sitz,
  E-Mail und eine vertretungsberechtigte Person.
* **Datenschutzerklärung** – seit dem revidierten DSG (in Kraft seit
  1.9.2023) gilt eine Informationspflicht (Art. 19 DSG). Sie muss sagen, wer
  verantwortlich ist, welche Daten anfallen und welche Rechte Besucherinnen
  und Besucher haben.

Beides steht in `content/site.json` unter `PAGES.impressum` und
`PAGES.datenschutz` und lässt sich dort bearbeiten.

**Vor dem Veröffentlichen prüfen:** Adresse des Vereins, vertretungsberechtigte
Person und Telefonnummer im Impressum stimmen? Die Angaben stammen von der
alten Website und aus den Einzahlungsangaben.

Die Datenschutzerklärung nennt zwei Dienste, die Daten ins Ausland übertragen:
Google Fonts (Schriften) und die eingebettete Google-Karte auf der
Kontaktseite. Beide senden die IP-Adresse der Besucherin an Google. Wer das
vermeiden will: Schriften lokal ablegen und die Karte durch ein Bild mit Link
ersetzen – dann fällt der Abschnitt weg.

## Keine Fotogalerie

Die Seite hatte einen Mitgliederbereich mit Fotoalben. Er ist entfernt worden,
weil er keinen echten Schutz bot: auf GitHub Pages liegt jede Datei öffentlich
im Netz. Die Anmeldemaske hätte die Alben nur vor Gelegenheitsbesuchern
versteckt – die Bilddateien wären für jeden abrufbar geblieben, und die
Albenliste stand im Quelltext der Seite.

Alle Fotos, die nur in der Galerie waren, sind gelöscht (154 Dateien, 37 MB).
Geblieben sind die 21 Bilder, die auf den Seiten selbst verwendet werden.

Wenn ihr die Alben zurückwollt, braucht es einen echten Zugriffsschutz –
zum Beispiel Supabase mit privatem Speicher und ablaufenden Links. Die Seite
kann dabei auf GitHub Pages bleiben.

Bevor Fotos von Kindern online gehen: Einverständnis der Eltern einholen.
"# CeviMarch_Webseite" 
