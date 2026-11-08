# Ce March Kasse

Web-App für die Belege und das Kassenbuch des Cevi March. Alle Leiterinnen und
Leiter fotografieren ihren Beleg direkt mit dem Handy und schicken ihn mit
Betrag, Datum und Beschreibung ein. Die App vergibt automatisch eine
Belegnummer, führt pro Kasse ein Kassenbuch mit laufendem Saldo und zeigt,
wem die Kasse noch wie viel Geld schuldet. Am Schluss lassen sich alle Belege
drucken und die Kostenübersicht als Excel-Datei herunterladen.

Die App läuft auf einem eigenen VPS, speichert alles lokal (SQLite + Dateien)
und braucht keine externen Dienste.

---

## Zwei Passwörter statt Benutzerkonten

Es gibt keine persönlichen Konten und keine E-Mail-Adressen. Die Anmeldeseite
hat nur ein Feld, und welches Passwort man eingibt, entscheidet, was man sieht:

| Passwort        | Was man darf                                                                 |
|-----------------|------------------------------------------------------------------------------|
| **Leitung**     | alles: Kassen anlegen und ändern, Belege prüfen, Einnahmen und Rückerstattungen buchen, drucken, exportieren |
| **Mitarbeit**   | nur Belege einreichen und die eigenen Belege dieses Geräts ansehen – keine Kassenstände, keine fremden Belege |

Beide Abteilungsleitungen benutzen dasselbe Leitungspasswort. Beim allerersten
Start erzeugt die App beide Passwörter und schreibt sie ins Terminal; danach
ändert man sie in der App unter **Einstellungen**.

Wer etwas ausgelegt hat, steht als **Name** direkt beim Beleg. Der Browser
merkt sich den Namen und setzt ihn beim nächsten Beleg von selbst ein; dazu
schlägt die App die Namen vor, die in dieser Kasse schon vorkamen.

---

## Was die App kann

**Für alle (Mitarbeitspasswort)**

- Ein grosser Knopf: *Beleg erfassen*
- Beleg mit dem Handy fotografieren (oder PDF hochladen), Betrag, Datum,
  Beschreibung und Laden erfassen
- Die eigenen Belege dieses Geräts ansehen, solange sie offen sind auch
  korrigieren oder löschen

**Für die Abteilungsleitung (Leitungspasswort)**

- Übersicht über **alle Kassen** mit Saldo, offenen Belegen und offenen Auslagen
- In jeder Kasse: Kassenbuch, Belege, Schulden, Einnahmen, Excel und Druck –
  alles an einem Ort, nichts über mehrere Kassen gemischt
- Belege prüfen (einzeln oder mehrere auf einmal) oder ablehnen
- Einnahmen und Einzahlungen erfassen
- Rückerstattungen an Personen buchen
- Kassen anlegen, umbenennen, schliessen, Startsaldo setzen

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

Beim allerersten Start schreibt die App die beiden Passwörter ins Terminal und
legt eine erste Kasse („AL-Kasse“) an. Danach im Browser `http://localhost:3000`
öffnen, anmelden und die Passwörter unter *Einstellungen* ändern.

Datenbank und Fotos liegen in `kasse/data/` (nicht im Git).

---

## Auf dem VPS betreiben

### 1. Mit Docker (empfohlen)

```bash
git clone <dein-repo> /opt/ce-march-kasse
cd /opt/ce-march-kasse/kasse
docker compose up -d --build
docker compose logs -f        # zeigt die beiden Startpasswörter
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
Description=Ce March Kasse
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
| `PASSWORT_LEITUNG`   | Optional. Ohne Angabe erzeugt die App eines und zeigt es an.      |
| `PASSWORT_MITARBEIT` | Optional. Ohne Angabe erzeugt die App eines und zeigt es an.      |

Beide Passwort-Variablen wirken nur beim allerersten Start, solange noch
keines gesetzt ist. Danach ändert man sie in der App oder über die
Kommandozeile.

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
npm run admin -- leitung             # neues Leitungspasswort erzeugen
npm run admin -- leitung Geheim123   # Leitungspasswort selbst setzen
npm run admin -- mitarbeit           # neues Mitarbeitspasswort
npm run admin -- kassen              # Kassen und Saldi anzeigen
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
- **Druck**: eigene Druckseite pro Kasse – zuerst das Kassenbuch mit laufendem
  Saldo, danach jeder Beleg auf einer eigenen A4-Seite mit Nummer, Betrag und
  Foto. Im Browser auf „Drucken“ oder „Als PDF speichern“.

### Sicherheit

- Passwörter mit bcrypt gehasht, nie im Klartext gespeichert
- Sitzungen als httpOnly-Cookie, 30 Tage, serverseitig in der Datenbank.
  Wird ein Passwort geändert, fliegen alle anderen Geräte mit dieser Rolle raus.
- CSRF-Token für alle verändernden Anfragen
- Anmeldeversuche werden begrenzt (10 Fehlversuche, dann 15 Minuten Sperre)
- Belegfotos sind nicht öffentlich: jeder Abruf prüft die Berechtigung
- Wer nur das Mitarbeitspasswort hat, sieht ausschliesslich die Belege, die
  von seinem eigenen Gerät eingereicht wurden
- Content-Security-Policy über `helmet`
- Jede Änderung landet im Protokoll (Tabelle `protokoll`)

`npm audit` meldet eine mittlere Schwachstelle in `uuid` als Unterpaket von
`exceljs`. Sie betrifft nur die UUID-Varianten 3/5/6 mit eigenem Puffer, die
hier nicht verwendet werden; ein Downgrade von `exceljs` wäre riskanter.

### Datenmodell

| Tabelle              | Inhalt                                                     |
|----------------------|-------------------------------------------------------------|
| `einstellungen`      | die beiden Passwort-Hashes                                  |
| `kassen`             | Kassen mit Farbe und Startsaldo                             |
| `belege`             | Belege inkl. Nummer (pro Kasse und Jahr), Betrag in Rappen, Name der auslegenden Person, Status |
| `beleg_dateien`      | Fotos und PDFs zu einem Beleg                               |
| `einnahmen`          | Einzahlungen in eine Kasse                                  |
| `rueckerstattungen`  | Auszahlungen an Personen, verknüpft mit Belegen             |
| `sitzungen`          | angemeldete Geräte mit ihrer Rolle                          |
| `protokoll`          | wer hat wann was geändert                                   |
