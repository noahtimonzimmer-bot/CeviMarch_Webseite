// Alles, was pro Kasse ausgerechnet wird: das Kassenbuch mit laufendem
// Saldo, die Belegliste und die offenen Auslagen ("wem schulde ich was").
// Wird von der API, vom Excel-Export und von der Druckansicht gemeinsam
// benutzt, damit ueberall dieselben Zahlen stehen.
import { db } from './db.js';

export const ZAHLUNGSARTEN = ['privat', 'kasse_bar', 'kasse_karte', 'rechnung'];

export const ZAHLUNGSART_TEXT = {
  privat: 'privat ausgelegt',
  kasse_bar: 'Kasse bar',
  kasse_karte: 'Kassenkarte',
  rechnung: 'Rechnung'
};

export const STATUS_TEXT = { offen: 'offen', geprueft: 'geprüft', abgelehnt: 'abgelehnt' };

export function kasseLesen(id) {
  return db.prepare('SELECT * FROM kassen WHERE id = ?').get(Number(id));
}

export function alleKassen() {
  return db.prepare('SELECT * FROM kassen ORDER BY aktiv DESC, reihenfolge, name').all();
}

/** Jahre, in denen diese Kasse Bewegungen hat (neuestes zuerst). */
export function jahreDerKasse(kasseId) {
  const zeilen = db
    .prepare(
      `SELECT jahr FROM (
         SELECT jahr FROM belege WHERE kasse_id = ?
         UNION
         SELECT CAST(substr(datum, 1, 4) AS INTEGER) AS jahr FROM einnahmen WHERE kasse_id = ?
       ) ORDER BY jahr DESC`
    )
    .all(kasseId, kasseId)
    .map((z) => z.jahr);
  const jetzt = new Date().getFullYear();
  if (!zeilen.includes(jetzt)) zeilen.unshift(jetzt);
  return zeilen;
}

function jahrFilter(jahr) {
  return Number.isInteger(Number(jahr)) && Number(jahr) > 1990 ? Number(jahr) : null;
}

/**
 * Das Kassenbuch: Startsaldo, danach Einnahmen und geprüfte Belege nach
 * Datum sortiert, mit laufendem Saldo nach jeder Zeile.
 */
