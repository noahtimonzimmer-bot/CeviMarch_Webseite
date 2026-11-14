// Legt beim allerersten Start das Konto der Abteilungsleitung und das
// gemeinsame Passwort an und schreibt beides ins Terminal.
import { db } from './db.js';
import {
  SCHLUESSEL_MELDER, einstellungLesen, einstellungSetzen,
  passwortHashen, passwortVorschlagen
} from './auth.js';

export function ersteEinrichtung() {
  const zeilen = [];

  // --- Konto der Abteilungsleitung
  if (db.prepare('SELECT COUNT(*) AS n FROM benutzer').get().n === 0) {
    const email = (process.env.ADMIN_EMAIL || 'noahtimonzimmer@gmail.com').trim().toLowerCase();
    const name = process.env.ADMIN_NAME || 'Abteilungsleitung';
    const passwort = process.env.ADMIN_PASSWORT || passwortVorschlagen();
    db.prepare(
      `INSERT INTO benutzer (name, email, passwort_hash, rolle, passwort_neu)
       VALUES (?, ?, ?, 'admin', 1)`
    ).run(name, email, passwortHashen(passwort));
    zeilen.push(`   Abteilungsleitung: ${email}`);
    zeilen.push(`   Passwort:          ${process.env.ADMIN_PASSWORT ? 'wie in ADMIN_PASSWORT gesetzt' : passwort}`);
  }

  // --- Gemeinsames Passwort zum Belege einreichen
  if (!einstellungLesen(SCHLUESSEL_MELDER)) {
    const passwort = process.env.PASSWORT_MITARBEIT || passwortVorschlagen();
    einstellungSetzen(SCHLUESSEL_MELDER, passwortHashen(passwort));
    zeilen.push(`   Belege erfassen (fuer alle Leiter): ${process.env.PASSWORT_MITARBEIT ? 'wie in PASSWORT_MITARBEIT gesetzt' : passwort}`);
  }

  // --- Eine erste Kasse, damit die Seite nicht leer ist
  if (db.prepare('SELECT COUNT(*) AS n FROM kassen').get().n === 0) {
    db.prepare('INSERT INTO kassen (name, beschreibung, farbe) VALUES (?, ?, ?)')
      .run('AL-Kasse', 'Kasse der Abteilungsleitung', '#1d4f9e');
  }

  if (!zeilen.length) return;
  console.log('');
  console.log('========================================================');
  console.log(' Cevi March Kasse - Zugaenge');
  for (const zeile of zeilen) console.log(zeile);
  console.log('   Beides laesst sich in der App aendern.');
  console.log('========================================================');
  console.log('');
}
