// Anmelden, abmelden, eigenes Konto pflegen.
import express from 'express';
import { db, protokollieren } from '../db.js';
import {
  mitEmailAnmelden, mitPasswortAnmelden, sitzungAnlegen, sitzungLoeschen,
  kontoSitzungenBeenden, melderSitzungenBeenden, melderPasswortSetzen,
  cookieSetzen, cookieLoeschen, csrfPruefen, angemeldet, mitKonto, nurAdmin,
  passwortHashen, passwortRegelnVerletzt, passwortVorschlagen, MINDESTLAENGE_MELDER,
  zuVieleVersuche, versuchZaehlen, versucheZuruecksetzen,
  verwalteteKassen, SITZUNGS_COOKIE
} from '../auth.js';

const router = express.Router();

/** Alles, was die Oberflaeche ueber die angemeldete Person wissen muss. */
function ichAntwort(req) {
  const antwort = {
    rolle: req.rolle,
    csrf: req.sitzung.csrf,
    kassen_ids: verwalteteKassen(req)
  };
  if (req.benutzer) {
    antwort.konto = {
      id: req.benutzer.id,
      name: req.benutzer.name,
      email: req.benutzer.email,
      iban: req.benutzer.iban,
      telefon: req.benutzer.telefon,
      passwort_neu: Boolean(req.benutzer.passwort_neu)
    };
  }
  return antwort;
}

/** Nur unser eigenes Javascript schickt diesen Kopfeintrag mit. */
function eigeneAnfrage(req) {
  return req.get('X-Requested-With') === 'ce-march-kasse';
}

// --------------------------------------------- Gemeinsames Passwort (Melder)

router.post('/anmelden', (req, res) => {
  if (!eigeneAnfrage(req)) return res.status(403).json({ fehler: 'Ungueltige Anfrage.' });
  const passwort = req.body?.passwort;
  if (!passwort) return res.status(400).json({ fehler: 'Bitte das Passwort eingeben.' });
  if (zuVieleVersuche('*')) {
    return res.status(429).json({ fehler: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' });
  }
  if (!mitPasswortAnmelden(passwort)) {
    versuchZaehlen('*');
    return res.status(401).json({ fehler: 'Das Passwort stimmt nicht.' });
  }
  versucheZuruecksetzen('*');
  const sitzung = sitzungAnlegen('melder');
  cookieSetzen(res, sitzung.sid, sitzung.ablauf);
  req.sitzung = sitzung;
  req.rolle = 'melder';
  res.json(ichAntwort(req));
});

// ---------------------------------------------------- Konto (E-Mail + Wort)

router.post('/anmelden-konto', (req, res) => {
  if (!eigeneAnfrage(req)) return res.status(403).json({ fehler: 'Ungueltige Anfrage.' });
  const { email, passwort } = req.body || {};
  if (!email || !passwort) {
    return res.status(400).json({ fehler: 'E-Mail und Passwort sind noetig.' });
  }
  if (zuVieleVersuche(email)) {
    return res.status(429).json({ fehler: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' });
  }
  const benutzer = mitEmailAnmelden(email, passwort);
  if (!benutzer) {
    versuchZaehlen(email);
    return res.status(401).json({ fehler: 'E-Mail oder Passwort stimmt nicht.' });
  }
  versucheZuruecksetzen(email);
  const sitzung = sitzungAnlegen(benutzer.rolle, benutzer.id);
  cookieSetzen(res, sitzung.sid, sitzung.ablauf);
  req.sitzung = sitzung;
  req.rolle = benutzer.rolle;
  req.benutzer = benutzer;
  res.json(ichAntwort(req));
});

router.post('/abmelden', csrfPruefen, (req, res) => {
  sitzungLoeschen(req.cookies?.[SITZUNGS_COOKIE]);
  cookieLoeschen(res);
  res.json({ ok: true });
});

router.get('/ich', (req, res) => {
  if (!req.sitzung) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  res.json(ichAntwort(req));
});

// ------------------------------------------------------------ Eigenes Konto

router.patch('/ich', csrfPruefen, mitKonto, (req, res) => {
  const { name, iban, telefon } = req.body || {};
  db.prepare('UPDATE benutzer SET name = ?, iban = ?, telefon = ? WHERE id = ?').run(
    String(name || req.benutzer.name).trim().slice(0, 120),
    iban ? String(iban).replace(/\s/g, '').toUpperCase().slice(0, 34) : null,
    telefon ? String(telefon).trim().slice(0, 40) : null,
    req.benutzer.id
  );
  req.benutzer = db
    .prepare('SELECT id, name, email, rolle, iban, telefon, aktiv, passwort_neu FROM benutzer WHERE id = ?')
    .get(req.benutzer.id);
  res.json(ichAntwort(req));
});

router.post('/ich/passwort', csrfPruefen, mitKonto, (req, res) => {
  const { altes_passwort: alt, neues_passwort: neu } = req.body || {};
  const zeile = db.prepare('SELECT passwort_hash FROM benutzer WHERE id = ?').get(req.benutzer.id);
  if (!mitEmailAnmelden(req.benutzer.email, alt)) {
    return res.status(400).json({ fehler: 'Das bisherige Passwort stimmt nicht.' });
  }
  const problem = passwortRegelnVerletzt(neu);
  if (problem) return res.status(400).json({ fehler: problem });
  if (!zeile) return res.status(404).json({ fehler: 'Konto nicht gefunden.' });

  db.prepare('UPDATE benutzer SET passwort_hash = ?, passwort_neu = 0 WHERE id = ?')
    .run(passwortHashen(neu), req.benutzer.id);
  // Alle anderen Geraete dieses Kontos abmelden.
  kontoSitzungenBeenden(req.benutzer.id, req.sitzung.sid);
  protokollieren(req.rolle, 'passwort_geaendert', 'benutzer', req.benutzer.id, null);
  res.json({ ok: true });
});

// -------------------------------------- Gemeinsames Passwort neu setzen

router.get('/passwort-vorschlag', mitKonto, (_req, res) => {
  res.json({ passwort: passwortVorschlagen() });
});

router.post('/melder-passwort', csrfPruefen, nurAdmin, (req, res) => {
  const neues = req.body?.passwort;
  const problem = passwortRegelnVerletzt(neues, MINDESTLAENGE_MELDER);
  if (problem) return res.status(400).json({ fehler: problem });
  melderPasswortSetzen(neues);
  melderSitzungenBeenden();
  protokollieren(req.rolle, 'melder_passwort_geaendert', null, null, null);
  res.json({ ok: true });
});

export default router;
