// Exporte: Excel-Kostenuebersicht und Druckansicht aller Belege.
import express from 'express';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { db } from '../db.js';
import { angemeldet } from '../auth.js';
import { belegeLaden, sichtbarkeit } from '../belegabfrage.js';
import { abrechnungBerechnen, schuldenBerechnen } from './abrechnung.js';
import { alsZahl, ausRappen } from '../geld.js';

const router = express.Router();
router.use(angemeldet);

const ZAHLUNGSART_TEXT = {
  privat: 'privat ausgelegt',
  kasse_bar: 'Kasse bar',
  kasse_karte: 'Kassenkarte',
  rechnung: 'Rechnung'
};
const STATUS_TEXT = { offen: 'offen', geprueft: 'geprüft', abgelehnt: 'abgelehnt' };

function dateiName(req, endung) {
  const kassen = String(req.query.kasse || '')
    .split(',').map(Number).filter(Boolean);
  let teil = 'alle-Kassen';
  if (kassen.length === 1) {
    const kasse = db.prepare('SELECT kuerzel FROM kassen WHERE id = ?').get(kassen[0]);
    if (kasse) teil = kasse.kuerzel;
  }
  const von = req.query.von ? String(req.query.von).slice(0, 10) : 'Anfang';
  const bis = req.query.bis ? String(req.query.bis).slice(0, 10) : 'heute';
  return `Kassenbuch_${teil}_${von}_bis_${bis}.${endung}`;
}

// ------------------------------------------------------------------- Excel

