// Belege: einreichen, ansehen, pruefen, Fotos ausliefern.
//
// Die Abteilungsleitung sieht alle Belege. Wer mit dem Mitarbeitspasswort
// angemeldet ist, sieht nur die Belege, die von diesem Geraet eingereicht
// wurden - erkennbar an einer zufaelligen Kennung, die der Browser mitschickt.
import express from 'express';
import fs from 'node:fs';
import { db, protokollieren } from '../db.js';
import { angemeldet, darfKasse, darfBuchen } from '../auth.js';
import { zuRappen } from '../geld.js';
import { ZAHLUNGSARTEN, kasseLesen } from '../kassenbuch.js';
import { belegUpload, belegDateiSpeichern, vollerPfad, dateiLoeschen } from '../dateien.js';

const router = express.Router();
router.use(angemeldet);

function belegLesen(id) {
  return db
    .prepare(
      `SELECT b.*, k.name AS kasse_name, k.farbe AS kasse_farbe,
              r.datum AS rueckerstattet_am,
              (SELECT COUNT(*) FROM beleg_dateien d WHERE d.beleg_id = b.id) AS anzahl_dateien
         FROM belege b
         JOIN kassen k ON k.id = b.kasse_id
         LEFT JOIN rueckerstattungen r ON r.id = b.rueckerstattung_id
        WHERE b.id = ?`
    )
    .get(Number(id));
}

function dateienLesen(belegId) {
  return db
    .prepare(
      `SELECT id, mime, original_name, groesse, vorschau_pfad IS NOT NULL AS hat_vorschau
         FROM beleg_dateien WHERE beleg_id = ? ORDER BY id`
    )
    .all(belegId);
}

function geraetKennung(req) {
  const wert = String(req.get('X-Geraet') || req.query.geraet || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(wert) ? wert : null;
}

function darfSehen(req, beleg) {
  if (!beleg) return false;
  // Leitung, Vereinskassier und der zustaendige Kassenchef sehen alles,
  // was zu ihrer Kasse gehoert.
  if (darfKasse(req, beleg.kasse_id)) return true;
  // Wer nur einreicht, sieht die Belege des eigenen Geraets.
  const geraet = geraetKennung(req);
  return Boolean(geraet && beleg.geraet === geraet);
}

/** Eigene Belege darf man aendern und loeschen, solange sie offen sind. */
function darfBearbeiten(req, beleg) {
  if (darfBuchen(req, beleg.kasse_id)) return true;
  return darfSehen(req, beleg) && beleg.status === 'offen';
}

function istDatum(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));
}

// ----------------------------------------------- Eigene Belege dieses Geraets

