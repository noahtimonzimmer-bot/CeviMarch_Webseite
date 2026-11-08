// Anmelden mit einem der beiden Passwoerter, abmelden, Passwoerter aendern.
import express from 'express';
import { protokollieren } from '../db.js';
import {
  anmelden, sitzungAnlegen, sitzungLoeschen, sitzungenBeenden, cookieSetzen, cookieLoeschen,
  csrfPruefen, nurLeitung, passwortSetzen, passwortRegelnVerletzt, passwortVorschlagen,
  zuVieleVersuche, versuchZaehlen, versucheZuruecksetzen, SITZUNGS_COOKIE
} from '../auth.js';

const router = express.Router();

function ichAntwort(req) {
  return { rolle: req.sitzung.rolle, csrf: req.sitzung.csrf };
}

router.post('/anmelden', (req, res) => {
  // Einfacher Schutz: nur unser eigenes Javascript schickt diesen Kopfeintrag
  // mit, ein Formular einer fremden Seite kann das nicht.
  if (req.get('X-Requested-With') !== 'ce-march-kasse') {
    return res.status(403).json({ fehler: 'Ungueltige Anfrage.' });
  }
  const passwort = req.body?.passwort;
  if (!passwort) return res.status(400).json({ fehler: 'Bitte das Passwort eingeben.' });
  if (zuVieleVersuche()) {
    return res.status(429).json({ fehler: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' });
  }
  const rolle = anmelden(passwort);
  if (!rolle) {
    versuchZaehlen();
    return res.status(401).json({ fehler: 'Das Passwort stimmt nicht.' });
  }
  versucheZuruecksetzen();
  const sitzung = sitzungAnlegen(rolle);
  cookieSetzen(res, sitzung.sid, sitzung.ablauf);
  req.sitzung = sitzung;
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

/** Vorschlag fuer ein neues Passwort, damit man sich keines ausdenken muss. */
router.get('/passwort-vorschlag', nurLeitung, (_req, res) => {
  res.json({ passwort: passwortVorschlagen() });
});

router.post('/passwoerter', csrfPruefen, nurLeitung, (req, res) => {
  const rolle = req.body?.rolle === 'admin' ? 'admin' : 'benutzer';
  const neues = req.body?.passwort;
  const problem = passwortRegelnVerletzt(neues);
  if (problem) return res.status(400).json({ fehler: problem });

  passwortSetzen(rolle, neues);
  // Alle anderen Geraete mit dieser Rolle muessen sich neu anmelden.
  sitzungenBeenden(rolle, rolle === req.sitzung.rolle ? req.sitzung.sid : null);
  protokollieren(req.sitzung.rolle, 'passwort_geaendert', 'passwort', null, { rolle });
  res.json({ ok: true });
});

export default router;
