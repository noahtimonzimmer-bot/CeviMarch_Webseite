# Cevi March Kasse

Web-App für die Belege und das Kassenbuch des Cevi March. Alle Leiterinnen und
Leiter fotografieren ihren Beleg direkt mit dem Handy und schicken ihn mit
Betrag, Datum und Beschreibung ein. Die App vergibt automatisch eine
Belegnummer, führt pro Kasse ein Kassenbuch mit laufendem Saldo und zeigt,
wem die Kasse noch wie viel Geld schuldet. Am Schluss lassen sich alle Belege
drucken und die Kostenübersicht als Excel-Datei herunterladen.

Die App läuft auf einem eigenen VPS, speichert alles lokal (SQLite + Dateien)
und braucht keine externen Dienste.

---

## Wer darf was

Es gibt vier Rollen. Drei davon haben ein eigenes Konto mit E-Mail und
selbst gesetztem Passwort, die vierte braucht gar keines.

| Rolle | Anmeldung | Was man darf |
|---|---|---|
| **Abteilungsleitung** (`admin`) | E-Mail + eigenes Passwort | alles, über alle Kassen: Kassen anlegen, Personen anlegen, Kassen freigeben, prüfen, auszahlen, abrechnen |
| **Vereinskassier** (`kassier`) | E-Mail + eigenes Passwort | sieht alle Kassen und führt das Vereinskonto: zahlt die Leiter zurück und begleicht die Rechnungen der Kassenchefs. Führt aber kein Kassenbuch und prüft keine Belege. |
| **Kassenchef** (`chef`) | E-Mail + eigenes Passwort | nur die Kassen, die ihm freigegeben sind: Belege prüfen, Einnahmen erfassen, drucken, exportieren |
| **Leiterin / Leiter** | nur ein gemeinsames Passwort | Belege einreichen, bei jeder Kasse. Sieht nur die Belege des eigenen Geräts – keine Kassenstände, keine fremden Belege. |

Die Trennung ist gewollt: der Kassenchef entscheidet, **ob** eine Ausgabe
in seine Kasse gehört, der Vereinskassier **bezahlt** sie. Nur er hat
Zugriff auf das Konto des Vereins.

Während des Jahres prüft also der Kassenchef, und der Vereinskassier zahlt.
Am Jahresende macht der Vereinskassier die Kontrolle: er kann jedes
Kassenbuch jedes Jahres ansehen, als Excel herunterladen und mit allen
Belegen ausdrucken – auch die Kassen, die er selbst nie geführt hat.

Die Anmeldeseite zeigt zuerst nur ein Passwortfeld – das ist der Weg für
alle Leiter. Darunter führt ein Knopf zur Anmeldung mit E-Mail.

### Konten anlegen

Die Abteilungsleitung legt unter **Personen** eine Person an: Name,
E-Mail, Rolle, IBAN und die Kassen, die sie betreuen darf. Die App zeigt
daraufhin **einmal** ein Startpasswort wie `Stern-Feuer-2277`. Das gibst
du persönlich weiter – die App verschickt keine E-Mails. Beim ersten
Anmelden muss die Person ein eigenes Passwort setzen.

Vergessenes Passwort: unter *Personen* auf **Neues Passwort**, dann wird
ein neues Startpasswort erzeugt und die Person überall abgemeldet.

### Ohne Bargeld abrechnen

Der ganze Ablauf kommt ohne Kassenbargeld aus:

1. Ein Leiter kauft etwas, legt das Geld aus und **reicht den Beleg ein**.
2. Der **Kassenchef prüft** den Beleg. Er landet im Kassenbuch, der Saldo
   der Kasse sinkt, und unter *Diese Kasse schuldet noch* steht der Name
   des Leiters mit dem Betrag.
3. Der **Vereinskassier überweist** dem Leiter das Geld vom Vereinskonto –
   er ist der einzige, der darauf Zugriff hat – und bucht es in der App als
   *vom Vereinskonto bezahlt*. Damit ist die Auslage erledigt.

Der Saldo der Kasse ändert sich bei der Auszahlung nicht mehr: das Geld war
schon beim Prüfen gebucht. Die Liste der Schulden zeigt nur, was noch
auszuzahlen ist.

