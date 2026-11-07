// Kleines Hilfswerkzeug fuer den Server:
//   npm run admin -- liste
//   npm run admin -- neu "Name" mail@example.ch admin
//   npm run admin -- passwort mail@example.ch
import 'dotenv/config';
import { db, schemaAnlegen } from './db.js';
import { passwortHashen, startpasswortErzeugen } from './auth.js';

schemaAnlegen();

const [befehl, ...rest] = process.argv.slice(2);

function liste() {
  const zeilen = db.prepare('SELECT id, name, email, rolle, aktiv FROM benutzer ORDER BY name').all();
  if (!zeilen.length) return console.log('Noch keine Benutzer.');
  for (const z of zeilen) {
    console.log(`${String(z.id).padStart(3)}  ${z.rolle === 'admin' ? '[Leitung]' : '[Benutzer]'}  ${z.name} <${z.email}>${z.aktiv ? '' : '  (gesperrt)'}`);
  }
}

function neu([name, email, rolle]) {
  if (!name || !email) return console.log('Aufruf: npm run admin -- neu "Vorname Name" mail@example.ch [admin]');
  const passwort = startpasswortErzeugen();
  db.prepare(
    `INSERT INTO benutzer (name, email, passwort_hash, rolle, passwort_neu) VALUES (?, ?, ?, ?, 1)`
  ).run(name, email.toLowerCase(), passwortHashen(passwort), rolle === 'admin' ? 'admin' : 'benutzer');
  console.log(`Angelegt: ${name} <${email}>`);
  console.log(`Startpasswort: ${passwort}`);
}

function passwort([email]) {
  if (!email) return console.log('Aufruf: npm run admin -- passwort mail@example.ch');
  const person = db.prepare('SELECT id FROM benutzer WHERE email = ? COLLATE NOCASE').get(email);
  if (!person) return console.log('Nicht gefunden.');
  const neues = startpasswortErzeugen();
  db.prepare('UPDATE benutzer SET passwort_hash = ?, passwort_neu = 1 WHERE id = ?')
    .run(passwortHashen(neues), person.id);
  db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ?').run(person.id);
  console.log(`Neues Startpasswort fuer ${email}: ${neues}`);
}

switch (befehl) {
  case 'liste': liste(); break;
  case 'neu': neu(rest); break;
  case 'passwort': passwort(rest); break;
  default:
    console.log('Befehle: liste | neu "Name" mail@example.ch [admin] | passwort mail@example.ch');
}
