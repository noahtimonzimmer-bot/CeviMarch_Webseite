-- Datenbankschema "Ce March Kasse"
-- Alle Geldbetraege werden als ganze Rappen (INTEGER) gespeichert,
-- damit es keine Rundungsfehler gibt.
--
-- Zugang auf zwei Wegen:
--   * Abteilungsleitung, Vereinskassier und Kassenchefs haben ein Konto
--     mit E-Mail und eigenem Passwort (Tabelle benutzer).
--   * Alle uebrigen reichen mit einem gemeinsamen Passwort Belege ein und
--     schreiben ihren Namen direkt beim Beleg dazu.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Schluessel/Wert-Tabelle, unter anderem fuer das gemeinsame Passwort.
CREATE TABLE IF NOT EXISTS einstellungen (
  schluessel  TEXT PRIMARY KEY,
  wert        TEXT NOT NULL,
  geaendert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Konten fuer alle, die mehr duerfen als Belege einreichen.
--   admin   = Abteilungsleitung: sieht und darf alles
--   kassier = Vereinskassier: sieht alle Kassen, zahlt die Leiter vom
--             Vereinskonto zurueck und bezahlt die Rechnungen. Er fuehrt
--             aber kein Kassenbuch und prueft keine Belege.
--   chef    = Kassenchef: fuehrt die Kassen, die ihm zugeteilt sind, und
--             prueft dort die Belege
CREATE TABLE IF NOT EXISTS benutzer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  passwort_hash TEXT    NOT NULL,
  rolle         TEXT    NOT NULL DEFAULT 'chef' CHECK (rolle IN ('admin', 'kassier', 'chef')),
  iban          TEXT,          -- fuer die Rechnung an den Verein
  telefon       TEXT,
  aktiv         INTEGER NOT NULL DEFAULT 1,
  passwort_neu  INTEGER NOT NULL DEFAULT 1,  -- 1 = muss beim Anmelden geaendert werden
  erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kassen (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  beschreibung      TEXT,
  farbe             TEXT    NOT NULL DEFAULT '#d21a37',
  startsaldo_rappen INTEGER NOT NULL DEFAULT 0,
  aktiv             INTEGER NOT NULL DEFAULT 1,
  reihenfolge       INTEGER NOT NULL DEFAULT 0,
  erstellt_am       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Auszahlung an eine Person, die etwas ausgelegt hat.
--
-- Zahlt ein Kassenchef aus der eigenen Tasche, steht er in
-- "uebernommen_von". Die Schuld wandert damit vom Leiter auf den Chef:
-- der Verein schuldet das Geld neu ihm. Sobald er daraus eine Rechnung
-- stellt, haengt sie in "rechnung_id".
CREATE TABLE IF NOT EXISTS rueckerstattungen (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kasse_id        INTEGER NOT NULL REFERENCES kassen(id) ON DELETE CASCADE,
  person          TEXT    NOT NULL,
  datum           TEXT    NOT NULL,
  betrag_rappen   INTEGER NOT NULL,
  methode         TEXT    NOT NULL DEFAULT 'bank' CHECK (methode IN ('bank', 'bar', 'twint', 'verrechnet')),
  quelle          TEXT    NOT NULL DEFAULT 'eigene_tasche'
                  CHECK (quelle IN ('eigene_tasche', 'kasse')),
  uebernommen_von INTEGER REFERENCES benutzer(id),
  rechnung_id     INTEGER REFERENCES rechnungen(id) ON DELETE SET NULL,
  notiz           TEXT,
  erstellt_am     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Welcher Kassenchef betreut welche Kasse. Zuteilen darf nur ein Admin.
CREATE TABLE IF NOT EXISTS kassen_chefs (
  kasse_id    INTEGER NOT NULL REFERENCES kassen(id)   ON DELETE CASCADE,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  erstellt_am TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kasse_id, benutzer_id)
);

-- Rechnung eines Kassenchefs an den Verein: alles, was er aus eigener
-- Tasche vorgestreckt hat und noch nicht zurueckbekommen hat.
CREATE TABLE IF NOT EXISTS rechnungen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kasse_id      INTEGER NOT NULL REFERENCES kassen(id)   ON DELETE CASCADE,
  benutzer_id   INTEGER NOT NULL REFERENCES benutzer(id),
  jahr          INTEGER NOT NULL,
  nummer        INTEGER NOT NULL,          -- fortlaufend pro Jahr
  datum         TEXT    NOT NULL,
  betrag_rappen INTEGER NOT NULL,
  iban          TEXT,                      -- Stand bei der Ausstellung
  status        TEXT    NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'bezahlt')),
  bezahlt_am    TEXT,
  notiz         TEXT,
  erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (jahr, nummer)
);

