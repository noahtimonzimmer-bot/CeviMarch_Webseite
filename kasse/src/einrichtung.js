// Legt beim allerersten Start ein Administratorkonto an.
import { db } from './db.js';
import { passwortHashen, startpasswortErzeugen } from './auth.js';

export function ersteEinrichtung() {
  const anzahl = db.prepare('SELECT COUNT(*) AS n FROM benutzer').get().n;
  if (anzahl > 0) return;

  const email = (process.env.ADMIN_EMAIL || 'admin@cevimarch.ch').trim();
  const name = process.env.ADMIN_NAME || 'Abteilungsleitung';
  const passwort = process.env.ADMIN_PASSWORT || startpasswortErzeugen();
  const selbstGesetzt = Boolean(process.env.ADMIN_PASSWORT);

  db.prepare(
    `INSERT INTO benutzer (name, email, passwort_hash, rolle, passwort_neu)
     VALUES (?, ?, ?, 'admin', ?)`
  ).run(name, email, passwortHashen(passwort), selbstGesetzt ? 0 : 1);

  console.log('');
  console.log('========================================================');
  console.log(' Erstes Administratorkonto angelegt');
  console.log(`   E-Mail:   ${email}`);
  if (!selbstGesetzt) {
    console.log(`   Passwort: ${passwort}`);
    console.log('   (Bitte nach der ersten Anmeldung sofort aendern.)');
  } else {
    console.log('   Passwort: wie in ADMIN_PASSWORT gesetzt');
  }
  console.log('========================================================');
  console.log('');
}
