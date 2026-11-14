// Anmeldung, Sitzungen, CSRF-Schutz und Berechtigungen.
//
// Es gibt zwei Wege in die App:
//
//   1. Mit Konto (E-Mail + eigenes Passwort)
//        rolle 'admin'   - Abteilungsleitung: alles
//        rolle 'kassier' - Vereinskassier: sieht alle Kassen, zahlt die
//                          Leiter vom Vereinskonto zurueck und bezahlt die
//                          Rechnungen. Prueft aber keine Belege und fuehrt
//                          kein Kassenbuch. Fuer die Jahreskontrolle darf er
//                          jede Kasse ansehen, drucken und exportieren.
//        rolle 'chef'    - Kassenchef: fuehrt die ihm zugeteilten Kassen
//                          und prueft dort die Belege
//
//   2. Mit dem gemeinsamen Passwort
//        rolle 'melder' - darf nur Belege einreichen, bei jeder Kasse,
//        und sieht nur die Belege des eigenen Geraets.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, protokollieren } from './db.js';

const SITZUNG_TAGE = 30;
const COOKIE_NAME = 'cmk_sid';

export const SCHLUESSEL_MELDER = 'passwort_mitarbeit';

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

/**
 * Pruefregeln fuer Passwoerter. Konten brauchen acht Zeichen; das
 * gemeinsame Passwort zum Belege erfassen darf kuerzer sein, weil es jedes
 * Lager am Telefon durchgegeben wird und damit nur Belege einreichen kann -
 * keine Kassenstaende, keine fremden Belege. Gegen Durchprobieren schuetzt
 * die Bremse nach zehn Fehlversuchen.
 */
export const MINDESTLAENGE_KONTO = 8;
export const MINDESTLAENGE_MELDER = 4;