-- Ein Beleg gehoert immer genau einer Kasse. Die Nummer zaehlt innerhalb
-- dieser Kasse und innerhalb des Jahres von 1 an hoch - wie im Kassenbuch
-- auf Papier.
CREATE TABLE IF NOT EXISTS belege (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  kasse_id           INTEGER NOT NULL REFERENCES kassen(id) ON DELETE CASCADE,
  jahr               INTEGER NOT NULL,
  nummer             INTEGER NOT NULL,          -- fortlaufend pro Kasse und Jahr
  datum              TEXT    NOT NULL,          -- Einkaufsdatum, ISO: YYYY-MM-DD
  betrag_rappen      INTEGER NOT NULL CHECK (betrag_rappen > 0),
  beschreibung       TEXT    NOT NULL,
  haendler           TEXT,
  zahlungsart        TEXT    NOT NULL DEFAULT 'privat'
                     CHECK (zahlungsart IN ('privat', 'kasse_bar', 'kasse_karte', 'rechnung')),
  person             TEXT,                      -- wer ausgelegt hat (bei 'privat' Pflicht)
  status             TEXT    NOT NULL DEFAULT 'offen'
                     CHECK (status IN ('offen', 'geprueft', 'abgelehnt')),
  notiz              TEXT,
  ablehnungsgrund    TEXT,
  geraet             TEXT,                      -- anonyme Kennung des einreichenden Geraets
  erstellt_am        TEXT    NOT NULL DEFAULT (datetime('now')),
  geprueft_am        TEXT,
  rueckerstattung_id INTEGER REFERENCES rueckerstattungen(id) ON DELETE SET NULL,
  UNIQUE (kasse_id, jahr, nummer)
);

CREATE TABLE IF NOT EXISTS beleg_dateien (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  beleg_id      INTEGER NOT NULL REFERENCES belege(id) ON DELETE CASCADE,
  pfad          TEXT    NOT NULL,   -- relativ zum Upload-Ordner
  vorschau_pfad TEXT,
  mime          TEXT    NOT NULL,
  original_name TEXT,
  groesse       INTEGER NOT NULL DEFAULT 0,
  erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Einnahmen und Einzahlungen in eine Kasse (Uebertrag, Beitraege, Zuschuesse).
CREATE TABLE IF NOT EXISTS einnahmen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kasse_id      INTEGER NOT NULL REFERENCES kassen(id) ON DELETE CASCADE,
  datum         TEXT    NOT NULL,
  betrag_rappen INTEGER NOT NULL CHECK (betrag_rappen > 0),
  beschreibung  TEXT    NOT NULL,
  erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sitzungen (
  sid         TEXT    PRIMARY KEY,
  rolle       TEXT    NOT NULL CHECK (rolle IN ('admin', 'kassier', 'chef', 'melder')),
  benutzer_id INTEGER REFERENCES benutzer(id) ON DELETE CASCADE,  -- leer bei 'melder'
  csrf        TEXT    NOT NULL,
  ablauf      INTEGER NOT NULL,
  erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS protokoll (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rolle       TEXT,
  aktion      TEXT    NOT NULL,
  objekt      TEXT,
  objekt_id   INTEGER,
  details     TEXT,
  erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chefs_benutzer ON kassen_chefs(benutzer_id);
CREATE INDEX IF NOT EXISTS idx_rechnungen      ON rechnungen(kasse_id, status);
CREATE INDEX IF NOT EXISTS idx_belege_kasse  ON belege(kasse_id, datum);
CREATE INDEX IF NOT EXISTS idx_belege_status ON belege(kasse_id, status);
CREATE INDEX IF NOT EXISTS idx_belege_person ON belege(person);
CREATE INDEX IF NOT EXISTS idx_einnahmen     ON einnahmen(kasse_id, datum);
CREATE INDEX IF NOT EXISTS idx_dateien_beleg ON beleg_dateien(beleg_id);
CREATE INDEX IF NOT EXISTS idx_sitzungen_abl ON sitzungen(ablauf);
