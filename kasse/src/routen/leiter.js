// Namensliste der Leiterinnen und Leiter.
//
// Lesen darf jede Anmeldung - auch mit dem gemeinsamen Passwort, damit man
// sich beim Anmelden auswaehlen und bei "Ausgelegt von" jemanden waehlen
// kann. Pflegen darf nur die Abteilungsleitung.
import express from 'express';
import { db, protokollieren } from '../db.js';
import { angemeldet, nurAdmin } from '../auth.js';

const router = express.Router();
router.use(angemeldet);

function alle() {
  return db.prepare('SELECT id, name FROM leiter ORDER BY name COLLATE NOCASE').all();
}

function nameLesen(wert) {
  return String(wert || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

router.get('/', (_req, res) => {
  res.json(alle());
});

router.post('/', nurAdmin, (req, res) => {
  // Mehrere auf einmal: eine Zeile pro Name.
  const namen = String(req.body?.namen ?? req.body?.name ?? '')
    .split(/\r?\n|,/)
    .map(nameLesen)
    .filter((name) => name.length >= 2);
  if (!namen.length) return res.status(400).json({ fehler: 'Bitte mindestens einen Namen angeben.' });

  const einfuegen = db.prepare('INSERT OR IGNORE INTO leiter (name) VALUES (?)');
  let neu = 0;
  db.transaction(() => {
    for (const name of namen) neu += einfuegen.run(name).changes;
  })();
  protokollieren(req.rolle, 'leiter_angelegt', 'leiter', null, { anzahl: neu });
  res.status(201).json({ neu, leiter: alle() });
});

router.patch('/:id', nurAdmin, (req, res) => {
  const eintrag = db.prepare('SELECT * FROM leiter WHERE id = ?').get(Number(req.params.id));
  if (!eintrag) return res.status(404).json({ fehler: 'Name nicht gefunden.' });
  const name = nameLesen(req.body?.name);
  if (name.length < 2) return res.status(400).json({ fehler: 'Bitte einen Namen angeben.' });
  const doppelt = db
    .prepare('SELECT 1 FROM leiter WHERE name = ? COLLATE NOCASE AND id <> ?')
    .get(name, eintrag.id);
  if (doppelt) return res.status(409).json({ fehler: 'Diesen Namen gibt es schon.' });

  // Umbenennen zieht die Belege mit, damit "noch offen an ..." stimmt.
  db.transaction(() => {
    db.prepare('UPDATE leiter SET name = ? WHERE id = ?').run(name, eintrag.id);
    if (req.body?.belege_mitnehmen !== false) {
      db.prepare('UPDATE belege SET person = ? WHERE person = ? COLLATE NOCASE')
        .run(name, eintrag.name);
    }
  })();
  protokollieren(req.rolle, 'leiter_umbenannt', 'leiter', eintrag.id, { vorher: eintrag.name, nachher: name });
  res.json({ leiter: alle() });
});

router.delete('/:id', nurAdmin, (req, res) => {
  const eintrag = db.prepare('SELECT * FROM leiter WHERE id = ?').get(Number(req.params.id));
  if (!eintrag) return res.status(404).json({ fehler: 'Name nicht gefunden.' });
  db.prepare('DELETE FROM leiter WHERE id = ?').run(eintrag.id);
  protokollieren(req.rolle, 'leiter_entfernt', 'leiter', eintrag.id, { name: eintrag.name });
  res.json({ leiter: alle() });
});

export default router;
