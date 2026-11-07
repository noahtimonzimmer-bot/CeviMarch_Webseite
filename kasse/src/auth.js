// Anmeldung, Sitzungen, CSRF-Schutz und Berechtigungen.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, protokollieren } from './db.js';

const SITZUNG_TAGE = 30;
const COOKIE_NAME = 'cmk_sid';

// ---------------------------------------------------------------- Passwoerter

export function passwortHashen(klartext) {
  return bcrypt.hashSync(klartext, 12);
}

export function passwortPruefen(klartext, hash) {
  try {
    return bcrypt.compareSync(klartext, hash);
  } catch {
    return false;
  }
}

export function passwortRegelnVerletzt(passwort) {
  if (typeof passwort !== 'string' || passwort.length < 8) {
    return 'Das Passwort braucht mindestens 8 Zeichen.';
  }
  if (passwort.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}

/** Lesbares Startpasswort, das man am Telefon durchgeben kann. */
export function startpasswortErzeugen() {
  const woerter = [
    'Zelt', 'Feuer', 'Seil', 'Karte', 'Pfad', 'Berg', 'Fluss', 'Kompass',
    'Lager', 'Knoten', 'Stern', 'Wald', 'Bach', 'Hut', 'Nebel', 'Brot'
  ];
  const w1 = woerter[crypto.randomInt(woerter.length)];
  const w2 = woerter[crypto.randomInt(woerter.length)];
  return `${w1}-${w2}-${crypto.randomInt(1000, 9999)}`;
}

// ----------------------------------------------------------------- Sitzungen

export function sitzungAnlegen(benutzerId) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const ablauf = Date.now() + SITZUNG_TAGE * 24 * 60 * 60 * 1000;
  db.prepare(
    'INSERT INTO sitzungen (sid, benutzer_id, csrf, ablauf) VALUES (?, ?, ?, ?)'
  ).run(sid, benutzerId, csrf, ablauf);
  return { sid, csrf, ablauf };
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

/** Haengt req.benutzer und req.sitzung an, wenn angemeldet. */
export function sitzungLaden(req, _res, next) {
  const sitzung = sitzungLesen(req.cookies?.[COOKIE_NAME]);
  if (sitzung) {
    const benutzer = db
      .prepare(
        `SELECT id, name, email, rolle, iban, telefon, aktiv, passwort_neu
           FROM benutzer WHERE id = ?`
      )
      .get(sitzung.benutzer_id);
    if (benutzer && benutzer.aktiv) {
      req.benutzer = benutzer;
      req.sitzung = sitzung;
    }
  }
  next();
}

export function angemeldet(req, res, next) {
  if (!req.benutzer) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  next();
}

export function nurAdmin(req, res, next) {
  if (!req.benutzer) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  if (req.benutzer.rolle !== 'admin') {
    return res.status(403).json({ fehler: 'Nur fuer die Kassenleitung.' });
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

// ------------------------------------------------------------ Berechtigungen

/** 'kassier' | 'melder' | null  — Rolle des Benutzers bei dieser Kasse. */
export function kassenRolle(benutzer, kasseId) {
  if (!benutzer) return null;
  if (benutzer.rolle === 'admin') return 'kassier';
  const zeile = db
    .prepare('SELECT rolle FROM kassen_mitglieder WHERE kasse_id = ? AND benutzer_id = ?')
    .get(kasseId, benutzer.id);
  return zeile ? zeile.rolle : null;
}

export function darfKasseVerwalten(benutzer, kasseId) {
  return kassenRolle(benutzer, kasseId) === 'kassier';
}

export function darfBelegEinreichen(benutzer, kasseId) {
  return kassenRolle(benutzer, kasseId) !== null;
}

/** IDs aller Kassen, bei denen der Benutzer Kassier (oder Admin) ist. */
export function verwalteteKassenIds(benutzer) {
  if (benutzer.rolle === 'admin') {
    return db.prepare('SELECT id FROM kassen').all().map((k) => k.id);
  }
  return db
    .prepare(`SELECT kasse_id AS id FROM kassen_mitglieder
               WHERE benutzer_id = ? AND rolle = 'kassier'`)
    .all(benutzer.id)
    .map((k) => k.id);
}

// ------------------------------------------------------- Anmeldeversuche

const versuche = new Map(); // email -> { anzahl, bis }

export function zuVieleVersuche(email) {
  const eintrag = versuche.get(String(email || '').toLowerCase());
  if (!eintrag) return false;
  if (eintrag.bis < Date.now()) {
    versuche.delete(String(email || '').toLowerCase());
    return false;
  }
  return eintrag.anzahl >= 8;
}

export function versuchZaehlen(email) {
  const schluessel = String(email || '').toLowerCase();
  const eintrag = versuche.get(schluessel) || { anzahl: 0, bis: 0 };
  eintrag.anzahl += 1;
  eintrag.bis = Date.now() + 15 * 60 * 1000;
  versuche.set(schluessel, eintrag);
}

export function versucheZuruecksetzen(email) {
  versuche.delete(String(email || '').toLowerCase());
}

// -------------------------------------------------------------- Anmelden

export function anmelden(email, passwort) {
  const benutzer = db
    .prepare('SELECT * FROM benutzer WHERE email = ? COLLATE NOCASE')
    .get(String(email || '').trim());
  if (!benutzer || !benutzer.aktiv) return null;
  if (!passwortPruefen(passwort, benutzer.passwort_hash)) return null;
  protokollieren(benutzer.id, 'anmeldung', 'benutzer', benutzer.id, null);
  return benutzer;
}
