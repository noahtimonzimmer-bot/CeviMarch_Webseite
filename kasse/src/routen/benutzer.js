// Konten verwalten: Kassenchefs anlegen, Kassen freigeben, sperren.
// Das darf nur die Abteilungsleitung (Rolle 'admin').
import express from 'express';
import { db, protokollieren } from '../db.js';
import {
  nurAdmin, mitKonto, passwortHashen, passwortVorschlagen, kontoSitzungenBeenden
} from '../auth.js';

const router = express.Router();

const KONTO_FELDER = `id, name, email, rolle, iban, telefon, aktiv, passwort_neu, erstellt_am`;

function kontoLesen(id) {
  const konto = db.prepare(`SELECT ${KONTO_FELDER} FROM benutzer WHERE id = ?`).get(Number(id));
  if (!konto) return null;
  konto.kassen = db
    .prepare(
      `SELECT k.id, k.name FROM kassen_chefs c JOIN kassen k ON k.id = c.kasse_id
        WHERE c.benutzer_id = ? ORDER BY k.reihenfolge, k.name`
    )
    .all(konto.id);
  return konto;
}

function istEmail(wert) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(wert || '').trim());
}

/** Wie viele Admins gibt es sonst noch? Der letzte darf nicht weg. */
function andereAdmins(ausserId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'admin' AND aktiv = 1 AND id <> ?")
    .get(Number(ausserId)).n;
}

// Kassenchefs duerfen die Liste lesen (um zu sehen, wer sonst noch da ist),
// aendern darf nur die Abteilungsleitung.
router.get('/', mitKonto, (req, res) => {
  const konten = db
    .prepare(`SELECT ${KONTO_FELDER} FROM benutzer ORDER BY rolle, name`)
    .all()
    .map((konto) => kontoLesen(konto.id));
  if (req.rolle !== 'admin') {
    return res.json(konten.map((k) => ({ id: k.id, name: k.name, rolle: k.rolle })));
  }
  res.json(konten);
});

router.post('/', nurAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const rolle = ['admin', 'kassier', 'chef'].includes(req.body?.rolle)
    ? req.body.rolle : 'chef';
  if (name.length < 2) return res.status(400).json({ fehler: 'Bitte einen Namen angeben.' });
  if (!istEmail(email)) return res.status(400).json({ fehler: 'Bitte eine gueltige E-Mail angeben.' });
  if (db.prepare('SELECT 1 FROM benutzer WHERE email = ? COLLATE NOCASE').get(email)) {
    return res.status(409).json({ fehler: 'Diese E-Mail hat schon ein Konto.' });
  }

  // Das Startpasswort wird einmal angezeigt und muss beim ersten
  // Anmelden geaendert werden. Verschickt wird nichts - die
  // Abteilungsleitung gibt es persoenlich weiter.
  const startpasswort = passwortVorschlagen();
  const info = db
    .prepare(
      `INSERT INTO benutzer (name, email, passwort_hash, rolle, iban, telefon, passwort_neu)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      name.slice(0, 120), email, passwortHashen(startpasswort), rolle,
      req.body?.iban ? String(req.body.iban).replace(/\s/g, '').toUpperCase().slice(0, 34) : null,
      req.body?.telefon ? String(req.body.telefon).trim().slice(0, 40) : null
    );

  const id = Number(info.lastInsertRowid);
  // Gleich mitgegebene Kassen freischalten.
  for (const kasseId of (Array.isArray(req.body?.kassen) ? req.body.kassen : []).map(Number)) {
    if (db.prepare('SELECT 1 FROM kassen WHERE id = ?').get(kasseId)) {
      db.prepare('INSERT OR IGNORE INTO kassen_chefs (kasse_id, benutzer_id) VALUES (?, ?)')
        .run(kasseId, id);
    }
  }

  protokollieren(req.rolle, 'konto_angelegt', 'benutzer', id, { email, rolle });
  res.status(201).json({ ...kontoLesen(id), startpasswort });
});

router.patch('/:id', nurAdmin, (req, res) => {
  const konto = kontoLesen(req.params.id);
  if (!konto) return res.status(404).json({ fehler: 'Konto nicht gefunden.' });

  const neueRolle = ['admin', 'kassier', 'chef'].includes(req.body?.rolle)
    ? req.body.rolle : konto.rolle;
  const neuAktiv = req.body?.aktiv === undefined ? konto.aktiv : (req.body.aktiv ? 1 : 0);

  // Die letzte Abteilungsleitung darf sich nicht selbst aussperren.
  if (konto.rolle === 'admin' && (neueRolle !== 'admin' || !neuAktiv) && andereAdmins(konto.id) === 0) {
    return res.status(400).json({
      fehler: 'Das ist die einzige Abteilungsleitung. Lege zuerst eine zweite an.'
    });
  }

  db.prepare(
    'UPDATE benutzer SET name = ?, rolle = ?, iban = ?, telefon = ?, aktiv = ? WHERE id = ?'
  ).run(
    String(req.body?.name ?? konto.name).trim().slice(0, 120) || konto.name,
    neueRolle,
    req.body?.iban !== undefined
      ? (String(req.body.iban).replace(/\s/g, '').toUpperCase().slice(0, 34) || null)
      : konto.iban,
    req.body?.telefon !== undefined ? (String(req.body.telefon).trim().slice(0, 40) || null) : konto.telefon,
    neuAktiv,
    konto.id
  );
  if (!neuAktiv) kontoSitzungenBeenden(konto.id);
  protokollieren(req.rolle, 'konto_geaendert', 'benutzer', konto.id, null);
  res.json(kontoLesen(konto.id));
});

/** Neues Startpasswort erzeugen, wenn jemand seines vergessen hat. */
router.post('/:id/passwort', nurAdmin, (req, res) => {
  const konto = kontoLesen(req.params.id);
  if (!konto) return res.status(404).json({ fehler: 'Konto nicht gefunden.' });
  const startpasswort = passwortVorschlagen();
  db.prepare('UPDATE benutzer SET passwort_hash = ?, passwort_neu = 1 WHERE id = ?')
    .run(passwortHashen(startpasswort), konto.id);
  kontoSitzungenBeenden(konto.id);
  protokollieren(req.rolle, 'konto_passwort_zurueckgesetzt', 'benutzer', konto.id, null);
  res.json({ startpasswort });
});

// -------------------------------------------------- Kassen freigeben

router.put('/:id/kassen', nurAdmin, (req, res) => {
  const konto = kontoLesen(req.params.id);
  if (!konto) return res.status(404).json({ fehler: 'Konto nicht gefunden.' });
  const gewuenscht = (Array.isArray(req.body?.kassen) ? req.body.kassen : [])
    .map(Number)
    .filter((id) => db.prepare('SELECT 1 FROM kassen WHERE id = ?').get(id));

  db.transaction(() => {
    db.prepare('DELETE FROM kassen_chefs WHERE benutzer_id = ?').run(konto.id);
    const setzen = db.prepare('INSERT OR IGNORE INTO kassen_chefs (kasse_id, benutzer_id) VALUES (?, ?)');
    for (const kasseId of gewuenscht) setzen.run(kasseId, konto.id);
  })();

  protokollieren(req.rolle, 'kassen_freigegeben', 'benutzer', konto.id, { kassen: gewuenscht });
  res.json(kontoLesen(konto.id));
});

export default router;
