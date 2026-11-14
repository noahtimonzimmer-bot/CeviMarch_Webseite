// Kassen: Uebersicht, Kassenbuch, Einnahmen, Auszahlungen und Rechnungen.
// Alles, was eine Kasse betrifft, haengt hier unter /api/kassen/:id.
import express from 'express';
import { db, protokollieren } from '../db.js';
import {
  angemeldet, nurAdmin, nurKassier, mitKonto, darfKasse, darfBuchen,
  darfAuszahlen, verwalteteKassen
} from '../auth.js';
import { zuRappen } from '../geld.js';
import {
  alleKassen, kasseLesen, kasseZahlen, kassenbuch, belegeDerKasse,
  schuldenDerKasse, personenDerKasse, jahreDerKasse
} from '../kassenbuch.js';

const router = express.Router();
router.use(angemeldet);

/** Holt die Kasse und prueft, ob die angemeldete Person sie ansehen darf. */
function meineKasse(req, res) {
  const kasse = kasseLesen(req.params.id);
  if (!kasse) {
    res.status(404).json({ fehler: 'Kasse nicht gefunden.' });
    return null;
  }
  if (!darfKasse(req, kasse.id)) {
    res.status(403).json({ fehler: 'Diese Kasse ist dir nicht freigegeben.' });
    return null;
  }
  return kasse;
}

/** Dasselbe, aber nur fuer die, die in dieser Kasse auch buchen duerfen. */
function meineBuchungskasse(req, res) {
  const kasse = meineKasse(req, res);
  if (!kasse) return null;
  if (!darfBuchen(req, kasse.id)) {
    res.status(403).json({ fehler: 'Das Kassenbuch fuehrt der Kassenchef.' });
    return null;
  }
  return kasse;
}

// ------------------------------------------------------------- Uebersicht

router.get('/', (req, res) => {
  const kassen = alleKassen();
  // Wer nur Belege einreicht, braucht die Kassenstaende nicht zu sehen -
  // aber die Liste, um die richtige Kasse zu waehlen.
  if (req.rolle === 'melder') {
    return res.json(
      kassen
        .filter((k) => k.aktiv)
        .map((k) => ({ id: k.id, name: k.name, beschreibung: k.beschreibung, farbe: k.farbe }))
    );
  }
  const erlaubt = new Set(verwalteteKassen(req));
  res.json(kassen.filter((k) => erlaubt.has(k.id)).map(kasseZahlen));
});

