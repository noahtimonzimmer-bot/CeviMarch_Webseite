# Server einrichten

Die Website ist statisch, die Kassen-App braucht Node und einen eigenen
Prozess. Beides läuft auf einem kleinen Server:

- `cevimarch.ch` und `www.cevimarch.ch` → die Website aus diesem Ordner
- `kasse.cevimarch.ch` → die App aus `kasse/`, im Docker-Container
- nginx davor, HTTPS von Let's Encrypt

---

## 1. Was bestellen

Die App ist ein Kassenbuch für eine Handvoll Leute. Sie braucht fast
nichts:

| | |
|---|---|
| Betriebssystem | **Ubuntu 24.04 LTS** |
| Prozessor | 1–2 Kerne |
| Arbeitsspeicher | **2 GB** reichen, 4 GB sind bequem |
| Speicherplatz | **20–40 GB** (Belegfotos wachsen langsam) |

Das ist das **kleinste** Angebot bei jedem Anbieter. Nimm nicht das
grosse Paket, das kostet das Zehnfache und bringt hier nichts.

Beim Bestellen wird nach einem **SSH-Schlüssel** gefragt. Falls du noch
keinen hast, unter Windows in PowerShell:

```powershell
ssh-keygen -t ed25519 -C "cevimarch"
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Die ausgegebene Zeile beim Anbieter als öffentlichen Schlüssel einfügen.
Der private Schlüssel (`id_ed25519`, ohne `.pub`) bleibt auf deinem
Rechner und wird **nie** weitergegeben.

---

## 2. Server einrichten

Nach der Bestellung bekommst du eine IP-Adresse. Dann:

```bash
ssh root@<IP-Adresse>
curl -fsSL https://raw.githubusercontent.com/noahtimonzimmer-bot/CeviMarch_Webseite/main/server/einrichten.sh -o einrichten.sh
bash einrichten.sh
```

Das Skript installiert Docker, nginx und die Firewall, legt den Benutzer
`cevi` an, schaltet die Passwort-Anmeldung ab und holt das Projekt nach
`/opt/cevimarch`.

---

## 3. DNS umstellen

Im hosttech-Kundencenter unter **Domains → Domaincenter → cevimarch.ch →
DNS Records**:

| Typ | Name | Wert |
|---|---|---|
| A | `@` (leer) | *IP des Servers* |
| A | `www` | *IP des Servers* |
| A | `kasse` | *IP des Servers* |

Die alten A-Records auf `82.220.38.154` ersetzen.

**MX-, SPF- und DMARC-Einträge nicht anfassen** — sonst kommen keine
E-Mails mehr an. Auch `mail`, `webmail` und `default._domainkey` bleiben
auf der alten IP. Das Plesk-Hosting nicht kündigen, die Postfächer hängen
daran.

Es kann bis zu sechs Stunden dauern, bis die Umstellung überall greift.

---

## 4. Veröffentlichen und HTTPS

Sobald die Domain auf den Server zeigt:

```bash
ssh cevi@<IP-Adresse>
bash /opt/cevimarch/server/veroeffentlichen.sh
sudo bash /opt/cevimarch/server/https.sh
```

Beim allerersten Start erzeugt die Kassen-App zwei Passwörter und zeigt
sie im Protokoll an:

```bash
cd /opt/cevimarch/kasse
docker compose -f docker-compose.yml -f docker-compose.server.yml logs | head -40
```

Diese beiden Passwörter notieren und danach in der App unter
*Einstellungen* ändern.

---

## 5. Sicherung einrichten

Das Kassenbuch ist Buchhaltung — eine Sicherung ist Pflicht:

```bash
sudo crontab -e
```

Diese Zeile anfügen:

```
15 3 * * * bash /opt/cevimarch/server/sicherung.sh >> /var/log/kasse-sicherung.log 2>&1
```

Jede Nacht um 3:15 Uhr wird die Datenbank samt Belegen nach
`/var/sicherungen/kasse/` geschrieben, 30 Tage werden aufbewahrt.

**Das reicht allein nicht.** Eine Sicherung, die auf demselben Server
liegt, ist bei einem Serverausfall mit weg. Hol dir die Archive
regelmässig herunter:

```powershell
scp cevi@<IP>:/var/sicherungen/kasse/*.tar.gz .
```

---

## Änderungen ausspielen

Nach jedem Push auf GitHub:

```bash
ssh cevi@<IP> 'bash /opt/cevimarch/server/veroeffentlichen.sh'
```

Das holt den neuen Stand, baut den Container neu und lädt nginx.

---

## Nachsehen, wenn etwas klemmt

```bash
# Läuft die App?
cd /opt/cevimarch/kasse
docker compose -f docker-compose.yml -f docker-compose.server.yml ps
docker compose -f docker-compose.yml -f docker-compose.server.yml logs --tail 50

# Stimmt die nginx-Konfiguration?
sudo nginx -t

# Zeigt die Domain schon hierher?
dig +short cevimarch.ch
```
