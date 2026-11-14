// Kleines Hilfswerkzeug fuer den Server, falls man sich aussperrt:
//   npm run admin -- konten                      (alle Konten anzeigen)
//   npm run admin -- passwort mail@example.ch    (neues Startpasswort)
//   npm run admin -- admin "Name" mail@beispiel.ch   (Konto der Leitung anlegen)
//   npm run admin -- kassier "Name" mail@beispiel.ch (Konto des Vereinskassiers)
//   npm run admin -- melder [passwort]           (gemeinsames Passwort setzen)
//   npm run admin -- kassen                      (Kassen und Saldi anzeigen)
import 'dotenv/config';
import { db, schemaAnlegen } from './db.js';
import {
  passwortHashen, passwortVorschlagen, passwortRegelnVerletzt,
  melderPasswortSetzen, melderSitzungenBeenden, kontoSitzungenBeenden
} from './auth.js';
import { alleKassen, kasseZahlen } from './kassenbuch.js';
import { formatieren } from './geld.js';

schemaAnlegen();

const [befehl, ...rest] = process.argv.slice(2);

const ROLLEN_KUERZEL = {
  admin: '[Leitung]',
  kassier: '[Kassier]',
  chef: '[Kassenchef]'
};

function konten() {
  const zeilen = db.prepare('SELECT id, name, email, rolle, aktiv FROM benutzer ORDER BY rolle, name').all();
  if (!zeilen.length) return console.log('Noch keine Konten.');
  for (const z of zeilen) {
    const kassen = db
      .prepare(`SELECT k.name FROM kassen_chefs c JOIN kassen k ON k.id = c.kasse_id
                 WHERE c.benutzer_id = ? ORDER BY k.name`)
      .all(z.id)
      .map((k) => k.name)
      .join(', ');
    console.log(
      `${String(z.id).padStart(3)}  ${ROLLEN_KUERZEL[z.rolle].padEnd(13)} ` +
      `${z.name.padEnd(24)} ${z.email}${z.aktiv ? '' : '  (gesperrt)'}${kassen ? `  -> ${kassen}` : ''}`
    );
  }
}

function passwort([email]) {
  if (!email) return console.log('Aufruf: npm run admin -- passwort mail@example.ch');
  const konto = db.prepare('SELECT id FROM benutzer WHERE email = ? COLLATE NOCASE').get(email);
  if (!konto) return console.log('Nicht gefunden.');
  const neues = passwortVorschlagen();
  db.prepare('UPDATE benutzer SET passwort_hash = ?, passwort_neu = 1 WHERE id = ?')
    .run(passwortHashen(neues), konto.id);
  kontoSitzungenBeenden(konto.id);
  console.log(`Neues Startpasswort fuer ${email}: ${neues}`);
}

function kontoAnlegen(rolle, [name, email]) {
  if (!name || !email) {
    return console.log(`Aufruf: npm run admin -- ${rolle} "Vorname Name" mail@example.ch`);
  }
  if (db.prepare('SELECT 1 FROM benutzer WHERE email = ? COLLATE NOCASE').get(email)) {
    return console.log('Diese E-Mail hat schon ein Konto.');
  }
  const neues = passwortVorschlagen();
  db.prepare(
    `INSERT INTO benutzer (name, email, passwort_hash, rolle, passwort_neu)
     VALUES (?, ?, ?, ?, 1)`
  ).run(name, String(email).toLowerCase(), passwortHashen(neues), rolle);
  const bezeichnung = rolle === 'admin' ? 'Abteilungsleitung' : 'Vereinskassier';
  console.log(`Angelegt: ${name} <${email}> als ${bezeichnung}`);
  console.log(`Startpasswort: ${neues}`);
}

function melder() {
  const gewuenscht = rest[0];
  const neues = gewuenscht || passwortVorschlagen();
  const problem = passwortRegelnVerletzt(neues);
  if (problem) return console.log(problem);
  melderPasswortSetzen(neues);
  melderSitzungenBeenden();
  console.log(`Neues Passwort zum Belege erfassen: ${neues}`);
  console.log('Alle Geraete mit diesem Passwort muessen sich neu anmelden.');
}

function kassen() {
  const liste = alleKassen().map(kasseZahlen);
  if (!liste.length) return console.log('Noch keine Kassen.');
  for (const kasse of liste) {
    console.log(
      `${String(kasse.id).padStart(3)}  ${kasse.name.padEnd(24)} ` +
      `Saldo ${formatieren(kasse.saldo_rappen).padStart(14)}  ` +
      `offen: ${kasse.anzahl_offen}  schuldet: ${formatieren(kasse.schulden_rappen)}` +
      `${kasse.aktiv ? '' : '  (geschlossen)'}`
    );
  }
}

switch (befehl) {
  case 'konten': konten(); break;
  case 'passwort': passwort(rest); break;
  case 'admin': kontoAnlegen('admin', rest); break;
  case 'kassier': kontoAnlegen('kassier', rest); break;
  case 'melder': melder(); break;
  case 'kassen': kassen(); break;
  default:
    console.log(
      'Befehle: konten | passwort <mail> | admin "Name" <mail> | '
      + 'kassier "Name" <mail> | melder [passwort] | kassen'
    );
}