router.get('/excel', async (req, res) => {
  const { belege } = belegeLaden(req.benutzer, req.query, { limit: 20000 });
  const zusammenzug = abrechnungBerechnen(req.benutzer, req.query);

  const mappe = new ExcelJS.Workbook();
  mappe.creator = 'Ce March Kasse';
  mappe.created = new Date();

  const kopfStil = (zeile) => {
    zeile.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    zeile.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4F9E' } };
    zeile.alignment = { vertical: 'middle' };
    zeile.height = 22;
  };

  // --- Blatt 1: Belege
  const blatt = mappe.addWorksheet('Belege', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  blatt.columns = [
    { header: 'Beleg-Nr.', key: 'nummer', width: 16 },
    { header: 'Datum', key: 'datum', width: 12 },
    { header: 'Kasse', key: 'kasse', width: 18 },
    { header: 'Beschreibung', key: 'beschreibung', width: 38 },
    { header: 'Händler', key: 'haendler', width: 20 },
    { header: 'Kategorie', key: 'kategorie', width: 16 },
    { header: 'Zahlungsart', key: 'zahlungsart', width: 18 },
    { header: 'Ausgelegt von', key: 'person', width: 20 },
    { header: 'Betrag CHF', key: 'betrag', width: 14 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Zurückerstattet', key: 'rueck', width: 16 },
    { header: 'Erfasst am', key: 'erfasst', width: 18 },
    { header: 'Fotos', key: 'dateien', width: 8 }
  ];
  kopfStil(blatt.getRow(1));

  for (const beleg of belege) {
    const zeile = blatt.addRow({
      nummer: beleg.nummer,
      datum: beleg.datum,
      kasse: `${beleg.kasse_kuerzel} – ${beleg.kasse_name}`,
      beschreibung: beleg.beschreibung,
      haendler: beleg.haendler || '',
      kategorie: beleg.kategorie,
      zahlungsart: ZAHLUNGSART_TEXT[beleg.zahlungsart] || beleg.zahlungsart,
      person: beleg.bezahlt_von_name || '',
      betrag: alsZahl(beleg.betrag_rappen),
      status: STATUS_TEXT[beleg.status] || beleg.status,
      rueck: beleg.rueckerstattet_am || (beleg.zahlungsart === 'privat' ? 'offen' : '–'),
      erfasst: (beleg.erstellt_am || '').slice(0, 16),
      dateien: beleg.anzahl_dateien
    });
    zeile.getCell('betrag').numFmt = '#,##0.00';
    if (beleg.status === 'abgelehnt') zeile.font = { strike: true, color: { argb: 'FF888888' } };
    if (beleg.status === 'offen') zeile.getCell('status').font = { color: { argb: 'FFD21A37' }, bold: true };
  }
  const summenZeile = blatt.addRow({
    beschreibung: 'Total',
    betrag: alsZahl(belege.reduce((s, b) => s + (b.status !== 'abgelehnt' ? b.betrag_rappen : 0), 0))
  });
  summenZeile.font = { bold: true };
  summenZeile.getCell('betrag').numFmt = '#,##0.00';
  blatt.autoFilter = { from: 'A1', to: `M1` };

  // --- Blatt 2: Einnahmen
  const gewaehlteKassen = String(req.query.kasse || '')
    .split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0);
  const erlaubteKassen = sichtbarkeit(req.benutzer).kassier
    .filter((id) => !gewaehlteKassen.length || gewaehlteKassen.includes(id));
  const einnahmenBlatt = mappe.addWorksheet('Einnahmen');
  einnahmenBlatt.columns = [
    { header: 'Datum', key: 'datum', width: 12 },
    { header: 'Kasse', key: 'kasse', width: 20 },
    { header: 'Beschreibung', key: 'beschreibung', width: 40 },
    { header: 'Kategorie', key: 'kategorie', width: 18 },
    { header: 'Betrag CHF', key: 'betrag', width: 14 }
  ];
  kopfStil(einnahmenBlatt.getRow(1));
  if (erlaubteKassen.length) {
    const bedingungen = [`e.kasse_id IN (${erlaubteKassen.map(() => '?').join(', ')})`];
    const werte = [...erlaubteKassen];
    if (req.query.von) { bedingungen.push('e.datum >= ?'); werte.push(String(req.query.von).slice(0, 10)); }
    if (req.query.bis) { bedingungen.push('e.datum <= ?'); werte.push(String(req.query.bis).slice(0, 10)); }
    const einnahmen = db
      .prepare(
        `SELECT e.*, k.kuerzel, k.name AS kasse_name FROM einnahmen e
           JOIN kassen k ON k.id = e.kasse_id
          WHERE ${bedingungen.join(' AND ')} ORDER BY e.datum`
      )
      .all(...werte);
    for (const eintrag of einnahmen) {
      const zeile = einnahmenBlatt.addRow({
        datum: eintrag.datum,
        kasse: `${eintrag.kuerzel} – ${eintrag.kasse_name}`,
        beschreibung: eintrag.beschreibung,
        kategorie: eintrag.kategorie,
        betrag: alsZahl(eintrag.betrag_rappen)
      });
      zeile.getCell('betrag').numFmt = '#,##0.00';
    }
  }

  // --- Blatt 3: Zusammenzug
  const uebersicht = mappe.addWorksheet('Zusammenzug');
  uebersicht.columns = [
    { header: '', key: 'a', width: 34 },
    { header: '', key: 'b', width: 18 },
    { header: '', key: 'c', width: 14 }
  ];
  const titel = uebersicht.addRow({ a: 'Kostenübersicht Ce March Kasse' });
  titel.font = { bold: true, size: 14 };
  uebersicht.addRow({
    a: 'Zeitraum',
    b: `${req.query.von || 'Anfang'} bis ${req.query.bis || 'heute'}`
  });
  uebersicht.addRow({});
  const zahl = (beschriftung, rappen, fett = false) => {
    const zeile = uebersicht.addRow({ a: beschriftung, b: alsZahl(rappen) });
    zeile.getCell('b').numFmt = '#,##0.00';
    if (fett) zeile.font = { bold: true };
    return zeile;
  };
  zahl('Startsaldo', zusammenzug.startsaldo_rappen);
  zahl('Einnahmen', zusammenzug.einnahmen_rappen);
  zahl('Ausgaben (geprüfte Belege)', -zusammenzug.ausgaben_rappen);
  zahl('Saldo', zusammenzug.saldo_rappen, true);
  uebersicht.addRow({});
  zahl('Noch offene Belege (ungeprüft)', zusammenzug.offen_rappen);

  uebersicht.addRow({});
  const k1 = uebersicht.addRow({ a: 'Nach Kategorie', b: 'Betrag CHF', c: 'Anzahl' });
  kopfStil(k1);
  for (const eintrag of zusammenzug.nach_kategorie) {
    const zeile = uebersicht.addRow({ a: eintrag.kategorie, b: alsZahl(eintrag.summe), c: eintrag.anzahl });
    zeile.getCell('b').numFmt = '#,##0.00';
  }

  uebersicht.addRow({});
  const k2 = uebersicht.addRow({ a: 'Nach Kasse', b: 'Betrag CHF', c: 'Anzahl' });
  kopfStil(k2);
  for (const eintrag of zusammenzug.nach_kasse) {
    const zeile = uebersicht.addRow({
      a: `${eintrag.kuerzel} – ${eintrag.name}`, b: alsZahl(eintrag.summe), c: eintrag.anzahl
    });
    zeile.getCell('b').numFmt = '#,##0.00';
  }

  // --- Blatt 4: offene Auslagen
  const schulden = schuldenBerechnen(req.benutzer, req.query);
  const schuldenBlatt = mappe.addWorksheet('Offene Auslagen');
  schuldenBlatt.columns = [
    { header: 'Person', key: 'person', width: 26 },
    { header: 'IBAN', key: 'iban', width: 30 },
    { header: 'Anzahl Belege', key: 'anzahl', width: 15 },
    { header: 'Ältester Beleg', key: 'aeltester', width: 16 },
    { header: 'Offen CHF', key: 'summe', width: 14 }
  ];
  kopfStil(schuldenBlatt.getRow(1));
  for (const person of schulden.personen) {
    const zeile = schuldenBlatt.addRow({
      person: person.name || 'unbekannt',
      iban: person.iban || '',
      anzahl: person.anzahl,
      aeltester: person.aeltester,
      summe: alsZahl(person.summe)
    });
    zeile.getCell('summe').numFmt = '#,##0.00';
  }
  const total = schuldenBlatt.addRow({ person: 'Total', summe: alsZahl(schulden.gesamt_rappen) });
  total.font = { bold: true };
  total.getCell('summe').numFmt = '#,##0.00';

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${dateiName(req, 'xlsx')}"`);
  await mappe.xlsx.write(res);
  res.end();
});

// --------------------------------------------------------------- Druckansicht

function escape(text) {
  return String(text ?? '').replace(/[&<>"']/g, (z) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z])
  );
}

router.get('/druck', (req, res) => {
  const { belege, summe_rappen: summe } = belegeLaden(req.benutzer, req.query, { limit: 5000 });
  const mitDateien = belege.map((beleg) => ({
    ...beleg,
    dateien: db
      .prepare('SELECT id, mime FROM beleg_dateien WHERE beleg_id = ? ORDER BY id')
      .all(beleg.id)
  }));

  const zeitraum = `${req.query.von || 'Anfang'} – ${req.query.bis || 'heute'}`;
  const kassenNamen = [...new Set(belege.map((b) => `${b.kasse_kuerzel} ${b.kasse_name}`))].join(', ') || '–';

  const liste = mitDateien
    .map(
      (b) => `<tr>
        <td class="nr">${escape(b.nummer)}</td>
        <td>${escape(b.datum)}</td>
        <td>${escape(b.beschreibung)}${b.haendler ? ` <span class="grau">(${escape(b.haendler)})</span>` : ''}</td>
        <td>${escape(b.bezahlt_von_name || '–')}</td>
        <td>${escape(STATUS_TEXT[b.status] || b.status)}</td>
        <td class="betrag">${ausRappen(b.betrag_rappen)}</td>
      </tr>`
    )
    .join('\n');

  const seiten = mitDateien
    .map((b) => {
      const bilder = b.dateien.length
        ? b.dateien
            .map((d) =>
              d.mime === 'application/pdf'
                ? `<p class="pdf-hinweis">PDF-Beleg: <a href="/api/belege/${b.id}/dateien/${d.id}">${escape(b.nummer)}.pdf</a> (bitte separat drucken)</p>`
                : `<img src="/api/belege/${b.id}/dateien/${d.id}" alt="Beleg ${escape(b.nummer)}">`
            )
            .join('\n')
        : '<p class="kein-beleg">Kein Foto hinterlegt</p>';
      return `<section class="beleg-seite">
        <header>
          <div class="nummer">${escape(b.nummer)}</div>
          <div class="kopf-zeilen">
            <div><strong>${escape(b.beschreibung)}</strong></div>
            <div>${escape(b.datum)} · ${escape(b.kasse_kuerzel)} ${escape(b.kasse_name)} · ${escape(b.kategorie)}</div>
            <div>${escape(ZAHLUNGSART_TEXT[b.zahlungsart] || b.zahlungsart)}${b.bezahlt_von_name ? ` · ${escape(b.bezahlt_von_name)}` : ''}</div>
          </div>
          <div class="betrag-gross">CHF ${ausRappen(b.betrag_rappen)}</div>
        </header>
        <div class="bilder">${bilder}</div>
      </section>`;
    })
    .join('\n');

  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}'; base-uri 'self'; form-action 'self'`
  );
  res.send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Belege drucken – ${escape(zeitraum)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #15161a; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .kopf { border-bottom: 3px solid #d21a37; padding-bottom: 10px; margin-bottom: 16px;
          display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .meta { color: #4a4b52; font-size: 12px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #1d4f9e; color: #fff; padding: 6px 8px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e7e0d1; vertical-align: top; }
  .nr { font-family: ui-monospace, "Courier New", monospace; white-space: nowrap; }
  .betrag { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grau { color: #87888f; }
  tfoot td { font-weight: 700; border-top: 2px solid #15161a; border-bottom: none; }
  .beleg-seite { page-break-before: always; break-before: page; padding-top: 4mm; }
  .beleg-seite header { display: grid; grid-template-columns: auto 1fr auto; gap: 12px;
      align-items: start; border-bottom: 2px solid #d21a37; padding-bottom: 8px; margin-bottom: 10px; }
  .nummer { font-family: ui-monospace, "Courier New", monospace; font-size: 15px; font-weight: 700;
            background: #15161a; color: #fff; padding: 4px 8px; border-radius: 6px; white-space: nowrap; }
  .kopf-zeilen { font-size: 12px; line-height: 1.5; }
  .betrag-gross { font-size: 20px; font-weight: 700; white-space: nowrap; }
  .bilder img { max-width: 100%; max-height: 220mm; object-fit: contain; display: block; margin: 0 auto 6mm; }
  .kein-beleg, .pdf-hinweis { color: #87888f; font-style: italic; font-size: 12px; }
  .druckleiste { position: sticky; top: 0; background: #fbf8f1; border: 1px solid #e7e0d1;
      padding: 10px 14px; margin-bottom: 14px; border-radius: 10px; display: flex; gap: 10px; align-items: center; }
  .druckleiste button { background: #d21a37; color: #fff; border: 0; padding: 8px 16px;
      border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
  @media print { .druckleiste { display: none; } }
</style>
</head>
<body>
<div class="druckleiste">
  <button id="drucken" type="button">Jetzt drucken / als PDF speichern</button>
  <span class="meta">${mitDateien.length} Belege · jede Seite ein Beleg mit Foto</span>
</div>

<div class="kopf">
  <div>
    <h1>Belegübersicht</h1>
    <div class="meta">
      Zeitraum: ${escape(zeitraum)}<br>
      Kassen: ${escape(kassenNamen)}<br>
      Gedruckt am ${new Date().toLocaleDateString('de-CH')}
    </div>
  </div>
  <div class="betrag-gross">CHF ${ausRappen(summe)}</div>
</div>

<table>
  <thead>
    <tr><th>Beleg-Nr.</th><th>Datum</th><th>Beschreibung</th><th>Ausgelegt von</th><th>Status</th><th class="betrag">CHF</th></tr>
  </thead>
  <tbody>${liste || '<tr><td colspan="6">Keine Belege im gewählten Zeitraum.</td></tr>'}</tbody>
  <tfoot><tr><td colspan="5">Total</td><td class="betrag">${ausRappen(summe)}</td></tr></tfoot>
</table>

${seiten}
<script nonce="${nonce}">
  document.getElementById('drucken').addEventListener('click', function () { window.print(); });
</script>
</body>
</html>`);
});

export default router;
