// Belege: einreichen, ansehen, pruefen, Fotos ausliefern.
import express from 'express';
import fs from 'node:fs';
import { db, protokollieren } from '../db.js';
import { angemeldet, darfKasseVerwalten, darfBelegEinreichen, kassenRolle } from '../auth.js';
import { zuRappen } from '../geld.js';
import { belegeLaden, BELEG_AUSWAHL } from '../belegabfrage.js';
import { belegUpload, belegDateiSpeichern, vollerPfad, dateiLoeschen } from '../dateien.js';

const router = express.Router();
router.use(angemeldet);

export const KATEGORIEN = [
  'Lebensmittel', 'Material', 'Miete', 'Transport', 'Programm',
  'Geschenke', 'Buero', 'Versicherung', 'Sonstiges'
];

const ZAHLUNGSARTEN = ['privat', 'kasse_bar', 'kasse_karte', 'rechnung'];

function belegLesen(id) {
  return db.prepare(`${BELEG_AUSWAHL} WHERE b.id = ?`).get(id);
}

function dateienLesen(belegId) {
  return db
    .prepare(
      `SELECT id, mime, original_name, groesse, vorschau_pfad IS NOT NULL AS hat_vorschau
         FROM beleg_dateien WHERE beleg_id = ? ORDER BY id`
    )
    .all(belegId);
}

function darfSehen(benutzer, beleg) {
  if (!beleg) return false;
  if (darfKasseVerwalten(benutzer, beleg.kasse_id)) return true;
  if (!kassenRolle(benutzer, beleg.kasse_id)) return false;
  return beleg.erfasst_von === benutzer.id || beleg.bezahlt_von === benutzer.id;
}

function darfBearbeiten(benutzer, beleg) {
  if (darfKasseVerwalten(benutzer, beleg.kasse_id)) return true;
  return beleg.erfasst_von === benutzer.id && beleg.status === 'offen';
}

function istDatum(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));
}

// ------------------------------------------------------------------- Liste

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json({ ...belegeLaden(req.benutzer, req.query, { limit, offset }), kategorien: KATEGORIEN });
});

router.get('/:id', (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!darfSehen(req.benutzer, beleg)) {
    return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  }
  res.json({ ...beleg, dateien: dateienLesen(beleg.id) });
});

/** Kleines Vorschaubild des ersten Fotos - fuer die Listenansicht. */
router.get('/:id/vorschau', (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!darfSehen(req.benutzer, beleg)) return res.status(404).end();
  const datei = db
    .prepare(
      `SELECT * FROM beleg_dateien WHERE beleg_id = ? AND mime <> 'application/pdf'
        ORDER BY id LIMIT 1`
    )
    .get(beleg.id);
  if (!datei) return res.status(404).end();
  const pfad = vollerPfad(datei.vorschau_pfad || datei.pfad);
  if (!pfad || !fs.existsSync(pfad)) return res.status(404).end();
  res.setHeader('Content-Type', datei.vorschau_pfad ? 'image/jpeg' : datei.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(pfad).pipe(res);
});

// ---------------------------------------------------------------- Anlegen

const naechsteNummer = db.transaction((kasseId, jahr) => {
  const kasse = db.prepare('SELECT kuerzel FROM kassen WHERE id = ?').get(kasseId);
  const max = db
    .prepare('SELECT COALESCE(MAX(laufnummer), 0) AS n FROM belege WHERE kasse_id = ? AND jahr = ?')
    .get(kasseId, jahr).n;
  const laufnummer = max + 1;
  return {
    laufnummer,
    nummer: `${kasse.kuerzel}-${jahr}-${String(laufnummer).padStart(4, '0')}`
  };
});