export function kassenbuch(kasseId, jahr = null) {
  const kasse = kasseLesen(kasseId);
  if (!kasse) return null;
  const j = jahrFilter(jahr);

  const belege = db
    .prepare(
      `SELECT id, nummer, jahr, datum, betrag_rappen, beschreibung, haendler,
              zahlungsart, person, status, rueckerstattung_id, erstellt_am,
              (SELECT COUNT(*) FROM beleg_dateien d WHERE d.beleg_id = belege.id) AS anzahl_dateien
         FROM belege
        WHERE kasse_id = ? AND status = 'geprueft' ${j ? 'AND jahr = ?' : ''}
        ORDER BY datum, nummer`
    )
    .all(...(j ? [kasseId, j] : [kasseId]));

  const einnahmen = db
    .prepare(
      `SELECT id, datum, betrag_rappen, beschreibung FROM einnahmen
        WHERE kasse_id = ? ${j ? "AND substr(datum, 1, 4) = ?" : ''}
        ORDER BY datum, id`
    )
    .all(...(j ? [kasseId, String(j)] : [kasseId]));

  // Beim Jahresfilter ist der Startsaldo das, was Ende des Vorjahres uebrig war.
  let startsaldo = kasse.startsaldo_rappen;
  let startText = 'Startsaldo der Kasse';
  if (j) {
    const vorher = db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(betrag_rappen), 0) FROM einnahmen
             WHERE kasse_id = ? AND substr(datum, 1, 4) < ?) AS ein,
           (SELECT COALESCE(SUM(betrag_rappen), 0) FROM belege
             WHERE kasse_id = ? AND status = 'geprueft' AND jahr < ?) AS aus`
      )
      .get(kasseId, String(j), kasseId, j);
    startsaldo = kasse.startsaldo_rappen + vorher.ein - vorher.aus;
    // Nur wenn vorher wirklich etwas gebucht wurde, ist es ein Uebertrag.
    if (vorher.ein || vorher.aus) startText = `Übertrag aus ${j - 1}`;
  }

  const bewegungen = [
    ...einnahmen.map((e) => ({
      typ: 'einnahme',
      id: e.id,
      datum: e.datum,
      nummer: null,
      text: e.beschreibung,
      einnahme_rappen: e.betrag_rappen,
      ausgabe_rappen: 0
    })),
    ...belege.map((b) => ({
      typ: 'beleg',
      id: b.id,
      datum: b.datum,
      nummer: b.nummer,
      text: b.beschreibung,
      haendler: b.haendler,
      person: b.person,
      zahlungsart: b.zahlungsart,
      anzahl_dateien: b.anzahl_dateien,
      offen_an_person: b.zahlungsart === 'privat' && !b.rueckerstattung_id,
      einnahme_rappen: 0,
      ausgabe_rappen: b.betrag_rappen
    }))
  ].sort((a, b) => {
    if (a.datum !== b.datum) return a.datum < b.datum ? -1 : 1;
    if (a.typ !== b.typ) return a.typ === 'einnahme' ? -1 : 1;
    return (a.nummer || a.id) - (b.nummer || b.id);
  });

  let saldo = startsaldo;
  for (const zeile of bewegungen) {
    saldo += zeile.einnahme_rappen - zeile.ausgabe_rappen;
    zeile.saldo_rappen = saldo;
  }

  const summeEinnahmen = einnahmen.reduce((s, e) => s + e.betrag_rappen, 0);
  const summeAusgaben = belege.reduce((s, b) => s + b.betrag_rappen, 0);

  return {
    kasse,
    jahr: j,
    start: { text: startText, saldo_rappen: startsaldo },
    zeilen: bewegungen,
    einnahmen_rappen: summeEinnahmen,
    ausgaben_rappen: summeAusgaben,
    saldo_rappen: saldo,
    anzahl_belege: belege.length,
    anzahl_einnahmen: einnahmen.length
  };
}

/** Kurzzahlen fuer die Kassenuebersicht. */
export function kasseZahlen(kasse) {
  const belege = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'geprueft' THEN betrag_rappen END), 0) AS geprueft,
         COALESCE(SUM(CASE WHEN status = 'offen'    THEN betrag_rappen END), 0) AS offen,
         COUNT(CASE WHEN status = 'offen' THEN 1 END) AS anzahl_offen,
         COUNT(*) AS anzahl
       FROM belege WHERE kasse_id = ?`
    )
    .get(kasse.id);
  const einnahmen = db
    .prepare('SELECT COALESCE(SUM(betrag_rappen), 0) AS summe FROM einnahmen WHERE kasse_id = ?')
    .get(kasse.id).summe;
  // Was die Kasse den Leitern noch schuldet, die etwas ausgelegt haben.
  const anLeiter = db
    .prepare(
      `SELECT COALESCE(SUM(betrag_rappen), 0) AS summe FROM belege
        WHERE kasse_id = ? AND status = 'geprueft' AND zahlungsart = 'privat'
          AND rueckerstattung_id IS NULL`
    )
    .get(kasse.id).summe;

  // Was die Kasse den Kassenchefs schuldet, die Leiter aus der eigenen
  // Tasche ausbezahlt haben. Erledigt ist das erst, wenn die Rechnung an
  // den Verein bezahlt ist.
  const anChefs = db
    .prepare(
      `SELECT COALESCE(SUM(r.betrag_rappen), 0) AS summe
         FROM rueckerstattungen r
         LEFT JOIN rechnungen n ON n.id = r.rechnung_id
        WHERE r.kasse_id = ? AND r.quelle = 'eigene_tasche' AND r.uebernommen_von IS NOT NULL
          AND (r.rechnung_id IS NULL OR n.status = 'offen')`
    )
    .get(kasse.id).summe;

  return {
    ...kasse,
    einnahmen_rappen: einnahmen,
    ausgaben_rappen: belege.geprueft,
    offen_rappen: belege.offen,
    anzahl_offen: belege.anzahl_offen,
    anzahl_belege: belege.anzahl,
    schulden_an_leiter_rappen: anLeiter,
    schulden_an_chefs_rappen: anChefs,
    schulden_rappen: anLeiter + anChefs,
    saldo_rappen: kasse.startsaldo_rappen + einnahmen - belege.geprueft
  };
}