### Wenn ein Kassenchef selbst vorstreckt

Manchmal geht es nicht anders und ein Kassenchef bezahlt einen Leiter aus
der eigenen Tasche. Dann bucht er es als *„Ich habe vorgestreckt“*:

1. Die Schuld wandert vom Leiter auf ihn. In der Kasse steht unter seinem
   Namen, was der Verein ihm schuldet.
2. Am Jahresende **stellt er eine Rechnung** über alles, was er vorgestreckt
   hat. Sie lässt sich drucken oder als PDF speichern und enthält seine
   IBAN, die einzelnen Auszahlungen und die Belegnummern.
3. Der **Vereinskassier überweist** den Betrag und hakt die Rechnung in der
   App als *bezahlt* ab. Damit ist auch diese Schuld erledigt.

## Was die App kann

**Für alle Leiterinnen und Leiter**

- Ein grosser Knopf: *Beleg erfassen*
- Beleg mit dem Handy fotografieren (oder PDF hochladen), Betrag, Datum,
  Beschreibung und Laden erfassen
- Die eigenen Belege dieses Geräts ansehen, solange sie offen sind auch
  korrigieren oder löschen

**Für Kassenchefs, in ihren Kassen**

- Kassenbuch mit laufendem Saldo, Belege, offene Auslagen – alles an einem
  Ort, nichts über mehrere Kassen gemischt
- Belege prüfen (einzeln oder mehrere auf einmal) oder ablehnen
- Einnahmen und Einzahlungen erfassen
- Festhalten, wenn man einen Leiter selbst aus der eigenen Tasche bezahlt
  hat, und daraus eine Rechnung an den Verein stellen
- Excel-Export und Druckansicht

**Für den Vereinskassier, über alle Kassen**

- Alle Kassenbücher und Belege ansehen, drucken, exportieren
- Die offenen Auslagen aller Kassen an einem Ort sehen
- Leiter vom Vereinskonto zurückzahlen
- Rechnungen der Kassenchefs als bezahlt abhaken

**Für die Abteilungsleitung**

- Alles von oben
- Kassen anlegen, umbenennen, schliessen, Startsaldo setzen
- Personen anlegen, sperren, Passwort zurücksetzen
- **Nur die Abteilungsleitung gibt einem Kassenchef seine Kassen frei**

### Das Kassenbuch

Jede Kasse hat ihr eigenes Buch, genau wie auf Papier – Übertrag zuoberst,
danach jede Bewegung mit laufendem Saldo:

| Datum | Nr. | Beschreibung | Ausgelegt von | Einnahme | Ausgabe | Saldo |
|-------|-----|--------------|---------------|----------|---------|-------|
|       |     | Übertrag aus 2025 |          |          |         | 500.00 |
| 15.01.2026 |  | Lagerbeiträge |          | 2’000.00 |         | 2’500.00 |
| 14.03.2026 | 1 | Znüni Samstag | Lea       |          | 12.50   | 2’487.50 |

Ins Buch kommt nur, was **geprüft** ist. Neu eingereichte Belege stehen
darüber in einem eigenen Kasten und zählen erst nach dem Prüfen beim Saldo mit.

### Belegnummern

Jeder Beleg bekommt beim Einreichen eine Nummer, die **pro Kasse und Jahr**
von 1 an hochzählt: Nr. 1, Nr. 2, Nr. 3 … Jede Kasse hat ihre eigene Reihe,
und die Nummer lässt sich nicht mehr ändern. Sie steht auf jeder gedruckten
Belegseite.

### Geldbeträge

Intern wird ausschliesslich in **ganzen Rappen** gerechnet (Integer), nie mit
Kommazahlen. Eingaben wie `12.50`, `12,50`, `1'234.05` oder `80.-` werden alle
korrekt erkannt.

---

## Lokal starten (zum Ausprobieren)

Voraussetzung: Node.js 20 oder neuer.

```bash
cd kasse
npm install
npm start
```

Beim allerersten Start legt die App das Konto der Abteilungsleitung und das
gemeinsame Passwort an, schreibt beides ins Terminal und erstellt eine erste
Kasse („AL-Kasse“). Danach im Browser `http://localhost:3000` öffnen, mit
E-Mail anmelden und unter *Mein Konto* ein eigenes Passwort setzen.

