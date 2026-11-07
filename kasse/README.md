# Ce March Kasse

Web-App für die Belege und das Kassenbuch des Cevi March. Alle Leiterinnen und
Leiter fotografieren ihren Beleg direkt mit dem Handy und schicken ihn mit
Betrag, Datum und Beschreibung ein. Die App vergibt automatisch eine
Belegnummer, rechnet auf den Rappen genau ab und zeigt, wem noch wie viel
Geld geschuldet wird. Am Schluss lassen sich alle Belege drucken und die
Kostenübersicht als Excel-Datei herunterladen.

Die App läuft auf einem eigenen VPS, speichert alles lokal (SQLite + Dateien)
und braucht keine externen Dienste.

---

## Was die App kann

**Für alle (Rolle „Melder“)**

- Beleg mit dem Handy fotografieren (oder PDF hochladen), Betrag, Datum,
  Beschreibung, Laden und Kategorie erfassen
- Nur die eigenen Belege sehen, solange sie offen sind auch korrigieren
- Sehen, welche Belege geprüft und welche schon zurückerstattet wurden

**Für Kassiere einer Kasse**

- Alle Belege dieser Kasse sehen, prüfen (einzeln oder mehrere auf einmal)
  oder mit Begründung ablehnen
- Einnahmen und Einzahlungen erfassen
- Abrechnung mit Saldo, Auswertung nach Kategorie, Kasse, Zahlungsart
- Excel-Export und Druckansicht aller Belege
- Rückerstattungen an Personen buchen

**Für die Abteilungsleitung (Rolle „admin“)**

- Alles von oben, über alle Kassen hinweg
- Kassen anlegen, umbenennen, schliessen, Startsaldo setzen
- Personen anlegen, sperren, Passwort zurücksetzen
- **Nur die Abteilungsleitung teilt Personen einer Kasse zu** und entscheidet,
  wer dort nur meldet und wer prüfen und abrechnen darf

### Belegnummern

Jeder Beleg bekommt beim Einreichen automatisch eine Nummer nach dem Muster

```
JS-2026-0001
│  │    └── fortlaufend pro Kasse und Jahr
│  └─────── Jahr des Einkaufsdatums
└────────── Kürzel der Kasse
```

Die Nummer ist eindeutig, lässt sich nicht mehr ändern und steht auf jeder
gedruckten Belegseite. Das Kürzel einer Kasse bleibt darum fest.

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

Beim allerersten Start legt die App ein Administratorkonto an und schreibt
E-Mail und Startpasswort ins Terminal. Danach im Browser `http://localhost:3000`
öffnen, anmelden und sofort ein eigenes Passwort setzen.

Datenbank und Fotos liegen in `kasse/data/` (nicht im Git).

---

## Auf dem VPS betreiben

### 1. Mit Docker (empfohlen)

```bash
git clone <dein-repo> /opt/ce-march-kasse
cd /opt/ce-march-kasse/kasse
docker compose up -d --build
docker compose logs -f        # zeigt das Startpasswort der Leitung
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

| Variable         | Bedeutung                                                   |
|------------------|-------------------------------------------------------------|
| `PORT`           | Port des Servers (Standard 3000)                             |
| `HOST`           | Adresse, Standard `0.0.0.0`                                  |
| `DATA_DIR`       | Ordner für Datenbank und Fotos                               |
| `TRUST_PROXY`    | `true`, wenn ein Reverse Proxy davor läuft                   |
| `COOKIE_SECURE`  | `true` bei HTTPS – sonst bleibt niemand angemeldet           |
| `MAX_UPLOAD_MB`  | Maximale Grösse pro Foto (Standard 20)                       |
| `ADMIN_NAME`     | Name des ersten Kontos (nur beim allerersten Start)          |
| `ADMIN_EMAIL`    | E-Mail des ersten Kontos                                     |
| `ADMIN_PASSWORT` | Optional. Ohne Angabe erzeugt die App eines und zeigt es an. |

---

## Sicherung

Gesichert werden müssen nur zwei Dinge, beide im Datenordner:

- `kasse.sqlite` – alle Buchungen, Benutzer, Kassen
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

## Benutzer von der Kommandozeile

Falls man sich einmal aussperrt:

```bash
npm run admin -- liste
npm run admin -- neu "Vorname Name" person@example.ch admin
npm run admin -- passwort person@example.ch
```

---

## Technik

- **Server**: Node.js, Express, SQLite (better-sqlite3, WAL)
- **Oberfläche**: reines HTML/CSS/JavaScript, kein Build-Schritt, als Web-App
  aufs Handy installierbar
- **Fotos**: werden mit `sharp` gedreht, auf 2000 px verkleinert und als JPEG
  gespeichert, dazu ein kleines Vorschaubild. Fehlt `sharp`, wird das Original
  unverändert abgelegt.
- **Excel**: `exceljs`, vier Blätter (Belege, Einnahmen, Zusammenzug, offene
  Auslagen)
- **Druck**: eigene Druckseite – zuerst die Belegliste, danach jeder Beleg auf
  einer eigenen A4-Seite mit Nummer, Betrag und Foto. Im Browser auf
  „Drucken“ oder „Als PDF speichern“.

### Sicherheit

- Passwörter mit bcrypt gehasht, Startpasswörter müssen beim ersten Anmelden
  geändert werden
- Sitzungen als httpOnly-Cookie, 30 Tage, serverseitig in der Datenbank
- CSRF-Token für alle verändernden Anfragen
- Belegfotos sind nicht öffentlich: jeder Abruf prüft die Berechtigung
- Anmeldeversuche werden begrenzt (8 Fehlversuche, dann 15 Minuten Sperre)
- Content-Security-Policy über `helmet`
- Jede Änderung landet im Protokoll (Tabelle `protokoll`)

`npm audit` meldet eine mittlere Schwachstelle in `uuid` als Unterpaket von
`exceljs`. Sie betrifft nur die UUID-Varianten 3/5/6 mit eigenem Puffer, die
hier nicht verwendet werden; ein Downgrade von `exceljs` wäre riskanter.

### Datenmodell

| Tabelle              | Inhalt                                                  |
|----------------------|---------------------------------------------------------|
| `benutzer`           | Personen, Rolle (`admin`/`benutzer`), IBAN              |
| `kassen`             | Kassen mit Kürzel, Farbe, Startsaldo                    |
| `kassen_mitglieder`  | Zuteilung Person → Kasse mit Rolle `melder`/`kassier`   |
| `belege`             | Belege inkl. Nummer, Betrag in Rappen, Status           |
| `beleg_dateien`      | Fotos und PDFs zu einem Beleg                           |
| `einnahmen`          | Einzahlungen in eine Kasse                              |
| `rueckerstattungen`  | Auszahlungen an Personen, verknüpft mit Belegen         |
| `sitzungen`          | angemeldete Geräte                                       |
| `protokoll`          | wer hat wann was geändert                               |
