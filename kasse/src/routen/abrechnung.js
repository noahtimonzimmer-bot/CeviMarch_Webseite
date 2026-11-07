// Abrechnung: Zusammenzug pro Kasse, offene Auslagen ("wem schulde ich was")
// und Rueckerstattungen.
import express from 'express';
import { db, protokollieren } from '../db.js';
import { angemeldet, darfKasseVerwalten } from '../auth.js';
import { zuRappen } from '../geld.js';
import { belegFilter, sichtbarkeit } from '../belegabfrage.js';

const router = express.Router();
router.use(angemeldet);

/** Kompletter Zusammenzug fuer den gewaehlten Zeitraum. */
export function abrechnungBerechnen(benutzer, abfrage) {
  const { where, werte } = belegFilter(benutzer, abfrage);
  const erlaubteKassen = sichtbarkeit(benutzer).kassier;

  const ausgaben = db
    .prepare(
      `SELECT b.status,
              COUNT(*) AS anzahl,
              COALESCE(SUM(b.betrag_rappen), 0) AS summe
         FROM belege b WHERE ${where} GROUP BY b.status`
    )
    .all(...werte);

  const nachKategorie = db
    .prepare(
      `SELECT b.kategorie, COUNT(*) AS anzahl, COALESCE(SUM(b.betrag_rappen), 0) AS summe
         FROM belege b WHERE ${where} AND b.status = 'geprueft'
        GROUP BY b.kategorie ORDER BY summe DESC`
    )
    .all(...werte);

  const nachZahlungsart = db
    .prepare(
      `SELECT b.zahlungsart, COUNT(*) AS anzahl, COALESCE(SUM(b.betrag_rappen), 0) AS summe
         FROM belege b WHERE ${where} AND b.status = 'geprueft'
        GROUP BY b.zahlungsart ORDER BY summe DESC`
    )
    .all(...werte);

  const nachMonat = db
    .prepare(
      `SELECT substr(b.datum, 1, 7) AS monat, COUNT(*) AS anzahl,
              COALESCE(SUM(b.betrag_rappen), 0) AS summe
         FROM belege b WHERE ${where} AND b.status = 'geprueft'
        GROUP BY monat ORDER BY monat`
    )
    .all(...werte);

  const nachKasse = db
    .prepare(
      `SELECT k.id, k.name, k.kuerzel, k.farbe,
              COUNT(*) AS anzahl,
              COALESCE(SUM(CASE WHEN b.status = 'geprueft' THEN b.betrag_rappen END), 0) AS summe,
              COALESCE(SUM(CASE WHEN b.status = 'offen'    THEN b.betrag_rappen END), 0) AS offen
         FROM belege b JOIN kassen k ON k.id = b.kasse_id
        WHERE ${where} GROUP BY k.id ORDER BY k.name`
    )
    .all(...werte);

  const nachPerson = db
    .prepare(
      `SELECT p.id, p.name,
              COUNT(*) AS anzahl,
              COALESCE(SUM(b.betrag_rappen), 0) AS summe
         FROM belege b LEFT JOIN benutzer p ON p.id = b.bezahlt_von
        WHERE ${where} AND b.status = 'geprueft' AND b.zahlungsart = 'privat'
        GROUP BY p.id ORDER BY summe DESC`
    )
    .all(...werte);

  // Einnahmen im gleichen Zeitraum und in denselben Kassen.
  let einnahmen = { anzahl: 0, summe: 0 };
  let startsaldo = 0;
  if (erlaubteKassen.length) {
    const kasseFilter = String(abfrage.kasse || '')
      .split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0);
    const kassen = kasseFilter.length
      ? erlaubteKassen.filter((id) => kasseFilter.includes(id))
      : erlaubteKassen;

    if (kassen.length) {
      const platz = kassen.map(() => '?').join(', ');
      const bedingungen = [`kasse_id IN (${platz})`];
      const ewerte = [...kassen];
      if (abfrage.von) { bedingungen.push('datum >= ?'); ewerte.push(String(abfrage.von).slice(0, 10)); }
      if (abfrage.bis) { bedingungen.push('datum <= ?'); ewerte.push(String(abfrage.bis).slice(0, 10)); }
      einnahmen = db
        .prepare(`SELECT COUNT(*) AS anzahl, COALESCE(SUM(betrag_rappen), 0) AS summe
                    FROM einnahmen WHERE ${bedingungen.join(' AND ')}`)
        .get(...ewerte);
      startsaldo = db
        .prepare(`SELECT COALESCE(SUM(startsaldo_rappen), 0) AS s FROM kassen WHERE id IN (${platz})`)
        .get(...kassen).s;
    }
  }

  const summe = (status) => ausgaben.find((a) => a.status === status)?.summe || 0;
  const anzahl = (status) => ausgaben.find((a) => a.status === status)?.anzahl || 0;

  return {
    zeitraum: { von: abfrage.von || null, bis: abfrage.bis || null },
    ausgaben_rappen: summe('geprueft'),
    offen_rappen: summe('offen'),
    abgelehnt_rappen: summe('abgelehnt'),
    anzahl_geprueft: anzahl('geprueft'),
    anzahl_offen: anzahl('offen'),
    anzahl_abgelehnt: anzahl('abgelehnt'),
    einnahmen_rappen: einnahmen.summe,
    anzahl_einnahmen: einnahmen.anzahl,
    startsaldo_rappen: startsaldo,
    saldo_rappen: startsaldo + einnahmen.summe - summe('geprueft'),
    nach_kategorie: nachKategorie,
    nach_zahlungsart: nachZahlungsart,
    nach_monat: nachMonat,
    nach_kasse: nachKasse,
    nach_person: nachPerson
  };
}