Datenbank und Fotos liegen in `kasse/data/` (nicht im Git).

---

## Auf dem VPS betreiben

### 1. Mit Docker (empfohlen)

```bash
git clone <dein-repo> /opt/ce-march-kasse
cd /opt/ce-march-kasse/kasse
docker compose up -d --build
docker compose logs -f        # zeigt die Startpasswörter
```

Der Container hört nur auf `127.0.0.1:3000`; davor gehört ein Reverse Proxy
mit HTTPS. Die Daten liegen im Docker-Volume `kassendaten` unter `/daten`.

### 2. nginx davor

```nginx
server {
    listen 443 ssl http2;
    server_name kasse.cevimarch.ch;

    ssl_certificate     /etc/letsencrypt/live/kasse.cevimarch.ch/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kasse.cevimarch.ch/privkey.pem;

    # Handyfotos sind gross
    client_max_body_size 25m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name kasse.cevimarch.ch;
    return 301 https://$host$request_uri;
}
```

Zertifikat mit `certbot --nginx -d kasse.cevimarch.ch`.

Wichtig: Mit HTTPS davor müssen `TRUST_PROXY=true` und `COOKIE_SECURE=true`
gesetzt sein (in `docker-compose.yml` bereits so).

### 3. Ohne Docker (systemd)

```bash
cd /opt/ce-march-kasse/kasse
npm install --omit=dev
cp .env.example .env     # anpassen
```

`/etc/systemd/system/ce-march-kasse.service`:

```ini
[Unit]
Description=Cevi March Kasse
After=network.target

[Service]
Type=simple
User=kasse
WorkingDirectory=/opt/ce-march-kasse/kasse
EnvironmentFile=/opt/ce-march-kasse/kasse/.env
ExecStart=/usr/bin/node src/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now ce-march-kasse
journalctl -u ce-march-kasse -f
```

---

## Einstellungen (.env)

| Variable             | Bedeutung                                                      |
|----------------------|-----------------------------------------------------------------|
| `PORT`               | Port des Servers (Standard 3000)                                  |
| `HOST`               | Adresse, Standard `0.0.0.0`                                       |
| `DATA_DIR`           | Ordner für Datenbank und Fotos                                    |
| `TRUST_PROXY`        | `true`, wenn ein Reverse Proxy davor läuft                        |
| `COOKIE_SECURE`      | `true` bei HTTPS – sonst bleibt niemand angemeldet                |
| `MAX_UPLOAD_MB`      | Maximale Grösse pro Foto (Standard 20)                            |
| `ADMIN_NAME`         | Name des ersten Kontos (nur beim allerersten Start)               |
| `ADMIN_EMAIL`        | E-Mail des ersten Kontos, Standard `noahtimonzimmer@gmail.com`    |
| `ADMIN_PASSWORT`     | Optional. Ohne Angabe erzeugt die App eines und zeigt es an.      |
| `PASSWORT_MITARBEIT` | Optional. Das gemeinsame Passwort zum Belege erfassen.            |

Diese vier wirken nur beim allerersten Start, solange es noch kein Konto
gibt. Danach ändert man alles in der App oder über die Kommandozeile.

---

## Sicherung

Gesichert werden müssen nur zwei Dinge, beide im Datenordner:

- `kasse.sqlite` – alle Buchungen, Kassen, Passwörter
- `uploads/` – die Belegfotos

```bash
# Taegliche Sicherung (Docker)
docker compose exec -T kasse \
  node -e "const D=require('better-sqlite3')('/daten/kasse.sqlite');D.backup('/daten/sicherung.sqlite')"
docker cp ce-march-kasse:/daten /sicherung/kasse-$(date +%F)
```

Ohne Docker genügt es, den ganzen `data/`-Ordner zu kopieren – am besten mit
gestopptem Dienst oder über den `.backup`-Befehl von SQLite.

---

## Kommandozeile

Falls man sich einmal aussperrt:

```bash
npm run admin -- konten                        # alle Konten anzeigen
npm run admin -- passwort lea@example.ch       # neues Startpasswort
npm run admin -- admin "Noah Zimmer" noah@…    # Abteilungsleitung anlegen
npm run admin -- kassier "Max Muster" max@…    # Vereinskassier anlegen
npm run admin -- melder                        # gemeinsames Passwort neu setzen
npm run admin -- kassen                        # Kassen und Saldi anzeigen
```

