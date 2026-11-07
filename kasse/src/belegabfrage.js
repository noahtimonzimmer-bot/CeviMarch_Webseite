// Baut die SQL-Abfrage fuer Beleglisten - inklusive Sichtbarkeitsregeln.
// Wird von der Belegliste, der Abrechnung und den Exporten gemeinsam benutzt.
import { db } from './db.js';

/** Kassen-IDs getrennt nach Rolle des Benutzers. */
export function sichtbarkeit(benutzer) {
  if (benutzer.rolle === 'admin') {
    return {
      kassier: db.prepare('SELECT id FROM kassen').all().map((k) => k.id),
      melder: []
    };
  }
  const zeilen = db
    .prepare('SELECT kasse_id, rolle FROM kassen_mitglieder WHERE benutzer_id = ?')
    .all(benutzer.id);
  return {
    kassier: zeilen.filter((z) => z.rolle === 'kassier').map((z) => z.kasse_id),
    melder: zeilen.filter((z) => z.rolle === 'melder').map((z) => z.kasse_id)
  };
}

function platzhalter(liste) {
  return liste.map(() => '?').join(', ');
}

/**
 * @returns {{ where: string, werte: any[] }}
 */
export function belegFilter(benutzer, abfrage = {}) {
  const bedingungen = [];
  const werte = [];

  // --- Sichtbarkeit
  const { kassier, melder } = sichtbarkeit(benutzer);
  const teile = [];
  if (kassier.length) {
    teile.push(`b.kasse_id IN (${platzhalter(kassier)})`);
    werte.push(...kassier);
  }
  if (melder.length) {
    teile.push(
      `(b.kasse_id IN (${platzhalter(melder)}) AND (b.erfasst_von = ? OR b.bezahlt_von = ?))`
    );
    werte.push(...melder, benutzer.id, benutzer.id);
  }
  bedingungen.push(teile.length ? `(${teile.join(' OR ')})` : '0 = 1');

  // --- Filter aus der Oberflaeche
  const kasseIds = String(abfrage.kasse || '')
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);
  if (kasseIds.length) {
    bedingungen.push(`b.kasse_id IN (${platzhalter(kasseIds)})`);
    werte.push(...kasseIds);
  }

  if (abfrage.von) {
    bedingungen.push('b.datum >= ?');
    werte.push(String(abfrage.von).slice(0, 10));
  }
  if (abfrage.bis) {
    bedingungen.push('b.datum <= ?');
    werte.push(String(abfrage.bis).slice(0, 10));
  }
  if (abfrage.jahr) {
    bedingungen.push('b.jahr = ?');
    werte.push(Number(abfrage.jahr));
  }
  if (abfrage.status && ['offen', 'geprueft', 'abgelehnt'].includes(abfrage.status)) {
    bedingungen.push('b.status = ?');
    werte.push(abfrage.status);
  }
  if (abfrage.zahlungsart) {
    bedingungen.push('b.zahlungsart = ?');
    werte.push(String(abfrage.zahlungsart));
  }
  if (abfrage.kategorie) {
    bedingungen.push('b.kategorie = ?');
    werte.push(String(abfrage.kategorie));
  }
  if (abfrage.person) {
    bedingungen.push('b.bezahlt_von = ?');
    werte.push(Number(abfrage.person));
  }
  if (abfrage.nur_eigene === '1' || abfrage.nur_eigene === true) {
    bedingungen.push('(b.erfasst_von = ? OR b.bezahlt_von = ?)');
    werte.push(benutzer.id, benutzer.id);
  }
  if (abfrage.offene_auslagen === '1') {
    bedingungen.push("b.zahlungsart = 'privat' AND b.status = 'geprueft' AND b.rueckerstattung_id IS NULL");
  }
  if (abfrage.q) {
    const suche = `%${String(abfrage.q).trim()}%`;
    bedingungen.push(
      '(b.beschreibung LIKE ? OR b.haendler LIKE ? OR b.nummer LIKE ? OR b.notiz LIKE ?)'
    );
    werte.push(suche, suche, suche, suche);
  }

  return { where: bedingungen.join(' AND '), werte };
}

export const BELEG_AUSWAHL = `
  SELECT b.*,
         k.name    AS kasse_name,
         k.kuerzel AS kasse_kuerzel,
         k.farbe   AS kasse_farbe,
         p.name    AS bezahlt_von_name,
         e.name    AS erfasst_von_name,
         g.name    AS geprueft_von_name,
         r.datum   AS rueckerstattet_am,
         (SELECT COUNT(*) FROM beleg_dateien d WHERE d.beleg_id = b.id) AS anzahl_dateien
    FROM belege b
    JOIN kassen   k ON k.id = b.kasse_id
    LEFT JOIN benutzer p ON p.id = b.bezahlt_von
    LEFT JOIN benutzer e ON e.id = b.erfasst_von
    LEFT JOIN benutzer g ON g.id = b.geprueft_von
    LEFT JOIN rueckerstattungen r ON r.id = b.rueckerstattung_id
`;

export function belegeLaden(benutzer, abfrage, { limit = 500, offset = 0 } = {}) {
  const { where, werte } = belegFilter(benutzer, abfrage);
  const sortierung =
    {
      datum_auf: 'b.datum ASC, b.nummer ASC',
      nummer: 'b.kasse_id, b.jahr DESC, b.laufnummer DESC',
      betrag: 'b.betrag_rappen DESC',
      erfasst: 'b.erstellt_am DESC'
    }[abfrage.sortierung] || 'b.datum DESC, b.id DESC';

  const zeilen = db
    .prepare(`${BELEG_AUSWAHL} WHERE ${where} ORDER BY ${sortierung} LIMIT ? OFFSET ?`)
    .all(...werte, limit, offset);

  const gesamt = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(b.betrag_rappen), 0) AS summe
                FROM belege b WHERE ${where}`)
    .get(...werte);

  return { belege: zeilen, anzahl: gesamt.n, summe_rappen: gesamt.summe };
}