router.post('/', nurAdmin, (req, res) => {
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

router.patch('/:id', nurAdmin, (req, res) => {
  const kasse = kasseLesen(req.params.id);
  if (!kasse) return res.status(404).json({ fehler: 'Kasse nicht gefunden.' });
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

router.delete('/:id', nurAdmin, (req, res) => {
  const kasse = kasseLesen(req.params.id);
  if (!kasse) return res.status(404).json({ fehler: 'Kasse nicht gefunden.' });
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

router.get('/:id', mitKonto, (req, res) => {
  const kasse = meineKasse(req, res);
  if (!kasse) return;
  const jahre = jahreDerKasse(kasse.id);
  const jahr = req.query.jahr === 'alle' ? null : Number(req.query.jahr) || jahre[0];

  res.json({
    kasse: kasseZahlen(kasse),
    jahre,
    jahr,
    buch: kassenbuch(kasse.id, jahr),
    offene: belegeDerKasse(kasse.id, { status: 'offen' }),
    belege: belegeDerKasse(kasse.id, { jahr }),
    schulden: schuldenDerKasse(kasse.id),
    personen: personenDerKasse(kasse.id),
    chefs: db
      .prepare(
        `SELECT b.id, b.name, b.email FROM kassen_chefs c JOIN benutzer b ON b.id = c.benutzer_id
          WHERE c.kasse_id = ? AND b.aktiv = 1 ORDER BY b.name`
      )
      .all(kasse.id),
    rechnungen: db
      .prepare(
        `SELECT n.*, b.name AS benutzer_name
           FROM rechnungen n JOIN benutzer b ON b.id = n.benutzer_id
          WHERE n.kasse_id = ? ORDER BY n.jahr DESC, n.nummer DESC LIMIT 50`
      )
      .all(kasse.id),
    rueckerstattungen: db
      .prepare(
        `SELECT r.*, b.name AS chef_name,
                (SELECT COUNT(*) FROM belege WHERE rueckerstattung_id = r.id) AS anzahl_belege
           FROM rueckerstattungen r
           LEFT JOIN benutzer b ON b.id = r.uebernommen_von
          WHERE r.kasse_id = ? ORDER BY r.datum DESC, r.id DESC LIMIT 100`
      )
      .all(kasse.id)
  });
});

/** Namensvorschlaege, damit das Feld "ausgelegt von" sich selbst ausfuellt. */
router.get('/:id/personen', (req, res) => {
  res.json(personenDerKasse(Number(req.params.id)));
});

// ---------------------------------------------------------------- Einnahmen

router.post('/:id/einnahmen', mitKonto, (req, res) => {
  const kasse = meineBuchungskasse(req, res);
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

router.delete('/:id/einnahmen/:einnahmeId', mitKonto, (req, res) => {
  const kasse = meineBuchungskasse(req, res);
  if (!kasse) return;
  const eintrag = db
    .prepare('SELECT * FROM einnahmen WHERE id = ? AND kasse_id = ?')
    .get(Number(req.params.einnahmeId), kasse.id);
  if (!eintrag) return res.status(404).json({ fehler: 'Eintrag nicht gefunden.' });
  db.prepare('DELETE FROM einnahmen WHERE id = ?').run(eintrag.id);
  protokollieren(req.rolle, 'einnahme_geloescht', 'einnahme', eintrag.id, {
    betrag: eintrag.betrag_rappen, beschreibung: eintrag.beschreibung
  });
  res.json({ ok: true });
});

// ------------------------------------------------------ Leiter auszahlen

router.post('/:id/rueckerstattungen', mitKonto, (req, res) => {
  const kasse = meineKasse(req, res);
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

  // Woher kam das Geld? Der Normalfall ist das Vereinskonto, auf das nur
  // der Vereinskassier Zugriff hat - dann entsteht keine Schuld. Streckt
  // ein Kassenchef ausnahmsweise selbst vor, wandert die Schuld der Kasse
  // vom Leiter auf ihn, und er kann daraus eine Rechnung stellen.
  const vorgabe = req.rolle === 'chef' ? 'eigene_tasche' : 'kasse';
  const quelle = ['kasse', 'eigene_tasche'].includes(req.body?.quelle)
    ? req.body.quelle : vorgabe;
  if (!darfAuszahlen(req, kasse.id, quelle)) {
    return res.status(403).json({
      fehler: quelle === 'eigene_tasche'
        ? 'Nur ein Kassenchef kann festhalten, dass er selbst vorgestreckt hat.'
        : 'Vom Vereinskonto zahlt der Vereinskassier aus.'
    });
  }
  const uebernommenVon = quelle === 'eigene_tasche' ? req.benutzer.id : null;

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
        `INSERT INTO rueckerstattungen
           (kasse_id, person, datum, betrag_rappen, methode, quelle, uebernommen_von, notiz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(kasse.id, person.slice(0, 120), datum, summe, methode, quelle, uebernommenVon,
           String(req.body?.notiz || '').trim().slice(0, 300) || null);
    neueId = Number(info.lastInsertRowid);
    const setzen = db.prepare('UPDATE belege SET rueckerstattung_id = ? WHERE id = ?');
    for (const beleg of belege) setzen.run(neueId, beleg.id);
  })();

  protokollieren(req.rolle, 'rueckerstattung', 'rueckerstattung', neueId, {
    person, summe, quelle, anzahl: belege.length
  });
  res.status(201).json(db.prepare('SELECT * FROM rueckerstattungen WHERE id = ?').get(neueId));
});

router.delete('/:id/rueckerstattungen/:rueckId', mitKonto, (req, res) => {
  const kasse = meineKasse(req, res);
  if (!kasse) return;
  const eintrag = db
    .prepare('SELECT * FROM rueckerstattungen WHERE id = ? AND kasse_id = ?')
    .get(Number(req.params.rueckId), kasse.id);
  if (!eintrag) return res.status(404).json({ fehler: 'Nicht gefunden.' });
  if (!darfAuszahlen(req, kasse.id, eintrag.quelle)) {
    return res.status(403).json({ fehler: 'Diese Auszahlung gehoert dir nicht.' });
  }
  if (eintrag.rechnung_id) {
    return res.status(400).json({
      fehler: 'Diese Auszahlung steht auf einer Rechnung. Zuerst die Rechnung loeschen.'
    });
  }
  db.transaction(() => {
    db.prepare('UPDATE belege SET rueckerstattung_id = NULL WHERE rueckerstattung_id = ?').run(eintrag.id);
    db.prepare('DELETE FROM rueckerstattungen WHERE id = ?').run(eintrag.id);
  })();
  protokollieren(req.rolle, 'rueckerstattung_geloescht', 'rueckerstattung', eintrag.id, null);
  res.json({ ok: true });
});

// -------------------------------------------------- Rechnung an den Verein

const naechsteRechnungsnummer = db.transaction((jahr) => {
  const max = db
    .prepare('SELECT COALESCE(MAX(nummer), 0) AS n FROM rechnungen WHERE jahr = ?')
    .get(jahr).n;
  return max + 1;
});

/**
 * Stellt eine Rechnung ueber alles, was diese Person in dieser Kasse aus
 * eigener Tasche vorgestreckt und noch nicht verrechnet hat.
 */
router.post('/:id/rechnungen', mitKonto, (req, res) => {
  const kasse = meineKasse(req, res);
  if (!kasse) return;

  // Admins duerfen die Rechnung auch fuer einen Chef ausstellen.
  const fuerId = req.rolle === 'admin' && req.body?.benutzer_id
    ? Number(req.body.benutzer_id) : req.benutzer.id;
  const konto = db.prepare('SELECT id, name, iban FROM benutzer WHERE id = ?').get(fuerId);
  if (!konto) return res.status(404).json({ fehler: 'Konto nicht gefunden.' });
  if (!konto.iban) {
    return res.status(400).json({
      fehler: 'Fuer die Rechnung braucht es eine IBAN. Trage sie unter "Mein Konto" ein.'
    });
  }

  const offene = db
    .prepare(
      `SELECT id, betrag_rappen FROM rueckerstattungen
        WHERE kasse_id = ? AND uebernommen_von = ? AND quelle = 'eigene_tasche'
          AND rechnung_id IS NULL`
    )
    .all(kasse.id, konto.id);
  if (!offene.length) {
    return res.status(400).json({ fehler: 'Es gibt nichts zu verrechnen.' });
  }

  const datum = String(req.body?.datum || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ fehler: 'Ungueltiges Datum.' });
  const jahr = Number(datum.slice(0, 4));
  const summe = offene.reduce((s, r) => s + r.betrag_rappen, 0);

  let neueId;
  db.transaction(() => {
    const nummer = naechsteRechnungsnummer(jahr);
    const info = db
      .prepare(
        `INSERT INTO rechnungen (kasse_id, benutzer_id, jahr, nummer, datum, betrag_rappen, iban, notiz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(kasse.id, konto.id, jahr, nummer, datum, summe, konto.iban,
           String(req.body?.notiz || '').trim().slice(0, 300) || null);
    neueId = Number(info.lastInsertRowid);
    const setzen = db.prepare('UPDATE rueckerstattungen SET rechnung_id = ? WHERE id = ?');
    for (const eintrag of offene) setzen.run(neueId, eintrag.id);
  })();

  protokollieren(req.rolle, 'rechnung_gestellt', 'rechnung', neueId, { summe, kasse: kasse.name });
  res.status(201).json(db.prepare('SELECT * FROM rechnungen WHERE id = ?').get(neueId));
});

/** Der Vereinskassier hakt die Rechnung ab, sobald er sie bezahlt hat. */
router.post('/:id/rechnungen/:rechnungId/bezahlt', nurKassier, (req, res) => {
  const rechnung = db
    .prepare('SELECT * FROM rechnungen WHERE id = ? AND kasse_id = ?')
    .get(Number(req.params.rechnungId), Number(req.params.id));
  if (!rechnung) return res.status(404).json({ fehler: 'Rechnung nicht gefunden.' });
  const bezahlt = req.body?.bezahlt === false ? 'offen' : 'bezahlt';
  db.prepare(
    `UPDATE rechnungen SET status = ?, bezahlt_am = ? WHERE id = ?`
  ).run(bezahlt, bezahlt === 'bezahlt' ? (String(req.body?.datum || '').slice(0, 10) || new Date().toISOString().slice(0, 10)) : null, rechnung.id);
  protokollieren(req.rolle, `rechnung_${bezahlt}`, 'rechnung', rechnung.id, null);
  res.json(db.prepare('SELECT * FROM rechnungen WHERE id = ?').get(rechnung.id));
});

router.delete('/:id/rechnungen/:rechnungId', mitKonto, (req, res) => {
  const kasse = meineKasse(req, res);
  if (!kasse) return;
  const rechnung = db
    .prepare('SELECT * FROM rechnungen WHERE id = ? AND kasse_id = ?')
    .get(Number(req.params.rechnungId), kasse.id);
  if (!rechnung) return res.status(404).json({ fehler: 'Rechnung nicht gefunden.' });
  if (rechnung.status === 'bezahlt' && req.rolle !== 'admin' && req.rolle !== 'kassier') {
    return res.status(400).json({
      fehler: 'Bezahlte Rechnungen loescht nur die Abteilungsleitung oder der Vereinskassier.'
    });
  }
  db.transaction(() => {
    db.prepare('UPDATE rueckerstattungen SET rechnung_id = NULL WHERE rechnung_id = ?').run(rechnung.id);
    db.prepare('DELETE FROM rechnungen WHERE id = ?').run(rechnung.id);
  })();
  protokollieren(req.rolle, 'rechnung_geloescht', 'rechnung', rechnung.id, null);
  res.json({ ok: true });
});

export default router;
