// Datenbankverbindung und Hilfsfunktionen.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));

export const DATEN_ORDNER = path.resolve(
  process.env.DATA_DIR || path.join(hier, '..', 'data')
);
export const UPLOAD_ORDNER = path.join(DATEN_ORDNER, 'uploads');

fs.mkdirSync(UPLOAD_ORDNER, { recursive: true });

export const db = new Database(path.join(DATEN_ORDNER, 'kasse.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function schemaAnlegen() {
  const sql = fs.readFileSync(path.join(hier, 'schema.sql'), 'utf8');
  db.exec(sql);
  nachruesten();
}

/** Spalten dieser Tabelle, die es schon gibt. */
function spalten(tabelle) {
  return db.prepare(`PRAGMA table_info(${tabelle})`).all().map((z) => z.name);
}

/**
 * Bringt eine aeltere Datenbank auf den heutigen Stand.
 * "CREATE TABLE IF NOT EXISTS" aendert bestehende Tabellen nicht - neue
 * Spalten muessen darum von Hand nachgezogen werden.
 */
function nachruesten() {
  const rueck = spalten('rueckerstattungen');
  if (rueck.length && !rueck.includes('quelle')) {
    db.exec(`
      ALTER TABLE rueckerstattungen ADD COLUMN quelle TEXT NOT NULL DEFAULT 'eigene_tasche';
      ALTER TABLE rueckerstattungen ADD COLUMN uebernommen_von INTEGER REFERENCES benutzer(id);
      ALTER TABLE rueckerstattungen ADD COLUMN rechnung_id INTEGER REFERENCES rechnungen(id);
    `);
  }

  // Die Sitzungstabelle kannte frueher nur 'admin' und 'benutzer', und die
  // Rollenliste kannte den Vereinskassier noch nicht. Eine CHECK-Bedingung
  // laesst sich nicht aendern, darum wird die Tabelle neu angelegt - alle
  // muessen sich danach einmal neu anmelden.
  const sitzung = spalten('sitzungen');
  if (sitzung.length && (!sitzung.includes('benutzer_id') || !kenntKassier('sitzungen'))) {
    db.exec('DROP TABLE sitzungen');
    db.exec(`
      CREATE TABLE sitzungen (
        sid         TEXT    PRIMARY KEY,
        rolle       TEXT    NOT NULL CHECK (rolle IN ('admin', 'kassier', 'chef', 'melder')),
        benutzer_id INTEGER REFERENCES benutzer(id) ON DELETE CASCADE,
        csrf        TEXT    NOT NULL,
        ablauf      INTEGER NOT NULL,
        erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sitzungen_abl ON sitzungen(ablauf);
    `);
  }

  // Dasselbe bei den Konten: die Rolle 'kassier' muss in die CHECK-Liste.
  // Hier haengen fremde Schluessel dran, darum mit Umbau statt Loeschen.
  if (spalten('benutzer').length && !kenntKassier('benutzer')) {
    db.pragma('foreign_keys = OFF');
    // Beim Umbenennen sollen die Verweise der anderen Tabellen stehen
    // bleiben - sie zeigen danach wieder auf die richtige Tabelle.
    db.pragma('legacy_alter_table = ON');
    db.exec(`
      BEGIN;
      CREATE TABLE benutzer_neu (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT    NOT NULL,
        email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        passwort_hash TEXT    NOT NULL,
        rolle         TEXT    NOT NULL DEFAULT 'chef' CHECK (rolle IN ('admin', 'kassier', 'chef')),
        iban          TEXT,
        telefon       TEXT,
        aktiv         INTEGER NOT NULL DEFAULT 1,
        passwort_neu  INTEGER NOT NULL DEFAULT 1,
        erstellt_am   TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO benutzer_neu
        (id, name, email, passwort_hash, rolle, iban, telefon, aktiv, passwort_neu, erstellt_am)
        SELECT id, name, email, passwort_hash, rolle, iban, telefon, aktiv, passwort_neu, erstellt_am
          FROM benutzer;
      DROP TABLE benutzer;
      ALTER TABLE benutzer_neu RENAME TO benutzer;
      COMMIT;
    `);
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

/** Steht die Rolle 'kassier' schon in der CHECK-Liste dieser Tabelle? */
function kenntKassier(tabelle) {
  const zeile = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tabelle);
  return Boolean(zeile?.sql?.includes("'kassier'"));
}

export function protokollieren(rolle, aktion, objekt, objektId, details) {
  db.prepare(
    `INSERT INTO protokoll (rolle, aktion, objekt, objekt_id, details)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    rolle ?? null,
    aktion,
    objekt ?? null,
    objektId ?? null,
    details ? JSON.stringify(details) : null
  );
}