router.get('/meine', (req, res) => {
  const geraet = geraetKennung(req);
  if (!geraet) return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT b.id, b.nummer, b.jahr, b.datum, b.betrag_rappen, b.beschreibung,
                b.status, b.person, b.zahlungsart, b.erstellt_am,
                k.name AS kasse_name, k.farbe AS kasse_farbe,
                (SELECT COUNT(*) FROM beleg_dateien d WHERE d.beleg_id = b.id) AS anzahl_dateien
           FROM belege b JOIN kassen k ON k.id = b.kasse_id
          WHERE b.geraet = ? ORDER BY b.erstellt_am DESC LIMIT 50`
      )
      .all(geraet)
  );
});

router.get('/:id', (req, res) => {
  const beleg = belegLesen(req.params.id);
  if (!darfSehen(req, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  res.json({ ...beleg, dateien: dateienLesen(beleg.id) });
});

/** Kleines Vorschaubild des ersten Fotos - fuer die Listenansicht. */
router.get('/:id/vorschau', (req, res) => {
  const beleg = belegLesen(req.params.id);
  if (!darfSehen(req, beleg)) return res.status(404).end();
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

// Die Nummer zaehlt pro Kasse und Jahr von 1 an hoch, genau wie im
// Kassenbuch auf Papier. Sie wird in einer Transaktion vergeben, damit zwei
// gleichzeitige Belege nie dieselbe Nummer bekommen.
const naechsteNummer = db.transaction((kasseId, jahr) => {
  const max = db
    .prepare('SELECT COALESCE(MAX(nummer), 0) AS n FROM belege WHERE kasse_id = ? AND jahr = ?')
    .get(kasseId, jahr).n;
  return max + 1;
});

router.post('/', belegUpload.array('dateien', 8), async (req, res) => {
  const kasse = kasseLesen(Number(req.body?.kasse_id));
  if (!kasse || !kasse.aktiv) {
    return res.status(404).json({ fehler: 'Kasse nicht gefunden oder geschlossen.' });
  }

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
  const person = String(req.body?.person || '').trim().slice(0, 120);
  if (zahlungsart === 'privat' && !person) {
    return res.status(400).json({ fehler: 'Bitte angeben, wer das Geld ausgelegt hat.' });
  }

  const jahr = Number(datum.slice(0, 4));
  const nummer = naechsteNummer(kasse.id, jahr);

  const info = db
    .prepare(
      `INSERT INTO belege
         (kasse_id, jahr, nummer, datum, betrag_rappen, beschreibung, haendler,
          zahlungsart, person, notiz, geraet, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offen')`
    )
    .run(
      kasse.id, jahr, nummer, datum, betrag, beschreibung.slice(0, 500),
      String(req.body?.haendler || '').trim().slice(0, 160) || null,
      zahlungsart, person || null,
      String(req.body?.notiz || '').trim().slice(0, 1000) || null,
      geraetKennung(req)
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

  protokollieren(req.rolle, 'beleg_eingereicht', 'beleg', belegId, { kasse: kasse.name, nummer, betrag });
  const beleg = belegLesen(belegId);
  res.status(201).json({ ...beleg, dateien: dateienLesen(belegId) });
});

// --------------------------------------------------------------- Aendern

router.patch('/:id', (req, res) => {
  const beleg = belegLesen(req.params.id);
  if (!darfSehen(req, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBearbeiten(req, beleg)) {
    return res.status(403).json({ fehler: 'Geprüfte Belege kann nur die Abteilungsleitung aendern.' });
  }

  const datum = req.body?.datum !== undefined ? String(req.body.datum).slice(0, 10) : beleg.datum;
  if (!istDatum(datum)) return res.status(400).json({ fehler: 'Bitte ein gueltiges Datum angeben.' });
  // Die Nummer zaehlt pro Jahr: ein Jahreswechsel wuerde die Reihe zerreissen.
  if (Number(datum.slice(0, 4)) !== beleg.jahr) {
    return res.status(400).json({
      fehler: `Beleg Nr. ${beleg.nummer} gehoert ins Jahr ${beleg.jahr}. Bitte loeschen und neu erfassen.`
    });
  }

  const betrag = req.body?.betrag !== undefined ? zuRappen(req.body.betrag) : beleg.betrag_rappen;
  if (betrag === null || betrag <= 0) return res.status(400).json({ fehler: 'Ungueltiger Betrag.' });

  db.prepare(
    `UPDATE belege SET datum = ?, betrag_rappen = ?, beschreibung = ?, haendler = ?,
            zahlungsart = ?, person = ?, notiz = ?
      WHERE id = ?`
  ).run(
    datum,
    betrag,
    String(req.body?.beschreibung ?? beleg.beschreibung).trim().slice(0, 500),
    req.body?.haendler !== undefined ? (String(req.body.haendler).trim().slice(0, 160) || null) : beleg.haendler,
    ZAHLUNGSARTEN.includes(req.body?.zahlungsart) ? req.body.zahlungsart : beleg.zahlungsart,
    req.body?.person !== undefined ? (String(req.body.person).trim().slice(0, 120) || null) : beleg.person,
    req.body?.notiz !== undefined ? (String(req.body.notiz).trim().slice(0, 1000) || null) : beleg.notiz,
    beleg.id
  );
  protokollieren(req.rolle, 'beleg_geaendert', 'beleg', beleg.id, { nummer: beleg.nummer });
  const neu = belegLesen(beleg.id);
  res.json({ ...neu, dateien: dateienLesen(neu.id) });
});

router.post('/:id/status', (req, res) => {
  const beleg = belegLesen(req.params.id);
  if (!beleg) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBuchen(req, beleg.kasse_id)) {
    return res.status(403).json({ fehler: 'Belege prueft der Kassenchef.' });
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
    `UPDATE belege SET status = ?, geprueft_am = datetime('now'), ablehnungsgrund = ? WHERE id = ?`
  ).run(
    status,
    status === 'abgelehnt' ? (String(req.body?.grund || '').trim().slice(0, 500) || null) : null,
    beleg.id
  );
  protokollieren(req.rolle, `beleg_${status}`, 'beleg', beleg.id, { nummer: beleg.nummer });
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
  db.transaction(() => {
    const setzen = db.prepare(
      `UPDATE belege SET status = ?, geprueft_am = datetime('now') WHERE id = ?`
    );
    for (const id of ids) {
      const beleg = db.prepare('SELECT id, kasse_id, rueckerstattung_id FROM belege WHERE id = ?').get(id);
      if (!beleg) continue;
      if (!darfBuchen(req, beleg.kasse_id)) continue;
      if (beleg.rueckerstattung_id && status !== 'geprueft') continue;
      setzen.run(status, id);
      geaendert += 1;
    }
  })();
  protokollieren(req.rolle, 'belege_sammel_status', 'beleg', null, { status, anzahl: geaendert });
  res.json({ geaendert });
});

router.delete('/:id', (req, res) => {
  const beleg = belegLesen(req.params.id);
  if (!darfSehen(req, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBearbeiten(req, beleg)) {
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
  protokollieren(req.rolle, 'beleg_geloescht', 'beleg', beleg.id, {
    nummer: beleg.nummer, betrag: beleg.betrag_rappen, beschreibung: beleg.beschreibung
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Dateien

router.post('/:id/dateien', belegUpload.array('dateien', 8), async (req, res) => {
  const beleg = belegLesen(req.params.id);
  if (!darfSehen(req, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBearbeiten(req, beleg)) return res.status(403).json({ fehler: 'Keine Berechtigung.' });
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
  const beleg = belegLesen(req.params.id);
  if (!darfSehen(req, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
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
    `inline; filename="Beleg-${beleg.jahr}-${beleg.nummer}${datei.mime === 'application/pdf' ? '.pdf' : '.jpg'}"`
  );
  fs.createReadStream(pfad).pipe(res);
});

router.delete('/:id/dateien/:dateiId', (req, res) => {
  const beleg = belegLesen(req.params.id);
  if (!darfSehen(req, beleg)) return res.status(404).json({ fehler: 'Beleg nicht gefunden.' });
  if (!darfBearbeiten(req, beleg)) return res.status(403).json({ fehler: 'Keine Berechtigung.' });
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
