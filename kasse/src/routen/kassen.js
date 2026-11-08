// Kassen: Uebersicht, Kassenbuch, Einnahmen und Rueckerstattungen.
// Alles, was eine Kasse betrifft, haengt hier unter /api/kassen/:id.
import express from 'express';
import { db, protokollieren } from '../db.js';
import { angemeldet, nurLeitung } from '../auth.js';
import { zuRappen } from '../geld.js';
import {
  alleKassen, kasseLesen, kasseZahlen, kassenbuch, belegeDerKasse,
  schuldenDerKasse, personenDerKasse, jahreDerKasse
} from '../kassenbuch.js';

const router = express.Router();
router.use(angemeldet);

function kasseOderFehler(req, res) {
  const kasse = kasseLesen(req.params.id);
  if (!kasse) {
    res.status(404).json({ fehler: 'Kasse nicht gefunden.' });
    return null;
  }
  return kasse;
}

// ------------------------------------------------------------- Uebersicht

router.get('/', (req, res) => {
  const kassen = alleKassen();
  // Wer nur Belege einreicht, braucht die Kassenstaende nicht zu sehen.
  if (req.rolle !== 'admin') {
    return res.json(
      kassen
        .filter((k) => k.aktiv)
        .map((k) => ({ id: k.id, name: k.name, beschreibung: k.beschreibung, farbe: k.farbe }))
    );
  }
  res.json(kassen.map(kasseZahlen));
});

router.post('/', nurLeitung, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2) return res.status(400).json({ fehler: 'Bitte einen Namen angeben.' });
  const startsaldo = zuRappen(req.body?.startsaldo ?? 0) ?? 0;
  const farbe = /^#[0-9a-f]{6}$/i.test(req.body?.farbe || '') ? req.body.farbe : '#d21a37';
  const letzte = db.prepare('SELECT COALESCE(MAX(reihenfolge), 0) AS n FROM kassen').get().n;

  const info = db
    .prepare(
      `INSERT INTO kassen (name, beschreibung, farbe, startsaldo_rappen, reihenfolge)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name.slice(0, 120), String(req.body?.beschreibung || '').trim() || null,
         farbe, startsaldo, letzte + 1);

  protokollieren(req.rolle, 'kasse_angelegt', 'kasse', info.lastInsertRowid, { name });
  res.status(201).json(kasseZahlen(kasseLesen(info.lastInsertRowid)));
});

router.patch('/:id', nurLeitung, (req, res) => {
  const kasse = kasseOderFehler(req, res);
  if (!kasse) return;
  db.prepare(
    `UPDATE kassen SET name = ?, beschreibung = ?, farbe = ?, startsaldo_rappen = ?, aktiv = ?
      WHERE id = ?`
  ).run(
    String(req.body?.name ?? kasse.name).trim().slice(0, 120) || kasse.name,
    req.body?.beschreibung !== undefined ? (String(req.body.beschreibung).trim() || null) : kasse.beschreibung,
    /^#[0-9a-f]{6}$/i.test(req.body?.farbe || '') ? req.body.farbe : kasse.farbe,
    req.body?.startsaldo !== undefined ? (zuRappen(req.body.startsaldo) ?? kasse.startsaldo_rappen) : kasse.startsaldo_rappen,
    req.body?.aktiv === undefined ? kasse.aktiv : (req.body.aktiv ? 1 : 0),
    kasse.id
  );
  protokollieren(req.rolle, 'kasse_geaendert', 'kasse', kasse.id, null);
  res.json(kasseZahlen(kasseLesen(kasse.id)));
});

router.delete('/:id', nurLeitung, (req, res) => {
  const kasse = kasseOderFehler(req, res);
  if (!kasse) return;
  const belege = db.prepare('SELECT COUNT(*) AS n FROM belege WHERE kasse_id = ?').get(kasse.id).n;
  const einnahmen = db.prepare('SELECT COUNT(*) AS n FROM einnahmen WHERE kasse_id = ?').get(kasse.id).n;
  if (belege || einnahmen) {
    return res.status(400).json({
      fehler: 'Diese Kasse hat Buchungen und kann nicht geloescht werden. Du kannst sie stattdessen schliessen.'
    });
  }
  db.prepare('DELETE FROM kassen WHERE id = ?').run(kasse.id);
  protokollieren(req.rolle, 'kasse_geloescht', 'kasse', kasse.id, { name: kasse.name });
  res.json({ ok: true });
});

// ------------------------------------------------- Eine Kasse mit allem drin

router.get('/:id', nurLeitung, (req, res) => {
  const kasse = kasseOderFehler(req, res);
  if (!kasse) return;
  const jahre = jahreDerKasse(kasse.id);
  const jahr = req.query.jahr === 'alle' ? null : Number(req.query.jahr) || jahre[0];

  res.json({
    kasse: kasseZahlen(kasse),
    jahre,
    jahr,
    buch: kassenbuch(kasse.id, jahr),
    offene: belegeDerKasse(kasse.id, { status: 'offen' }),
    abgelehnte: belegeDerKasse(kasse.id, { status: 'abgelehnt', jahr }),
    belege: belegeDerKasse(kasse.id, { jahr }),
    schulden: schuldenDerKasse(kasse.id),
    personen: personenDerKasse(kasse.id),
    rueckerstattungen: db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM belege WHERE rueckerstattung_id = r.id) AS anzahl_belege
           FROM rueckerstattungen r WHERE r.kasse_id = ?
          ORDER BY r.datum DESC, r.id DESC LIMIT 100`
      )
      .all(kasse.id)
  });
});