router.get('/abrechnung', (req, res) => {
  res.json(abrechnungBerechnen(req.benutzer, req.query));
});

// ------------------------------------------------- Wem schulde ich noch was?

/** Offene private Auslagen pro Person (geprueft, aber noch nicht zurueckerstattet). */
export function schuldenBerechnen(benutzer, abfrage = {}) {
  const { where, werte } = belegFilter(
    benutzer,
    { ...abfrage, status: 'geprueft', zahlungsart: 'privat' }
  );
  const personen = db
    .prepare(
      `SELECT p.id, p.name, p.email, p.iban,
              COUNT(*) AS anzahl,
              COALESCE(SUM(b.betrag_rappen), 0) AS summe,
              MIN(b.datum) AS aeltester
         FROM belege b LEFT JOIN benutzer p ON p.id = b.bezahlt_von
        WHERE ${where} AND b.rueckerstattung_id IS NULL
        GROUP BY p.id ORDER BY summe DESC`
    )
    .all(...werte);

  const belege = db
    .prepare(
      `SELECT b.id, b.nummer, b.datum, b.betrag_rappen, b.beschreibung, b.bezahlt_von,
              k.name AS kasse_name, k.kuerzel AS kasse_kuerzel
         FROM belege b JOIN kassen k ON k.id = b.kasse_id
        WHERE ${where} AND b.rueckerstattung_id IS NULL
        ORDER BY b.datum`
    )
    .all(...werte);

  for (const person of personen) {
    person.belege = belege.filter((b) => b.bezahlt_von === person.id);
  }
  return {
    personen,
    gesamt_rappen: personen.reduce((s, p) => s + p.summe, 0)
  };
}

router.get('/schulden', (req, res) => {
  res.json(schuldenBerechnen(req.benutzer, req.query));
});

// ----------------------------------------------------------- Rueckerstattung

