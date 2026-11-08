// Anmeldung mit zwei Passwoertern, Sitzungen und CSRF-Schutz.
//
// Es gibt keine persoenlichen Konten. Wer das Leitungspasswort kennt, sieht
// und verwaltet alles; wer das Mitarbeitspasswort kennt, kann nur Belege
// einreichen. So koennen sich mehrere Abteilungsleitungen dasselbe Passwort
// teilen, ohne dass jemand ein Konto braucht.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, protokollieren } from './db.js';

const SITZUNG_TAGE = 30;
const COOKIE_NAME = 'cmk_sid';

export const SCHLUESSEL_ADMIN = 'passwort_leitung';
export const SCHLUESSEL_BENUTZER = 'passwort_mitarbeit';

// ---------------------------------------------------------------- Passwoerter

export function passwortHashen(klartext) {
  return bcrypt.hashSync(klartext, 12);
}

function passwortVergleichen(klartext, hash) {
  try {
    return bcrypt.compareSync(klartext, hash);
  } catch {
    return false;
  }
}

export function passwortRegelnVerletzt(passwort) {
  if (typeof passwort !== 'string' || passwort.length < 6) {
    return 'Das Passwort braucht mindestens 6 Zeichen.';
  }
  if (passwort.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}

/** Lesbares Passwort, das man am Telefon durchgeben kann. */
export function passwortVorschlagen() {
  const woerter = [
    'Zelt', 'Feuer', 'Seil', 'Karte', 'Pfad', 'Berg', 'Fluss', 'Kompass',
    'Lager', 'Knoten', 'Stern', 'Wald', 'Bach', 'Hut', 'Nebel', 'Brot'
  ];
  const w1 = woerter[crypto.randomInt(woerter.length)];
  const w2 = woerter[crypto.randomInt(woerter.length)];
  return `${w1}-${w2}-${crypto.randomInt(1000, 9999)}`;
}

export function einstellungLesen(schluessel) {
  return db.prepare('SELECT wert FROM einstellungen WHERE schluessel = ?').get(schluessel)?.wert || null;
}

export function einstellungSetzen(schluessel, wert) {
  db.prepare(
    `INSERT INTO einstellungen (schluessel, wert, geaendert_am)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, geaendert_am = excluded.geaendert_am`
  ).run(schluessel, wert);
}

export function passwortSetzen(rolle, klartext) {
  einstellungSetzen(rolle === 'admin' ? SCHLUESSEL_ADMIN : SCHLUESSEL_BENUTZER, passwortHashen(klartext));
}

// ----------------------------------------------------------------- Sitzungen

export function sitzungAnlegen(rolle) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const ablauf = Date.now() + SITZUNG_TAGE * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sitzungen (sid, rolle, csrf, ablauf) VALUES (?, ?, ?, ?)')
    .run(sid, rolle, csrf, ablauf);
  return { sid, rolle, csrf, ablauf };
}

export function sitzungLesen(sid) {
  if (!sid) return null;
  const zeile = db.prepare('SELECT * FROM sitzungen WHERE sid = ?').get(sid);
  if (!zeile) return null;
  if (zeile.ablauf < Date.now()) {
    db.prepare('DELETE FROM sitzungen WHERE sid = ?').run(sid);
    return null;
  }
  return zeile;
}

export function sitzungLoeschen(sid) {
  if (sid) db.prepare('DELETE FROM sitzungen WHERE sid = ?').run(sid);
}

/** Nach einem Passwortwechsel fliegen alle Geraete mit dieser Rolle raus. */
export function sitzungenBeenden(rolle, ausser = null) {
  db.prepare('DELETE FROM sitzungen WHERE rolle = ? AND sid <> ?').run(rolle, ausser || '');
}

export function alteSitzungenAufraeumen() {
  db.prepare('DELETE FROM sitzungen WHERE ablauf < ?').run(Date.now());
}

export function cookieSetzen(res, sid, ablauf) {
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    expires: new Date(ablauf),
    path: '/'
  });
}

export function cookieLoeschen(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export const SITZUNGS_COOKIE = COOKIE_NAME;

// --------------------------------------------------------------- Middleware

/** Haengt req.sitzung und req.rolle an, wenn angemeldet. */
export function sitzungLaden(req, _res, next) {
  const sitzung = sitzungLesen(req.cookies?.[COOKIE_NAME]);
  if (sitzung) {
    req.sitzung = sitzung;
    req.rolle = sitzung.rolle;
  }
  next();
}

export function angemeldet(req, res, next) {
  if (!req.rolle) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  next();
}

export function nurLeitung(req, res, next) {
  if (!req.rolle) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  if (req.rolle !== 'admin') {
    return res.status(403).json({ fehler: 'Nur die Abteilungsleitung kann das.' });
  }
  next();
}

/** Schuetzt alle veraendernden Anfragen gegen fremde Webseiten. */
export function csrfPruefen(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.sitzung) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  const mitgeschickt = req.get('X-CSRF-Token');
  if (!mitgeschickt || mitgeschickt !== req.sitzung.csrf) {
    return res.status(403).json({ fehler: 'Sicherheits-Token fehlt oder ist abgelaufen. Seite neu laden.' });
  }
  next();
}

// ------------------------------------------------------- Anmeldeversuche

// Ohne Benutzernamen kann nur global gebremst werden. Das reicht: die App
// steht hinter einer eigenen Adresse und hat wenige Benutzer.
let versuche = { anzahl: 0, bis: 0 };

export function zuVieleVersuche() {
  if (versuche.bis < Date.now()) {
    versuche = { anzahl: 0, bis: 0 };
    return false;
  }
  return versuche.anzahl >= 10;
}

export function versuchZaehlen() {
  versuche.anzahl += 1;
  versuche.bis = Date.now() + 15 * 60 * 1000;
}

export function versucheZuruecksetzen() {
  versuche = { anzahl: 0, bis: 0 };
}

// -------------------------------------------------------------- Anmelden

/** Prueft das Passwort gegen beide Rollen. Gibt 'admin', 'benutzer' oder null. */
export function anmelden(passwort) {
  if (typeof passwort !== 'string' || !passwort) return null;
  const adminHash = einstellungLesen(SCHLUESSEL_ADMIN);
  const benutzerHash = einstellungLesen(SCHLUESSEL_BENUTZER);

  // Beide Vergleiche laufen immer, damit die Antwortzeit nichts verraet.
  const istAdmin = adminHash ? passwortVergleichen(passwort, adminHash) : false;
  const istBenutzer = benutzerHash ? passwortVergleichen(passwort, benutzerHash) : false;

  const rolle = istAdmin ? 'admin' : istBenutzer ? 'benutzer' : null;
  if (rolle) protokollieren(rolle, 'anmeldung', null, null, null);
  return rolle;
}
