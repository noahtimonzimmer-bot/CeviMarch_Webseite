// Legt beim allerersten Start die beiden Passwoerter an und schreibt sie
// ins Terminal. Danach kann die Abteilungsleitung sie in der App aendern.
import { db } from './db.js';
import {
  SCHLUESSEL_ADMIN, SCHLUESSEL_BENUTZER,
  einstellungLesen, einstellungSetzen, passwortHashen, passwortVorschlagen
} from './auth.js';

export function ersteEinrichtung() {
  const fehltAdmin = !einstellungLesen(SCHLUESSEL_ADMIN);
  const fehltBenutzer = !einstellungLesen(SCHLUESSEL_BENUTZER);
  if (!fehltAdmin && !fehltBenutzer) return;

  const adminPasswort = process.env.PASSWORT_LEITUNG || passwortVorschlagen();
  const benutzerPasswort = process.env.PASSWORT_MITARBEIT || passwortVorschlagen();

  if (fehltAdmin) einstellungSetzen(SCHLUESSEL_ADMIN, passwortHashen(adminPasswort));
  if (fehltBenutzer) einstellungSetzen(SCHLUESSEL_BENUTZER, passwortHashen(benutzerPasswort));

  console.log('');
  console.log('========================================================');
  console.log(' Ce March Kasse - Passwoerter');
  if (fehltAdmin) {
    console.log(`   Leitung   (sieht und verwaltet alles): ${process.env.PASSWORT_LEITUNG ? 'wie in PASSWORT_LEITUNG gesetzt' : adminPasswort}`);
  }
  if (fehltBenutzer) {
    console.log(`   Mitarbeit (nur Belege erfassen):       ${process.env.PASSWORT_MITARBEIT ? 'wie in PASSWORT_MITARBEIT gesetzt' : benutzerPasswort}`);
  }
  console.log('   Beide lassen sich in der App unter "Einstellungen" aendern.');
  console.log('========================================================');
  console.log('');

  // Beim ersten Start gleich eine AL-Kasse anlegen, damit die Seite nicht leer ist.
  if (db.prepare('SELECT COUNT(*) AS n FROM kassen').get().n === 0) {
    db.prepare('INSERT INTO kassen (name, beschreibung, farbe) VALUES (?, ?, ?)')
      .run('AL-Kasse', 'Kasse der Abteilungsleitung', '#1d4f9e');
  }
}