/** Namensvorschlaege, damit das Feld "ausgelegt von" sich selbst ausfuellt. */
router.get('/:id/personen', (req, res) => {
  res.json(personenDerKasse(Number(req.params.id)));
});

// ---------------------------------------------------------------- Einnahmen

router.post('/:id/einnahmen', nurLeitung, (req, res) => {
  const kasse = kasseOderFehler(req, res);
  if (!kasse) return;
  const datum = String(req.body?.datum || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return res.status(400).json({ fehler: 'Bitte ein gueltiges Datum angeben.' });
  }
  const betrag = zuRappen(req.body?.betrag);
  if (betrag === null || betrag <= 0) return res.status(400).json({ fehler: 'Ungueltiger Betrag.' });
  const beschreibung = String(req.body?.beschreibung || '').trim();
  if (beschreibung.length < 2) return res.status(400).json({ fehler: 'Bitte kurz beschreiben.' });

  const info = db
    .prepare('INSERT INTO einnahmen (kasse_id, datum, betrag_rappen, beschreibung) VALUES (?, ?, ?, ?)')
    .run(kasse.id, datum, betrag, beschreibung.slice(0, 300));
  protokollieren(req.rolle, 'einnahme_erfasst', 'einnahme', info.lastInsertRowid, { betrag });
  res.status(201).json(db.prepare('SELECT * FROM einnahmen WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id/einnahmen/:einnahmeId', nurLeitung, (req, res) => {
  const eintrag = db
    .prepare('SELECT * FROM einnahmen WHERE id = ? AND kasse_id = ?')
    .get(Number(req.params.einnahmeId), Number(req.params.id));
  if (!eintrag) return res.status(404).json({ fehler: 'Eintrag nicht gefunden.' });
  db.prepare('DELETE FROM einnahmen WHERE id = ?').run(eintrag.id);
  protokollieren(req.rolle, 'einnahme_geloescht', 'einnahme', eintrag.id, {
    betrag: eintrag.betrag_rappen, beschreibung: eintrag.beschreibung
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------- Rueckerstattung

router.post('/:id/rueckerstattungen', nurLeitung, (req, res) => {
  const kasse = kasseOderFehler(req, res);
  if (!kasse) return;
  const person = String(req.body?.person || '').trim();
  const ids = Array.isArray(req.body?.beleg_ids) ? req.body.beleg_ids.map(Number).filter(Boolean) : [];
  if (!person || !ids.length) {
    return res.status(400).json({ fehler: 'Person und mindestens ein Beleg sind noetig.' });
  }
  const datum = String(req.body?.datum || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ fehler: 'Ungueltiges Datum.' });
  const methode = ['bank', 'bar', 'twint', 'verrechnet'].includes(req.body?.methode)
    ? req.body.methode : 'bank';

  const belege = db
    .prepare(`SELECT * FROM belege WHERE id IN (${ids.map(() => '?').join(', ')}) AND kasse_id = ?`)
    .all(...ids, kasse.id);
  if (belege.length !== ids.length) {
    return res.status(404).json({ fehler: 'Ein Beleg gehoert nicht zu dieser Kasse.' });
  }
  for (const beleg of belege) {
    if (beleg.status !== 'geprueft') {
      return res.status(400).json({ fehler: `Beleg Nr. ${beleg.nummer} ist noch nicht geprueft.` });
    }
    if (beleg.rueckerstattung_id) {
      return res.status(400).json({ fehler: `Beleg Nr. ${beleg.nummer} ist schon zurueckerstattet.` });
    }
  }

  const summe = belege.reduce((s, b) => s + b.betrag_rappen, 0);
  let neueId;
  db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO rueckerstattungen (kasse_id, person, datum, betrag_rappen, methode, notiz)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(kasse.id, person.slice(0, 120), datum, summe, methode,
           String(req.body?.notiz || '').trim().slice(0, 300) || null);
    neueId = Number(info.lastInsertRowid);
    const setzen = db.prepare('UPDATE belege SET rueckerstattung_id = ? WHERE id = ?');
    for (const beleg of belege) setzen.run(neueId, beleg.id);
  })();

  protokollieren(req.rolle, 'rueckerstattung', 'rueckerstattung', neueId, {
    person, summe, anzahl: belege.length
  });
  res.status(201).json(db.prepare('SELECT * FROM rueckerstattungen WHERE id = ?').get(neueId));
});

router.delete('/:id/rueckerstattungen/:rueckId', nurLeitung, (req, res) => {
  const eintrag = db
    .prepare('SELECT * FROM rueckerstattungen WHERE id = ? AND kasse_id = ?')
    .get(Number(req.params.rueckId), Number(req.params.id));
  if (!eintrag) return res.status(404).json({ fehler: 'Nicht gefunden.' });
  db.transaction(() => {
    db.prepare('UPDATE belege SET rueckerstattung_id = NULL WHERE rueckerstattung_id = ?').run(eintrag.id);
    db.prepare('DELETE FROM rueckerstattungen WHERE id = ?').run(eintrag.id);
  })();
  protokollieren(req.rolle, 'rueckerstattung_geloescht', 'rueckerstattung', eintrag.id, null);
  res.json({ ok: true });
});

export default router;