---

## Technik

- **Server**: Node.js, Express, SQLite (better-sqlite3, WAL)
- **Oberfläche**: reines HTML/CSS/JavaScript, kein Build-Schritt, mittig
  gesetzt, als Web-App aufs Handy installierbar, heller und dunkler Modus
- **Fotos**: werden mit `sharp` gedreht, auf 2000 px verkleinert und als JPEG
  gespeichert, dazu ein kleines Vorschaubild. Fehlt `sharp`, wird das Original
  unverändert abgelegt.
- **Excel**: `exceljs`, drei Blätter (Kassenbuch, Belege, offene Auslagen) –
  immer für genau eine Kasse
- **Rechnung**: eigene A4-Seite mit IBAN, den einzelnen Auszahlungen und den
  Belegnummern, zum Drucken oder als PDF
- **Druck**: eigene Druckseite pro Kasse – zuerst das Kassenbuch mit laufendem
  Saldo, danach jeder Beleg auf einer eigenen A4-Seite mit Nummer, Betrag und
  Foto. Im Browser auf „Drucken“ oder „Als PDF speichern“.

### Sicherheit

- Konto-Passwörter brauchen mindestens 8 Zeichen. Das gemeinsame Passwort
  zum Belege erfassen darf ab 4 Zeichen kurz sein – es wird im Lager mündlich
  weitergegeben und kommt nur an das Beleg-Formular, nicht an Kassenstände
  oder fremde Belege.
- Passwörter mit bcrypt gehasht, nie im Klartext gespeichert. Startpasswörter
  werden genau einmal angezeigt und müssen beim ersten Anmelden geändert werden.
- Sitzungen als httpOnly-Cookie, 30 Tage, serverseitig in der Datenbank.
  Wird ein Passwort geändert oder ein Konto gesperrt, fliegen die übrigen
  Geräte dieses Kontos sofort raus.
- CSRF-Token für alle verändernden Anfragen
- Anmeldeversuche werden begrenzt (10 Fehlversuche, dann 15 Minuten Sperre)
- Belegfotos sind nicht öffentlich: jeder Abruf prüft die Berechtigung
- Wer nur das gemeinsame Passwort hat, sieht ausschliesslich die Belege, die
  von seinem eigenen Gerät eingereicht wurden
- Ein Kassenchef kommt nur an die Kassen, die ihm freigegeben sind – geprüft
  wird das bei jedem einzelnen Aufruf, nicht nur in der Oberfläche
- Content-Security-Policy über `helmet`
- Jede Änderung landet im Protokoll (Tabelle `protokoll`)

`npm audit` meldet eine mittlere Schwachstelle in `uuid` als Unterpaket von
`exceljs`. Sie betrifft nur die UUID-Varianten 3/5/6 mit eigenem Puffer, die
hier nicht verwendet werden; ein Downgrade von `exceljs` wäre riskanter.

### Datenmodell

| Tabelle              | Inhalt                                                     |
|----------------------|-------------------------------------------------------------|
| `benutzer`           | Konten von Abteilungsleitung, Vereinskassier und Kassenchefs, mit IBAN |
| `kassen_chefs`       | welcher Kassenchef betreut welche Kasse                     |
| `rechnungen`         | Rechnungen der Kassenchefs an den Verein                    |
| `einstellungen`      | der Hash des gemeinsamen Passworts                          |
| `kassen`             | Kassen mit Farbe und Startsaldo                             |
| `belege`             | Belege inkl. Nummer (pro Kasse und Jahr), Betrag in Rappen, Name der auslegenden Person, Status |
| `beleg_dateien`      | Fotos und PDFs zu einem Beleg                               |
| `einnahmen`          | Einzahlungen in eine Kasse                                  |
| `rueckerstattungen`  | Auszahlungen an Leiter, verknüpft mit Belegen; hält fest, ob ein Kassenchef sie vorgestreckt hat |
| `sitzungen`          | angemeldete Geräte mit Rolle und, bei Konten, der Person    |
| `protokoll`          | wer hat wann was geändert                                   |
