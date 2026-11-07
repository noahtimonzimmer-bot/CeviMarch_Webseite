// Einnahmen und Einzahlungen einer Kasse (Beitraege, Zuschuesse, Bareinlagen).
import express from 'express';
import { db, protokollieren } from '../db.js';
import { angemeldet, darfKasseVerwalten } from '../auth.js';
import { zuRappen } from '../geld.js';
import { sichtbarkeit } from '../belegabfrage.js';

const router = express.Router();
router.use(angemeldet);

router.get('/', (req, res) => {
  const erlaubt = sichtbarkeit(req.benutzer).kassier;
  if (!erlaubt.length) return res.json({ einnahmen: [], summe_rappen: 0 });

  const bedingungen = [`e.kasse_id IN (${erlaubt.map(() => '?').join(', ')})`];
  const werte = [...erlaubt];

  const kasseIds = String(req.query.kasse || '')
    .split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0);
  if (kasseIds.length) {
    bedingungen.push(`e.kasse_id IN (${kasseIds.map(() => '?').join(', ')})`);
    werte.push(...kasseIds);
  }
  if (req.query.von) { bedingungen.push('e.datum >= ?'); werte.push(String(req.query.von).slice(0, 10)); }
  if (req.query.bis) { bedingungen.push('e.datum <= ?'); werte.push(String(req.query.bis).slice(0, 10)); }

  const where = bedingungen.join(' AND ');
  const einnahmen = db
    .prepare(
      `SELECT e.*, k.name AS kasse_name, k.kuerzel AS kasse_kuerzel, b.name AS erfasst_von_name
         FROM einnahmen e
         JOIN kassen k   ON k.id = e.kasse_id
         LEFT JOIN benutzer b ON b.id = e.erfasst_von
        WHERE ${where}
        ORDER BY e.datum DESC, e.id DESC`
    )
    .all(...werte);
  const summe = einnahmen.reduce((s, e) => s + e.betrag_rappen, 0);
  res.json({ einnahmen, summe_rappen: summe });
});

router.post('/', (req, res) => {
  const kasseId = Number(req.body?.kasse_id);
  if (!darfKasseVerwalten(req.benutzer, kasseId)) {
    return res.status(403).json({ fehler: 'Nur die Kassenfuehrung kann Einnahmen erfassen.' });
  }
  const datum = String(req.body?.datum || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return res.status(400).json({ fehler: 'Bitte ein gueltiges Datum angeben.' });
  }
  const betrag = zuRappen(req.body?.betrag);
  if (betrag === null || betrag <= 0) return res.status(400).json({ fehler: 'Ungueltiger Betrag.' });
  const beschreibung = String(req.body?.beschreibung || '').trim();
  if (beschreibung.length < 2) return res.status(400).json({ fehler: 'Bitte kurz beschreiben.' });

  const info = db
    .prepare(
      `INSERT INTO einnahmen (kasse_id, datum, betrag_rappen, beschreibung, kategorie, erfasst_von)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(kasseId, datum, betrag, beschreibung.slice(0, 300),
         String(req.body?.kategorie || 'Einnahme').trim().slice(0, 60), req.benutzer.id);
  protokollieren(req.benutzer.id, 'einnahme_erfasst', 'einnahme', info.lastInsertRowid, { betrag });
  res.status(201).json(db.prepare('SELECT * FROM einnahmen WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const eintrag = db.prepare('SELECT * FROM einnahmen WHERE id = ?').get(Number(req.params.id));
  if (!eintrag) return res.status(404).json({ fehler: 'Eintrag nicht gefunden.' });
  if (!darfKasseVerwalten(req.benutzer, eintrag.kasse_id)) {
    return res.status(403).json({ fehler: 'Keine Berechtigung.' });
  }
  db.prepare('DELETE FROM einnahmen WHERE id = ?').run(eintrag.id);
  protokollieren(req.benutzer.id, 'einnahme_geloescht', 'einnahme', eintrag.id, {
    betrag: eintrag.betrag_rappen, beschreibung: eintrag.beschreibung
  });
  res.json({ ok: true });
});

export default router;
