// Benutzerverwaltung - nur fuer die Abteilungsleitung (Rolle 'admin').
import express from 'express';
import { db, protokollieren } from '../db.js';
import {
  nurAdmin, angemeldet, passwortHashen, startpasswortErzeugen, passwortRegelnVerletzt
} from '../auth.js';

const router = express.Router();

// Liste aller Personen. Kassiere brauchen die Namen fuer "wer hat ausgelegt",
// sehen aber keine weiteren Angaben.
router.get('/', angemeldet, (req, res) => {
  if (req.benutzer.rolle === 'admin') {
    const liste = db
      .prepare(
        `SELECT b.id, b.name, b.email, b.rolle, b.iban, b.telefon, b.aktiv, b.erstellt_am,
                (SELECT COUNT(*) FROM belege WHERE erfasst_von = b.id) AS anzahl_belege
           FROM benutzer b
          ORDER BY b.aktiv DESC, b.name`
      )
      .all();
    const mitgliedschaften = db
      .prepare(
        `SELECT m.benutzer_id, m.kasse_id, m.rolle, k.name, k.kuerzel
           FROM kassen_mitglieder m JOIN kassen k ON k.id = m.kasse_id`
      )
      .all();
    for (const person of liste) {
      person.kassen = mitgliedschaften.filter((m) => m.benutzer_id === person.id);
    }
    return res.json(liste);
  }
  res.json(
    db.prepare('SELECT id, name FROM benutzer WHERE aktiv = 1 ORDER BY name').all()
  );
});

router.post('/', nurAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const rolle = req.body?.rolle === 'admin' ? 'admin' : 'benutzer';
  if (name.length < 2) return res.status(400).json({ fehler: 'Bitte einen Namen angeben.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ fehler: 'Bitte eine gueltige E-Mail-Adresse angeben.' });
  }
  if (db.prepare('SELECT 1 FROM benutzer WHERE email = ? COLLATE NOCASE').get(email)) {
    return res.status(409).json({ fehler: 'Diese E-Mail-Adresse wird schon verwendet.' });
  }
  const passwort = String(req.body?.passwort || '') || startpasswortErzeugen();
  const problem = passwortRegelnVerletzt(passwort);
  if (problem) return res.status(400).json({ fehler: problem });

  const info = db
    .prepare(
      `INSERT INTO benutzer (name, email, passwort_hash, rolle, passwort_neu)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(name, email, passwortHashen(passwort), rolle);

  protokollieren(req.benutzer.id, 'benutzer_angelegt', 'benutzer', info.lastInsertRowid, { email });
  res.status(201).json({ id: info.lastInsertRowid, name, email, rolle, startpasswort: passwort });
});

router.patch('/:id', nurAdmin, (req, res) => {
  const id = Number(req.params.id);
  const person = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(id);
  if (!person) return res.status(404).json({ fehler: 'Person nicht gefunden.' });

  const neueRolle = req.body?.rolle === 'admin' ? 'admin' : req.body?.rolle === 'benutzer' ? 'benutzer' : person.rolle;
  const aktiv = req.body?.aktiv === undefined ? person.aktiv : (req.body.aktiv ? 1 : 0);

  // Es muss immer mindestens eine aktive Leitung geben.
  if (person.rolle === 'admin' && (neueRolle !== 'admin' || !aktiv)) {
    const andere = db
      .prepare("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'admin' AND aktiv = 1 AND id <> ?")
      .get(id).n;
    if (andere === 0) {
      return res.status(400).json({ fehler: 'Es muss mindestens eine aktive Leitung geben.' });
    }
  }

  db.prepare(
    `UPDATE benutzer SET name = ?, email = ?, rolle = ?, aktiv = ?, iban = ?, telefon = ?
      WHERE id = ?`
  ).run(
    String(req.body?.name ?? person.name).trim().slice(0, 120),
    String(req.body?.email ?? person.email).trim().toLowerCase(),
    neueRolle,
    aktiv,
    req.body?.iban !== undefined
      ? (req.body.iban ? String(req.body.iban).replace(/\s/g, '').toUpperCase().slice(0, 34) : null)
      : person.iban,
    req.body?.telefon !== undefined ? (req.body.telefon || null) : person.telefon,
    id
  );
  if (!aktiv) db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ?').run(id);
  protokollieren(req.benutzer.id, 'benutzer_geaendert', 'benutzer', id, null);
  res.json(db.prepare('SELECT id, name, email, rolle, iban, telefon, aktiv FROM benutzer WHERE id = ?').get(id));
});

router.post('/:id/passwort-zuruecksetzen', nurAdmin, (req, res) => {
  const id = Number(req.params.id);
  const person = db.prepare('SELECT id FROM benutzer WHERE id = ?').get(id);
  if (!person) return res.status(404).json({ fehler: 'Person nicht gefunden.' });
  const passwort = startpasswortErzeugen();
  db.prepare('UPDATE benutzer SET passwort_hash = ?, passwort_neu = 1 WHERE id = ?')
    .run(passwortHashen(passwort), id);
  db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ?').run(id);
  protokollieren(req.benutzer.id, 'passwort_zurueckgesetzt', 'benutzer', id, null);
  res.json({ startpasswort: passwort });
});

export default router;