export function passwortRegelnVerletzt(passwort, mindestens = MINDESTLAENGE_KONTO) {
  if (typeof passwort !== 'string' || passwort.length < mindestens) {
    return `Das Passwort braucht mindestens ${mindestens} Zeichen.`;
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

/** Setzt das gemeinsame Passwort fuer alle, die nur Belege einreichen. */
export function melderPasswortSetzen(klartext) {
  einstellungSetzen(SCHLUESSEL_MELDER, passwortHashen(klartext));
}

// ----------------------------------------------------------------- Sitzungen

export function sitzungAnlegen(rolle, benutzerId = null) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const ablauf = Date.now() + SITZUNG_TAGE * 24 * 60 * 60 * 1000;
  db.prepare(
    'INSERT INTO sitzungen (sid, rolle, benutzer_id, csrf, ablauf) VALUES (?, ?, ?, ?, ?)'
  ).run(sid, rolle, benutzerId, csrf, ablauf);
  return { sid, rolle, benutzer_id: benutzerId, csrf, ablauf };
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

/** Nach einem Passwortwechsel fliegen die anderen Geraete raus. */
export function melderSitzungenBeenden() {
  db.prepare("DELETE FROM sitzungen WHERE rolle = 'melder'").run();
}

export function kontoSitzungenBeenden(benutzerId, ausser = null) {
  db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ? AND sid <> ?')
    .run(benutzerId, ausser || '');
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

/** Haengt req.sitzung, req.rolle und bei Konten req.benutzer an. */
export function sitzungLaden(req, _res, next) {
  const sitzung = sitzungLesen(req.cookies?.[COOKIE_NAME]);
  if (!sitzung) return next();

  if (sitzung.benutzer_id) {
    const benutzer = db
      .prepare('SELECT id, name, email, rolle, iban, telefon, aktiv, passwort_neu FROM benutzer WHERE id = ?')
      .get(sitzung.benutzer_id);
    // Gesperrte Konten kommen nicht mehr rein.
    if (!benutzer || !benutzer.aktiv) {
      sitzungLoeschen(sitzung.sid);
      return next();
    }
    req.benutzer = benutzer;
    req.rolle = benutzer.rolle;
  } else {
    req.rolle = sitzung.rolle;
  }
  req.sitzung = sitzung;
  next();
}

export function angemeldet(req, res, next) {
  if (!req.rolle) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  next();
}

/** Nur die Abteilungsleitung. */
export function nurAdmin(req, res, next) {
  if (!req.rolle) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  if (req.rolle !== 'admin') {
    return res.status(403).json({ fehler: 'Das darf nur die Abteilungsleitung.' });
  }
  next();
}

/** Abteilungsleitung oder Vereinskassier - wer ans Vereinskonto kommt. */
export function nurKassier(req, res, next) {
  if (!req.rolle) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  if (req.rolle !== 'admin' && req.rolle !== 'kassier') {
    return res.status(403).json({ fehler: 'Das macht der Vereinskassier.' });
  }
  next();
}

/** Wer ein eigenes Konto hat - Leitung, Kassier oder Kassenchef. */
export function mitKonto(req, res, next) {
  if (!req.rolle) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  if (!req.benutzer) {
    return res.status(403).json({ fehler: 'Dafuer braucht es ein eigenes Konto.' });
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

/** IDs der Kassen, die diese Anmeldung verwalten darf. */
export function verwalteteKassen(req) {
  if (req.rolle === 'admin' || req.rolle === 'kassier') {
    return db.prepare('SELECT id FROM kassen').all().map((k) => k.id);
  }
  if (req.rolle === 'chef' && req.benutzer) {
    return db
      .prepare('SELECT kasse_id AS id FROM kassen_chefs WHERE benutzer_id = ?')
      .all(req.benutzer.id)
      .map((k) => k.id);
  }
  return [];
}

/**
 * Darf diese Anmeldung die Kasse ansehen - Kassenbuch, Belege, Druck und
 * Export? Der Vereinskassier sieht alle Kassen, ein Kassenchef nur seine.
 */
export function darfKasse(req, kasseId) {
  const id = Number(kasseId);
  if (!Number.isInteger(id)) return false;
  if (req.rolle === 'admin' || req.rolle === 'kassier') return true;
  if (req.rolle !== 'chef' || !req.benutzer) return false;
  return Boolean(
    db
      .prepare('SELECT 1 FROM kassen_chefs WHERE kasse_id = ? AND benutzer_id = ?')
      .get(id, req.benutzer.id)
  );
}

/**
 * Darf diese Anmeldung in der Kasse buchen - Belege pruefen, Einnahmen
 * erfassen, Eintraege loeschen? Das ist die Arbeit des Kassenchefs. Der
 * Vereinskassier schaut nur zu und zahlt aus.
 */
export function darfBuchen(req, kasseId) {
  if (req.rolle === 'kassier') return false;
  return darfKasse(req, kasseId);
}

/**
 * Darf diese Anmeldung eine Auszahlung buchen? Vom Vereinskonto zahlt der
 * Vereinskassier (und die Abteilungsleitung). Ein Kassenchef darf nur
 * festhalten, was er selbst aus der eigenen Tasche vorgestreckt hat.
 */
export function darfAuszahlen(req, kasseId, quelle) {
  if (!darfKasse(req, kasseId)) return false;
  if (req.rolle === 'admin') return true;
  if (req.rolle === 'kassier') return quelle !== 'eigene_tasche';
  return req.rolle === 'chef' && quelle === 'eigene_tasche';
}

// ------------------------------------------------------- Anmeldeversuche

// Gebremst wird je Kennung (E-Mail, oder '*' fuer das gemeinsame Passwort).
const versuche = new Map();

function schluesselFuer(kennung) {
  return String(kennung || '*').toLowerCase();
}

export function zuVieleVersuche(kennung) {
  const eintrag = versuche.get(schluesselFuer(kennung));
  if (!eintrag) return false;
  if (eintrag.bis < Date.now()) {
    versuche.delete(schluesselFuer(kennung));
    return false;
  }
  return eintrag.anzahl >= 10;
}

export function versuchZaehlen(kennung) {
  const schluessel = schluesselFuer(kennung);
  const eintrag = versuche.get(schluessel) || { anzahl: 0, bis: 0 };
  eintrag.anzahl += 1;
  eintrag.bis = Date.now() + 15 * 60 * 1000;
  versuche.set(schluessel, eintrag);
}

export function versucheZuruecksetzen(kennung) {
  versuche.delete(schluesselFuer(kennung));
}

// -------------------------------------------------------------- Anmelden

/** Anmeldung mit Konto. Gibt die Benutzerzeile oder null. */
export function mitEmailAnmelden(email, passwort) {
  if (typeof passwort !== 'string' || !passwort) return null;
  const benutzer = db
    .prepare('SELECT * FROM benutzer WHERE email = ? COLLATE NOCASE')
    .get(String(email || '').trim());
  if (!benutzer || !benutzer.aktiv) return null;
  if (!passwortVergleichen(passwort, benutzer.passwort_hash)) return null;
  protokollieren(benutzer.rolle, 'anmeldung', 'benutzer', benutzer.id, { email: benutzer.email });
  return benutzer;
}

/** Anmeldung mit dem gemeinsamen Passwort. Gibt 'melder' oder null. */
export function mitPasswortAnmelden(passwort) {
  if (typeof passwort !== 'string' || !passwort) return null;
  const hash = einstellungLesen(SCHLUESSEL_MELDER);
  if (!hash || !passwortVergleichen(passwort, hash)) return null;
  protokollieren('melder', 'anmeldung', null, null, null);
  return 'melder';
}
