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