router.get('/rueckerstattungen', (req, res) => {
  const nurEigene = req.benutzer.rolle !== 'admin' && !sichtbarkeit(req.benutzer).kassier.length;
  const zeilen = db
    .prepare(
      `SELECT r.*, b.name AS benutzer_name, e.name AS erstellt_von_name,
              (SELECT COUNT(*) FROM belege WHERE rueckerstattung_id = r.id) AS anzahl_belege
         FROM rueckerstattungen r
         JOIN benutzer b ON b.id = r.benutzer_id
         LEFT JOIN benutzer e ON e.id = r.erstellt_von
        ${nurEigene ? 'WHERE r.benutzer_id = ?' : ''}
        ORDER BY r.datum DESC, r.id DESC LIMIT 300`
    )
    .all(...(nurEigene ? [req.benutzer.id] : []));
  res.json(zeilen);
});

router.post('/rueckerstattungen', (req, res) => {
  const benutzerId = Number(req.body?.benutzer_id);
  const ids = Array.isArray(req.body?.beleg_ids) ? req.body.beleg_ids.map(Number).filter(Boolean) : [];
  if (!benutzerId || !ids.length) {
    return res.status(400).json({ fehler: 'Person und mindestens ein Beleg sind noetig.' });
  }
  const datum = String(req.body?.datum || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ fehler: 'Ungueltiges Datum.' });
  const methode = ['bank', 'bar', 'twint', 'verrechnet'].includes(req.body?.methode)
    ? req.body.methode : 'bank';

  const belege = db
    .prepare(`SELECT * FROM belege WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids);

  for (const beleg of belege) {
    if (!darfKasseVerwalten(req.benutzer, beleg.kasse_id)) {
      return res.status(403).json({ fehler: `Keine Berechtigung fuer Beleg ${beleg.nummer}.` });
    }
    if (beleg.status !== 'geprueft') {
      return res.status(400).json({ fehler: `Beleg ${beleg.nummer} ist noch nicht geprueft.` });
    }
    if (beleg.rueckerstattung_id) {
      return res.status(400).json({ fehler: `Beleg ${beleg.nummer} ist schon zurueckerstattet.` });
    }
    if (beleg.bezahlt_von !== benutzerId) {
      return res.status(400).json({ fehler: `Beleg ${beleg.nummer} gehoert zu einer anderen Person.` });
    }
  }
  if (belege.length !== ids.length) return res.status(404).json({ fehler: 'Ein Beleg wurde nicht gefunden.' });

  const summe = belege.reduce((s, b) => s + b.betrag_rappen, 0);
  let neueId;
  db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO rueckerstattungen (benutzer_id, datum, betrag_rappen, methode, notiz, erstellt_von)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(benutzerId, datum, summe, methode,
           String(req.body?.notiz || '').trim().slice(0, 300) || null, req.benutzer.id);
    neueId = Number(info.lastInsertRowid);
    const setzen = db.prepare('UPDATE belege SET rueckerstattung_id = ? WHERE id = ?');
    for (const beleg of belege) setzen.run(neueId, beleg.id);
  })();

  protokollieren(req.benutzer.id, 'rueckerstattung', 'rueckerstattung', neueId, {
    benutzerId, summe, anzahl: belege.length
  });
  res.status(201).json(db.prepare('SELECT * FROM rueckerstattungen WHERE id = ?').get(neueId));
});

router.delete('/rueckerstattungen/:id', (req, res) => {
  const id = Number(req.params.id);
  const eintrag = db.prepare('SELECT * FROM rueckerstattungen WHERE id = ?').get(id);
  if (!eintrag) return res.status(404).json({ fehler: 'Nicht gefunden.' });
  const belege = db.prepare('SELECT kasse_id FROM belege WHERE rueckerstattung_id = ?').all(id);
  for (const beleg of belege) {
    if (!darfKasseVerwalten(req.benutzer, beleg.kasse_id)) {
      return res.status(403).json({ fehler: 'Keine Berechtigung.' });
    }
  }
  db.transaction(() => {
    db.prepare('UPDATE belege SET rueckerstattung_id = NULL WHERE rueckerstattung_id = ?').run(id);
    db.prepare('DELETE FROM rueckerstattungen WHERE id = ?').run(id);
  })();
  protokollieren(req.benutzer.id, 'rueckerstattung_geloescht', 'rueckerstattung', id, null);
  res.json({ ok: true });
});

export default router;