/** Belege einer Kasse, standardmaessig alle Status. */
export function belegeDerKasse(kasseId, { jahr = null, status = null, suche = null } = {}) {
  const bedingungen = ['b.kasse_id = ?'];
  const werte = [Number(kasseId)];
  const j = jahrFilter(jahr);
  if (j) { bedingungen.push('b.jahr = ?'); werte.push(j); }
  if (status && ['offen', 'geprueft', 'abgelehnt'].includes(status)) {
    bedingungen.push('b.status = ?');
    werte.push(status);
  }
  if (suche) {
    const muster = `%${String(suche).trim()}%`;
    bedingungen.push('(b.beschreibung LIKE ? OR b.haendler LIKE ? OR b.person LIKE ? OR b.notiz LIKE ?)');
    werte.push(muster, muster, muster, muster);
  }
  return db
    .prepare(
      `SELECT b.*, r.datum AS rueckerstattet_am,
              (SELECT COUNT(*) FROM beleg_dateien d WHERE d.beleg_id = b.id) AS anzahl_dateien
         FROM belege b
         LEFT JOIN rueckerstattungen r ON r.id = b.rueckerstattung_id
        WHERE ${bedingungen.join(' AND ')}
        ORDER BY b.jahr DESC, b.nummer DESC`
    )
    .all(...werte);
}

/** Wem schuldet diese Kasse noch Geld? Privat ausgelegt, geprüft, nicht zurueckerstattet. */
export function schuldenDerKasse(kasseId) {
  const id = Number(kasseId);

  // --- Leiter, die etwas ausgelegt und noch nichts zurueckbekommen haben
  const belege = db
    .prepare(
      `SELECT id, nummer, jahr, datum, betrag_rappen, beschreibung, person
         FROM belege
        WHERE kasse_id = ? AND status = 'geprueft' AND zahlungsart = 'privat'
          AND rueckerstattung_id IS NULL
        ORDER BY datum`
    )
    .all(id);

  const nachPerson = new Map();
  for (const beleg of belege) {
    const name = (beleg.person || 'ohne Namen').trim();
    if (!nachPerson.has(name)) nachPerson.set(name, { person: name, summe: 0, anzahl: 0, belege: [] });
    const eintrag = nachPerson.get(name);
    eintrag.summe += beleg.betrag_rappen;
    eintrag.anzahl += 1;
    eintrag.belege.push(beleg);
  }
  const personen = [...nachPerson.values()].sort((a, b) => b.summe - a.summe);

  // --- Kassenchefs, die aus der eigenen Tasche ausbezahlt haben
  const auslagen = db
    .prepare(
      `SELECT r.id, r.person, r.datum, r.betrag_rappen, r.methode, r.rechnung_id,
              b.id AS chef_id, b.name AS chef_name, b.iban AS chef_iban,
              n.nummer AS rechnung_nummer, n.jahr AS rechnung_jahr, n.status AS rechnung_status
         FROM rueckerstattungen r
         JOIN benutzer b ON b.id = r.uebernommen_von
         LEFT JOIN rechnungen n ON n.id = r.rechnung_id
        WHERE r.kasse_id = ? AND r.quelle = 'eigene_tasche'
          AND (r.rechnung_id IS NULL OR n.status = 'offen')
        ORDER BY r.datum`
    )
    .all(id);

  const nachChef = new Map();
  for (const eintrag of auslagen) {
    if (!nachChef.has(eintrag.chef_id)) {
      nachChef.set(eintrag.chef_id, {
        benutzer_id: eintrag.chef_id,
        name: eintrag.chef_name,
        iban: eintrag.chef_iban,
        summe: 0,
        anzahl: 0,
        ohne_rechnung_rappen: 0,
        auslagen: []
      });
    }
    const chef = nachChef.get(eintrag.chef_id);
    chef.summe += eintrag.betrag_rappen;
    chef.anzahl += 1;
    if (!eintrag.rechnung_id) chef.ohne_rechnung_rappen += eintrag.betrag_rappen;
    chef.auslagen.push(eintrag);
  }
  const chefs = [...nachChef.values()].sort((a, b) => b.summe - a.summe);

  const anLeiter = personen.reduce((s, p) => s + p.summe, 0);
  const anChefs = chefs.reduce((s, c) => s + c.summe, 0);
  return {
    personen,
    chefs,
    an_leiter_rappen: anLeiter,
    an_chefs_rappen: anChefs,
    gesamt_rappen: anLeiter + anChefs
  };
}

/** Namen, die in dieser Kasse schon vorkamen - fuer die Vorschlagsliste. */
export function personenDerKasse(kasseId) {
  return db
    .prepare(
      `SELECT person FROM belege WHERE kasse_id = ? AND person IS NOT NULL AND person <> ''
        GROUP BY person COLLATE NOCASE ORDER BY MAX(erstellt_am) DESC LIMIT 40`
    )
    .all(Number(kasseId))
    .map((z) => z.person);
}
