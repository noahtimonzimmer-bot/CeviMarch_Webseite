// Kleines Hilfswerkzeug fuer den Server, falls man sich aussperrt:
//   npm run admin -- leitung            (neues Leitungspasswort erzeugen)
//   npm run admin -- leitung Geheim123  (Leitungspasswort selbst setzen)
//   npm run admin -- mitarbeit          (neues Mitarbeitspasswort erzeugen)
//   npm run admin -- kassen             (Kassen und Saldi anzeigen)
import 'dotenv/config';
import { schemaAnlegen } from './db.js';
import {
  passwortSetzen, passwortVorschlagen, passwortRegelnVerletzt, sitzungenBeenden
} from './auth.js';
import { alleKassen, kasseZahlen } from './kassenbuch.js';
import { formatieren } from './geld.js';

schemaAnlegen();

const [befehl, ...rest] = process.argv.slice(2);

function setzen(rolle, bezeichnung) {
  const gewuenscht = rest[0];
  const passwort = gewuenscht || passwortVorschlagen();
  const problem = passwortRegelnVerletzt(passwort);
  if (problem) return console.log(problem);
  passwortSetzen(rolle, passwort);
  sitzungenBeenden(rolle);
  console.log(`Neues ${bezeichnung}: ${passwort}`);
  console.log('Alle Geraete mit dieser Rolle muessen sich neu anmelden.');
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
  case 'leitung': setzen('admin', 'Leitungspasswort'); break;
  case 'mitarbeit': setzen('benutzer', 'Mitarbeitspasswort'); break;
  case 'kassen': kassen(); break;
  default:
    console.log('Befehle: leitung [passwort] | mitarbeit [passwort] | kassen');
}
