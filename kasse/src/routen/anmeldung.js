// Anmelden, abmelden, eigenes Profil.
import express from 'express';
import { db, protokollieren } from '../db.js';
import {
  anmelden, sitzungAnlegen, sitzungLoeschen, cookieSetzen, cookieLoeschen,
  csrfPruefen, angemeldet, passwortHashen, passwortPruefen, passwortRegelnVerletzt,
  zuVieleVersuche, versuchZaehlen, versucheZuruecksetzen, SITZUNGS_COOKIE
} from '../auth.js';

const router = express.Router();

/** Kassen, die dieser Benutzer sieht, inklusive seiner Rolle darin. */
function kassenFuer(benutzer) {
  if (benutzer.rolle === 'admin') {
    return db
      .prepare(`SELECT id, name, kuerzel, farbe, aktiv, 'kassier' AS meine_rolle
                  FROM kassen ORDER BY aktiv DESC, name`)
      .all();
  }
  return db
    .prepare(
      `SELECT k.id, k.name, k.kuerzel, k.farbe, k.aktiv, m.rolle AS meine_rolle
         FROM kassen k
         JOIN kassen_mitglieder m ON m.kasse_id = k.id
        WHERE m.benutzer_id = ? AND k.aktiv = 1
        ORDER BY k.name`
    )
    .all(benutzer.id);
}

export function ichAntwort(req) {
  return {
    benutzer: {
      id: req.benutzer.id,
      name: req.benutzer.name,
      email: req.benutzer.email,
      rolle: req.benutzer.rolle,
      iban: req.benutzer.iban,
      telefon: req.benutzer.telefon,
      passwort_neu: Boolean(req.benutzer.passwort_neu)
    },
    csrf: req.sitzung.csrf,
    kassen: kassenFuer(req.benutzer)
  };
}

router.post('/anmelden', (req, res) => {
  // Einfacher CSRF-Schutz fuer die Anmeldung: nur Anfragen aus unserem eigenen
  // Javascript schicken diesen Kopfeintrag mit, ein HTML-Formular einer
  // fremden Seite kann das nicht.
  if (req.get('X-Requested-With') !== 'ce-march-kasse') {
    return res.status(403).json({ fehler: 'Ungueltige Anfrage.' });
  }
  const { email, passwort } = req.body || {};
  if (!email || !passwort) {
    return res.status(400).json({ fehler: 'E-Mail und Passwort sind noetig.' });
  }
  if (zuVieleVersuche(email)) {
    return res.status(429).json({
      fehler: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.'
    });
  }
  const benutzer = anmelden(email, passwort);
  if (!benutzer) {
    versuchZaehlen(email);
    return res.status(401).json({ fehler: 'E-Mail oder Passwort stimmt nicht.' });
  }
  versucheZuruecksetzen(email);
  const sitzung = sitzungAnlegen(benutzer.id);
  cookieSetzen(res, sitzung.sid, sitzung.ablauf);
  req.benutzer = benutzer;
  req.sitzung = sitzung;
  res.json(ichAntwort(req));
});

router.post('/abmelden', csrfPruefen, (req, res) => {
  sitzungLoeschen(req.cookies?.[SITZUNGS_COOKIE]);
  cookieLoeschen(res);
  res.json({ ok: true });
});

router.get('/ich', (req, res) => {
  if (!req.benutzer) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
  res.json(ichAntwort(req));
});

router.patch('/ich', csrfPruefen, angemeldet, (req, res) => {
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

router.post('/ich/passwort', csrfPruefen, angemeldet, (req, res) => {
  const { altes_passwort: alt, neues_passwort: neu } = req.body || {};
  const zeile = db.prepare('SELECT passwort_hash FROM benutzer WHERE id = ?').get(req.benutzer.id);
  if (!passwortPruefen(alt, zeile.passwort_hash)) {
    return res.status(400).json({ fehler: 'Das bisherige Passwort stimmt nicht.' });
  }
  const problem = passwortRegelnVerletzt(neu);
  if (problem) return res.status(400).json({ fehler: problem });

  db.prepare('UPDATE benutzer SET passwort_hash = ?, passwort_neu = 0 WHERE id = ?')
    .run(passwortHashen(neu), req.benutzer.id);
  // Alle anderen Sitzungen beenden.
  db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ? AND sid <> ?')
    .run(req.benutzer.id, req.sitzung.sid);
  protokollieren(req.benutzer.id, 'passwort_geaendert', 'benutzer', req.benutzer.id, null);
  res.json({ ok: true });
});

export default router;