router.post('/', belegUpload.array('dateien', 8), async (req, res) => {
  const kasseId = Number(req.body?.kasse_id);
  if (!darfBelegEinreichen(req.benutzer, kasseId)) {
    return res.status(403).json({ fehler: 'Du bist dieser Kasse nicht zugeteilt.' });
  }
  const kasse = db.prepare('SELECT * FROM kassen WHERE id = ? AND aktiv = 1').get(kasseId);
  if (!kasse) return res.status(404).json({ fehler: 'Kasse nicht gefunden oder geschlossen.' });

  const datum = String(req.body?.datum || '').slice(0, 10);
  if (!istDatum(datum)) return res.status(400).json({ fehler: 'Bitte ein gueltiges Datum angeben.' });

  const betrag = zuRappen(req.body?.betrag);
  if (betrag === null || betrag <= 0) {
    return res.status(400).json({ fehler: 'Bitte einen Betrag groesser als 0 angeben (z.B. 12.50).' });
  }
  const beschreibung = String(req.body?.beschreibung || '').trim();
  if (beschreibung.length < 2) {
    return res.status(400).json({ fehler: 'Bitte kurz beschreiben, wofuer der Beleg ist.' });
  }
  const zahlungsart = ZAHLUNGSARTEN.includes(req.body?.zahlungsart) ? req.body.zahlungsart : 'privat';

  // Wer ausgelegt hat: normale Melder immer sie selbst, Kassiere duerfen es setzen.
  let bezahltVon = req.benutzer.id;
  if (req.body?.bezahlt_von && darfKasseVerwalten(req.benutzer, kasseId)) {
    bezahltVon = Number(req.body.bezahlt_von);
  }
  if (zahlungsart !== 'privat' && req.body?.bezahlt_von === '') bezahltVon = null;

  const jahr = Number(datum.slice(0, 4));
  const { laufnummer, nummer } = naechsteNummer(kasseId, jahr);

  const info = db
    .prepare(
      `INSERT INTO belege
         (kasse_id, nummer, jahr, laufnummer, datum, betrag_rappen, beschreibung,
          haendler, kategorie, zahlungsart, bezahlt_von, notiz, erfasst_von, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offen')`
    )
    .run(
      kasseId, nummer, jahr, laufnummer, datum, betrag, beschreibung.slice(0, 500),
      String(req.body?.haendler || '').trim().slice(0, 160) || null,
      KATEGORIEN.includes(req.body?.kategorie) ? req.body.kategorie : 'Sonstiges',
      zahlungsart, bezahltVon,
      String(req.body?.notiz || '').trim().slice(0, 1000) || null,
      req.benutzer.id
    );

  const belegId = Number(info.lastInsertRowid);
  for (const datei of req.files || []) {
    const gespeichert = await belegDateiSpeichern(datei);
    db.prepare(
      `INSERT INTO beleg_dateien (beleg_id, pfad, vorschau_pfad, mime, original_name, groesse)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(belegId, gespeichert.pfad, gespeichert.vorschau_pfad, gespeichert.mime,
          gespeichert.original_name, gespeichert.groesse);
  }

  protokollieren(req.benutzer.id, 'beleg_eingereicht', 'beleg', belegId, { nummer, betrag });
  const beleg = belegLesen(belegId);
  res.status(201).json({ ...beleg, dateien: dateienLesen(belegId) });
});

// --------------------------------------------------------------- Aendern

router.patch('/:id', (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!darfSehen(req.benutzer, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBearbeiten(req.benutzer, beleg)) {
    return res.status(403).json({ fehler: 'Geprüfte Belege kann nur die Kassenfuehrung aendern.' });
  }

  const datum = req.body?.datum !== undefined ? String(req.body.datum).slice(0, 10) : beleg.datum;
  if (!istDatum(datum)) return res.status(400).json({ fehler: 'Bitte ein gueltiges Datum angeben.' });
  // Das Jahr steckt in der Belegnummer: Datum darf das Jahr nicht mehr wechseln.
  if (Number(datum.slice(0, 4)) !== beleg.jahr) {
    return res.status(400).json({
      fehler: `Die Belegnummer ${beleg.nummer} gehoert zum Jahr ${beleg.jahr}. Bitte den Beleg loeschen und neu erfassen.`
    });
  }

  const betrag = req.body?.betrag !== undefined ? zuRappen(req.body.betrag) : beleg.betrag_rappen;
  if (betrag === null || betrag <= 0) return res.status(400).json({ fehler: 'Ungueltiger Betrag.' });

  const darfVerwalten = darfKasseVerwalten(req.benutzer, beleg.kasse_id);

  db.prepare(
    `UPDATE belege SET datum = ?, betrag_rappen = ?, beschreibung = ?, haendler = ?,
            kategorie = ?, zahlungsart = ?, bezahlt_von = ?, notiz = ?
      WHERE id = ?`
  ).run(
    datum,
    betrag,
    String(req.body?.beschreibung ?? beleg.beschreibung).trim().slice(0, 500),
    req.body?.haendler !== undefined ? (String(req.body.haendler).trim().slice(0, 160) || null) : beleg.haendler,
    KATEGORIEN.includes(req.body?.kategorie) ? req.body.kategorie : beleg.kategorie,
    ZAHLUNGSARTEN.includes(req.body?.zahlungsart) ? req.body.zahlungsart : beleg.zahlungsart,
    darfVerwalten && req.body?.bezahlt_von !== undefined
      ? (req.body.bezahlt_von ? Number(req.body.bezahlt_von) : null)
      : beleg.bezahlt_von,
    req.body?.notiz !== undefined ? (String(req.body.notiz).trim().slice(0, 1000) || null) : beleg.notiz,
    beleg.id
  );
  protokollieren(req.benutzer.id, 'beleg_geaendert', 'beleg', beleg.id, { nummer: beleg.nummer });
  const neu = belegLesen(beleg.id);
  res.json({ ...neu, dateien: dateienLesen(neu.id) });
});

router.post('/:id/status', (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!beleg) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfKasseVerwalten(req.benutzer, beleg.kasse_id)) {
    return res.status(403).json({ fehler: 'Nur die Kassenfuehrung kann Belege pruefen.' });
  }
  const status = req.body?.status;
  if (!['offen', 'geprueft', 'abgelehnt'].includes(status)) {
    return res.status(400).json({ fehler: 'Unbekannter Status.' });
  }
  if (beleg.rueckerstattung_id && status !== 'geprueft') {
    return res.status(400).json({
      fehler: 'Dieser Beleg ist schon zurueckerstattet. Zuerst die Rueckerstattung loeschen.'
    });
  }
  db.prepare(
    `UPDATE belege SET status = ?, geprueft_von = ?, geprueft_am = datetime('now'), ablehnungsgrund = ?
      WHERE id = ?`
  ).run(
    status,
    status === 'offen' ? null : req.benutzer.id,
    status === 'abgelehnt' ? (String(req.body?.grund || '').trim().slice(0, 500) || null) : null,
    beleg.id
  );
  protokollieren(req.benutzer.id, `beleg_${status}`, 'beleg', beleg.id, { nummer: beleg.nummer });
  res.json(belegLesen(beleg.id));
});

/** Mehrere Belege auf einmal pruefen. */
router.post('/sammel-status', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  const status = req.body?.status;
  if (!ids.length) return res.status(400).json({ fehler: 'Keine Belege ausgewaehlt.' });
  if (!['offen', 'geprueft', 'abgelehnt'].includes(status)) {
    return res.status(400).json({ fehler: 'Unbekannter Status.' });
  }
  let geaendert = 0;
  const lauf = db.transaction(() => {
    for (const id of ids) {
      const beleg = db.prepare('SELECT id, kasse_id, rueckerstattung_id FROM belege WHERE id = ?').get(id);
      if (!beleg || !darfKasseVerwalten(req.benutzer, beleg.kasse_id)) continue;
      if (beleg.rueckerstattung_id && status !== 'geprueft') continue;
      db.prepare(
        `UPDATE belege SET status = ?, geprueft_von = ?, geprueft_am = datetime('now') WHERE id = ?`
      ).run(status, status === 'offen' ? null : req.benutzer.id, id);
      geaendert += 1;
    }
  });
  lauf();
  protokollieren(req.benutzer.id, 'belege_sammel_status', 'beleg', null, { status, anzahl: geaendert });
  res.json({ geaendert });
});

router.delete('/:id', (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!darfSehen(req.benutzer, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  const darfVerwalten = darfKasseVerwalten(req.benutzer, beleg.kasse_id);
  if (!darfVerwalten && !(beleg.erfasst_von === req.benutzer.id && beleg.status === 'offen')) {
    return res.status(403).json({ fehler: 'Dieser Beleg kann nicht mehr geloescht werden.' });
  }
  if (beleg.rueckerstattung_id) {
    return res.status(400).json({ fehler: 'Zurueckerstattete Belege koennen nicht geloescht werden.' });
  }
  for (const datei of db.prepare('SELECT pfad, vorschau_pfad FROM beleg_dateien WHERE beleg_id = ?').all(beleg.id)) {
    dateiLoeschen(datei.pfad);
    dateiLoeschen(datei.vorschau_pfad);
  }
  db.prepare('DELETE FROM belege WHERE id = ?').run(beleg.id);
  protokollieren(req.benutzer.id, 'beleg_geloescht', 'beleg', beleg.id, {
    nummer: beleg.nummer, betrag: beleg.betrag_rappen, beschreibung: beleg.beschreibung
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Dateien

router.post('/:id/dateien', belegUpload.array('dateien', 8), async (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!darfSehen(req.benutzer, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBearbeiten(req.benutzer, beleg)) {
    return res.status(403).json({ fehler: 'Keine Berechtigung.' });
  }
  for (const datei of req.files || []) {
    const gespeichert = await belegDateiSpeichern(datei);
    db.prepare(
      `INSERT INTO beleg_dateien (beleg_id, pfad, vorschau_pfad, mime, original_name, groesse)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(beleg.id, gespeichert.pfad, gespeichert.vorschau_pfad, gespeichert.mime,
          gespeichert.original_name, gespeichert.groesse);
  }
  res.json({ dateien: dateienLesen(beleg.id) });
});

router.get('/:id/dateien/:dateiId', (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!darfSehen(req.benutzer, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  const datei = db
    .prepare('SELECT * FROM beleg_dateien WHERE id = ? AND beleg_id = ?')
    .get(Number(req.params.dateiId), beleg.id);
  if (!datei) return res.status(404).json({ fehler: 'Datei nicht gefunden.' });

  const vorschau = req.query.vorschau === '1' && datei.vorschau_pfad;
  const pfad = vollerPfad(vorschau ? datei.vorschau_pfad : datei.pfad);
  if (!pfad || !fs.existsSync(pfad)) return res.status(404).json({ fehler: 'Datei fehlt auf dem Server.' });

  res.setHeader('Content-Type', vorschau ? 'image/jpeg' : datei.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${beleg.nummer}${vorschau ? '_klein' : ''}${datei.mime === 'application/pdf' ? '.pdf' : '.jpg'}"`
  );
  fs.createReadStream(pfad).pipe(res);
});

router.delete('/:id/dateien/:dateiId', (req, res) => {
  const beleg = belegLesen(Number(req.params.id));
  if (!darfSehen(req.benutzer, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBearbeiten(req.benutzer, beleg)) return res.status(403).json({ fehler: 'Keine Berechtigung.' });
  const datei = db
    .prepare('SELECT * FROM beleg_dateien WHERE id = ? AND beleg_id = ?')
    .get(Number(req.params.dateiId), beleg.id);
  if (!datei) return res.status(404).json({ fehler: 'Datei nicht gefunden.' });
  dateiLoeschen(datei.pfad);
  dateiLoeschen(datei.vorschau_pfad);
  db.prepare('DELETE FROM beleg_dateien WHERE id = ?').run(datei.id);
  res.json({ ok: true });
});

export default router;
