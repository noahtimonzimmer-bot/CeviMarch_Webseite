-- Datenbankschema "Ce March Kasse"
-- Alle Geldbetraege werden als ganze Rappen (INTEGER) gespeichert,
-- damit es keine Rundungsfehler gibt.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS benutzer (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  passwort_hash  TEXT    NOT NULL,
  rolle          TEXT    NOT NULL DEFAULT 'benutzer' CHECK (rolle IN ('admin', 'benutzer')),
  iban           TEXT,
  telefon        TEXT,
  aktiv          INTEGER NOT NULL DEFAULT 1,
  passwort_neu   INTEGER NOT NULL DEFAULT 0,  -- 1 = Passwort muss beim Login geaendert werden
  erstellt_am    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kassen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  kuerzel       TEXT    NOT NULL UNIQUE COLLATE NOCASE,  -- z.B. JS, PF, AL
  beschreibung  TEXT,
  farbe         TEXT    NOT NULL DEFAULT '#d21a37',
  startsaldo_rappen INTEGER NOT NULL DEFAULT 0,
  aktiv         INTEGER NOT NULL DEFAULT 1,
  erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Wer darf bei welcher Kasse was?
--   melder  = darf Belege fuer diese Kasse einreichen und nur die eigenen sehen
--   kassier = sieht und prueft alle Belege dieser Kasse, darf abrechnen und exportieren
CREATE TABLE IF NOT EXISTS kassen_mitglieder (
  kasse_id    INTEGER NOT NULL REFERENCES kassen(id)   ON DELETE CASCADE,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  rolle       TEXT    NOT NULL DEFAULT 'melder' CHECK (rolle IN ('melder', 'kassier')),
  erstellt_am TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kasse_id, benutzer_id)
);

CREATE TABLE IF NOT EXISTS rueckerstattungen (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id    INTEGER NOT NULL REFERENCES benutzer(id),
  datum          TEXT    NOT NULL,
  betrag_rappen  INTEGER NOT NULL,
  methode        TEXT    NOT NULL DEFAULT 'bank' CHECK (methode IN ('bank', 'bar', 'twint', 'verrechnet')),
  notiz          TEXT,
  erstellt_von   INTEGER REFERENCES benutzer(id),
  erstellt_am    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS belege (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  kasse_id           INTEGER NOT NULL REFERENCES kassen(id),
  nummer             TEXT    NOT NULL UNIQUE,   -- z.B. JS-2026-0042
  jahr               INTEGER NOT NULL,
  laufnummer         INTEGER NOT NULL,
  datum              TEXT    NOT NULL,          -- Einkaufsdatum, ISO: YYYY-MM-DD
  betrag_rappen      INTEGER NOT NULL CHECK (betrag_rappen > 0),
  beschreibung       TEXT    NOT NULL,
  haendler           TEXT,
  kategorie          TEXT    NOT NULL DEFAULT 'Sonstiges',
  zahlungsart        TEXT    NOT NULL DEFAULT 'privat'
                     CHECK (zahlungsart IN ('privat', 'kasse_bar', 'kasse_karte', 'rechnung')),
  bezahlt_von        INTEGER REFERENCES benutzer(id),  -- wer ausgelegt hat (bei 'privat' Pflicht)
  status             TEXT    NOT NULL DEFAULT 'offen'
                     CHECK (status IN ('offen', 'geprueft', 'abgelehnt')),
  notiz              TEXT,
  ablehnungsgrund    TEXT,
  erfasst_von        INTEGER NOT NULL REFERENCES benutzer(id),
  erstellt_am        TEXT    NOT NULL DEFAULT (datetime('now')),
  geprueft_von       INTEGER REFERENCES benutzer(id),
  geprueft_am        TEXT,
  rueckerstattung_id INTEGER REFERENCES rueckerstattungen(id) ON DELETE SET NULL,
  UNIQUE (kasse_id, jahr, laufnummer)
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

-- Einnahmen / Einzahlungen in eine Kasse (Beitraege, Zuschuesse, Bareinlage ...)
CREATE TABLE IF NOT EXISTS einnahmen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kasse_id      INTEGER NOT NULL REFERENCES kassen(id) ON DELETE CASCADE,
  datum         TEXT    NOT NULL,
  betrag_rappen INTEGER NOT NULL CHECK (betrag_rappen > 0),
  beschreibung  TEXT    NOT NULL,
  kategorie     TEXT    NOT NULL DEFAULT 'Einnahme',
  erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
  erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sitzungen (
  sid         TEXT    PRIMARY KEY,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  csrf        TEXT    NOT NULL,
  ablauf      INTEGER NOT NULL,
  erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS protokoll (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id INTEGER REFERENCES benutzer(id),
  aktion      TEXT    NOT NULL,
  objekt      TEXT,
  objekt_id   INTEGER,
  details     TEXT,
  erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_belege_kasse   ON belege(kasse_id, datum);
CREATE INDEX IF NOT EXISTS idx_belege_status  ON belege(status);
CREATE INDEX IF NOT EXISTS idx_belege_person  ON belege(bezahlt_von);
CREATE INDEX IF NOT EXISTS idx_einnahmen      ON einnahmen(kasse_id, datum);
CREATE INDEX IF NOT EXISTS idx_dateien_beleg  ON beleg_dateien(beleg_id);
CREATE INDEX IF NOT EXISTS idx_sitzungen_abl  ON sitzungen(ablauf);
