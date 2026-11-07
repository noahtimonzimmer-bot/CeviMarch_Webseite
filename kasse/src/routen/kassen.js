// Kassen anlegen, aendern und Personen zuteilen.
import express from 'express';
import { db, protokollieren } from '../db.js';
import { angemeldet, nurAdmin, kassenRolle, darfKasseVerwalten } from '../auth.js';
import { zuRappen } from '../geld.js';

const router = express.Router();

function kasseMitZahlen(kasse) {
  const zahlen = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'geprueft'  THEN betrag_rappen END), 0) AS ausgaben,
         COALESCE(SUM(CASE WHEN status = 'offen'     THEN betrag_rappen END), 0) AS offen,
         COUNT(*) AS anzahl
       FROM belege WHERE kasse_id = ?`
    )
    .get(kasse.id);
  const einnahmen = db
    .prepare('SELECT COALESCE(SUM(betrag_rappen), 0) AS summe FROM einnahmen WHERE kasse_id = ?')
    .get(kasse.id).summe;
  return {
    ...kasse,
    ausgaben_rappen: zahlen.ausgaben,
    offen_rappen: zahlen.offen,
    anzahl_belege: zahlen.anzahl,
    einnahmen_rappen: einnahmen,
    saldo_rappen: kasse.startsaldo_rappen + einnahmen - zahlen.ausgaben
  };
}

router.get('/', angemeldet, (req, res) => {
  const alle =
    req.benutzer.rolle === 'admin'
      ? db.prepare('SELECT * FROM kassen ORDER BY aktiv DESC, name').all()
      : db
          .prepare(
            `SELECT k.* FROM kassen k
               JOIN kassen_mitglieder m ON m.kasse_id = k.id
              WHERE m.benutzer_id = ? AND k.aktiv = 1
              ORDER BY k.name`
          )
          .all(req.benutzer.id);

  res.json(
    alle.map((kasse) => {
      const rolle = kassenRolle(req.benutzer, kasse.id);
      // Wer nur Belege einreicht, sieht keine Kassenstaende.
      if (rolle !== 'kassier') {
        return {
          id: kasse.id, name: kasse.name, kuerzel: kasse.kuerzel, farbe: kasse.farbe,
          beschreibung: kasse.beschreibung, aktiv: kasse.aktiv, meine_rolle: rolle
        };
      }
      return { ...kasseMitZahlen(kasse), meine_rolle: rolle };
    })
  );
});

router.post('/', nurAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const kuerzel = String(req.body?.kuerzel || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (name.length < 2) return res.status(400).json({ fehler: 'Bitte einen Namen angeben.' });
  if (kuerzel.length < 1 || kuerzel.length > 6) {
    return res.status(400).json({ fehler: 'Das Kuerzel braucht 1 bis 6 Zeichen (A-Z, 0-9).' });
  }
  if (db.prepare('SELECT 1 FROM kassen WHERE kuerzel = ? COLLATE NOCASE').get(kuerzel)) {
    return res.status(409).json({ fehler: 'Dieses Kuerzel gibt es schon.' });
  }
  const startsaldo = zuRappen(req.body?.startsaldo ?? 0) ?? 0;
  const farbe = /^#[0-9a-f]{6}$/i.test(req.body?.farbe || '') ? req.body.farbe : '#d21a37';

  const info = db
    .prepare(
      `INSERT INTO kassen (name, kuerzel, beschreibung, farbe, startsaldo_rappen)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, kuerzel, String(req.body?.beschreibung || '').trim() || null, farbe, startsaldo);

  protokollieren(req.benutzer.id, 'kasse_angelegt', 'kasse', info.lastInsertRowid, { name, kuerzel });
  res.status(201).json(kasseMitZahlen(db.prepare('SELECT * FROM kassen WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/:id', nurAdmin, (req, res) => {
  const id = Number(req.params.id);
  const kasse = db.prepare('SELECT * FROM kassen WHERE id = ?').get(id);
  if (!kasse) return res.status(404).json({ fehler: 'Kasse nicht gefunden.' });

  // Das Kuerzel steckt in bereits vergebenen Belegnummern und bleibt darum fest.
  db.prepare(
    `UPDATE kassen SET name = ?, beschreibung = ?, farbe = ?, startsaldo_rappen = ?, aktiv = ?
      WHERE id = ?`
  ).run(
    String(req.body?.name ?? kasse.name).trim().slice(0, 120),
    req.body?.beschreibung !== undefined ? (String(req.body.beschreibung).trim() || null) : kasse.beschreibung,
    /^#[0-9a-f]{6}$/i.test(req.body?.farbe || '') ? req.body.farbe : kasse.farbe,
    req.body?.startsaldo !== undefined ? (zuRappen(req.body.startsaldo) ?? kasse.startsaldo_rappen) : kasse.startsaldo_rappen,
    req.body?.aktiv === undefined ? kasse.aktiv : (req.body.aktiv ? 1 : 0),
    id
  );
  protokollieren(req.benutzer.id, 'kasse_geaendert', 'kasse', id, null);
  res.json(kasseMitZahlen(db.prepare('SELECT * FROM kassen WHERE id = ?').get(id)));
});

// --------------------------------------------------------------- Mitglieder

router.get('/:id/mitglieder', angemeldet, (req, res) => {
  const id = Number(req.params.id);
  if (!darfKasseVerwalten(req.benutzer, id)) {
    return res.status(403).json({ fehler: 'Keine Berechtigung fuer diese Kasse.' });
  }
  res.json(
    db
      .prepare(
        `SELECT m.benutzer_id AS id, b.name, b.email, m.rolle, b.aktiv
           FROM kassen_mitglieder m JOIN benutzer b ON b.id = m.benutzer_id
          WHERE m.kasse_id = ?
          ORDER BY m.rolle DESC, b.name`
      )
      .all(id)
  );
});

// Zuteilen darf nur die Abteilungsleitung.
router.put('/:id/mitglieder', nurAdmin, (req, res) => {
  const kasseId = Number(req.params.id);
  const benutzerId = Number(req.body?.benutzer_id);
  const rolle = req.body?.rolle === 'kassier' ? 'kassier' : 'melder';
  if (!db.prepare('SELECT 1 FROM kassen WHERE id = ?').get(kasseId)) {
    return res.status(404).json({ fehler: 'Kasse nicht gefunden.' });
  }
  if (!db.prepare('SELECT 1 FROM benutzer WHERE id = ?').get(benutzerId)) {
    return res.status(404).json({ fehler: 'Person nicht gefunden.' });
  }
  db.prepare(
    `INSERT INTO kassen_mitglieder (kasse_id, benutzer_id, rolle) VALUES (?, ?, ?)
     ON CONFLICT (kasse_id, benutzer_id) DO UPDATE SET rolle = excluded.rolle`
  ).run(kasseId, benutzerId, rolle);
  protokollieren(req.benutzer.id, 'kasse_zugeteilt', 'kasse', kasseId, { benutzerId, rolle });
  res.json({ ok: true });
});

router.delete('/:id/mitglieder/:benutzerId', nurAdmin, (req, res) => {
  db.prepare('DELETE FROM kassen_mitglieder WHERE kasse_id = ? AND benutzer_id = ?')
    .run(Number(req.params.id), Number(req.params.benutzerId));
  protokollieren(req.benutzer.id, 'kasse_entzogen', 'kasse', Number(req.params.id), {
    benutzerId: Number(req.params.benutzerId)
  });
  res.json({ ok: true });
});

export default router;
