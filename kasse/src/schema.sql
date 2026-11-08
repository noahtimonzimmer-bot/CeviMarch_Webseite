-- Datenbankschema "Ce March Kasse"
-- Alle Geldbetraege werden als ganze Rappen (INTEGER) gespeichert,
-- damit es keine Rundungsfehler gibt.
--
-- Es gibt keine persoenlichen Konten: der Zugang laeuft ueber zwei
-- Passwoerter (Leitung und Mitarbeit). Wer etwas ausgelegt hat, steht als
-- Name direkt beim Beleg.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Schluessel/Wert-Tabelle, unter anderem fuer die beiden Passwoerter.
CREATE TABLE IF NOT EXISTS einstellungen (
  schluessel  TEXT PRIMARY KEY,
  wert        TEXT NOT NULL,
  geaendert_am TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE TABLE IF NOT EXISTS rueckerstattungen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kasse_id      INTEGER NOT NULL REFERENCES kassen(id) ON DELETE CASCADE,
  person        TEXT    NOT NULL,
  datum         TEXT    NOT NULL,
  betrag_rappen INTEGER NOT NULL,
  methode       TEXT    NOT NULL DEFAULT 'bank' CHECK (methode IN ('bank', 'bar', 'twint', 'verrechnet')),
  notiz         TEXT,
  erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now'))
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
  rolle       TEXT    NOT NULL CHECK (rolle IN ('admin', 'benutzer')),
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

CREATE INDEX IF NOT EXISTS idx_belege_kasse  ON belege(kasse_id, datum);
CREATE INDEX IF NOT EXISTS idx_belege_status ON belege(kasse_id, status);
CREATE INDEX IF NOT EXISTS idx_belege_person ON belege(person);
CREATE INDEX IF NOT EXISTS idx_einnahmen     ON einnahmen(kasse_id, datum);
CREATE INDEX IF NOT EXISTS idx_dateien_beleg ON beleg_dateien(beleg_id);
CREATE INDEX IF NOT EXISTS idx_sitzungen_abl ON sitzungen(ablauf);
